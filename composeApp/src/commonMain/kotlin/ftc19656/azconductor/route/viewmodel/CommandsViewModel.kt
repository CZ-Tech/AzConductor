package ftc19656.azconductor.route.viewmodel

import androidx.lifecycle.ViewModel
import ftc19656.azconductor.AppContext
import ftc19656.azconductor.TimingConfig
import ftc19656.azconductor.io.OpModeStatusResponse
import ftc19656.azconductor.io.RobotPositionResponse
import ftc19656.azconductor.io.SyncManager
import ftc19656.azconductor.route.ControlNode
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.decodeFromString

class CommandsViewModel(
    private val syncManager: SyncManager,
    private val refreshIntervalMs: Long = TimingConfig.ROBOT_SYNC_INTERVAL_MS
) : ViewModel() {

    private val _robotPaths = MutableStateFlow<List<String>>(emptyList())
    val robotPaths: StateFlow<List<String>> = _robotPaths.asStateFlow()

    /** Delegates to [SyncManager.opModeStatus] — auto-updated by RobotSyncService polling. */
    val opModeStatus: StateFlow<OpModeStatusResponse> get() = syncManager.opModeStatus

    /** Delegates to [SyncManager.robotPosition] — auto-updated by RobotSyncService polling. */
    val robotPosition: StateFlow<RobotPositionResponse?> get() = syncManager.robotPosition

    private val _executionStatus = MutableStateFlow<String?>(null)
    val executionStatus: StateFlow<String?> = _executionStatus.asStateFlow()

    private val _fetchedWaypoints = MutableStateFlow<List<ControlNode>>(emptyList())
    val fetchedWaypoints: StateFlow<List<ControlNode>> = _fetchedWaypoints.asStateFlow()

    private val scope = CoroutineScope(Dispatchers.Default + SupervisorJob())

    init {
        scope.launch {
            while (isActive) {
                try {
                    _robotPaths.value = syncManager.listRobotPaths()
                } catch (_: Exception) {
                    _robotPaths.value = emptyList()
                }
                delay(refreshIntervalMs)
            }
        }
    }

    /**
     * Manually refresh the robot path list immediately.
     */
    suspend fun refresh() {
        try {
            _robotPaths.value = syncManager.listRobotPaths()
        } catch (_: Exception) {
            _robotPaths.value = emptyList()
        }
    }

    /**
     * Fetch the waypoints JSON for a named path from the robot
     * and decode into [ControlNode] list for on-map rendering.
     */
    suspend fun fetchPathData(pathName: String) {
        try {
            val json = syncManager.pullRoute(pathName)
            if (json != null) {
                val points = AppContext.jsonConfig.decodeFromString<List<ControlNode>>(json)
                _fetchedWaypoints.value = points
            } else {
                _fetchedWaypoints.value = emptyList()
            }
        } catch (_: Exception) {
            _fetchedWaypoints.value = emptyList()
        }
    }

    /**
     * Execute a saved path on the robot via POST /run/saved/{pathName}.
     * Updates [executionStatus] with the result.
     */
    suspend fun executeSavedPath(pathName: String) {
        _executionStatus.value = "正在执行..."
        val result = try {
            syncManager.executeSavedPath(pathName)
        } catch (_: Exception) {
            null
        }
        _executionStatus.value = when {
            result == null -> "执行失败：无法连接机器人"
            result.contains("\"status\":\"ok\"") -> "执行成功"
            result.contains("\"status\":\"error\"") -> "执行失败：${extractErrorMessage(result)}"
            else -> "执行已触发"
        }
    }

    /**
     * Execute a temporary path JSON on the robot via POST /run/temp.
     * Updates [executionStatus] with the result.
     */
    suspend fun executeTempPath(json: String) {
        _executionStatus.value = "正在执行..."
        val result = try {
            syncManager.executeTempPath(json)
        } catch (_: Exception) {
            null
        }
        _executionStatus.value = when {
            result == null -> "执行失败：无法连接机器人"
            result.contains("\"status\":\"ok\"") -> "执行已触发"
            result.contains("\"status\":\"error\"") -> "执行失败：${extractErrorMessage(result)}"
            else -> "执行已触发"
        }
    }

    /** Clear the execution status, e.g. after the user dismisses it. */
    fun clearExecutionStatus() {
        _executionStatus.value = null
    }

    /** Extract a human-readable error message from a JSON error response. */
    private fun extractErrorMessage(json: String): String {
        val msgKey = "\"message\":\""
        val idx = json.indexOf(msgKey)
        if (idx < 0) return "未知错误"
        val start = idx + msgKey.length
        val end = json.indexOf("\"", start)
        return if (end > start) json.substring(start, end) else "未知错误"
    }
}
