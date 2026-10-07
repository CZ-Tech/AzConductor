package ftc19656.azconductor.io.network

import kotlinx.coroutines.test.runTest
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

class RobotApiClientContractTest {
    private val json = Json {
        encodeDefaults = true
        ignoreUnknownKeys = true
    }

    @Test
    fun sessionOpenUsesExactV2EndpointAndStoresToken() = runTest {
        val server = MockRobotServer(json)
        val client = RobotApiClient("192.168.43.1", json, transport = server)

        val result = client.openSession("TestDesktop")

        val ok = assertIs<ApiResult.Ok<SessionOpenResponse>>(result)
        assertEquals("mock-session-token", ok.value.token)
        assertEquals(10_000, ok.value.expiresInMs)
        assertEquals("mock-session-token", client.token)

        val request = server.requests.single()
        assertEquals("POST", request.method)
        assertEquals("http://192.168.43.1:8888/api/v2/session", request.url)
        assertNull(request.headers["X-Az-Session"])
        assertEquals(
            SessionOpenRequest("TestDesktop"),
            json.decodeFromString<SessionOpenRequest>(request.body!!),
        )
    }

    @Test
    fun authenticatedRequestsCarrySessionHeader() = runTest {
        val server = MockRobotServer(json)
        val client = connectedClient(server)

        val result = client.listRoutes()

        assertIs<ApiResult.Ok<RouteManifestResponse>>(result)
        val request = server.requests.last()
        assertEquals("GET", request.method)
        assertEquals("http://192.168.43.1:8888/api/v2/routes", request.url)
        assertEquals("mock-session-token", request.headers["X-Az-Session"])
    }

    @Test
    fun unauthenticatedRobotApiCallFailsLocallyWithoutNetworkRequest() = runTest {
        val server = MockRobotServer(json)
        val client = RobotApiClient("192.168.43.1", json, transport = server)

        val result = client.listRoutes()

        val error = assertIs<ApiResult.NetworkError>(result)
        assertTrue(error.message.contains("No active robot session"))
        assertTrue(server.requests.isEmpty())
    }

    @Test
    fun routeCrudMatchesRevisionAndPathEncodingContract() = runTest {
        val server = MockRobotServer(json)
        val client = connectedClient(server)
        val routeName = "蓝 路径(A)"
        val body = "[{\"x\":1,\"y\":2}]"

        val created = assertIs<ApiResult.Ok<RouteWriteResponse>>(
            client.putRoute(routeName, body, expectedRevision = 0)
        )
        assertEquals(201, created.status)
        assertEquals(1, created.value.revision)

        val putRequest = server.requests.last()
        assertEquals(
            "http://192.168.43.1:8888/api/v2/routes/"
                + "%E8%93%9D%20%E8%B7%AF%E5%BE%84%28A%29",
            putRequest.url,
        )
        assertEquals("0", putRequest.headers["If-Match"])
        assertEquals(body, putRequest.body)

        val fetched = assertIs<ApiResult.Ok<RobotRoutePayload>>(
            client.getRoute(routeName)
        )
        assertEquals(body, fetched.value.json)
        assertEquals(1, fetched.value.revision)

        val updated = assertIs<ApiResult.Ok<RouteWriteResponse>>(
            client.putRoute(routeName, "[{\"x\":3}]", expectedRevision = 1)
        )
        assertEquals(2, updated.value.revision)
        assertEquals("1", server.requests.last().headers["If-Match"])

        assertIs<ApiResult.Ok<Unit>>(
            client.deleteRoute(routeName, expectedRevision = 2)
        )
        assertFalse(server.routes.containsKey(routeName))
        assertEquals("2", server.requests.last().headers["If-Match"])
    }

    @Test
    fun staleRouteRevisionMapsToHttp412WithProtocolErrorCode() = runTest {
        val server = MockRobotServer(json)
        server.seedRoute("Auto", "[]", revision = 5)
        val client = connectedClient(server)

        val result = client.putRoute("Auto", "[{\"x\":1}]", expectedRevision = 4)

        val error = assertIs<ApiResult.HttpError>(result)
        assertEquals(412, error.status)
        assertEquals("revision_mismatch", error.code)
        assertTrue(error.body.contains("\"actual\":5"))
    }

    @Test
    fun missingRouteMapsTo404InsteadOfNetworkFailure() = runTest {
        val server = MockRobotServer(json)
        val client = connectedClient(server)

        val result = client.getRoute("missing")

        val error = assertIs<ApiResult.HttpError>(result)
        assertEquals(404, error.status)
        assertEquals("route_not_found", error.code)
    }

    @Test
    fun opModeLifecycleUsesRevisionGuardedV2Endpoints() = runTest {
        val server = MockRobotServer(json)
        val client = connectedClient(server)

        val listed = assertIs<ApiResult.Ok<OpModeListResponse>>(client.listOpModes())
        assertEquals(listOf("Auto A", "Auto B"), listed.value.opModes.map { it.name })

        val initial = assertIs<ApiResult.Ok<OpModeSnapshotDto>>(client.opModeState())
        assertEquals("STOPPED", initial.value.phase)

        assertIs<ApiResult.Ok<OpModeActionResponse>>(
            client.initOpMode("Auto A", initial.value.revision)
        )
        val initRequest = server.requests.last()
        assertTrue(initRequest.url.endsWith("/api/v2/opmode/init"))
        assertEquals(
            OpModeActionRequest("Auto A", initial.value.revision),
            json.decodeFromString<OpModeActionRequest>(initRequest.body!!),
        )

        val initState = assertIs<ApiResult.Ok<OpModeSnapshotDto>>(client.opModeState())
        assertEquals("INIT", initState.value.phase)
        assertEquals("Auto A", initState.value.activeName)

        assertIs<ApiResult.Ok<OpModeActionResponse>>(
            client.startOpMode("Auto A", initState.value.revision)
        )
        val running = assertIs<ApiResult.Ok<OpModeSnapshotDto>>(client.opModeState())
        assertEquals("RUNNING", running.value.phase)

        assertIs<ApiResult.Ok<OpModeActionResponse>>(
            client.stopOpMode("Auto A", running.value.revision)
        )
        val stopped = assertIs<ApiResult.Ok<OpModeSnapshotDto>>(client.opModeState())
        assertEquals("STOPPED", stopped.value.phase)
    }

    @Test
    fun staleOpModeRevisionRemainsConflictInsteadOfBeingRetried() = runTest {
        val server = MockRobotServer(json)
        val client = connectedClient(server)
        val stale = server.opModeRevision
        server.opModeRevision += 1

        val result = client.initOpMode("Auto A", stale)

        val error = assertIs<ApiResult.HttpError>(result)
        assertEquals(409, error.status)
        assertEquals("state_changed", error.code)
    }

    @Test
    fun sessionConflictPreserves409AndOwnerDetails() = runTest {
        val server = MockRobotServer(json)
        val first = RobotApiClient("192.168.43.1", json, transport = server)
        val second = RobotApiClient("192.168.43.1", json, transport = server)
        assertIs<ApiResult.Ok<SessionOpenResponse>>(first.openSession("Computer-A"))

        val result = second.openSession("Computer-B")

        val error = assertIs<ApiResult.HttpError>(result)
        assertEquals(409, error.status)
        assertEquals("already_connected", error.code)
        assertEquals("Computer-A", error.message)
    }

    @Test
    fun transportExceptionMapsToNetworkError() = runTest {
        val server = MockRobotServer(json)
        server.throwOnNextRequest = IllegalStateException("socket failed")
        val client = RobotApiClient("192.168.43.1", json, transport = server)

        val result = client.health()

        val error = assertIs<ApiResult.NetworkError>(result)
        assertTrue(error.message.contains("socket failed"))
    }

    @Test
    fun closeSessionClearsTokenAndPreventsLaterAuthenticatedCalls() = runTest {
        val server = MockRobotServer(json)
        val client = connectedClient(server)

        assertIs<ApiResult.Ok<Unit>>(client.closeSession())
        assertNull(client.token)
        assertNull(server.sessionToken)

        val requestCount = server.requests.size
        assertIs<ApiResult.NetworkError>(client.listRoutes())
        assertEquals(requestCount, server.requests.size)
    }

    private suspend fun connectedClient(server: MockRobotServer): RobotApiClient {
        val client = RobotApiClient("192.168.43.1", json, transport = server)
        assertIs<ApiResult.Ok<SessionOpenResponse>>(client.openSession("TestDesktop"))
        return client
    }
}
