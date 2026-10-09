package ftc19656.azconductor.io.network

import ftc19656.azconductor.route.SplineRouteContract
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

class RobotApiClient(
    robotIp: String,
    private val json: Json,
    private val port: Int = 8888,
    private val transport: RobotTransport = PlatformRobotTransport,
) {
    private var baseUrl: String = baseUrl(robotIp, port)
    private var sessionToken: String? = null

    val token: String? get() = sessionToken

    fun updateRobotIp(robotIp: String) {
        baseUrl = baseUrl(robotIp, port)
        sessionToken = null
    }

    suspend fun openSession(clientName: String): ApiResult<SessionOpenResponse> {
        val result = request(
            method = "POST",
            path = "/api/v2/session",
            body = json.encodeToString(SessionOpenRequest(clientName)),
            authenticated = false,
        )
        return decode<SessionOpenResponse>(result).also {
            if (it is ApiResult.Ok) sessionToken = it.value.token
        }
    }

    suspend fun closeSession(): ApiResult<Unit> {
        val result = request("DELETE", "/api/v2/session")
        if (result is ApiResult.Ok) sessionToken = null
        return result.map { Unit }
    }

    suspend fun health(): ApiResult<String> =
        request("GET", "/api/v2/health", authenticated = false).map { it.body }

    suspend fun listRoutes(): ApiResult<RouteManifestResponse> =
        decode(request("GET", "/api/v2/routes"))

    suspend fun getRoute(name: String): ApiResult<RobotRoutePayload> {
        val result = request("GET", "/api/v2/routes/" + pathSegment(name))
        return when (result) {
            is ApiResult.Ok -> {
                val revision = result.value.headers["x-route-revision"]?.toLongOrNull()
                    ?: parseEtag(result.value.headers["etag"])
                    ?: return ApiResult.NetworkError("Route response missing revision header")
                ApiResult.Ok(
                    RobotRoutePayload(name, revision, result.value.body),
                    result.status,
                )
            }
            is ApiResult.HttpError -> result
            is ApiResult.NetworkError -> result
        }
    }

    suspend fun putRoute(
        name: String,
        routeJson: String,
        expectedRevision: Long,
    ): ApiResult<RouteWriteResponse> {
        val errors = SplineRouteContract.validateRobotJson(routeJson)
        if (errors.isNotEmpty()) {
            return ApiResult.NetworkError("路径契约校验失败：" + errors.take(4).joinToString("；") {
                "${it.waypointIndex?.let { frame -> "帧${frame + 1} " } ?: ""}${it.message}"
            })
        }
        return decode(
        request(
            "PUT",
            "/api/v2/routes/" + pathSegment(name),
            body = routeJson,
            extraHeaders = mapOf("If-Match" to expectedRevision.toString()),
        )
        )
    }

    suspend fun deleteRoute(name: String, expectedRevision: Long): ApiResult<Unit> =
        request(
            "DELETE",
            "/api/v2/routes/" + pathSegment(name),
            extraHeaders = mapOf("If-Match" to expectedRevision.toString()),
        ).map { Unit }

    suspend fun executionState(): ApiResult<ExecutionSnapshotDto> =
        decode(request("GET", "/api/v2/execution"))

    suspend fun commandCatalog(): ApiResult<CommandCatalogResponse> =
        decode(request("GET", "/api/v2/commands"))

    suspend fun listOpModes(): ApiResult<OpModeListResponse> =
        decode(request("GET", "/api/v2/opmodes"))

    suspend fun opModeState(): ApiResult<OpModeSnapshotDto> =
        decode(request("GET", "/api/v2/opmode"))

    suspend fun initOpMode(
        name: String,
        expectedRevision: Long,
    ): ApiResult<OpModeActionResponse> =
        opModeAction("init", name, expectedRevision)

    suspend fun startOpMode(
        name: String,
        expectedRevision: Long,
    ): ApiResult<OpModeActionResponse> =
        opModeAction("start", name, expectedRevision)

    suspend fun stopOpMode(
        name: String,
        expectedRevision: Long,
    ): ApiResult<OpModeActionResponse> =
        opModeAction("stop", name, expectedRevision)

    fun eventUrl(): String? {
        val value = sessionToken ?: return null
        return baseUrl + "/api/v2/events?session=" + pathSegment(value)
    }

    private suspend fun opModeAction(
        action: String,
        name: String,
        expectedRevision: Long,
    ): ApiResult<OpModeActionResponse> =
        decode(
            request(
                "POST",
                "/api/v2/opmode/" + action,
                json.encodeToString(OpModeActionRequest(name, expectedRevision)),
            )
        )

    private suspend fun request(
        method: String,
        path: String,
        body: String? = null,
        authenticated: Boolean = true,
        extraHeaders: Map<String, String> = emptyMap(),
    ): ApiResult<NetworkHttpResponse> {
        val headers = mutableMapOf<String, String>()
        if (body != null) headers["Content-Type"] = "application/json"
        if (authenticated) {
            val value = sessionToken
                ?: return ApiResult.NetworkError("No active robot session")
            headers["X-Az-Session"] = value
        }
        headers.putAll(extraHeaders)

        return try {
            val response = transport.request(
                method = method,
                url = baseUrl + path,
                body = body,
                headers = headers,
            )
            if (response.status in 200..299) {
                ApiResult.Ok(response, response.status)
            } else {
                val error = runCatching {
                    json.decodeFromString<ApiErrorResponse>(response.body)
                }.getOrNull()
                ApiResult.HttpError(
                    status = response.status,
                    code = error?.error,
                    message = error?.message ?: error?.owner,
                    body = response.body,
                )
            }
        } catch (t: Throwable) {
            ApiResult.NetworkError(t.message ?: "Network request failed", t)
        }
    }

    private inline fun <reified T> decode(
        result: ApiResult<NetworkHttpResponse>,
    ): ApiResult<T> = when (result) {
        is ApiResult.Ok -> try {
            ApiResult.Ok(
                json.decodeFromString<T>(result.value.body),
                result.status,
            )
        } catch (t: Throwable) {
            ApiResult.NetworkError(
                "Invalid robot response: " + (t.message ?: "decode failed"),
                t,
            )
        }
        is ApiResult.HttpError -> result
        is ApiResult.NetworkError -> result
    }

    private fun parseEtag(value: String?): Long? =
        value?.trim()?.removeSurrounding("\"")?.toLongOrNull()

    companion object {
        private fun baseUrl(ip: String, port: Int): String =
            "http://" + ip.trim() + ":" + port

        fun pathSegment(value: String): String {
            val bytes = value.encodeToByteArray()
            val out = StringBuilder(bytes.size)
            for (byte in bytes) {
                val v = byte.toInt() and 0xff
                val c = v.toChar()
                if (
                    c in 'a'..'z' || c in 'A'..'Z' || c in '0'..'9' ||
                    c == '-' || c == '.' || c == '_' || c == '~'
                ) {
                    out.append(c)
                } else {
                    out.append('%')
                    out.append("0123456789ABCDEF"[v ushr 4])
                    out.append("0123456789ABCDEF"[v and 0x0f])
                }
            }
            return out.toString()
        }
    }
}
