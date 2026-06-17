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
