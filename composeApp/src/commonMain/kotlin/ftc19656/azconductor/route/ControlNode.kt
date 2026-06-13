package ftc19656.azconductor.route

import kotlinx.serialization.Serializable
import kotlin.math.abs

/**
 * 路径规划的控制节点，用于底层数学计算和路径逻辑。
 */
@Serializable
data class ControlNode(
    val x: Double,
    val dx: Double,
    val y: Double,
    val dy: Double,
    val heading: Double = 0.0,
    val dHeading: Double = 0.0,
    val duration: Double = 1.0,
    val marker: String = "",
    val command: String = "",
    val delayAfterArrive: Double = 0.0
) {
    infix fun isCloseTo(other: ControlNode): Boolean {
        val epsilon = 1e-7
        return abs(x - other.x) < epsilon &&
                abs(y - other.y) < epsilon &&
                abs(dx - other.dx) < epsilon &&
                abs(dy - other.dy) < epsilon &&
                abs(heading - other.heading) < epsilon &&
                abs(dHeading - other.dHeading) < epsilon &&
                abs(duration - other.duration) < epsilon &&
                marker == other.marker &&
                command == other.command &&
                abs(delayAfterArrive - other.delayAfterArrive) < epsilon
    }
}
