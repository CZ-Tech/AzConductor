package ftc19656.azconductor.back.route

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
     * @param u 归一化进度，范围通常在 0.0 到 1.0 之间
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
 * 二维平面两点间的轨迹生成器（解耦 X 和 Y）
 */
class TrajectoryGenerator2D(
    var startX: Double, var startY: Double, var startDx: Double, var startDy: Double, // 起点状态
    var endX: Double, var endY: Double, var endDx: Double, var endDy: Double,         // 终点状态
    var startTime: Double, var endTime: Double        // 时间区间
) {
    constructor(start: DifferentialPoint2D, end: DifferentialPoint2D, startTime: Double, endTime: Double) : this(
        start.x, start.y, start.dx, start.dy,
        end.x, end.y, end.dx, end.dy,
        startTime, endTime
    )

    // 分别为 X 轴和 Y 轴生成独立的一维样条
    // 样条对象：每次访问 get() 都会根据当前坐标生成新的样条逻辑
    private val splineX get() = CubicHermiteSpline1D(startX, startDx, endX, endDx)
    private val splineY get() = CubicHermiteSpline1D(startY, startDy, endY, endDy)


    val length: Double get() = calculateArcLength(100)

    val duration: Double get() = endTime - startTime



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


    /**
     * 根据当前绝对时间，计算机器人在该时刻的期望位置 (gotoX, gotoY)
     */
    fun getPointAtTime(currentTime: Double): Point2D {
        // 防止除零，并计算归一化进度 u
        val duration = endTime - startTime
        val u = if (duration > 0) {
            // 将当前时间映射到 0.0 ~ 1.0，并限制越界（对应原代码中的 (now - this.lt) / (this.t - this.lt)）
            ((currentTime - startTime) / duration).coerceIn(0.0, 1.0)
        } else {
            1.0
        }

        return Point2D(
            x = splineX.getPosition(u),
            y = splineY.getPosition(u)
        )
    }

    fun getStartPoint(): DifferentialPoint2D {
        return DifferentialPoint2D(
            startX,
            startDx,
            startY,
            startDy)
    }

    fun getEndPoint(): DifferentialPoint2D {
        return DifferentialPoint2D(
            endX,
            endDx,
            endY,
            endDy
        )
    }

}

// 简单的数据类用于存储坐标
data class Point2D(val x: Double, val y: Double) {
    infix fun isCloseTo(other: DifferentialPoint2D): Boolean {
        val epsilon = 1e-7
        return abs(x - other.x) < epsilon &&
                abs(y - other.y) < epsilon
    }
}

data class DifferentialPoint2D(val x: Double, val dx: Double, val y: Double, val dy: Double) {
    infix fun isCloseTo(other: DifferentialPoint2D): Boolean {
        val epsilon = 1e-7
        return abs(x - other.x) < epsilon &&
                abs(y - other.y) < epsilon &&
                abs(dx - other.dx) < epsilon &&
                abs(dy - other.dy) < epsilon
    }
}