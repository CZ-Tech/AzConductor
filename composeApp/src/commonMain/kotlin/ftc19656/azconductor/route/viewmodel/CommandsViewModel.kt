package ftc19656.azconductor.route.viewmodel

import androidx.lifecycle.ViewModel
import ftc19656.azconductor.AppContext
import ftc19656.azconductor.io.OpModeStatusResponse
import ftc19656.azconductor.io.RobotPositionResponse
import ftc19656.azconductor.io.SyncManager
import ftc19656.azconductor.io.network.ApiResult
import ftc19656.azconductor.io.network.QueuedRequestResponse
import ftc19656.azconductor.io.network.OpModeActionResponse
import ftc19656.azconductor.io.network.OpModeDescriptorDto
import ftc19656.azconductor.route.ControlNode
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.decodeFromString

class CommandsViewModel(
    private val syncManager: SyncManager,
) : ViewModel() {

    private val _robotPaths = MutableStateFlow<List<String>>(emptyList())
    val robotPaths: StateFlow<List<String>> = _robotPaths.asStateFlow()

    private val _opModes = MutableStateFlow<List<OpModeDescriptorDto>>(emptyList())
    val opModes: StateFlow<List<OpModeDescriptorDto>> = _opModes.asStateFlow()

    /** SSE-backed OpMode/runtime state. */
    val opModeStatus: StateFlow<OpModeStatusResponse> get() = syncManager.opModeStatus

    /** 60 Hz SSE robot pose stream. */
    val robotPosition: StateFlow<RobotPositionResponse?> get() = syncManager.robotPosition

    private val _executionStatus = MutableStateFlow<String?>(null)
    val executionStatus: StateFlow<String?> = _executionStatus.asStateFlow()

    private val _opModeActionStatus = MutableStateFlow<String?>(null)
    val opModeActionStatus: StateFlow<String?> = _opModeActionStatus.asStateFlow()

    private val _fetchedWaypoints = MutableStateFlow<List<ControlNode>>(emptyList())
    val fetchedWaypoints: StateFlow<List<ControlNode>> = _fetchedWaypoints.asStateFlow()

    private val scope = CoroutineScope(Dispatchers.Default + SupervisorJob())

    init {
        scope.launch {
            refresh()
            refreshOpModes()
            syncManager.routeRevision
                .collect { revision ->
                    if (revision > 0) refresh()
                }
        }
        scope.launch {
            syncManager.opModeStatus.collect { status ->
                if (status.controllerAvailable) refreshOpModes()
            }
        }
    }

    suspend fun refresh() {
        try {
            _robotPaths.value = syncManager.listRobotPaths()
        } catch (_: Exception) {
            _robotPaths.value = emptyList()
        }
    }

    suspend fun fetchPathData(pathName: String) {
        try {
            val routeJson = syncManager.pullRoute(pathName)
            if (routeJson != null) {
                val points =
                    AppContext.jsonConfig.decodeFromString<List<ControlNode>>(routeJson)
                _fetchedWaypoints.value = points
            } else {
                _fetchedWaypoints.value = emptyList()
            }
        } catch (_: Exception) {
            _fetchedWaypoints.value = emptyList()
        }
    }

    suspend fun refreshOpModes() {
        when (val result = syncManager.listOpModes()) {
            is ApiResult.Ok -> _opModes.value = result.value
            is ApiResult.HttpError,
            is ApiResult.NetworkError -> Unit
        }
    }

    suspend fun initOpMode(name: String) {
        val status = opModeStatus.value
        _opModeActionStatus.value = "正在 INIT..."
        _opModeActionStatus.value = opModeActionMessage(
            syncManager.initOpMode(name, status.revision),
            "INIT 请求已接受",
        )
    }

    suspend fun startOpMode() {
        val status = opModeStatus.value
        val name = status.activeOpModeName ?: return
        _opModeActionStatus.value = "正在 START..."
        _opModeActionStatus.value = opModeActionMessage(
            syncManager.startOpMode(name, status.revision),
            "START 请求已接受",
        )
    }

    suspend fun stopOpMode() {
        val status = opModeStatus.value
        val name = status.activeOpModeName ?: return
        _opModeActionStatus.value = "正在 STOP..."
        _opModeActionStatus.value = opModeActionMessage(
            syncManager.stopOpMode(name, status.revision),
            "STOP 请求已接受",
        )
    }

    suspend fun executeSavedPath(pathName: String) {
        _executionStatus.value = "正在执行..."
        val result = try {
            syncManager.executeSavedPath(pathName)
        } catch (t: Throwable) {
            ApiResult.NetworkError(t.message ?: "网络错误", t)
        }
        _executionStatus.value = executionMessage(result)
    }

    suspend fun executeTempPath(json: String) {
        _executionStatus.value = "正在执行..."
        val result = try {
            syncManager.executeTempPath(json)
        } catch (t: Throwable) {
            ApiResult.NetworkError(t.message ?: "网络错误", t)
        }
        _executionStatus.value = executionMessage(result)
    }

    fun clearExecutionStatus() {
        _executionStatus.value = null
    }

    fun clearOpModeActionStatus() {
        _opModeActionStatus.value = null
    }

    private fun executionMessage(result: ApiResult<QueuedRequestResponse>): String =
        when (result) {
            is ApiResult.Ok -> when {
                result.value.accepted -> "执行已触发"
                result.value.dropped &&
                    result.value.reason == "no_active_opmode" ->
                    "已丢弃：机器人没有活动 OpMode"
                result.value.dropped -> "已丢弃"
                else -> "未执行"
            }

            is ApiResult.HttpError -> {
                val detail = result.message?.let { " - " + it } ?: ""
                "执行失败：HTTP " + result.status + detail
            }

            is ApiResult.NetworkError -> "执行失败：" + result.message
        }

    private fun opModeActionMessage(
        result: ApiResult<OpModeActionResponse>,
        acceptedText: String,
    ): String = when (result) {
        is ApiResult.Ok -> acceptedText
        is ApiResult.HttpError -> {
            val detail = result.message?.let { " - " + it } ?: ""
            "OpMode 操作失败：HTTP " + result.status + detail
        }
        is ApiResult.NetworkError -> "OpMode 操作失败：" + result.message
    }
}
