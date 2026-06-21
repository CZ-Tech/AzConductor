package ftc19656.azconductor.io

import kotlinx.serialization.Serializable

/**
 * Individual command item returned by GET /commands on the robot HTTP API (port 8888).
 * Extra fields beyond [name], [params], and [ready] are silently ignored via ignoreUnknownKeys.
 */
@Serializable
data class RobotCommandItem(
    val name: String,
    val params: List<String> = emptyList(),
    val paramNames: List<String> = emptyList(),
    val ready: Boolean = false
)

/**
 * Response envelope for GET /commands on the robot HTTP API (port 8888).
 */
@Serializable
data class RobotCommandListResponse(
    val status: String = "ok",
    val commands: List<RobotCommandItem> = emptyList()
)

/**
 * Response envelope for GET /list on the robot HTTP API (port 8888).
 */
@Serializable
data class RobotPathListResponse(
    val status: String = "ok",
    val paths: List<String> = emptyList()
)

/**
 * Represents a sync conflict between local and remote path data.
 */
data class SyncConflictData(
    val pathName: String,
    val localJson: String,
    val remoteJson: String
)

/**
 * Response envelope for GET /status on the robot HTTP API (port 8888).
 * Reports the current OpMode and execution state.
 */
@Serializable
data class OpModeStatusResponse(
    val status: String = "ok",
    val opModeActive: Boolean = false,
    val executionReady: Boolean = false,
    val isExecuting: Boolean = false,
    val activeOpModeName: String? = null,
    val commandCount: Int = 0,
    val commandsReady: Int = 0
)

/**
 * Response envelope for GET /position on the robot HTTP API (port 8888).
 * Returns the robot's current field coordinates.
 */
@Serializable
data class RobotPositionResponse(
    val status: String = "ok",
    val x: Double = 0.0,
    val y: Double = 0.0,
    val heading: Double = 0.0,
    val unit: String = "inches",
    val headingUnit: String = "degrees"
)

/**
 * Response envelope for path execution endpoints
 * (POST /run/saved/{pathName} and POST /run/temp).
 */
@Serializable
data class PathExecutionResponse(
    val status: String = "ok",
    val path: String? = null,
    val message: String? = null
)
