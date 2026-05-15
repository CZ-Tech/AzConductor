package ftc19656.azconductor.route

import kotlinx.serialization.Serializable
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.hypot

/**
 * 一维三次埃尔米特样条曲线核心逻辑
 */
class CubicHermiteSpline1D(
    x0: Double, dx0: Double, // 起点：位置与导数
    x1: Double, dx1: Double  // 终点：位置与导数
) {
    // 预计算多项式系数
    private val a: Double = 2 * x0 + dx0 - 2 * x1 + dx1
    private val b: Double = -3 * x0 - 2 * dx0 + 3 * x1 - dx1
    private val c: Double = dx0
    private val d: Double = x0

    /**
     * 获取归一化参数 u 处的位置
     * @param u 归一化进度，范围通常在 0.0 与 1.0 之间
     */
    fun getPosition(u: Double): Double {
        return a * u * u * u + b * u * u + c * u + d
    }

    /**
     * 获取归一化参数 u 处的瞬时速度（导数）
     * 附加功能：对多项式求导 f'(u) = 3au^2 + 2bu + c
     */
    fun getVelocity(u: Double): Double {
        return 3 * a * u * u + 2 * b * u + c
    }
}

/**
 * 二维平面两点间的轨迹生成器（解析 X 与 Y）
 */
open class TrajectoryGenerator2D(
    var startX: Double, var startY: Double, var startDx: Double, var startDy: Double, // 起点状态
    var endX: Double, var endY: Double, var endDx: Double, var endDy: Double,         // 终点状态
    open var duration: Double        // 时间区间
) {
    constructor(start: DifferentialPoint2D, end: DifferentialPoint2D, duration: Double) : this(
        start.x, start.y, start.dx, start.dy,
        end.x, end.y, end.dx, end.dy,
        duration
    )

    // 分别为 X 轴和 Y 轴生成独立的一维样条
    // 样条对象：每次访问 get() 都会根据当前坐标生成新的样条逻辑
    protected open val splineX get() = CubicHermiteSpline1D(startX, startDx, endX, endDx)
    protected open val splineY get() = CubicHermiteSpline1D(startY, startDy, endY, endDy)


    val length: Double get() = calculateArcLength(100)

    /**
     * 使用辛普森积分法计算弧长
     * @param n 迭代步数（越大越精确，通常 100 足够 FTC 使用）
     */
    private fun calculateArcLength(n: Int): Double {
        if (n % 2 != 0) return calculateArcLength(n + 1) // 辛普森法要求步数为偶数
        val sx = splineX
        val sy = splineY

        val speedAtU: (Double) -> Double = { u ->
            val vx = sx.getVelocity(u)
            val vy = sy.getVelocity(u)
            hypot(vx, vy)
        }

        val du = 1.0 / n
        var sum = speedAtU(0.0) + speedAtU(1.0)

        for (i in 1 until n) {
            val u = i * du
            val weight = if (i % 2 == 1) 4 else 2
            sum += weight * speedAtU(u)
        }

        return (du / 3.0) * sum
    }


    // 计算 u 的逻辑提取出来，方便子类复用
    protected fun getU(localTime: Double): Double {
        return if (duration > 0) {
            (localTime / duration).coerceIn(0.0, 1.0)
        } else 1.0
    }

    /**
     * 根据当前在路段内的局部时间，计算机器人在该时刻的期望位置 (gotoX, gotoY)
     */
    open fun getPointAtTime(localTime: Double): DifferentialPoint2D {
        val u = getU(localTime)
        return DifferentialPoint2D(
            x = splineX.getPosition(u),
            dx = splineX.getVelocity(u),
            y = splineY.getPosition(u),
            dy = splineY.getVelocity(u)
        )
    }

    open fun getStartPoint(): DifferentialPoint2D {
        return DifferentialPoint2D(
            startX,
            startDx,
            startY,
            startDy)
    }

    open fun getEndPoint(): DifferentialPoint2D {
        return DifferentialPoint2D(
            endX,
            endDx,
            endY,
            endDy
        )
    }

}

/**
 * 带朝向的一体化轨迹生成器
 */
class OrientedTrajectoryGenerator2D(
    startX: Double, startY: Double, startDx: Double, startDy: Double,
    var startHeading: Double, var startDHeading: Double, // 新增朝向属性
    endX: Double, endY: Double, endDx: Double, endDy: Double,
    var endHeading: Double, var endDHeading: Double,     // 新增朝向属性
    override var duration: Double
) : TrajectoryGenerator2D(
    startX, startY, startDx, startDy,
    endX, endY, endDx, endDy,
    duration
) {


    // 方便的次级构造函数，直接传入 DifferentialPoint2D
    constructor(start: DifferentialPoint2D, end: DifferentialPoint2D, duration: Double) : this(
        start.x, start.y, start.dx, start.dy, start.heading, start.dHeading,
        end.x, end.y, end.dx, end.dy, end.heading, end.dHeading,
        duration
    )

    // 专属于朝向的样条
    private val splineHeading get() = CubicHermiteSpline1D(
        startHeading,
        startDHeading,
        normalizeRelative(startHeading, endHeading),
        endDHeading)

    /**
     * 复写获取点的方法，填充 heading 字段
     */
    override fun getPointAtTime(localTime: Double): DifferentialPoint2D {
        val u = getU(localTime)
        // 调用 super 获取基础的 x, y, dx, dy，然后注入新 heading 和 dHeading
        val basePoint = super.getPointAtTime(localTime)
        return basePoint.copy(
            heading = splineHeading.getPosition(u),
            dHeading = splineHeading.getVelocity(u)
        )
    }

    /**
     * 覆盖获取起始点的方法，返回包含完整信息的 DifferentialPoint2D
     */
    override fun getStartPoint(): DifferentialPoint2D {
        return DifferentialPoint2D(startX, startDx, startY, startDy, startHeading, startDHeading)
    }

    override fun getEndPoint(): DifferentialPoint2D {
        return DifferentialPoint2D(endX, endDx, endY, endDy, endHeading, endDHeading)
    }
}

@Serializable
data class DifferentialPoint2D(val x: Double,
                               val dx: Double,
                               val y: Double,
                               val dy: Double,
                               val heading: Double = 0.0,
                               val dHeading: Double = 0.0,
                               val duration: Double = 1.0,
                               val marker: String = "",
                               val delayAfterArrive: Double = 0.0
                              ) {
    infix fun isCloseTo(other: DifferentialPoint2D): Boolean {
        val epsilon = 1e-7
        return abs(x - other.x) < epsilon &&
                abs(y - other.y) < epsilon &&
                abs(dx - other.dx) < epsilon &&
                abs(dy - other.dy) < epsilon &&
                abs(heading - other.heading) < epsilon &&
                abs(dHeading - other.dHeading) < epsilon &&
                abs(duration - other.duration) < epsilon &&
                marker == other.marker &&
                abs(delayAfterArrive - other.delayAfterArrive) < epsilon
    }
}

/**
 * 将目标角度调整为相对于起始角度的最短路径对应值
 * 例如：从 350° 到 10°，会将 10° 转换为 370°，样条插值就会顺时针转 20°
 */
fun normalizeRelative(start: Double, end: Double): Double {
    var diff = (end - start) % 360.0
    if (diff > 180.0) diff -= 360.0
    if (diff < -180.0) diff += 360.0
    return start + diff
}
