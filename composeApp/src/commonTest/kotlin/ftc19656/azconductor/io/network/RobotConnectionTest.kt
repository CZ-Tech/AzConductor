package ftc19656.azconductor.io.network

import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

class RobotConnectionTest {
    private val json = Json {
        encodeDefaults = true
        ignoreUnknownKeys = true
    }

    @Test
    fun connectCreatesSessionAndOpensAuthenticatedEventStream() = runTest {
        val server = MockRobotServer(json)
        val connection = RobotConnection(
            robotIp = "192.168.43.1",
            json = json,
            clientName = "Desktop",
            transport = server,
        )

        val result = connection.connect()

        assertIs<ApiResult.Ok<Unit>>(result)
        val state = assertIs<RobotConnection.State.Connected>(connection.state.value)
        assertEquals("mock-session-token", state.token)
        assertEquals(
            "http://192.168.43.1:8888/api/v2/events?session=mock-session-token",
            server.openedEventUrl,
        )
        assertFalse(server.eventStreamClosed)
    }

    @Test
    fun sseEventsUpdateAllConnectionStateFlows() = runTest {
        val server = MockRobotServer(json)
        val connection = connected(server)

        server.emit(
            "pose",
            "{\"seq\":7,\"tNanos\":123,\"x\":1.25,\"y\":-2.5,\"heading\":90.0}",
        )
        server.emit(
            "runtime",
            "{\"seq\":7,\"opModeActive\":true,\"opModeName\":\"HttpAuto\"}",
        )
        server.emit(
            "execution",
            "{\"state\":\"RUNNING\",\"requestId\":9,"
                + "\"subject\":\"Auto\",\"revision\":4}",
        )
        server.emit("routes", "{\"revision\":12}")
        server.emit("commands", "{\"revision\":3}")
        server.emit("heartbeat", "{\"t\":4567}")

        assertEquals(7, connection.pose.value?.seq)
        assertEquals(1.25, connection.pose.value?.x)
        assertEquals(-2.5, connection.pose.value?.y)
        assertEquals(90.0, connection.pose.value?.heading)
        assertTrue(connection.runtime.value?.opModeActive == true)
        assertEquals("HttpAuto", connection.runtime.value?.opModeName)
        assertEquals("RUNNING", connection.execution.value?.state)
        assertEquals(9, connection.execution.value?.requestId)
        assertEquals(12, connection.routeRevision.value)
        assertEquals(3, connection.commandRevision.value)
        assertEquals(4567, connection.lastHeartbeatMs.value)
    }

    @Test
    fun malformedSsePayloadMovesConnectionToFailedState() = runTest {
        val server = MockRobotServer(json)
        val connection = connected(server)

        server.emit("pose", "{not-json}")

        val failed = assertIs<RobotConnection.State.Failed>(connection.state.value)
        assertTrue(failed.message.contains("Invalid pose event"))
    }

    @Test
    fun eventStreamTransportFailureMovesConnectedStateToFailed() = runTest {
        val server = MockRobotServer(json)
        val connection = connected(server)

        server.failEventStream("connection reset")

        val failed = assertIs<RobotConnection.State.Failed>(connection.state.value)
        assertEquals("connection reset", failed.message)
    }

    @Test
    fun secondComputerIsRejectedWithOwnerAndRetryDelay() = runTest {
        val server = MockRobotServer(json)
        val first = RobotConnection(
            "192.168.43.1",
            json,
            clientName = "Computer-A",
            transport = server,
        )
        val second = RobotConnection(
            "192.168.43.1",
            json,
            clientName = "Computer-B",
            transport = server,
        )
        assertIs<ApiResult.Ok<Unit>>(first.connect())

        val result = second.connect()

        assertIs<ApiResult.HttpError>(result)
        val rejected = assertIs<RobotConnection.State.Rejected>(second.state.value)
        assertEquals("Computer-A", rejected.owner)
        assertEquals(10_000, rejected.retryAfterMs)
    }

    @Test
    fun disconnectClosesEventStreamClosesSessionAndResetsState() = runTest {
        val server = MockRobotServer(json)
        val connection = connected(server)
        server.emit(
            "pose",
            "{\"seq\":1,\"tNanos\":1,\"x\":1,\"y\":2,\"heading\":3}",
        )

        connection.disconnect()

        assertIs<RobotConnection.State.Disconnected>(connection.state.value)
        assertTrue(server.eventStreamClosed)
        assertNull(server.sessionToken)
    }

    @Test
    fun changingRobotIpClosesStreamAndClearsRuntimeSnapshots() = runTest {
        val server = MockRobotServer(json)
        val connection = connected(server)
        server.emit(
            "pose",
            "{\"seq\":1,\"tNanos\":1,\"x\":1,\"y\":2,\"heading\":3}",
        )
        server.emit(
            "runtime",
            "{\"seq\":1,\"opModeActive\":true,\"opModeName\":\"HttpAuto\"}",
        )
        server.emit("routes", "{\"revision\":8}")

        connection.updateRobotIp("10.0.0.5")

        assertIs<RobotConnection.State.Disconnected>(connection.state.value)
        assertTrue(server.eventStreamClosed)
        assertNull(connection.pose.value)
        assertNull(connection.runtime.value)
        assertEquals(0, connection.routeRevision.value)
    }

    private suspend fun connected(server: MockRobotServer): RobotConnection {
        val connection = RobotConnection(
            robotIp = "192.168.43.1",
            json = json,
            transport = server,
        )
        assertIs<ApiResult.Ok<Unit>>(connection.connect())
        return connection
    }
}
