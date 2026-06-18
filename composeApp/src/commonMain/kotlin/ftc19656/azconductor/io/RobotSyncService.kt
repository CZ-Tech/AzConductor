package ftc19656.azconductor.io

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
import kotlinx.serialization.json.Json

/**
 * Global singleton that handles robot I/O: connection management,
 * periodic command refresh, and raw data push/pull operations.
 *
 * This service is a **pure I/O layer** — it does NOT know about local
 * route state, conflict detection, or UI policy.  Callers push data via
 * [sendToRobot] and pull data via [listRobotPaths] / [pullRoute]; they
 * are responsible for comparison, conflict resolution, and scheduling.
 *
 * Upward outputs ([connectionStatus], [availableCommands]) are exposed
 * as [StateFlow]s that UI layers collect directly.
 */
object RobotSyncService {

    private val jsonConfig = Json {
        prettyPrint = true
        encodeDefaults = true
        ignoreUnknownKeys = true
    }

    private val scope = CoroutineScope(Dispatchers.Default + SupervisorJob())

    // ---- Upward outputs (read by RouteConnector / UI) ----

    private val _connectionStatus = MutableStateFlow("未配置IP")
    val connectionStatus: StateFlow<String> = _connectionStatus.asStateFlow()

    private val _availableCommands = MutableStateFlow<List<RobotCommandItem>>(emptyList())
    val availableCommands: StateFlow<List<RobotCommandItem>> = _availableCommands.asStateFlow()

    // ---- Internal state ----

    private var remoteSave: RemoteSave? = null
    private var periodicSyncJob: Job? = null

    // ---- Public API ----

    /**
     * Update the robot IP address. Cancels any running sync job, creates
     * a new [RemoteSave] (or null if [ip] is blank), then reconnects
     * and restarts periodic command refresh.
     */
    fun setRobotIp(ip: String) {
        periodicSyncJob?.cancel()
        periodicSyncJob = null
        remoteSave = if (ip.isNotBlank()) {
            RemoteSave(ip) { status -> _connectionStatus.value = status }
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
     * Fire-and-forget: push JSON to the robot for a given path name.
     * Delegates to [RemoteSave.send].
     */
    fun sendToRobot(jsonBody: String, pathName: String) {
        remoteSave?.send(jsonBody, pathName)
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
     * Fetch the raw JSON for a single named path from the robot
     * via GET /{pathName}.  Returns null on failure.
     */
    suspend fun pullRoute(pathName: String): String? {
        return remoteSave?.fetchPath(pathName)
    }

    // ---- Internal ----

    /**
     * Proactively call GET /commands on the robot to verify connectivity
     * and report the command list.
     */
    private fun connectAndFetchCommands() {
        val rs = remoteSave ?: return
        _connectionStatus.value = "正在连接..."
        scope.launch {
            try {
                val result = rs.fetchCommands()
                if (result != null) {
                    try {
                        val response = jsonConfig.decodeFromString<RobotCommandListResponse>(result)
                        if (response.status == "ok") {
                            _availableCommands.value = response.commands
                        }
                        _connectionStatus.value = "就绪"
                    } catch (_: Exception) {
                        _connectionStatus.value = "已连接"
                    }
                } else {
                    _connectionStatus.value = "连接失败"
                }
            } catch (_: Throwable) {
                _connectionStatus.value = "连接失败"
            }
        }
    }

    /**
     * Periodic loop that refreshes the command list from the robot.
     * Does NOT perform conflict detection — callers are responsible
     * for comparing local and remote data on their own schedule.
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

                println("RobotSyncService: sync cycle start — refreshing commands")
                try {
                    val commandsResult = rs.fetchCommands()
                    if (commandsResult != null) {
                        try {
                            val response = jsonConfig.decodeFromString<RobotCommandListResponse>(commandsResult)
                            if (response.status == "ok") {
                                _availableCommands.value = response.commands
                                println("RobotSyncService: commands refreshed (${response.commands.size} commands)")
                            }
                        } catch (_: Exception) {
                            println("RobotSyncService: failed to parse commands response")
                        }
                    } else {
                        println("RobotSyncService: fetchCommands returned null")
                    }
                } catch (e: Throwable) {
                    println("RobotSyncService: fetchCommands error: ${e.message}")
                }
                println("RobotSyncService: sync cycle end")
            }
            println("RobotSyncService: periodic sync stopped")
        }
    }
}
