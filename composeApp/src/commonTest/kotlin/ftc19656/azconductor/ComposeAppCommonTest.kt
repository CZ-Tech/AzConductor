package ftc19656.azconductor

import ftc19656.azconductor.route.DifferentialPoint2D
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ComposeAppCommonTest {

    @Test
    fun testDifferentialPoint2DMarkerSerialization() {
        val point = DifferentialPoint2D(x = 10.0, dx = 1.0, y = 20.0, dy = 2.0, marker = "test-marker")
        val json = Json.encodeToString(point)
        
        assertTrue(json.contains("\"marker\":\"test-marker\""), "JSON should contain the marker field")
        
        val decoded = Json.decodeFromString<DifferentialPoint2D>(json)
        assertEquals("test-marker", decoded.marker)
        assertTrue(point isCloseTo decoded)
    }

    @Test
    fun testDifferentialPoint2DIsCloseTo() {
        val p1 = DifferentialPoint2D(1.0, 1.0, 1.0, 1.0, marker = "a")
        val p2 = DifferentialPoint2D(1.0, 1.0, 1.0, 1.0, marker = "a")
        val p3 = DifferentialPoint2D(1.0, 1.0, 1.0, 1.0, marker = "b")
        
        assertTrue(p1 isCloseTo p2)
        assertTrue(!(p1 isCloseTo p3))
    }
}
