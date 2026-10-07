package ftc19656.azconductor.io.network

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.json.Json

class RobotConnection(
    robotIp: String,
    private val json: Json,
    private val clientName: String = "AzConductor",
    port: Int = 8888,
    private val transport: RobotTransport = PlatformRobotTransport,
) {
    sealed interface State {
        data object Disconnected : State
        data object Connecting : State
        data class Connected(val token: String) : State
        data class Rejected(val owner: String?, val retryAfterMs: Long?) : State
        data class Failed(val message: String) : State
    }

    private val api = RobotApiClient(robotIp, json, port, transport)
    private var eventHandle: NetworkEventHandle? = null

    private val _state = MutableStateFlow<State>(State.Disconnected)
    val state: StateFlow<State> = _state.asStateFlow()

    private val _pose = MutableStateFlow<PoseEvent?>(null)
    val pose: StateFlow<PoseEvent?> = _pose.asStateFlow()

    private val _runtime = MutableStateFlow<RuntimeEvent?>(null)
    val runtime: StateFlow<RuntimeEvent?> = _runtime.asStateFlow()

    private val _execution = MutableStateFlow<ExecutionSnapshotDto?>(null)
    val execution: StateFlow<ExecutionSnapshotDto?> = _execution.asStateFlow()

    private val _opMode = MutableStateFlow<OpModeSnapshotDto?>(null)
    val opMode: StateFlow<OpModeSnapshotDto?> = _opMode.asStateFlow()

    private val _routeRevision = MutableStateFlow(0L)
    val routeRevision: StateFlow<Long> = _routeRevision.asStateFlow()

    private val _commandRevision = MutableStateFlow(0L)
    val commandRevision: StateFlow<Long> = _commandRevision.asStateFlow()

    private val _lastHeartbeatMs = MutableStateFlow<Long?>(null)
    val lastHeartbeatMs: StateFlow<Long?> = _lastHeartbeatMs.asStateFlow()

    fun apiClient(): RobotApiClient = api

    suspend fun connect(): ApiResult<Unit> {
        eventHandle?.close()
        eventHandle = null
        _state.value = State.Connecting

        return when (val opened = api.openSession(clientName)) {
            is ApiResult.Ok -> {
                val token = opened.value.token
                val eventUrl = api.eventUrl()
                    ?: return ApiResult.NetworkError("Session opened without event URL")
                openEvents(eventUrl)
                _state.value = State.Connected(token)
                ApiResult.Ok(Unit, opened.status)
            }
            is ApiResult.HttpError -> {
                val parsed = runCatching {
                    json.decodeFromString<ApiErrorResponse>(opened.body)
                }.getOrNull()
                if (opened.status == 409 && opened.code == "already_connected") {
                    _state.value = State.Rejected(
                        owner = parsed?.owner,
                        retryAfterMs = parsed?.retryAfterMs,
                    )
                } else {
                    _state.value = State.Failed(
                        opened.message ?: "HTTP " + opened.status
                    )
                }
                opened
            }
            is ApiResult.NetworkError -> {
                _state.value = State.Failed(opened.message)
                opened
            }
        }
    }

    suspend fun disconnect() {
        eventHandle?.close()
        eventHandle = null
        if (api.token != null) api.closeSession()
        _state.value = State.Disconnected
    }

    fun updateRobotIp(robotIp: String) {
        eventHandle?.close()
        eventHandle = null
        api.updateRobotIp(robotIp)
        _state.value = State.Disconnected
        clearRuntimeState()
    }

    private fun openEvents(url: String) {
        eventHandle = transport.openEventStream(
            url = url,
            eventNames = EVENT_NAMES,
            onOpen = {},
            onEvent = { event, data, _ -> handleEvent(event, data) },
            onError = { message ->
                if (_state.value is State.Connected) {
                    _state.value = State.Failed(message)
                }
            },
        )
    }

    private fun handleEvent(event: String, data: String) {
        try {
            when (event) {
                "pose" -> _pose.value = json.decodeFromString<PoseEvent>(data)
                "runtime" -> _runtime.value = json.decodeFromString<RuntimeEvent>(data)
                "execution" -> _execution.value =
                    json.decodeFromString<ExecutionSnapshotDto>(data)
                "opmode" -> _opMode.value =
                    json.decodeFromString<OpModeSnapshotDto>(data)
                "routes" -> _routeRevision.value =
                    json.decodeFromString<RevisionEvent>(data).revision
                "commands" -> _commandRevision.value =
                    json.decodeFromString<RevisionEvent>(data).revision
                "heartbeat" -> _lastHeartbeatMs.value =
                    json.decodeFromString<HeartbeatEvent>(data).t
            }
        } catch (t: Throwable) {
            _state.value = State.Failed(
                "Invalid " + event + " event: " + (t.message ?: "decode failed")
            )
        }
    }

    private fun clearRuntimeState() {
        _pose.value = null
        _runtime.value = null
        _execution.value = null
        _opMode.value = null
        _routeRevision.value = 0
        _commandRevision.value = 0
        _lastHeartbeatMs.value = null
    }

    companion object {
        private val EVENT_NAMES = listOf(
            "hello",
            "pose",
            "runtime",
            "execution",
            "opmode",
            "routes",
            "commands",
            "heartbeat",
        )
    }
}
