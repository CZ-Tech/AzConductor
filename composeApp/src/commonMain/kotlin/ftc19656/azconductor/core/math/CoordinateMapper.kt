package ftc19656.azconductor.core.math

import androidx.compose.ui.geometry.Offset
import ftc19656.azconductor.FieldConfig
import ftc19656.azconductor.toRadians
import kotlin.math.cos
import kotlin.math.sin

/**
 * 简单的边界数据类
 */
data class RectBounds(val minX: Double, val maxX: Double, val minY: Double, val maxY: Double)

/**
 * 坐标映射工具类
 */
class CoordinateMapper(
    physicalWidth: Float, physicalHeight: Float,
    logicalWidth: Float, logicalHeight: Float,
    originRatioX: Float, originRatioY: Float,
    rotationDegrees: Float
) {
    val centerX = physicalWidth / 2f
    val centerY = physicalHeight / 2f
    val scale = minOf(physicalWidth / logicalWidth, physicalHeight / logicalHeight)

    // 逻辑原点偏移（逻辑单位）
    private val logicalOffsetX = logicalWidth * (originRatioX - 0.5f)
    private val logicalOffsetY = logicalHeight * (originRatioY - 0.5f)

    // 基础屏幕偏移（在缩放和旋转之前）
    private val baseOffsetX = logicalOffsetX * FieldConfig.LOGICAL_X_MAP_TO_SCREEN_X + logicalOffsetY * FieldConfig.LOGICAL_Y_MAP_TO_SCREEN_X
    private val baseOffsetY = logicalOffsetX * FieldConfig.LOGICAL_X_MAP_TO_SCREEN_Y + logicalOffsetY * FieldConfig.LOGICAL_Y_MAP_TO_SCREEN_Y

    private val angleRad = (rotationDegrees.toDouble()).toRadians().toFloat()
    private val cosA = cos(angleRad)
    private val sinA = sin(angleRad)

    // 逆矩阵计算，用于 screenToLogical
    private val det = FieldConfig.LOGICAL_X_MAP_TO_SCREEN_X * FieldConfig.LOGICAL_Y_MAP_TO_SCREEN_Y - FieldConfig.LOGICAL_X_MAP_TO_SCREEN_Y * FieldConfig.LOGICAL_Y_MAP_TO_SCREEN_X
    private val invXMapX = FieldConfig.LOGICAL_Y_MAP_TO_SCREEN_Y / det
    private val invXMapY = -FieldConfig.LOGICAL_Y_MAP_TO_SCREEN_X / det
    private val invYMapX = -FieldConfig.LOGICAL_X_MAP_TO_SCREEN_Y / det
    private val invYMapY = FieldConfig.LOGICAL_X_MAP_TO_SCREEN_X / det

    // 将逻辑坐标映射到基础物理坐标（变换前）
    fun logicalToBase(lx: Float, ly: Float): Offset {
        val sxBase = lx * FieldConfig.LOGICAL_X_MAP_TO_SCREEN_X + ly * FieldConfig.LOGICAL_Y_MAP_TO_SCREEN_X + baseOffsetX
        val syBase = lx * FieldConfig.LOGICAL_X_MAP_TO_SCREEN_Y + ly * FieldConfig.LOGICAL_Y_MAP_TO_SCREEN_Y + baseOffsetY
        return Offset(sxBase, syBase)
    }


    fun logicalToScreen(lx: Float, ly: Float): Offset {
        val base = logicalToBase(lx, ly)
        val sx = base.x * scale
        val sy = base.y * scale
        return Offset(sx * cosA - sy * sinA + centerX, sx * sinA + sy * cosA + centerY)
    }

    fun screenToLogical(px: Float, py: Float): Offset {
        val rx = px - centerX
        val ry = py - centerY
        val sxBase = (rx * cosA + ry * sinA) / scale - baseOffsetX
        val syBase = (-rx * sinA + ry * cosA) / scale - baseOffsetY

        val lx = sxBase * invXMapX + syBase * invXMapY
        val ly = sxBase * invYMapX + syBase * invYMapY
        return Offset(lx, ly)
    }

    fun screenDeltaToLogicalDelta(dx: Float, dy: Float): Offset {
        val sxBase = (dx * cosA + dy * sinA) / scale
        val syBase = (-dx * sinA + dy * cosA) / scale

        val lx = sxBase * invXMapX + syBase * invXMapY
        val ly = sxBase * invYMapX + syBase * invYMapY
        return Offset(lx, ly)
    }
}

