package ftc19656.azconductor.route.viewmodel

import ftc19656.azconductor.io.ConfigManager
import ftc19656.azconductor.io.RobotSyncService
import ftc19656.azconductor.route.ControlNode
import ftc19656.azconductor.route.OrientedTrajectoryGenerator2D
import ftc19656.azconductor.route.RouteCore
import ftc19656.azconductor.route.RouteData
import ftc19656.azconductor.io.RobotCommandItem
import ftc19656.azconductor.io.RouteRepository
import ftc19656.azconductor.io.SyncConflictData
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.serialization.encodeToString
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json

class RouteConnector {

    private val jsonConfig = Json {
        prettyPrint = true
        encodeDefaults = true
        ignoreUnknownKeys = true
    }

    private val configManager = ConfigManager.getOrCreate("route")

    private val routeRepo = RouteRepository(jsonConfig, configManager)

    // ---- Robot sync service ----

    private val robotSyncService = RobotSyncService(
        jsonConfig = jsonConfig,
        scope = CoroutineScope(Dispatchers.Default + SupervisorJob()),
        onConnectionStatusChange = { status -> _connectionStatus.value = status },
        onCommandsRefreshed = { commands -> _availableCommands.value = commands },
        onConflictDetected = { conflict ->
            conflictQueue.add(conflict)
            if (_syncConflict.value == null) {
                _syncConflict.value = conflictQueue.removeAt(0)
            }
        },
        getLocalRoutes = { _allRoutes.value },
        getActiveConflictName = { _syncConflict.value?.pathName },
        isNameInConflictQueue = { name -> conflictQueue.any { it.pathName == name } },
    )

    // ---- Remote connection ----

    var robotIp: String
        get() = configManager["robot_ip"] ?: "192.168.43.1"
        set(value) {
            configManager["robot_ip"] = value
            robotSyncService.setRobotIp(value)
            if (value.isBlank()) {
                _connectionStatus.value = "未配置IP"
            }
        }

    // ---- Observable state ----

    private val _pathVersion = MutableStateFlow(0)
    val pathVersion: StateFlow<Int> = _pathVersion.asStateFlow()

    private val _connectionStatus = MutableStateFlow("未配置IP")
    val connectionStatus: StateFlow<String> = _connectionStatus.asStateFlow()

    private val _availableCommands = MutableStateFlow<List<RobotCommandItem>>(emptyList())
    val availableCommands: StateFlow<List<RobotCommandItem>> = _availableCommands.asStateFlow()

    private val _currentRouteName = MutableStateFlow("默认路径")
    val currentRouteName: StateFlow<String> = _currentRouteName.asStateFlow()

    private val _syncConflict = MutableStateFlow<SyncConflictData?>(null)
    val syncConflict: StateFlow<SyncConflictData?> = _syncConflict.asStateFlow()

    private val conflictQueue = mutableListOf<SyncConflictData>()

    init {
        val storedIp = configManager["robot_ip"] ?: "192.168.43.1"
        if (storedIp.isNotBlank()) {
            robotSyncService.setRobotIp(storedIp)
            _connectionStatus.value = "就绪"
        }
    }

    // ---- Conflict resolution ----

    private fun popNextConflict() {
        _syncConflict.value = if (conflictQueue.isNotEmpty()) conflictQueue.removeAt(0) else null
    }

    /**
     * Keep the local version, discard the remote version.
     */
    fun resolveConflictKeepLocal() {
        val conflict = _syncConflict.value ?: return
        // Push the local version to the robot so the conflict won't reappear on the next sync cycle.
        val localRoute = _allRoutes.value.find { it.name == conflict.pathName }
        if (localRoute != null) {
            val localJson = jsonConfig.encodeToString(localRoute.points)
            robotSyncService.sendToRobot(localJson, conflict.pathName)
        }
        popNextConflict()
    }

    /**
     * Replace local waypoints with the robot version.
     */
    fun resolveConflictKeepRemote() {
        val conflict = _syncConflict.value ?: return
        try {
            val points = jsonConfig.decodeFromString<List<ControlNode>>(conflict.remoteJson)
            _allRoutes.value = _allRoutes.value.map { route ->
                if (route.name == conflict.pathName) route.copy(points = points) else route
            }
            if (_currentRouteName.value == conflict.pathName) {
                _waypoints.value = points
                routeLogic.setWaypoints(points)
                _pathVersion.update { it + 1 }
            }
            // Persist to local storage only (don't re-send to robot)
            persistLocal()
        } catch (_: Exception) {
            println("RouteConnector: failed to apply remote version for '${conflict.pathName}'")
        }
        popNextConflict()
    }

    /**
     * Keep both versions: rename the local version (e.g. "默认路径(电脑端)")
     * and download the robot version under the original name.
     */
    fun resolveConflictKeepBoth() {
        val conflict = _syncConflict.value ?: return
        try {
            // 1. Generate new name for the local version
            var localNewName = "${conflict.pathName}(电脑端)"
            var suffix = 1
            while (_allRoutes.value.any { it.name == localNewName }) {
                suffix++
                localNewName = "${conflict.pathName}(电脑端$suffix)"
            }
            // 2. Rename local route
            _allRoutes.value = _allRoutes.value.map { route ->
                if (route.name == conflict.pathName) route.copy(name = localNewName) else route
            }
            // 3. Add robot version under original name
            val points = jsonConfig.decodeFromString<List<ControlNode>>(conflict.remoteJson)
            _allRoutes.value = _allRoutes.value + RouteData(name = conflict.pathName, points = points)
            // 4. If currently editing the conflict path, switch waypoints to robot version
            if (_currentRouteName.value == conflict.pathName) {
                _waypoints.value = points
                routeLogic.setWaypoints(points)
                _pathVersion.update { it + 1 }
            }
            // 5. Persist locally
            persistLocal()
        } catch (_: Exception) {
            println("RouteConnector: failed to keep both versions for '${conflict.pathName}'")
        }
        popNextConflict()
    }

    // ---- Robot path listing ----

    /**
     * Fetch the list of saved path names from the robot via GET /list.
     * Returns an empty list on failure or if the robot is unreachable.
     * Does NOT store any ViewModel state — the caller decides what to cache.
     */
    suspend fun listRobotPaths(): List<String> = robotSyncService.listRobotPaths()

    // ---- Internal model ----

    private val routeLogic = RouteCore()
    private val _waypoints = MutableStateFlow<List<ControlNode>>(emptyList())
    val waypoints: StateFlow<List<ControlNode>> = _waypoints.asStateFlow()

    private val _allRoutes = MutableStateFlow(listOf(RouteData(name = "默认路径")))
    private var lastPersistedHash = 0

    init {
        val loadedRoutes = routeRepo.loadAll()
        if (loadedRoutes.isNotEmpty()) {
            _allRoutes.value = loadedRoutes
            val first = loadedRoutes.first()
            _currentRouteName.value = first.name
            _waypoints.value = first.points
            routeLogic.setWaypoints(first.points)
            lastPersistedHash = loadedRoutes.hashCode()
        }
    }

    val trajectoryList: List<OrientedTrajectoryGenerator2D>
        get() = routeLogic.trajectoryList

    val lastPoint: ControlNode? get() = routeLogic.lastPoint
    val totalLength: Double get() = routeLogic.totalLength

    fun getTotalTime() = routeLogic.totalTime

    // ---- Route management ----

    fun getRouteNames(): List<String> = _allRoutes.value.map { it.name }

    fun createRoute(name: String) {
        if (_allRoutes.value.any { it.name == name }) return
        _allRoutes.value = _allRoutes.value + RouteData(name = name)
        switchRoute(name)
        persist()
    }

    fun switchRoute(name: String) {
        val route = _allRoutes.value.find { it.name == name } ?: return
        _currentRouteName.value = name
        _waypoints.value = route.points
        routeLogic.setWaypoints(route.points)
        _pathVersion.update { it + 1 }
    }

    fun deleteRoute(name: String) {
        _allRoutes.value = _allRoutes.value.filter { it.name != name }
        if (_allRoutes.value.isEmpty()) {
            _currentRouteName.value = ""
            _waypoints.value = emptyList()
            routeLogic.setWaypoints(emptyList())
            _pathVersion.update { it + 1 }
        } else if (_currentRouteName.value == name) {
            val next = _allRoutes.value.first()
            switchRoute(next.name)
        }
        persist()
    }

    fun renameRoute(oldName: String, newName: String) {
        if (oldName == newName || _allRoutes.value.any { it.name == newName }) return
        _allRoutes.value = _allRoutes.value.map { if (it.name == oldName) it.copy(name = newName) else it }
        if (_currentRouteName.value == oldName) {
            _currentRouteName.value = newName
        }
        persist()
    }

    fun moveRouteOrder(fromIndex: Int, toIndex: Int) {
        if (fromIndex !in _allRoutes.value.indices || toIndex !in _allRoutes.value.indices || fromIndex == toIndex) return
        _allRoutes.value = _allRoutes.value.toMutableList().apply {
            val item = removeAt(fromIndex)
            add(toIndex, item)
        }
        persist()
    }

    // ---- Persistence ----

    private fun syncAndSave() {
        val updated = _allRoutes.value.map { route ->
            if (route.name == _currentRouteName.value) route.copy(points = _waypoints.value.toList())
            else route
        }
        _allRoutes.value = updated
        persist()
    }

    /** Save all routes to local storage AND send the current route to the robot. */
    private fun persist() {
        persistLocal()
        robotSyncService.sendToRobot(
            jsonConfig.encodeToString(_waypoints.value.toList()),
            _currentRouteName.value
        )
    }

    /** Save all routes to local storage only (without sending to the robot). */
    private fun persistLocal() {
        routeRepo.saveAll(_allRoutes.value)
        lastPersistedHash = _allRoutes.value.hashCode()
        configManager[RouteRepository.STORAGE_KEY] = lastPersistedHash.toString()
    }

    // ---- Auto-save watcher ----

    private var autoSaveJob: Job? = null

    fun startAutoSaveWatcher() {
        stopAutoSaveWatcher()

        autoSaveJob = configManager.watchPath(
            pathKey = RouteRepository.STORAGE_KEY,
            intervalMs = 50L
        ) { newValue ->
            val remoteHash = newValue.toIntOrNull() ?: return@watchPath
            if (remoteHash != lastPersistedHash) {
                val parsed = routeRepo.loadAll()
                if (parsed.isEmpty()) return@watchPath
                lastPersistedHash = remoteHash
                val current = parsed.find { it.name == _currentRouteName.value }
                if (current != null) {
                    _waypoints.value = current.points
                    routeLogic.setWaypoints(current.points)
                    _pathVersion.update { it + 1 }
                }
                _allRoutes.value = parsed
            }
        }
    }

    fun stopAutoSaveWatcher() {
        autoSaveJob?.cancel()
        autoSaveJob = null
    }

    // ---- CRUD with auto-persist ----

    fun addPoint(point: ControlNode) {
        routeLogic.addPoint(point)
        _waypoints.value = _waypoints.value + point
        _pathVersion.update { it + 1 }
        syncAndSave()
    }

    fun addPointAt(index: Int, point: ControlNode) {
        routeLogic.addPointAt(index, point)
        _waypoints.value = _waypoints.value.toMutableList().apply { add(index, point) }
        _pathVersion.update { it + 1 }
        syncAndSave()
    }

    fun setWaypoints(points: List<ControlNode>) {
        routeLogic.setWaypoints(points)
        _waypoints.value = points
        _pathVersion.update { it + 1 }
        syncAndSave()
    }

    fun moveNode(index: Int, newPoint: ControlNode) {
        routeLogic.moveNode(index, newPoint)
        if (index in _waypoints.value.indices) {
            _waypoints.value = _waypoints.value.toMutableList().apply { this[index] = newPoint }
            _pathVersion.update { it + 1 }
            syncAndSave()
        }
    }

    fun moveNodeOrder(fromIndex: Int, toIndex: Int) {
        if (fromIndex !in _waypoints.value.indices || toIndex !in _waypoints.value.indices || fromIndex == toIndex) return
        routeLogic.moveNodeOrder(fromIndex, toIndex)
        _waypoints.value = _waypoints.value.toMutableList().apply {
            val node = removeAt(fromIndex)
            add(toIndex, node)
        }
        _pathVersion.update { it + 1 }
        syncAndSave()
    }

    fun removeNode(index: Int) {
        routeLogic.removeNode(index)
        if (index in _waypoints.value.indices) {
            _waypoints.value = _waypoints.value.toMutableList().apply { removeAt(index) }
            _pathVersion.update { it + 1 }
            syncAndSave()
        }
    }

    fun moveNode(sourceNode: ControlNode, destinationNode: ControlNode) {
        val index = _waypoints.value.indexOfFirst { it isCloseTo sourceNode }
        if (index != -1) moveNode(index, destinationNode)
    }

    fun removeNode(point2D: ControlNode) {
        val index = _waypoints.value.indexOfFirst { it isCloseTo point2D }
        if (index != -1) removeNode(index)
    }

    // ---- read-only delegation ----

    fun getNodes(): List<ControlNode> = routeLogic.getNodes()
    fun getPointAtTime(time: Double): ControlNode? = routeLogic.getPointAtTime(time)
    override fun toString(): String = routeLogic.toString()
    fun getNodeAt(index: Int): ControlNode = routeLogic.getNodeAt(index)

    // ---- export / import ----

    fun exportToJson(): String {
        syncAndSave()
        return routeRepo.exportJson(_allRoutes.value)
    }

    fun importFromJson(jsonText: String): Boolean {
        val routes = routeRepo.importJson(jsonText) ?: return false
        if (routes.isEmpty()) return false
        _allRoutes.value = routes
        val first = routes.first()
        _currentRouteName.value = first.name
        _waypoints.value = first.points
        routeLogic.setWaypoints(first.points)
        _pathVersion.update { it + 1 }
        persist()
        return true
    }
}
