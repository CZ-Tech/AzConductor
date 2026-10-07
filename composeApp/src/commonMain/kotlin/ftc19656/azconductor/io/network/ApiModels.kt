package ftc19656.azconductor.io.network

import kotlinx.serialization.Serializable

@Serializable data class SessionOpenRequest(val client: String)
@Serializable data class SessionOpenResponse(val token: String, val expiresInMs: Long)
@Serializable data class ApiErrorResponse(
    val error: String? = null,
    val message: String? = null,
    val owner: String? = null,
    val retryAfterMs: Long? = null,
    val actual: Long? = null,
)
@Serializable data class RouteManifestEntry(val name: String, val revision: Long)
@Serializable data class RouteManifestResponse(
    val routes: List<RouteManifestEntry> = emptyList(),
    val changeRevision: Long = 0,
)
data class RobotRoutePayload(val name: String, val revision: Long, val json: String)
@Serializable data class RouteWriteResponse(val name: String, val revision: Long)
@Serializable data class ExecutionSnapshotDto(
    val state: String,
    val requestId: Long = 0,
    val subject: String? = null,
    val revision: Long = 0,
)
@Serializable data class CommandDescriptorDto(
    val name: String,
    val paramNames: List<String> = emptyList(),
    val paramTypes: List<String> = emptyList(),
)
@Serializable data class CommandCatalogResponse(
    val revision: Long = 0,
    val commands: List<CommandDescriptorDto> = emptyList(),
)
@Serializable data class PoseEvent(
    val seq: Long,
    val tNanos: Long,
    val x: Double,
    val y: Double,
    val heading: Double,
)
@Serializable data class RuntimeEvent(
    val seq: Long,
    val opModeActive: Boolean,
    val opModeName: String? = null,
)
@Serializable data class RevisionEvent(val revision: Long)
@Serializable data class HeartbeatEvent(val t: Long)

@Serializable data class OpModeDescriptorDto(
    val name: String,
    val group: String = "",
)

@Serializable data class OpModeListResponse(
    val opModes: List<OpModeDescriptorDto> = emptyList(),
)

@Serializable data class OpModeSnapshotDto(
    val revision: Long = 0,
    val controllerAvailable: Boolean = false,
    val phase: String = "STOPPED",
    val activeName: String? = null,
)

@Serializable data class OpModeActionRequest(
    val name: String,
    val expectedRevision: Long,
)

@Serializable data class OpModeActionResponse(
    val accepted: Boolean = false,
    val action: String = "",
    val name: String = "",
)
