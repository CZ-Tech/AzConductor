package ftc19656.azconductor

import ftc19656.azconductor.route.ControlNode
import ftc19656.azconductor.route.RouteCore
import ftc19656.azconductor.ui.components.advancePlaybackTime
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

    @Test
    fun testInitialWaitAppearsInPreviewTimeline() {
        val route = RouteCore()
        route.addPoint(ControlNode(x = 0.0, dx = 20.0, y = 0.0, dy = 0.0, delayAfterArrive = 1.5))
        route.addPoint(ControlNode(x = 10.0, dx = 20.0, y = 0.0, dy = 0.0, duration = 2.0))
        assertEquals(3.5, route.totalTime)
        assertEquals(0.0, route.getPointAtTime(1.0)!!.x)
        assertTrue(route.getPointAtTime(2.0)!!.x > 0.0)
    }

    @Test
    fun testAdvancePlaybackTimeAppliesSpeed() {
        // 原速推进一帧
        assertEquals(1.016f, advancePlaybackTime(1f, 10f, 1f), 1e-6f)
        // 2 倍速推进一帧
        assertEquals(1.032f, advancePlaybackTime(1f, 10f, 2f), 1e-6f)
        // 0.5 倍速推进一帧
        assertEquals(1.008f, advancePlaybackTime(1f, 10f, 0.5f), 1e-6f)
    }

    @Test
    fun testAdvancePlaybackTimeClampsAtTotalTime() {
        assertEquals(10f, advancePlaybackTime(9.99f, 10f, 4f), 1e-6f)
        // 无有效路径时不推进
        assertEquals(0f, advancePlaybackTime(0f, 0f, 4f), 1e-6f)
    }

    @Test
    fun testAdvancePlaybackTimeClampsSpeedToAllowedRange() {
        assertEquals(
            advancePlaybackTime(1f, 10f, TimingConfig.PLAYBACK_SPEED_MIN),
            advancePlaybackTime(1f, 10f, 0f),
            1e-6f
        )
        assertEquals(
            advancePlaybackTime(1f, 10f, TimingConfig.PLAYBACK_SPEED_MAX),
            advancePlaybackTime(1f, 10f, 100f),
            1e-6f
        )
    }

    @Test
    fun testSpeedLabelFormatting() {
        assertEquals("1x", 1f.toSpeedLabel())
        assertEquals("2x", 2f.toSpeedLabel())
        assertEquals("3x", 3f.toSpeedLabel())
        assertEquals("0.5x", 0.5f.toSpeedLabel())
        assertEquals("1.5x", 1.5f.toSpeedLabel())
        assertEquals("0.25x", 0.25f.toSpeedLabel())
    }

    @Test
    fun testPlaybackSpeedPresetsStayWithinClampRange() {
        val presets = TimingConfig.PLAYBACK_SPEED_PRESETS
        assertTrue(presets.isNotEmpty(), "倍速档位不能为空")
        assertEquals(presets.sorted(), presets, "倍速档位应递增排列")
        assertTrue(TimingConfig.PLAYBACK_SPEED_DEFAULT in presets, "默认倍速应在档位中")
        assertTrue(3f in presets, "应包含 3 倍速档位")
        assertTrue(8f !in presets, "不应再包含 8 倍速档位")
        assertTrue(1.5f !in presets, "不应再包含 1.5 倍速档位")
        presets.forEach { preset ->
            assertTrue(
                preset in TimingConfig.PLAYBACK_SPEED_MIN..TimingConfig.PLAYBACK_SPEED_MAX,
                "倍速档位 $preset 超出钳制区间"
            )
        }
    }
}
