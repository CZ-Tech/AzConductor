package ftc19656.azconductor.io.network

import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

internal class MockRobotServer(
    private val json: Json = Json {
        encodeDefaults = true
        ignoreUnknownKeys = true
    },
) : RobotTransport {

    data class Request(
        val method: String,
        val url: String,
        val body: String?,
        val headers: Map<String, String>,
    )

    data class Route(
        var body: String,
        var revision: Long,
    )

    val requests = mutableListOf<Request>()
    val routes = linkedMapOf<String, Route>()

    var opModeActive: Boolean = false
    var opModeRevision: Long = 1
    var opModePhase: String = "STOPPED"
    var activeOpModeName: String? = null
    val opModes = mutableListOf(
        OpModeDescriptorDto("Auto A", "Auto"),
        OpModeDescriptorDto("Auto B", "Auto"),
    )
    var sessionOwner: String? = null
        private set
    var sessionToken: String? = null
        private set
    var eventStreamClosed: Boolean = false
        private set
    var openedEventUrl: String? = null
        private set
    var throwOnNextRequest: Throwable? = null
    var beforeNextPut: (() -> Unit)? = null

    private var routeChangeRevision = 1L
    private var nextRequestId = 1L
    private var eventCallback: ((String, String, String?) -> Unit)? = null
    private var eventError: ((String) -> Unit)? = null

    override suspend fun request(
        method: String,
        url: String,
        body: String?,
        headers: Map<String, String>,
    ): NetworkHttpResponse {
        throwOnNextRequest?.let {
            throwOnNextRequest = null
            throw it
        }

        val request = Request(method, url, body, headers)
        requests += request

        val target = url.substringAfter("://").substringAfter("/")
        val path = "/" + target.substringBefore("?")

        if (path == "/api/v2/health" && method == "GET") {
            return jsonResponse(
                200,
                "{\"status\":\"ok\",\"protocol\":2,\"sessionOwned\":"
                    + (sessionToken != null) + "}",
            )
        }

        if (path == "/api/v2/session") {
            return handleSession(method, body, headers)
        }

        if (!authorized(headers)) {
            return jsonResponse(401, "{\"error\":\"invalid_session\"}")
        }

        if (path == "/api/v2/routes" && method == "GET") {
            val items = routes.entries.joinToString(",") { (name, route) ->
                "{\"name\":\"" + escape(name) + "\",\"revision\":" + route.revision + "}"
            }
            return jsonResponse(
                200,
                "{\"routes\":[" + items + "],\"changeRevision\":" + routeChangeRevision + "}",
            )
        }

        if (path.startsWith("/api/v2/routes/")) {
            val encodedName = path.removePrefix("/api/v2/routes/")
            val name = percentDecode(encodedName)
            return handleRoute(method, name, body, headers)
        }

        if (path == "/api/v2/execution" && method == "GET") {
            return jsonResponse(
                200,
                "{\"state\":\"IDLE\",\"requestId\":0,\"subject\":null,\"revision\":1}",
            )
        }

        if (path == "/api/v2/opmodes" && method == "GET") {
            return jsonResponse(
                200,
                json.encodeToString(OpModeListResponse(opModes.toList())),
            )
        }

        if (path == "/api/v2/opmode" && method == "GET") {
            return jsonResponse(
                200,
                json.encodeToString(opModeSnapshot()),
            )
        }

        if (path.startsWith("/api/v2/opmode/") && method == "POST") {
            return handleOpModeAction(path.removePrefix("/api/v2/opmode/"), body)
        }

        if (path == "/api/v2/executions" && method == "POST") {
            return handleExecution(body)
        }

        if (path == "/api/v2/commands" && method == "GET") {
            return jsonResponse(200, "{\"revision\":1,\"commands\":[]}")
        }

        if (path == "/api/v2/runtime" && method == "GET") {
            return jsonResponse(
                200,
                "{\"runtime\":{\"seq\":1,\"opModeActive\":" + opModeActive
                    + ",\"opModeName\":" + if (opModeActive) "\"HttpAuto\"" else "null"
                    + "},\"pose\":{\"seq\":1,\"tNanos\":1,\"x\":0,\"y\":0,\"heading\":0}}",
            )
        }

        return jsonResponse(404, "{\"error\":\"not_found\"}")
    }

    override fun openEventStream(
        url: String,
        eventNames: List<String>,
        onOpen: () -> Unit,
        onEvent: (event: String, data: String, id: String?) -> Unit,
        onError: (message: String) -> Unit,
    ): NetworkEventHandle {
        openedEventUrl = url
        eventStreamClosed = false

        val supplied = url.substringAfter("session=", "")
        if (sessionToken == null || supplied != sessionToken) {
            onError("invalid_session")
            return object : NetworkEventHandle {
                override fun close() {
                    eventStreamClosed = true
                }
            }
        }

        eventCallback = onEvent
        eventError = onError
        onOpen()

        return object : NetworkEventHandle {
            override fun close() {
                eventStreamClosed = true
                eventCallback = null
                eventError = null
            }
        }
    }

    fun seedRoute(name: String, body: String, revision: Long = 1) {
        routes[name] = Route(body, revision)
    }

    fun mutateRemoteRoute(name: String, body: String) {
        val route = routes[name]
        if (route == null) {
            routes[name] = Route(body, 1)
        } else {
            route.body = body
            route.revision += 1
        }
        routeChangeRevision += 1
    }

    fun deleteRemoteRoute(name: String) {
        if (routes.remove(name) != null) {
            routeChangeRevision += 1
        }
    }

    fun emit(event: String, data: String, id: String? = null) {
        eventCallback?.invoke(event, data, id)
    }

    fun failEventStream(message: String) {
        eventError?.invoke(message)
    }

    private fun handleSession(
        method: String,
        body: String?,
        headers: Map<String, String>,
    ): NetworkHttpResponse {
        if (method == "POST") {
            if (sessionToken != null) {
                return jsonResponse(
                    409,
                    "{\"error\":\"already_connected\",\"owner\":\""
                        + escape(sessionOwner ?: "unknown")
                        + "\",\"retryAfterMs\":10000}",
                )
            }

            val owner = body?.let {
                json.decodeFromString<SessionOpenRequest>(it).client
            } ?: "AzConductor"
            sessionOwner = owner
            sessionToken = "mock-session-token"
            return jsonResponse(
                201,
                "{\"token\":\"mock-session-token\",\"expiresInMs\":10000}",
            )
        }

        if (method == "DELETE") {
            if (!authorized(headers)) {
                return jsonResponse(401, "{\"error\":\"invalid_session\"}")
            }
            sessionOwner = null
            sessionToken = null
            return NetworkHttpResponse(204, "")
        }

        return jsonResponse(405, "{\"error\":\"method_not_allowed\"}")
    }

    private fun handleRoute(
        method: String,
        name: String,
        body: String?,
        headers: Map<String, String>,
    ): NetworkHttpResponse {
        val current = routes[name]

        if (method == "GET") {
            if (current == null) {
                return jsonResponse(404, "{\"error\":\"route_not_found\"}")
            }
            return NetworkHttpResponse(
                status = 200,
                body = current.body,
                headers = mapOf(
                    "x-route-revision" to current.revision.toString(),
                    "etag" to "\"" + current.revision + "\"",
                ),
            )
        }

        if (method == "PUT") {
            val expected = headers["If-Match"]?.trim('"')?.toLongOrNull()
                ?: return jsonResponse(428, "{\"error\":\"if_match_required\"}")

            beforeNextPut?.let {
                beforeNextPut = null
                it()
            }

            val actual = routes[name]?.revision ?: 0
            if (expected != actual) {
                return jsonResponse(
                    412,
                    "{\"error\":\"revision_mismatch\",\"actual\":" + actual + "}",
                )
            }

            val next = actual + 1
            routes[name] = Route(body.orEmpty(), next)
            routeChangeRevision += 1
            return jsonResponse(
                if (actual == 0L) 201 else 200,
                "{\"name\":\"" + escape(name) + "\",\"revision\":" + next + "}",
            )
        }

        if (method == "DELETE") {
            val expected = headers["If-Match"]?.trim('"')?.toLongOrNull()
                ?: return jsonResponse(428, "{\"error\":\"if_match_required\"}")
            val route = routes[name]
                ?: return jsonResponse(404, "{\"error\":\"route_not_found\"}")
            if (expected != route.revision) {
                return jsonResponse(
                    412,
                    "{\"error\":\"revision_mismatch\",\"actual\":" + route.revision + "}",
                )
            }
            routes.remove(name)
            routeChangeRevision += 1
            return NetworkHttpResponse(204, "")
        }

        return jsonResponse(405, "{\"error\":\"method_not_allowed\"}")
    }

    private fun handleExecution(body: String?): NetworkHttpResponse {
        val request = body?.let { json.decodeFromString<ExecutionRequestDto>(it) }
            ?: return jsonResponse(400, "{\"error\":\"invalid_execution_type\"}")

        if (request.type == "saved") {
            val path = request.path.orEmpty()
            if (!routes.containsKey(path)) {
                return jsonResponse(404, "{\"error\":\"route_not_found\"}")
            }
        } else if (request.type == "inline") {
            if (request.trajectory == null) {
                return jsonResponse(400, "{\"error\":\"missing_trajectory\"}")
            }
        } else {
            return jsonResponse(400, "{\"error\":\"invalid_execution_type\"}")
        }

        if (!opModeActive) {
            return jsonResponse(
                200,
                "{\"accepted\":false,\"dropped\":true,\"reason\":\"no_active_opmode\"}",
            )
        }

        val id = nextRequestId++
        return jsonResponse(
            202,
            "{\"accepted\":true,\"requestId\":" + id + ",\"state\":\"QUEUED\"}",
        )
    }

    private fun handleOpModeAction(action: String, body: String?): NetworkHttpResponse {
        val request = body?.let { json.decodeFromString<OpModeActionRequest>(it) }
            ?: return jsonResponse(400, "{\"error\":\"missing_opmode_name\"}")

        if (request.expectedRevision != opModeRevision) {
            return jsonResponse(
                409,
                "{\"error\":\"state_changed\",\"message\":\"Robot state changed\"}",
            )
        }

        if (request.name !in opModes.map { it.name }) {
            return jsonResponse(404, "{\"error\":\"opmode_not_found\"}")
        }

        when (action) {
            "init" -> {
                if (opModePhase != "STOPPED") {
                    return jsonResponse(409, "{\"error\":\"opmode_not_stopped\"}")
                }
                opModePhase = "INIT"
                activeOpModeName = request.name
                opModeActive = true
            }
            "start" -> {
                if (opModePhase != "INIT" || activeOpModeName != request.name) {
                    return jsonResponse(409, "{\"error\":\"opmode_not_initialized\"}")
                }
                opModePhase = "RUNNING"
                opModeActive = true
            }
            "stop" -> {
                if (opModePhase == "STOPPED") {
                    // idempotent
                } else if (activeOpModeName != request.name) {
                    return jsonResponse(409, "{\"error\":\"opmode_mismatch\"}")
                } else {
                    opModePhase = "STOPPED"
                    activeOpModeName = null
                    opModeActive = false
                }
            }
            else -> return jsonResponse(404, "{\"error\":\"not_found\"}")
        }
        opModeRevision += 1

        return jsonResponse(
            202,
            json.encodeToString(
                OpModeActionResponse(
                    accepted = true,
                    action = action,
                    name = request.name,
                )
            ),
        )
    }

    private fun opModeSnapshot() = OpModeSnapshotDto(
        revision = opModeRevision,
        controllerAvailable = true,
        phase = opModePhase,
        activeName = activeOpModeName,
    )

    private fun authorized(headers: Map<String, String>): Boolean =
        sessionToken != null && headers["X-Az-Session"] == sessionToken

    private fun jsonResponse(status: Int, body: String) =
        NetworkHttpResponse(
            status = status,
            body = body,
            headers = mapOf("content-type" to "application/json"),
        )

    private fun percentDecode(value: String): String {
        val bytes = mutableListOf<Byte>()
        var index = 0
        while (index < value.length) {
            if (value[index] == '%' && index + 2 < value.length) {
                val hex = value.substring(index + 1, index + 3)
                bytes += hex.toInt(16).toByte()
                index += 3
            } else {
                val encoded = value[index].toString().encodeToByteArray()
                encoded.forEach { bytes += it }
                index += 1
            }
        }
        return bytes.toByteArray().decodeToString()
    }

    private fun escape(value: String): String =
        value.replace("\\", "\\\\").replace("\"", "\\\"")
}
