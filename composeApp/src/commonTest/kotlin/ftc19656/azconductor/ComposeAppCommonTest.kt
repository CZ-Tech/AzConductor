package ftc19656.azconductor

import ftc19656.azconductor.route.ControlNode
import ftc19656.azconductor.route.RouteCore
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ComposeAppCommonTest {

    @Test
    fun testControlNodeMarkerSerialization() {
        val point = ControlNode(x = 10.0, dx = 1.0, y = 20.0, dy = 2.0, marker = "test-marker")
        val json = Json.encodeToString(point)
        
        assertTrue(json.contains("\"marker\":\"test-marker\""), "JSON should contain the marker field")
        
        val decoded = Json.decodeFromString<ControlNode>(json)
        assertEquals("test-marker", decoded.marker)
        assertTrue(point isCloseTo decoded)
    }

    @Test
    fun testControlNodeIsCloseTo() {
        val p1 = ControlNode(1.0, 1.0, 1.0, 1.0, marker = "a")
        val p2 = ControlNode(1.0, 1.0, 1.0, 1.0, marker = "a")
        val p3 = ControlNode(1.0, 1.0, 1.0, 1.0, marker = "b")
        
        assertTrue(p1 isCloseTo p2)
        assertTrue(!(p1 isCloseTo p3))
    }

    @Test
    fun testRoutePreviewIncludesDelayAfterArrive() {
        val route = RouteCore()
        route.addPoint(ControlNode(x = 0.0, dx = 0.0, y = 0.0, dy = 0.0))
        route.addPoint(ControlNode(x = 10.0, dx = 0.0, y = 0.0, dy = 0.0, duration = 2.0, delayAfterArrive = 3.0))
        route.addPoint(ControlNode(x = 20.0, dx = 0.0, y = 0.0, dy = 0.0, duration = 2.0))

        assertEquals(7.0, route.totalTime)
        assertEquals(10.0, route.getPointAtTime(2.5)!!.x)
        assertEquals(10.0, route.getPointAtTime(5.0)!!.x)
        assertTrue(route.getPointAtTime(6.0)!!.x > 10.0)
    }
}
