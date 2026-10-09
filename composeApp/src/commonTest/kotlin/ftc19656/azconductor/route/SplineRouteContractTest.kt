package ftc19656.azconductor.route

import kotlinx.serialization.encodeToString
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class SplineRouteContractTest {
    private val json = Json { encodeDefaults = true; ignoreUnknownKeys = true }
    private fun point(x: Double = 0.0) = ControlNode(x = x, y = 0.0, dx = 20.0, dy = 0.0)

    @Test
    fun legacyNodesRoundTripWithoutExplicitNullMotionFields() {
        val legacy = """[{"x":0,"y":0,"dx":20,"dy":0,"duration":2}]"""
        val nodes = json.decodeFromString<List<ControlNode>>(legacy)
        assertEquals(1.0, nodes.single().maxPower)
        assertEquals(null, nodes.single().endSpeed)
        val serialized = json.encodeToString(nodes)
        assertFalse(serialized.contains("\"endSpeed\""))
        assertFalse(serialized.contains("\"maxSpeed\""))
        assertFalse(serialized.contains("\"brakeForwardPower\""))
        assertFalse(serialized.contains(":null"))
    }

    @Test
    fun explicitBrakingFieldsSurviveRobotAndArchiveRoundTrip() {
        val original = listOf(point(), point(50.0).copy(
            maxPower = 0.7, maxSpeed = 24.0,
            endSpeed = 0.0, brakeZoneIn = 12.0, brakeForwardPower = 0.2
        ))
        val robotJson = json.encodeToString(original)
        val decoded = json.decodeFromString<List<ControlNode>>(robotJson)
        assertEquals(original, decoded)
        assertTrue(SplineRouteContract.errors(decoded).isEmpty())

        val archive = json.encodeToString(listOf(RobotRoutes(routes = listOf(RouteData("test", original)))))
        val decodedArchive = json.decodeFromString<List<RobotRoutes>>(archive)
        assertEquals(original, decodedArchive.single().routes.single().points)
    }

    @Test
    fun validatorFlagsUnsupportedSemanticsAndRejectsBadBraking() {
        val points = listOf(point(), point(5.0).copy(
            endSpeed = 0.0, dHeading = 20.0, command = "shoot", delayAfterArrive = 1.0
        ))
        val issues = SplineRouteContract.validate(points)
        assertTrue(issues.any { it.field == "brakeZoneIn" && it.severity == SplineRouteContract.Severity.ERROR })
        assertTrue(issues.any { it.field == "dHeading" && it.severity == SplineRouteContract.Severity.WARNING })
        assertTrue(issues.any { it.field == "command" && it.severity == SplineRouteContract.Severity.WARNING })
        assertFalse(issues.any { it.field == "endSpeed" && it.severity == SplineRouteContract.Severity.WARNING })
    }

    @Test
    fun waypointInsertionDoesNotCloneCommandsAndStoppingActions() {
        val prior = point().copy(command = "shoot", marker = "A", commandParams = listOf("1"),
            delayAfterArrive = 2.0, endSpeed = 0.0, brakeZoneIn = 10.0,
            maxPower = 0.5, maxSpeed = 24.0)
        val next = prior.nextWaypoint(12.0, 10.0)
        assertEquals("", next.marker)
        assertEquals("", next.command)
        assertTrue(next.commandParams.isEmpty())
        assertEquals(null, next.endSpeed)
        assertEquals(0.0, next.brakeZoneIn)
        assertEquals(0.5, next.maxPower)
        assertEquals(24.0, next.maxSpeed)
    }

    @Test
    fun previewHeadingMatchesRobotZeroDerivativeSplineAndHalfTurnTie() {
        val spline = OrientedTrajectoryGenerator2D(
            start = DifferentialPoint2D(0.0, 10.0, 0.0, 0.0, 0.0, 100.0),
            end = DifferentialPoint2D(10.0, 10.0, 0.0, 0.0, 90.0, -100.0),
            duration = 2.0
        )
        assertEquals(14.0625, spline.getPointAtTime(0.5).heading, 1e-7)
        assertEquals(180.0, normalizeRelative(0.0, -180.0), 1e-7)
    }

    @Test
    fun rawRobotWireContractAllowsWaitAndRejectsMalformedFields() {
        val valid = """[{"x":0,"y":0},{"wait":0.5},{"x":24,"y":0,"maxPower":0.5,"endSpeed":0,"brakeZoneIn":8}]"""
        assertTrue(SplineRouteContract.validateRobotJson(valid).none {
            it.severity == SplineRouteContract.Severity.ERROR
        })
        val bad = """[{"x":0,"y":0},{"x":24,"y":0,"endSpeed":null,"maxSpeed":-1}]"""
        assertTrue(SplineRouteContract.validateRobotJson(bad).any {
            it.field == "endSpeed" && it.severity == SplineRouteContract.Severity.ERROR
        })
        assertTrue(SplineRouteContract.validateRobotJson(bad).any {
            it.field == "maxSpeed" && it.severity == SplineRouteContract.Severity.ERROR
        })
        assertTrue(SplineRouteContract.validateRobotJson("""{"routes":[]}""").any {
            it.severity == SplineRouteContract.Severity.ERROR
        })
    }

    @Test
    fun delayWaitFramesRoundTripWithoutDoubleCounting() {
        val original = listOf(
            point().copy(delayAfterArrive = 1.5),
            point(20.0).copy(duration = 2.0, delayAfterArrive = 2.5,
                endSpeed = 0.0, brakeZoneIn = 10.0)
        )
        val wire = SplineRouteContract.encodeRobotRoute(original, json)
        val frames = json.parseToJsonElement(wire) as JsonArray
        assertEquals(4, frames.size)
        assertFalse((frames[0] as JsonObject).containsKey("delayAfterArrive"))
        assertEquals("1.5", (frames[1] as JsonObject)["wait"]!!.jsonPrimitive.content)
        assertEquals("2.5", (frames[3] as JsonObject)["wait"]!!.jsonPrimitive.content)
        assertEquals(original, SplineRouteContract.decodeRobotRoute(wire, json))
        assertTrue(SplineRouteContract.validateRobotJson(wire).none {
            it.severity == SplineRouteContract.Severity.ERROR
        })
    }

    @Test
    fun independentWaitBeforeFirstPointCannotBeSilentlyImported() {
        val bad = """[{"wait":2},{"x":0,"y":0}]"""
        assertTrue(runCatching { SplineRouteContract.decodeRobotRoute(bad, json) }.isFailure)
        val oldRobotNodes = """[{"x":0,"y":1},{"x":2,"y":1,"delayAfterArrive":2}]"""
        assertEquals(2.0, SplineRouteContract.decodeRobotRoute(oldRobotNodes, json).last().delayAfterArrive)
    }
}
