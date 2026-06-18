package ftc19656.azconductor.io

import ftc19656.azconductor.TimingConfig
import ftc19656.azconductor.route.ControlNode
import ftc19656.azconductor.route.RouteData
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/**
 * Coordinates synchronisation between local [RouteRepository] and remote
 * [RobotSyncService].
 *
 * This is the **only** class that talks to [RobotSyncService].  It owns the
 * periodic conflict-detection loop, the conflict queue, the three resolution
 * strategies, and robot-IP lifecycle.  [RouteConnector] reads UI-facing
 * state from here but never touches the network directly.
 *
 * This is a pure data/sync-layer service — it has no Compose or UI
 * dependencies.
 */
class SyncManager(
    private val jsonConfig: Json,
    private val configManager: ConfigManager,
    private val routeRepo: RouteRepository,
    private val syncService: RobotSyncService
) {

    private val scope = CoroutineScope(Dispatchers.Default + SupervisorJob())

    // ---- Network state (delegated from RobotSyncService) ----

    /** Delegates directly to [RobotSyncService.connectionStatus]. */
    val connectionStatus: StateFlow<String> get() = syncService.connectionStatus

    /** Delegates directly to [RobotSyncService.availableCommands]. */
    val availableCommands: StateFlow<List<RobotCommandItem>> get() = syncService.availableCommands

    /** Delegates directly to [RobotSyncService.opModeStatus]. */
    val opModeStatus: StateFlow<OpModeStatusResponse> get() = syncService.opModeStatus

    /** Delegates directly to [RobotSyncService.robotPosition]. */
    val robotPosition: StateFlow<RobotPositionResponse?> get() = syncService.robotPosition

    // ---- Robot IP ----

    /**
     * The robot's IP address.  Writing persists to [configManager] and
     * immediately activates the new connection — the periodic sync timer
     * will start probing the new address.
     */
    var robotIp: String
        get() = configManager["robot_ip"] ?: "192.168.43.1"
        set(value) {
            configManager["robot_ip"] = value
            syncService.setRobotIp(value)
        }

    // ---- Conflict state (read by RouteConnector / UI) ----

    private val _conflictState = MutableStateFlow<SyncConflictData?>(null)
    val conflictState: StateFlow<SyncConflictData?> = _conflictState.asStateFlow()

    private val conflictQueue = mutableListOf<SyncConflictData>()

    /**
     * Called on any thread whenever [routeRepo] is mutated by a resolution
     * strategy.  The UI layer should reload its derived state from the
     * repository.
     */
    var onDataChanged: (() -> Unit)? = null

    /**
     * Set by [RouteConnector] during init.  Provides the current in-memory
     * route list so the auto-save timer can detect changes.
     */
    var localRoutesProvider: (() -> List<RouteData>)? = null

    /** Per-route hash of points last pushed to the robot.  Used to
     * avoid redundant pushes during periodic sync. */
    private val lastPushedHashes = mutableMapOf<String, Int>()

    // ---- Lifecycle ----

    private var conflictJob: Job? = null
    private var autoSaveJob: Job? = null
    private var crossTabJob: Job? = null

    init {
        val storedIp = configManager["robot_ip"] ?: "192.168.43.1"
        if (storedIp.isNotBlank()) {
            syncService.setRobotIp(storedIp)
        }
    }

    /**
     * Start all periodic loops:
     * - 50ms auto-save: high-frequency hash check → persist locally on change
     * - 5s conflict detection: compare local vs remote → fire conflict
     * - Cross-tab watch: reload when another tab mutates storage
     *
     * Safe to call multiple times — any previous loops are cancelled first.
     */
    fun start(
        autoSaveIntervalMs: Long = TimingConfig.STORAGE_POLL_MS,
        conflictIntervalMs: Long = TimingConfig.ROBOT_SYNC_INTERVAL_MS
    ) {
        stop()

        // 1. Auto-save: poll in-memory routes for changes, persist locally
        autoSaveJob = scope.launch {
            while (isActive) {
                delay(autoSaveIntervalMs)
                val provider = localRoutesProvider ?: continue
                routeRepo.saveIfChanged(provider())
            }
        }

        // 2. Robot sync: push local changes + detect remote conflicts
        println("SyncManager: starting robot sync (interval=${conflictIntervalMs}ms)")
        conflictJob = scope.launch {
            while (isActive) {
                delay(conflictIntervalMs)
                syncWithRobot()
            }
        }

        // 3. Cross-tab sync: another tab mutated storage → reload
        crossTabJob = routeRepo.watchExternalChanges { _ ->
            onDataChanged?.invoke()
        }
    }

    /** Cancel all periodic loops.  Idempotent. */
    fun stop() {
        conflictJob?.cancel()
        conflictJob = null
        autoSaveJob?.cancel()
        autoSaveJob = null
        crossTabJob?.cancel()
        crossTabJob = null
    }

    // ---- Robot path listing ----

    /**
     * Fetch the list of saved path names from the robot via GET /list.
     * Returns an empty list on failure or if the robot is unreachable.
     */
    suspend fun listRobotPaths(): List<String> = syncService.listRobotPaths()

    /**
     * Fetch the raw JSON for a single named path from the robot
     * via GET /{pathName}.  Returns null on failure.
     */
    suspend fun pullRoute(pathName: String): String? = syncService.pullRoute(pathName)

    /**
     * Queue a saved path for execution on the robot via POST /run/saved/{pathName}.
     * Returns the raw response body (JSON), or null on failure.
     */
    suspend fun executeSavedPath(pathName: String): String? = syncService.executeSavedPath(pathName)

    /**
     * Queue a temporary path JSON for execution on the robot via POST /run/temp.
     * Returns the raw response body (JSON), or null on failure.
     */
    suspend fun executeTempPath(jsonBody: String): String? = syncService.executeTempPath(jsonBody)

    // ---- Periodic sync with robot ----

    /**
     * Each cycle:
     * 1. Push any local routes whose points hash differs from the last push.
     * 2. For routes where we haven't changed, compare with the robot version
     *    and fire a conflict if they differ.
     */
    private suspend fun syncWithRobot() {
        val remotePaths = syncService.listRobotPaths()
        val provider = localRoutesProvider ?: return
        val localRoutes = provider()

        for (route in localRoutes) {
            val currentHash = route.points.hashCode()

            // 1. Push local changes to robot (await completion to avoid
            //    race condition on robot's shared POST / memory slot)
            if (currentHash != lastPushedHashes[route.name]) {
                try {
                    syncService.sendToRobot(
                        jsonConfig.encodeToString(route.points),
                        route.name
                    )
                    lastPushedHashes[route.name] = currentHash
                    println("SyncManager: pushed '${route.name}' to robot")
                } catch (_: Exception) {
                    println("SyncManager: push '${route.name}' failed, will retry next cycle")
                }
                continue
            }

            // 2. Conflict detection (robot may have changed independently)
            if (conflictQueue.any { it.pathName == route.name }) continue
            if (_conflictState.value?.pathName == route.name) continue
            if (route.name !in remotePaths) continue

            val remoteJson = syncService.pullRoute(route.name) ?: continue
            if (remoteJson.contains("\"status\":\"not_found\"")) continue

            val localJson = jsonConfig.encodeToString(route.points)
            if (localJson != remoteJson) {
                conflictQueue.add(
                    SyncConflictData(
                        pathName = route.name,
                        localJson = localJson,
                        remoteJson = remoteJson
                    )
                )
                if (_conflictState.value == null) {
                    _conflictState.value = conflictQueue.removeAt(0)
                }
                println("SyncManager: conflict detected for '${route.name}'")
            }
        }
    }

    // ---- Conflict resolution ----

    /**
     * Keep the local version, discard the remote version.
     * Pushes the local JSON to the robot so the conflict won't reappear.
     */
    fun resolveKeepLocal() {
        val conflict = _conflictState.value ?: return
        val localRoute = routeRepo.load(conflict.pathName)
        if (localRoute != null) {
            val json = jsonConfig.encodeToString(localRoute.points)
            scope.launch {
                try {
                    syncService.sendToRobot(json, conflict.pathName)
                    lastPushedHashes[conflict.pathName] = localRoute.points.hashCode()
                } catch (_: Exception) {
                    println("SyncManager: resolveKeepLocal push failed for '${conflict.pathName}'")
                }
            }
        }
        popNextConflict()
    }

    /**
     * Replace the local route with the remote version.
     * Persists to [routeRepo] and fires [onDataChanged].
     */
    fun resolveKeepRemote() {
        val conflict = _conflictState.value ?: return
        try {
            val points = jsonConfig.decodeFromString<List<ControlNode>>(conflict.remoteJson)
            val existing = routeRepo.load(conflict.pathName)
            if (existing != null) {
                routeRepo.save(existing.copy(points = points))
                onDataChanged?.invoke()
            }
        } catch (_: Exception) {
            println("SyncManager: failed to apply remote version for '${conflict.pathName}'")
        }
        popNextConflict()
    }

    /**
     * Keep both versions: rename the local copy (e.g. "默认路径(电脑端)")
     * and add the robot version under the original name.
     * Persists to [routeRepo] and fires [onDataChanged].
     */
    fun resolveKeepBoth() {
        val conflict = _conflictState.value ?: return
        try {
            val allRoutes = routeRepo.loadAll()

            // 1. Generate a unique name for the local version
            var localNewName = "${conflict.pathName}(电脑端)"
            var suffix = 1
            while (allRoutes.any { it.name == localNewName }) {
                suffix++
                localNewName = "${conflict.pathName}(电脑端$suffix)"
            }

            // 2. Rename the local route
            val localRoute = allRoutes.find { it.name == conflict.pathName }
            if (localRoute != null) {
                routeRepo.save(localRoute.copy(name = localNewName))
            }

            // 3. Add the robot version under the original name
            val points = jsonConfig.decodeFromString<List<ControlNode>>(conflict.remoteJson)
            routeRepo.save(RouteData(name = conflict.pathName, points = points))
            lastPushedHashes[conflict.pathName] = points.hashCode()

            onDataChanged?.invoke()
        } catch (_: Exception) {
            println("SyncManager: failed to keep both versions for '${conflict.pathName}'")
        }
        popNextConflict()
    }

    // ---- Internal ----

    private fun popNextConflict() {
        _conflictState.value =
            if (conflictQueue.isNotEmpty()) conflictQueue.removeAt(0) else null
    }
}
