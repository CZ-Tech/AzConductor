package ftc19656.azconductor.io

import ftc19656.azconductor.route.RouteData
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.encodeToString
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json

/**
 * Handles all robot communication: connection, periodic sync, conflict detection,
 * and command fetching. This is a plain service class — it does NOT hold any
 * UI state itself; all state changes are pushed upward through callbacks.
 *
 * Lifecycle: created once by [RouteConnector], lives for the application lifetime.
 */
class RobotSyncService(
    private val jsonConfig: Json,
    private val scope: CoroutineScope,

    // ---- Upward callbacks (service → ViewModel) ----
    private val onConnectionStatusChange: (String) -> Unit,
    private val onCommandsRefreshed: (List<RobotCommandItem>) -> Unit,
    private val onConflictDetected: (SyncConflictData) -> Unit,

    // ---- Downward queries (ViewModel answers the service) ----
    private val getLocalRoutes: () -> List<RouteData>,
    private val getActiveConflictName: () -> String?,
    private val isNameInConflictQueue: (String) -> Boolean,
) {
    private var remoteSave: RemoteSave? = null
    private var periodicSyncJob: Job? = null

    // ---- Public API ----

    /**
     * Update the robot IP address. Cancels any running sync job, creates
     * a new [RemoteSave] (or null if [ip] is blank), then reconnects
     * and restarts periodic sync.
     */
    fun setRobotIp(ip: String) {
        periodicSyncJob?.cancel()
        periodicSyncJob = null
        remoteSave = if (ip.isNotBlank()) {
            RemoteSave(ip) { status -> onConnectionStatusChange(status) }
        } else {
            null
        }
        connectAndFetchCommands()
        startPeriodicSync()
    }

    /** Cancel the sync job and release the RemoteSave reference. Idempotent. */
    fun stop() {
        periodicSyncJob?.cancel()
        periodicSyncJob = null
        remoteSave = null
    }

    /**
     * Fetch the list of saved path names from the robot via GET /list.
     * Returns an empty list on failure or if the robot is unreachable.
     */
    suspend fun listRobotPaths(): List<String> {
        val result = remoteSave?.listPaths() ?: return emptyList()
        return try {
            jsonConfig.decodeFromString<RobotPathListResponse>(result).paths
        } catch (_: Exception) {
            emptyList()
        }
    }

    /**
     * Fire-and-forget: send JSON to the robot for a given path name.
     * Delegates to [RemoteSave.send].
     */
    fun sendToRobot(jsonBody: String, pathName: String) {
        remoteSave?.send(jsonBody, pathName)
    }

    // ---- Internal ----

    /**
     * Proactively call GET /commands on the robot to verify connectivity
     * and report the command list via [onCommandsRefreshed].
     */
    private fun connectAndFetchCommands() {
        val rs = remoteSave ?: return
        onConnectionStatusChange("正在连接...")
        scope.launch {
            try {
                val result = rs.fetchCommands()
                if (result != null) {
                    try {
                        val response = jsonConfig.decodeFromString<RobotCommandListResponse>(result)
                        if (response.status == "ok") {
                            onCommandsRefreshed(response.commands)
                        }
                        onConnectionStatusChange("就绪")
                    } catch (_: Exception) {
                        onConnectionStatusChange("已连接")
                    }
                } else {
                    onConnectionStatusChange("连接失败")
                }
            } catch (_: Throwable) {
                onConnectionStatusChange("连接失败")
            }
        }
    }

    /**
     * Periodic sync loop that runs every [intervalMs] milliseconds:
     * 1. Refresh the command list from the robot.
     * 2. Compare each local route against the robot's version — fire
     *    [onConflictDetected] for any mismatch.
     *
     * Skips routes that are already in the conflict queue or currently
     * shown in the conflict dialog (queried via [getActiveConflictName]
     * and [isNameInConflictQueue]).
     */
    private fun startPeriodicSync(intervalMs: Long = 5000L) {
        println("RobotSyncService: starting periodic sync (interval=${intervalMs}ms)")
        periodicSyncJob = scope.launch {
            while (isActive) {
                delay(intervalMs)
                val rs = remoteSave
                if (rs == null) {
                    println("RobotSyncService: sync skipped (no remoteSave)")
                    continue
                }

                println("RobotSyncService: sync cycle start")

                // Step 1: refresh command list
                try {
                    val commandsResult = rs.fetchCommands()
                    if (commandsResult != null) {
                        try {
                            val response = jsonConfig.decodeFromString<RobotCommandListResponse>(commandsResult)
                            if (response.status == "ok") {
                                onCommandsRefreshed(response.commands)
                                println("RobotSyncService: commands refreshed (${response.commands.size} commands)")
                            }
                        } catch (_: Exception) { println("RobotSyncService: failed to parse commands response") }
                    } else {
                        println("RobotSyncService: fetchCommands returned null")
                    }
                } catch (e: Throwable) { println("RobotSyncService: fetchCommands error: ${e.message}") }

                // Step 2: list robot paths and compare each with local
                try {
                    val listResult = rs.listPaths()
                    if (listResult != null) {
                        try {
                            val pathList = jsonConfig.decodeFromString<RobotPathListResponse>(listResult)
                            if (pathList.status == "ok") {
                                println("RobotSyncService: robot has ${pathList.paths.size} paths: ${pathList.paths}")
                                val localRoutes = getLocalRoutes()
                                println("RobotSyncService: local has ${localRoutes.size} routes: ${localRoutes.map { it.name }}")
                                for (routeData in localRoutes) {
                                    if (isNameInConflictQueue(routeData.name)) {
                                        println("RobotSyncService: '${routeData.name}' already in conflict queue, skip")
                                        continue
                                    }
                                    if (getActiveConflictName() == routeData.name) {
                                        println("RobotSyncService: '${routeData.name}' currently showing conflict, skip")
                                        continue
                                    }
                                    if (routeData.name !in pathList.paths) {
                                        println("RobotSyncService: '${routeData.name}' not on robot, skip")
                                        continue
                                    }

                                    try {
                                        val remoteJson = rs.fetchPath(routeData.name)
                                        if (remoteJson == null) {
                                            println("RobotSyncService: fetchPath('${routeData.name}') returned null")
                                            continue
                                        }
                                        if (remoteJson.contains("\"status\":\"not_found\"")) {
                                            println("RobotSyncService: fetchPath('${routeData.name}') returned not_found")
                                            continue
                                        }

                                        val localJson = jsonConfig.encodeToString(routeData.points)
                                        if (localJson != remoteJson) {
                                            onConflictDetected(SyncConflictData(
                                                pathName = routeData.name,
                                                localJson = localJson,
                                                remoteJson = remoteJson
                                            ))
                                            println("RobotSyncService: sync conflict detected for '${routeData.name}'")
                                        } else {
                                            println("RobotSyncService: '${routeData.name}' local == remote, no conflict")
                                        }
                                    } catch (e: Throwable) {
                                        println("RobotSyncService: fetchPath('${routeData.name}') error: ${e.message}")
                                    }
                                }
                            }
                        } catch (_: Exception) { println("RobotSyncService: failed to parse path list response") }
                    } else {
                        println("RobotSyncService: listPaths returned null")
                    }
                } catch (e: Throwable) { println("RobotSyncService: listPaths error: ${e.message}") }

                println("RobotSyncService: sync cycle end")
            }
            println("RobotSyncService: periodic sync stopped")
        }
    }
}
