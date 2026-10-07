package ftc19656.azconductor.io.network

import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class RouteSyncEngineTest {
    private val json = Json {
        encodeDefaults = true
        ignoreUnknownKeys = true
    }

    @Test
    fun localOnlyRouteIsCreatedOnRobotAndBaselineIsRecorded() = runTest {
        val fixture = fixture(localRoutes = mapOf("Auto" to J1))

        val report = fixture.engine.syncOnce()

        assertEquals(listOf("Auto"), report.pushed)
        assertTrue(report.conflicts.isEmpty())
        assertEquals(J1, fixture.server.routes["Auto"]?.body)
        assertEquals(1, fixture.server.routes["Auto"]?.revision)
        assertNotNull(fixture.baselines.get(ROBOT_KEY, "Auto"))
    }

    @Test
    fun remoteOnlyRouteIsPulledLocally() = runTest {
        val fixture = fixture()
        fixture.server.seedRoute("Auto", J1, revision = 3)

        val report = fixture.engine.syncOnce()

        assertEquals(listOf("Auto"), report.pulled)
        assertEquals(J1, fixture.local.get("Auto")?.json)
        assertEquals(3, fixture.baselines.get(ROBOT_KEY, "Auto")?.remoteRevision)
    }

    @Test
    fun firstSyncWithIdenticalBodiesOnlyEstablishesBaseline() = runTest {
        val fixture = fixture(localRoutes = mapOf("Auto" to J1))
        fixture.server.seedRoute("Auto", J1, revision = 4)

        val report = fixture.engine.syncOnce()

        assertTrue(report.pushed.isEmpty())
        assertTrue(report.pulled.isEmpty())
        assertTrue(report.conflicts.isEmpty())
        assertEquals(4, fixture.baselines.get(ROBOT_KEY, "Auto")?.remoteRevision)
    }

    @Test
    fun firstSyncWithDifferentBodiesProducesConflictAndDoesNotOverwriteEitherSide() = runTest {
        val fixture = fixture(localRoutes = mapOf("Auto" to J1))
        fixture.server.seedRoute("Auto", J2, revision = 2)

        val report = fixture.engine.syncOnce()

        val conflict = report.conflicts.single()
        assertEquals(RouteConflictReason.FIRST_SYNC_DIFFERENT, conflict.reason)
        assertEquals(J1, conflict.localJson)
        assertEquals(J2, conflict.remoteJson)
        assertEquals(J1, fixture.local.get("Auto")?.json)
        assertEquals(J2, fixture.server.routes["Auto"]?.body)
        assertNull(fixture.baselines.get(ROBOT_KEY, "Auto"))
    }

    @Test
    fun localOnlyChangeAfterBaselinePushesWithRevisionPrecondition() = runTest {
        val fixture = fixture(localRoutes = mapOf("Auto" to J1))
        fixture.server.seedRoute("Auto", J1, revision = 1)
        fixture.engine.syncOnce()
        fixture.local.put("Auto", J2)

        val report = fixture.engine.syncOnce()

        assertEquals(listOf("Auto"), report.pushed)
        assertEquals(J2, fixture.server.routes["Auto"]?.body)
        assertEquals(2, fixture.server.routes["Auto"]?.revision)
        val put = fixture.server.requests.last { it.method == "PUT" }
        assertEquals("1", put.headers["If-Match"])
    }

    @Test
    fun remoteOnlyChangeAfterBaselinePullsLocally() = runTest {
        val fixture = fixture(localRoutes = mapOf("Auto" to J1))
        fixture.server.seedRoute("Auto", J1, revision = 1)
        fixture.engine.syncOnce()
        fixture.server.mutateRemoteRoute("Auto", J2)

        val report = fixture.engine.syncOnce()

        assertEquals(listOf("Auto"), report.pulled)
        assertEquals(J2, fixture.local.get("Auto")?.json)
        assertEquals(2, fixture.baselines.get(ROBOT_KEY, "Auto")?.remoteRevision)
    }

    @Test
    fun bothSidesChangedAfterBaselineProducesConflict() = runTest {
        val fixture = fixture(localRoutes = mapOf("Auto" to J1))
        fixture.server.seedRoute("Auto", J1, revision = 1)
        fixture.engine.syncOnce()
        fixture.local.put("Auto", J2)
        fixture.server.mutateRemoteRoute("Auto", J3)

        val report = fixture.engine.syncOnce()

        val conflict = report.conflicts.single()
        assertEquals(RouteConflictReason.BOTH_CHANGED, conflict.reason)
        assertEquals(J2, conflict.localJson)
        assertEquals(J3, conflict.remoteJson)
        assertEquals(J2, fixture.local.get("Auto")?.json)
        assertEquals(J3, fixture.server.routes["Auto"]?.body)
    }

    @Test
    fun localAbsenceDoesNotImplyDeletionAndPullsRemoteCopy() = runTest {
        val fixture = fixture(localRoutes = mapOf("Auto" to J1))
        fixture.server.seedRoute("Auto", J1, revision = 1)
        fixture.engine.syncOnce()
        fixture.local.delete("Auto")

        val report = fixture.engine.syncOnce()

        assertEquals(listOf("Auto"), report.pulled)
        assertTrue(report.conflicts.isEmpty())
        assertEquals(J1, fixture.local.get("Auto")?.json)
        assertTrue(fixture.server.routes.containsKey("Auto"))
    }

    @Test
    fun remoteAbsenceDoesNotImplyDeletionAndRecreatesLocalCopy() = runTest {
        val fixture = fixture(localRoutes = mapOf("Auto" to J1))
        fixture.server.seedRoute("Auto", J1, revision = 1)
        fixture.engine.syncOnce()
        fixture.server.deleteRemoteRoute("Auto")

        val report = fixture.engine.syncOnce()

        assertEquals(listOf("Auto"), report.pushed)
        assertTrue(report.conflicts.isEmpty())
        assertEquals(J1, fixture.local.get("Auto")?.json)
        assertEquals(J1, fixture.server.routes["Auto"]?.body)
    }

    @Test
    fun localAbsenceWithChangedRemotePullsChangedRemoteCopy() = runTest {
        val fixture = fixture(localRoutes = mapOf("Auto" to J1))
        fixture.server.seedRoute("Auto", J1, revision = 1)
        fixture.engine.syncOnce()
        fixture.local.delete("Auto")
        fixture.server.mutateRemoteRoute("Auto", J2)

        val report = fixture.engine.syncOnce()

        assertEquals(listOf("Auto"), report.pulled)
        assertTrue(report.conflicts.isEmpty())
        assertEquals(J2, fixture.local.get("Auto")?.json)
        assertTrue(fixture.server.routes.containsKey("Auto"))
    }

    @Test
    fun differentRouteNamesNeverConflictEvenWithOldBaselines() = runTest {
        val fixture = fixture(localRoutes = mapOf("Local Auto" to J1))
        fixture.server.seedRoute("Robot Auto", J2, revision = 7)
        fixture.baselines.put(
            ROBOT_KEY,
            RouteSyncBaseline(
                routeName = "Local Auto",
                localFingerprint = LocalRouteRecord("Local Auto", J1).fingerprint,
                remoteRevision = 3,
            ),
        )
        fixture.baselines.put(
            ROBOT_KEY,
            RouteSyncBaseline(
                routeName = "Robot Auto",
                localFingerprint = LocalRouteRecord("Robot Auto", J3).fingerprint,
                remoteRevision = 6,
            ),
        )

        val report = fixture.engine.syncOnce()

        assertTrue(report.conflicts.isEmpty())
        assertEquals(listOf("Local Auto"), report.pushed)
        assertEquals(listOf("Robot Auto"), report.pulled)
        assertEquals(J1, fixture.server.routes["Local Auto"]?.body)
        assertEquals(J2, fixture.local.get("Robot Auto")?.json)
    }

    @Test
    fun revisionRaceDuringPutBecomesBothChangedConflictInsteadOfOverwrite() = runTest {
        val fixture = fixture(localRoutes = mapOf("Auto" to J1))
        fixture.server.seedRoute("Auto", J1, revision = 1)
        fixture.engine.syncOnce()
        fixture.local.put("Auto", J2)
        fixture.server.beforeNextPut = {
            fixture.server.mutateRemoteRoute("Auto", J3)
        }

        val report = fixture.engine.syncOnce()

        val conflict = report.conflicts.single()
        assertEquals(RouteConflictReason.BOTH_CHANGED, conflict.reason)
        assertEquals(J2, conflict.localJson)
        assertEquals(J3, conflict.remoteJson)
        assertEquals(2, conflict.remoteRevision)
        assertEquals(J3, fixture.server.routes["Auto"]?.body)
    }

    @Test
    fun resolveKeepLocalUsesConflictRevisionAndUpdatesBaseline() = runTest {
        val fixture = fixture(localRoutes = mapOf("Auto" to J1))
        fixture.server.seedRoute("Auto", J2, revision = 7)
        val conflict = RouteSyncConflict(
            routeName = "Auto",
            reason = RouteConflictReason.FIRST_SYNC_DIFFERENT,
            localJson = J1,
            remoteJson = J2,
            remoteRevision = 7,
        )

        val result = fixture.engine.resolveKeepLocal(conflict)

        assertIs<ApiResult.Ok<Unit>>(result)
        assertEquals(J1, fixture.server.routes["Auto"]?.body)
        assertEquals(8, fixture.server.routes["Auto"]?.revision)
        assertEquals(8, fixture.baselines.get(ROBOT_KEY, "Auto")?.remoteRevision)
    }

    @Test
    fun resolveKeepRemoteReplacesLocalAndUpdatesBaseline() = runTest {
        val fixture = fixture(localRoutes = mapOf("Auto" to J1))
        val conflict = RouteSyncConflict(
            routeName = "Auto",
            reason = RouteConflictReason.FIRST_SYNC_DIFFERENT,
            localJson = J1,
            remoteJson = J2,
            remoteRevision = 5,
        )

        val result = fixture.engine.resolveKeepRemote(conflict)

        assertIs<ApiResult.Ok<Unit>>(result)
        assertEquals(J2, fixture.local.get("Auto")?.json)
        assertEquals(5, fixture.baselines.get(ROBOT_KEY, "Auto")?.remoteRevision)
    }

    private suspend fun fixture(
        localRoutes: Map<String, String> = emptyMap(),
    ): Fixture {
        val server = MockRobotServer(json)
        val client = RobotApiClient("192.168.43.1", json, transport = server)
        assertIs<ApiResult.Ok<SessionOpenResponse>>(client.openSession("TestDesktop"))
        val local = FakeLocalRouteAdapter(localRoutes)
        val baselines = InMemoryRouteSyncBaselineStore()
        return Fixture(
            server = server,
            local = local,
            baselines = baselines,
            engine = RouteSyncEngine(
                robotKey = ROBOT_KEY,
                api = client,
                local = local,
                baselines = baselines,
            ),
        )
    }

    private data class Fixture(
        val server: MockRobotServer,
        val local: FakeLocalRouteAdapter,
        val baselines: InMemoryRouteSyncBaselineStore,
        val engine: RouteSyncEngine,
    )

    private class FakeLocalRouteAdapter(
        initial: Map<String, String>,
    ) : LocalRouteAdapter {
        private val routes = initial.toMutableMap()

        override fun list(): List<LocalRouteRecord> =
            routes.entries.map { (name, body) -> LocalRouteRecord(name, body) }

        override fun get(name: String): LocalRouteRecord? =
            routes[name]?.let { LocalRouteRecord(name, it) }

        override fun put(name: String, json: String) {
            routes[name] = json
        }

        override fun delete(name: String) {
            routes.remove(name)
        }
    }

    companion object {
        private const val ROBOT_KEY = "192.168.43.1"
        private const val J1 = "[{\"x\":1}]"
        private const val J2 = "[{\"x\":2}]"
        private const val J3 = "[{\"x\":3}]"
    }
}
