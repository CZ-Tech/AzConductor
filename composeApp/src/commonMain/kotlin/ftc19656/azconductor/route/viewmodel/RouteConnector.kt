package ftc19656.azconductor.route.viewmodel

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import com.russhwolf.settings.Settings
import ftc19656.azconductor.io.ConfigManager
import ftc19656.azconductor.io.RemoteSave
import ftc19656.azconductor.io.loadRouteData
import ftc19656.azconductor.io.saveRouteData
import ftc19656.azconductor.route.ControlNode
import ftc19656.azconductor.route.OrientedTrajectoryGenerator2D
import ftc19656.azconductor.route.RobotRoutes
import ftc19656.azconductor.route.RouteCore
import ftc19656.azconductor.route.RouteData
import ftc19656.azconductor.io.RobotCommandItem
import ftc19656.azconductor.io.RobotCommandListResponse
import ftc19656.azconductor.io.RobotPathListResponse
import ftc19656.azconductor.io.SyncConflictData
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.encodeToString
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json

class RouteConnector : ViewModel() {

    private val settingsStorage = Settings()
    private val jsonConfig = Json {
        prettyPrint = true
        encodeDefaults = true
        ignoreUnknownKeys = true
    }

    // ---- Storage keys ----
    companion object {
        private const val STORAGE_KEY = "robot_routes"
        private const val LEGACY_KEY = "auto_save_waypoints"
    }

    private val configManager = ConfigManager.getOrCreate("route")

    // ---- Remote save to robot ----

    var robotIp: String
        get() = configManager["robot_ip"] ?: "192.168.43.1"
        set(value) {
            configManager["robot_ip"] = value
            periodicSyncJob?.cancel()
            remoteSave = if (value.isNotBlank()) {
                connectionStatus = "就绪"
                RemoteSave(value) { status -> connectionStatus = status }
            } else {
                connectionStatus = "未配置IP"
                null
            }
            connectAndFetchCommands()
            startPeriodicSync()
        }

    private var remoteSave: RemoteSave? = null
    private val scope = CoroutineScope(Dispatchers.Default + SupervisorJob())

    // ---- UI state ----

    var pathVersion by mutableStateOf(0)
    var connectionStatus by mutableStateOf("未配置IP")
        private set
    var availableCommands by mutableStateOf<List<RobotCommandItem>>(emptyList())
        private set
    var currentRouteName by mutableStateOf("默认路径")
    var syncConflict by mutableStateOf<SyncConflictData?>(null)
        private set

    private val conflictQueue = mutableListOf<SyncConflictData>()
    private var periodicSyncJob: Job? = null

    init {
        val storedIp = configManager["robot_ip"] ?: "192.168.43.1"
        if (storedIp.isNotBlank()) {
            remoteSave = RemoteSave(storedIp) { status -> connectionStatus = status }
            connectionStatus = "就绪"
        }
        connectAndFetchCommands()

        // Clean legacy large values from ConfigManager cache (Preferences has ~8KB per-key limit)
        configManager[LEGACY_KEY] = ""
        configManager[STORAGE_KEY] = "0"

        startPeriodicSync()
    }

    // ---- Proactive robot connection ----

    /**
     * Proactively call GET /commands on the robot to verify connectivity
     * and populate [availableCommands] with the command list.
     */
    private fun connectAndFetchCommands() {
        val rs = remoteSave ?: return
        connectionStatus = "正在连接..."
        scope.launch {
            try {
                val result = rs.fetchCommands()
                if (result != null) {
                    try {
                        val response = jsonConfig.decodeFromString<RobotCommandListResponse>(result)
                        if (response.status == "ok") {
                            availableCommands = response.commands
                        }
                        connectionStatus = "就绪"
                    } catch (_: Exception) {
                        connectionStatus = "已连接"
                    }
                } else {
                    connectionStatus = "连接失败"
                }
            } catch (_: Throwable) {
                connectionStatus = "连接失败"
            }
        }
    }

    // ---- Periodic sync with robot ----

    private fun startPeriodicSync(intervalMs: Long = 5000L) {
        println("RouteConnector: starting periodic sync (interval=${intervalMs}ms)")
        periodicSyncJob = scope.launch {
            while (isActive) {
                delay(intervalMs)
                val rs = remoteSave
                if (rs == null) {
                    println("RouteConnector: sync skipped (no remoteSave)")
                    continue
                }

                println("RouteConnector: sync cycle start")

                // Step 1: refresh command list
                try {
                    val commandsResult = rs.fetchCommands()
                    if (commandsResult != null) {
                        try {
                            val response = jsonConfig.decodeFromString<RobotCommandListResponse>(commandsResult)
                            if (response.status == "ok") {
                                availableCommands = response.commands
                                println("RouteConnector: commands refreshed (${response.commands.size} commands)")
                            }
                        } catch (_: Exception) { println("RouteConnector: failed to parse commands response") }
                    } else {
                        println("RouteConnector: fetchCommands returned null")
                    }
                } catch (e: Throwable) { println("RouteConnector: fetchCommands error: ${e.message}") }

                // Step 2: list robot paths and compare each with local
                try {
                    val listResult = rs.listPaths()
                    if (listResult != null) {
                        try {
                            val pathList = jsonConfig.decodeFromString<RobotPathListResponse>(listResult)
                            if (pathList.status == "ok") {
                                println("RouteConnector: robot has ${pathList.paths.size} paths: ${pathList.paths}")
                                println("RouteConnector: local has ${allRoutes.size} routes: ${allRoutes.map { it.name }}")
                                val localRoutes = allRoutes.toList()
                                for (routeData in localRoutes) {
                                    if (conflictQueue.any { it.pathName == routeData.name }) {
                                        println("RouteConnector: '${routeData.name}' already in conflict queue, skip")
                                        continue
                                    }
                                    if (syncConflict?.pathName == routeData.name) {
                                        println("RouteConnector: '${routeData.name}' currently showing conflict, skip")
                                        continue
                                    }
                                    if (routeData.name !in pathList.paths) {
                                        println("RouteConnector: '${routeData.name}' not on robot, skip")
                                        continue
                                    }

                                    try {
                                        val remoteJson = rs.fetchPath(routeData.name)
                                        if (remoteJson == null) {
                                            println("RouteConnector: fetchPath('${routeData.name}') returned null")
                                            continue
                                        }
                                        if (remoteJson.contains("\"status\":\"not_found\"")) {
                                            println("RouteConnector: fetchPath('${routeData.name}') returned not_found")
                                            continue
                                        }

                                        val localJson = jsonConfig.encodeToString(routeData.points)
                                        if (localJson != remoteJson) {
                                            conflictQueue.add(SyncConflictData(
                                                pathName = routeData.name,
                                                localJson = localJson,
                                                remoteJson = remoteJson
                                            ))
                                            println("RouteConnector: sync conflict detected for '${routeData.name}'")
                                        } else {
                                            println("RouteConnector: '${routeData.name}' local == remote, no conflict")
                                        }
                                    } catch (e: Throwable) {
                                        println("RouteConnector: fetchPath('${routeData.name}') error: ${e.message}")
                                    }
                                }
                            }
                        } catch (_: Exception) { println("RouteConnector: failed to parse path list response") }
                    } else {
                        println("RouteConnector: listPaths returned null")
                    }
                } catch (e: Throwable) { println("RouteConnector: listPaths error: ${e.message}") }

                // Step 3: pop next conflict from queue if no dialog is currently shown
                if (syncConflict == null && conflictQueue.isNotEmpty()) {
                    syncConflict = conflictQueue.removeAt(0)
                }

                println("RouteConnector: sync cycle end")
            }
            println("RouteConnector: periodic sync stopped")
        }
    }

    private fun popNextConflict() {
        syncConflict = if (conflictQueue.isNotEmpty()) conflictQueue.removeAt(0) else null
    }

    /**
     * Keep the local version, discard the remote version.
     */
    fun resolveConflictKeepLocal() {
        val conflict = syncConflict ?: return
        // Push the local version to the robot so the conflict won't reappear on the next sync cycle.
        val localRoute = allRoutes.find { it.name == conflict.pathName }
        if (localRoute != null) {
            val localJson = jsonConfig.encodeToString(localRoute.points)
            remoteSave?.send(localJson, conflict.pathName)
        }
        popNextConflict()
    }

    /**
     * Replace local waypoints with the robot version.
     */
    fun resolveConflictKeepRemote() {
        val conflict = syncConflict ?: return
        try {
            val points = jsonConfig.decodeFromString<List<ControlNode>>(conflict.remoteJson)
            allRoutes = allRoutes.map { route ->
                if (route.name == conflict.pathName) route.copy(points = points) else route
            }
            if (currentRouteName == conflict.pathName) {
                _waypoints.clear()
                _waypoints.addAll(points)
                routeLogic.setWaypoints(points)
                pathVersion++
            }
            // Persist to local storage only (don't re-send to robot)
            val robots = listOf(RobotRoutes(routes = allRoutes))
            val json = jsonConfig.encodeToString(robots)
            lastPersistedHash = allRoutes.hashCode()
            saveRouteData(json)
            configManager[STORAGE_KEY] = lastPersistedHash.toString()
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
        val conflict = syncConflict ?: return
        try {
            // 1. Generate new name for the local version
            var localNewName = "${conflict.pathName}(电脑端)"
            var suffix = 1
            while (allRoutes.any { it.name == localNewName }) {
                suffix++
                localNewName = "${conflict.pathName}(电脑端$suffix)"
            }
            // 2. Rename local route
            allRoutes = allRoutes.map { route ->
                if (route.name == conflict.pathName) route.copy(name = localNewName) else route
            }
            // 3. Add robot version under original name
            val points = jsonConfig.decodeFromString<List<ControlNode>>(conflict.remoteJson)
            allRoutes = allRoutes + RouteData(name = conflict.pathName, points = points)
            // 4. If currently editing the conflict path, switch waypoints to robot version
            if (currentRouteName == conflict.pathName) {
                _waypoints.clear()
                _waypoints.addAll(points)
                routeLogic.setWaypoints(points)
                pathVersion++
            }
            // 5. Persist
            val robots = listOf(RobotRoutes(routes = allRoutes))
            val json = jsonConfig.encodeToString(robots)
            lastPersistedHash = allRoutes.hashCode()
            saveRouteData(json)
            configManager[STORAGE_KEY] = lastPersistedHash.toString()
        } catch (_: Exception) {
            println("RouteConnector: failed to keep both versions for '${conflict.pathName}'")
        }
        popNextConflict()
    }

    // ---- Internal model ----

    private val routeLogic = RouteCore()
    private val _waypoints = mutableStateListOf<ControlNode>()
    val waypoints: List<ControlNode> get() = _waypoints

    private var allRoutes by mutableStateOf(listOf(RouteData(name = "默认路径")))
    private var lastPersistedHash = 0

    init {
        val loadedRoutes = loadFromStorage()
        if (loadedRoutes.isNotEmpty()) {
            allRoutes = loadedRoutes
            val first = loadedRoutes.first()
            currentRouteName = first.name
            _waypoints.addAll(first.points)
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

    fun getRouteNames(): List<String> = allRoutes.map { it.name }

    fun createRoute(name: String) {
        if (allRoutes.any { it.name == name }) return
        allRoutes = allRoutes + RouteData(name = name)
        switchRoute(name)
        persist()
    }

    fun switchRoute(name: String) {
        val route = allRoutes.find { it.name == name } ?: return
        currentRouteName = name
        _waypoints.clear()
        _waypoints.addAll(route.points)
        routeLogic.setWaypoints(route.points)
        pathVersion++
    }

    fun deleteRoute(name: String) {
        allRoutes = allRoutes.filter { it.name != name }
        if (allRoutes.isEmpty()) {
            currentRouteName = ""
            _waypoints.clear()
            routeLogic.setWaypoints(emptyList())
            pathVersion++
        } else if (currentRouteName == name) {
            val next = allRoutes.first()
            switchRoute(next.name)
        }
        persist()
    }

    fun renameRoute(oldName: String, newName: String) {
        if (oldName == newName || allRoutes.any { it.name == newName }) return
        allRoutes = allRoutes.map { if (it.name == oldName) it.copy(name = newName) else it }
        if (currentRouteName == oldName) {
            currentRouteName = newName
        }
        persist()
    }

    fun moveRouteOrder(fromIndex: Int, toIndex: Int) {
        if (fromIndex !in allRoutes.indices || toIndex !in allRoutes.indices || fromIndex == toIndex) return
        allRoutes = allRoutes.toMutableList().apply {
            val item = removeAt(fromIndex)
            add(toIndex, item)
        }
        persist()
    }

    // ---- Persistence ----

    private fun syncAndSave() {
        val updated = allRoutes.map { route ->
            if (route.name == currentRouteName) route.copy(points = _waypoints.toList())
            else route
        }
        allRoutes = updated
        persist()
    }

    private fun persist() {
        val robots = listOf(RobotRoutes(routes = allRoutes))
        val json = jsonConfig.encodeToString(robots)
        lastPersistedHash = allRoutes.hashCode()
        saveRouteData(json)
        configManager[STORAGE_KEY] = lastPersistedHash.toString()
        remoteSave?.send(jsonConfig.encodeToString(_waypoints.toList()), currentRouteName)
    }

    private fun loadFromStorage(): List<RouteData> {
        val json = loadRouteData()
        if (!json.isNullOrBlank()) {
            return try {
                jsonConfig.decodeFromString<List<RobotRoutes>>(json)
                    .flatMap { it.routes }
            } catch (_: Exception) { emptyList() }
        }
        // Legacy fallback from old Settings-based storage
        val legacyJson = settingsStorage.getString(LEGACY_KEY, "")
        if (legacyJson.isNotBlank()) {
            return try {
                val points = jsonConfig.decodeFromString<List<ControlNode>>(legacyJson)
                listOf(RouteData(name = "默认路径", points = points))
            } catch (_: Exception) { emptyList() }
        }
        return emptyList()
    }

    // ---- Auto-save watcher ----

    private var autoSaveJob: Job? = null

    fun startAutoSaveWatcher() {
        stopAutoSaveWatcher()

        autoSaveJob = configManager.watchPath(
            pathKey = STORAGE_KEY,
            intervalMs = 50L
        ) { newValue ->
            val remoteHash = newValue.toIntOrNull() ?: return@watchPath
            if (remoteHash != lastPersistedHash) {
                val json = loadRouteData()
                if (json.isNullOrBlank()) return@watchPath
                val parsed = try {
                    jsonConfig.decodeFromString<List<RobotRoutes>>(json)
                        .flatMap { it.routes }
                } catch (_: Exception) {
                    return@watchPath
                }
                lastPersistedHash = remoteHash
                val current = parsed.find { it.name == currentRouteName }
                if (current != null) {
                    _waypoints.clear()
                    _waypoints.addAll(current.points)
                    routeLogic.setWaypoints(current.points)
                    pathVersion++
                }
                allRoutes = parsed
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
        _waypoints.add(point)
        pathVersion++
        syncAndSave()
    }

    fun addPointAt(index: Int, point: ControlNode) {
        routeLogic.addPointAt(index, point)
        _waypoints.add(index, point)
        pathVersion++
        syncAndSave()
    }

    fun setWaypoints(points: List<ControlNode>) {
        routeLogic.setWaypoints(points)
        _waypoints.clear()
        _waypoints.addAll(points)
        pathVersion++
        syncAndSave()
    }

    fun moveNode(index: Int, newPoint: ControlNode) {
        routeLogic.moveNode(index, newPoint)
        if (index in _waypoints.indices) {
            _waypoints[index] = newPoint
            pathVersion++
            syncAndSave()
        }
    }

    fun moveNodeOrder(fromIndex: Int, toIndex: Int) {
        if (fromIndex !in _waypoints.indices || toIndex !in _waypoints.indices || fromIndex == toIndex) return
        routeLogic.moveNodeOrder(fromIndex, toIndex)
        val node = _waypoints.removeAt(fromIndex)
        _waypoints.add(toIndex, node)
        pathVersion++
        syncAndSave()
    }

    fun removeNode(index: Int) {
        routeLogic.removeNode(index)
        if (index in _waypoints.indices) {
            _waypoints.removeAt(index)
            pathVersion++
            syncAndSave()
        }
    }

    fun moveNode(sourceNode: ControlNode, destinationNode: ControlNode) {
        val index = _waypoints.indexOfFirst { it isCloseTo sourceNode }
        if (index != -1) moveNode(index, destinationNode)
    }

    fun removeNode(point2D: ControlNode) {
        val index = _waypoints.indexOfFirst { it isCloseTo point2D }
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
        return jsonConfig.encodeToString(listOf(RobotRoutes(routes = allRoutes)))
    }

    fun importFromJson(jsonText: String): Boolean {
        return try {
            val robots = jsonConfig.decodeFromString<List<RobotRoutes>>(jsonText)
            val routes = robots.flatMap { it.routes }
            if (routes.isEmpty()) return false
            allRoutes = routes
            val first = routes.first()
            currentRouteName = first.name
            _waypoints.clear()
            _waypoints.addAll(first.points)
            routeLogic.setWaypoints(first.points)
            pathVersion++
            persist()
            true
        } catch (_: Exception) {
            // Legacy format fallback
            try {
                val points = jsonConfig.decodeFromString<List<ControlNode>>(jsonText)
                val route = RouteData(name = "导入路径", points = points)
                allRoutes = allRoutes + route
                switchRoute(route.name)
                persist()
                true
            } catch (e2: Exception) {
                println("Import failed: ${e2.message}")
                false
            }
        }
    }
}
