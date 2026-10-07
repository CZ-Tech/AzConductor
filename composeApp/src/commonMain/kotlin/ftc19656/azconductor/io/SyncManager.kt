package ftc19656.azconductor.io

import ftc19656.azconductor.TimingConfig
import ftc19656.azconductor.io.network.ApiResult
import ftc19656.azconductor.io.network.ConfigRouteSyncBaselineStore
import ftc19656.azconductor.io.network.LocalRouteRecord
import ftc19656.azconductor.io.network.QueuedRequestResponse
import ftc19656.azconductor.io.network.RobotConnection
import ftc19656.azconductor.io.network.OpModeActionResponse
import ftc19656.azconductor.io.network.OpModeDescriptorDto
import ftc19656.azconductor.io.network.RouteRepositorySyncAdapter
import ftc19656.azconductor.io.network.RouteSyncBaseline
import ftc19656.azconductor.io.network.RouteSyncConflict
import ftc19656.azconductor.io.network.RouteSyncEngine
import ftc19656.azconductor.route.RouteData
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.Json

/**
 * UI-facing synchronization facade backed entirely by Network V2.
 *
 * Robot state arrives through the long-lived SSE connection. Route synchronization runs
 * only after connection, a local persisted change, or a robot "routes" revision event;
 * there is no periodic robot polling.
 */
class SyncManager(
    private val jsonConfig: Json,
    private val configManager: ConfigManager,
    private val routeRepo: RouteRepository,
    private val connection: RobotConnection,
) {
    private val scope = CoroutineScope(Dispatchers.Default + SupervisorJob())
    private val localAdapter = RouteRepositorySyncAdapter(routeRepo, jsonConfig)
    private val baselineStore = ConfigRouteSyncBaselineStore(configManager)
    private val syncMutex = Mutex()
    private val conflictMutex = Mutex()

    private var routeSyncEngine = createSyncEngine(robotIp)

    private val _connectionStatus = MutableStateFlow("未连接")
    val connectionStatus: StateFlow<String> = _connectionStatus.asStateFlow()

    private val _availableCommands = MutableStateFlow<List<RobotCommandItem>>(emptyList())
    val availableCommands: StateFlow<List<RobotCommandItem>> = _availableCommands.asStateFlow()

    private val _opModeStatus = MutableStateFlow(OpModeStatusResponse())
    val opModeStatus: StateFlow<OpModeStatusResponse> = _opModeStatus.asStateFlow()

    private val _robotPosition = MutableStateFlow<RobotPositionResponse?>(null)
    val robotPosition: StateFlow<RobotPositionResponse?> = _robotPosition.asStateFlow()
    val routeRevision: StateFlow<Long> get() = connection.routeRevision

    private val _conflictState = MutableStateFlow<SyncConflictData?>(null)
    val conflictState: StateFlow<SyncConflictData?> = _conflictState.asStateFlow()

    private val conflictQueue = mutableListOf<RouteSyncConflict>()
    private var activeConflict: RouteSyncConflict? = null

    var onDataChanged: (() -> Unit)? = null
    var localRoutesProvider: (() -> List<RouteData>)? = null

    private val jobs = mutableListOf<Job>()
    private var autoSaveJob: Job? = null
    private var crossTabJob: Job? = null

    var robotIp: String
        get() = configManager["robot_ip"] ?: "192.168.43.1"
        set(value) {
            configManager["robot_ip"] = value
            scope.launch { reconnect(value) }
        }

    fun start(autoSaveIntervalMs: Long = TimingConfig.STORAGE_POLL_MS) {
        stopJobs()
        installConnectionCollectors()

        autoSaveJob = scope.launch {
            while (isActive) {
                delay(autoSaveIntervalMs)
                val provider = localRoutesProvider ?: continue
                if (routeRepo.saveIfChanged(provider())) {
                    syncWithRobot()
                }
            }
        }

        crossTabJob = routeRepo.watchExternalChanges {
            onDataChanged?.invoke()
            scope.launch { syncWithRobot() }
        }

        scope.launch { reconnect(robotIp) }
    }

    fun stop() {
        stopJobs()
        _connectionStatus.value = "未连接"
        _opModeStatus.value = OpModeStatusResponse()
        _robotPosition.value = null
        scope.launch { connection.disconnect() }
    }

    private fun stopJobs() {
        jobs.forEach { it.cancel() }
        jobs.clear()
        autoSaveJob?.cancel()
        autoSaveJob = null
        crossTabJob?.cancel()
        crossTabJob = null
    }

    private fun installConnectionCollectors() {
        jobs += scope.launch {
            connection.state.collect { state ->
                _connectionStatus.value = when (state) {
                    RobotConnection.State.Disconnected -> "未连接"
                    RobotConnection.State.Connecting -> "正在连接..."
                    is RobotConnection.State.Connected -> "已连接"
                    is RobotConnection.State.Rejected ->
                        if (state.owner.isNullOrBlank()) "机器人已连接到其他电脑"
                        else "机器人已连接到 ${state.owner}"
                    is RobotConnection.State.Failed -> "连接失败"
                }
                if (state !is RobotConnection.State.Connected) {
                    _opModeStatus.value = OpModeStatusResponse()
                    _robotPosition.value = null
                }
            }
        }

        jobs += scope.launch {
            connection.pose.collect { pose ->
                _robotPosition.value = pose?.let {
                    RobotPositionResponse(
                        x = it.x,
                        y = it.y,
                        heading = it.heading,
                    )
                }
            }
        }

        jobs += scope.launch {
            combine(
                connection.opMode,
                connection.execution,
                _availableCommands,
            ) { opMode, execution, commands ->
                val phase = opMode?.phase ?: "STOPPED"
                val active = phase != "STOPPED"
                OpModeStatusResponse(
                    revision = opMode?.revision ?: 0,
                    controllerAvailable = opMode?.controllerAvailable == true,
                    phase = phase,
                    opModeActive = active,
                    executionReady =
                        phase == "RUNNING"
                            && execution != null
                            && execution.state != "NOT_READY",
                    isExecuting = execution?.state == "RUNNING",
                    activeOpModeName = opMode?.activeName,
                    commandCount = commands.size,
                    commandsReady = if (active) commands.size else 0,
                )
            }.collect { _opModeStatus.value = it }
        }

        jobs += scope.launch {
            connection.routeRevision.collect { revision ->
                if (revision > 0 && connection.state.value is RobotConnection.State.Connected) {
                    syncWithRobot()
                }
            }
        }

        jobs += scope.launch {
            connection.commandRevision.collect { revision ->
                if (revision > 0 && connection.state.value is RobotConnection.State.Connected) {
                    refreshCommands()
                }
            }
        }
    }

    private suspend fun reconnect(ip: String) {
        connection.disconnect()
        clearConflicts()

        if (ip.isBlank()) {
            connection.updateRobotIp(ip)
            _connectionStatus.value = "未配置IP"
            return
        }

        connection.updateRobotIp(ip)
        routeSyncEngine = createSyncEngine(ip)

        when (connection.connect()) {
            is ApiResult.Ok -> {
                refreshCommands()
                syncWithRobot()
            }
            is ApiResult.HttpError,
            is ApiResult.NetworkError -> Unit
        }
    }

    private fun createSyncEngine(robotKey: String): RouteSyncEngine =
        RouteSyncEngine(
            robotKey = robotKey,
            api = connection.apiClient(),
            local = localAdapter,
            baselines = baselineStore,
        )

    suspend fun listRobotPaths(): List<String> =
        when (val result = connection.apiClient().listRoutes()) {
            is ApiResult.Ok -> result.value.routes.map { it.name }
            else -> emptyList()
        }

    suspend fun pullRoute(pathName: String): String? =
        when (val result = connection.apiClient().getRoute(pathName)) {
            is ApiResult.Ok -> result.value.json
            else -> null
        }

    suspend fun executeSavedPath(pathName: String): ApiResult<QueuedRequestResponse> =
        connection.apiClient().executeSavedPath(pathName)

    suspend fun executeTempPath(jsonBody: String): ApiResult<QueuedRequestResponse> =
        try {
            connection.apiClient().executeInlinePath(
                jsonConfig.parseToJsonElement(jsonBody)
            )
        } catch (t: Throwable) {
            ApiResult.NetworkError("Invalid trajectory JSON", t)
        }

    suspend fun listOpModes(): ApiResult<List<OpModeDescriptorDto>> =
        when (val result = connection.apiClient().listOpModes()) {
            is ApiResult.Ok -> ApiResult.Ok(result.value.opModes, result.status)
            is ApiResult.HttpError -> result
            is ApiResult.NetworkError -> result
        }

    suspend fun initOpMode(
        name: String,
        expectedRevision: Long,
    ): ApiResult<OpModeActionResponse> =
        connection.apiClient().initOpMode(name, expectedRevision)

    suspend fun startOpMode(
        name: String,
        expectedRevision: Long,
    ): ApiResult<OpModeActionResponse> =
        connection.apiClient().startOpMode(name, expectedRevision)

    suspend fun stopOpMode(
        name: String,
        expectedRevision: Long,
    ): ApiResult<OpModeActionResponse> =
        connection.apiClient().stopOpMode(name, expectedRevision)

    suspend fun saveToRobot(pathName: String, pointsJson: String) {
        val api = connection.apiClient()
        val manifest = api.listRoutes()
        val expected = if (manifest is ApiResult.Ok) {
            manifest.value.routes.firstOrNull { it.name == pathName }?.revision ?: 0
        } else {
            throw IllegalStateException("Unable to read robot route manifest")
        }

        when (val result = api.putRoute(pathName, pointsJson, expected)) {
            is ApiResult.Ok -> {
                baselineStore.put(
                    robotIp,
                    RouteSyncBaseline(
                        routeName = pathName,
                        localFingerprint = LocalRouteRecord(pathName, pointsJson).fingerprint,
                        remoteRevision = result.value.revision,
                    )
                )
            }
            is ApiResult.HttpError ->
                throw IllegalStateException(
                    "Robot rejected route write: HTTP " + result.status
                )
            is ApiResult.NetworkError -> throw IllegalStateException(result.message)
        }
    }

    suspend fun deleteFromRobot(pathName: String): Boolean {
        val api = connection.apiClient()
        val manifest = api.listRoutes()
        if (manifest !is ApiResult.Ok) return false
        val revision = manifest.value.routes.firstOrNull { it.name == pathName }?.revision
            ?: return true

        return when (api.deleteRoute(pathName, revision)) {
            is ApiResult.Ok -> {
                baselineStore.remove(robotIp, pathName)
                true
            }
            else -> false
        }
    }

    private suspend fun refreshCommands() {
        when (val result = connection.apiClient().commandCatalog()) {
            is ApiResult.Ok -> {
                _availableCommands.value = result.value.commands.map { command ->
                    RobotCommandItem(
                        name = command.name,
                        params = command.paramTypes,
                        paramNames = command.paramNames,
                        ready = true,
                    )
                }
            }
            else -> Unit
        }
    }

    private suspend fun syncWithRobot() {
        if (connection.state.value !is RobotConnection.State.Connected) return

        syncMutex.withLock {
            val report = routeSyncEngine.syncOnce()
            if (report.pulled.isNotEmpty()) {
                onDataChanged?.invoke()
            }
            if (report.conflicts.isNotEmpty()) {
                queueConflicts(report.conflicts)
            }
            if (report.failures.isNotEmpty()) {
                println("SyncManager: " + report.failures.joinToString("; "))
            }
        }
    }

    private suspend fun queueConflicts(conflicts: List<RouteSyncConflict>) {
        conflictMutex.withLock {
            for (conflict in conflicts) {
                if (activeConflict?.routeName == conflict.routeName) continue
                if (conflictQueue.any { it.routeName == conflict.routeName }) continue
                conflictQueue += conflict
            }
            showNextConflictLocked()
        }
    }

    fun resolveKeepLocal() {
        val conflict = activeConflict ?: return
        scope.launch {
            when (routeSyncEngine.resolveKeepLocal(conflict)) {
                is ApiResult.Ok -> removeResolvedConflict(conflict)
                else -> Unit
            }
        }
    }

    fun resolveKeepRemote() {
        val conflict = activeConflict ?: return
        scope.launch {
            when (routeSyncEngine.resolveKeepRemote(conflict)) {
                is ApiResult.Ok -> {
                    onDataChanged?.invoke()
                    removeResolvedConflict(conflict)
                }
                else -> Unit
            }
        }
    }

    fun resolveKeepBoth() {
        val conflict = activeConflict ?: return
        if (conflict.localJson == null) {
            resolveKeepRemote()
            return
        }
        if (conflict.remoteJson == null) {
            resolveKeepLocal()
            return
        }

        scope.launch {
            val allRoutes = routeRepo.loadAll()
            var renamed = conflict.routeName + "(电脑端)"
            var suffix = 1
            while (allRoutes.any { it.name == renamed }) {
                suffix++
                renamed = conflict.routeName + "(电脑端" + suffix + ")"
            }

            val localRoute = routeRepo.load(conflict.routeName)
            if (localRoute != null) {
                routeRepo.delete(conflict.routeName)
                routeRepo.save(localRoute.copy(name = renamed))
            }

            when (routeSyncEngine.resolveKeepRemote(conflict)) {
                is ApiResult.Ok -> {
                    onDataChanged?.invoke()
                    removeResolvedConflict(conflict)
                    syncWithRobot()
                }
                else -> Unit
            }
        }
    }

    private suspend fun removeResolvedConflict(conflict: RouteSyncConflict) {
        conflictMutex.withLock {
            if (activeConflict?.routeName == conflict.routeName) {
                activeConflict = null
                _conflictState.value = null
            }
            conflictQueue.removeAll { it.routeName == conflict.routeName }
            showNextConflictLocked()
        }
    }

    private fun showNextConflictLocked() {
        if (activeConflict != null || conflictQueue.isEmpty()) return
        val next = conflictQueue.removeAt(0)
        activeConflict = next
        _conflictState.value = SyncConflictData(
            pathName = next.routeName,
            localJson = next.localJson,
            remoteJson = next.remoteJson,
            reason = next.reason.name,
        )
    }

    private suspend fun clearConflicts() {
        conflictMutex.withLock {
            conflictQueue.clear()
            activeConflict = null
            _conflictState.value = null
        }
    }
}
