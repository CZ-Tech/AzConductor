package ftc19656.azconductor.io

import kotlinx.serialization.Serializable

/**
 * Individual task item returned by GET /tasks on the robot HTTP API (port 8888).
 * Extra fields beyond [name] are silently ignored via ignoreUnknownKeys.
 */
@Serializable
data class RobotTaskItem(
    val name: String
)

/**
 * Response envelope for GET /tasks on the robot HTTP API (port 8888).
 */
@Serializable
data class RobotTaskListResponse(
    val status: String = "ok",
    val tasks: List<RobotTaskItem> = emptyList()
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
