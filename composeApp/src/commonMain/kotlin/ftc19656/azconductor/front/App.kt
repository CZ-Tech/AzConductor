package ftc19656.azconductor.front

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.wrapContentSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.IntSize
import azconductor.composeapp.generated.resources.FTC_MAP26
import azconductor.composeapp.generated.resources.Res
import ftc19656.azconductor.*
import ftc19656.azconductor.back.route.DifferentialPoint2D
import ftc19656.azconductor.back.route.RouteConnector
import org.jetbrains.compose.resources.painterResource
import kotlin.math.cos
import kotlin.math.sin

@Composable
@Preview
fun App(route: RouteConnector = RouteConnector(20.0)) {
    val painter = painterResource(Res.drawable.FTC_MAP26)
    var canvasPhysicalSize by remember { mutableStateOf(IntSize.Zero) }
    val rotationDegrees = canvasRotateDeg

    val selectedNodeIndex = remember { mutableStateOf(0) }

    // 决定使用哪套配色，这里简单示例硬编码为浅色
    val colorScheme = MyLightColors

    // 逻辑边界计算
    val originRatioX = 0.5f
    val originRatioY = 0.5f
    val bounds = remember(canvasLogicalWidth, canvasLogicalHeight) {
        RectBounds(
            minX = (-canvasLogicalWidth * originRatioX).toDouble(),
            maxX = (canvasLogicalWidth * (1f - originRatioX)).toDouble(),
            minY = (-canvasLogicalHeight * originRatioY).toDouble(),
            maxY = (canvasLogicalHeight * (1f - originRatioY)).toDouble()
        )
    }

    MaterialTheme(colorScheme = colorScheme,) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .wrapContentSize(Alignment.Center)
                .aspectRatio(canvasLogicalWidth / canvasLogicalHeight)
                .onSizeChanged { canvasPhysicalSize = it }
        ) {
            if (canvasPhysicalSize != IntSize.Zero) {
                val mapper = remember(canvasPhysicalSize, rotationDegrees) {
                    CoordinateMapper(
                        physicalWidth = canvasPhysicalSize.width.toFloat(),
                        physicalHeight = canvasPhysicalSize.height.toFloat(),
                        logicalWidth = canvasLogicalWidth,
                        logicalHeight = canvasLogicalHeight,
                        originRatioX = originRatioX,
                        originRatioY = originRatioY,
                        rotationDegrees = rotationDegrees
                    )
                }

                // --- 第一层：Canvas 绘制地图背景和路径 ---
                Canvas(
                    modifier = Modifier
                        .fillMaxSize()
                        .drawBehind { with(painter) { draw(size = size) } }
                        .pointerInput(mapper) {
                            detectTapGestures { offset ->
                                val logicPos = mapper.screenToLogical(offset.x, offset.y)
                                route.addPoint(
                                    DifferentialPoint2D(
                                        logicPos.x.toDouble().coerceIn(bounds.minX, bounds.maxX),
                                        10.0,
                                        logicPos.y.toDouble().coerceIn(bounds.minY, bounds.maxY),
                                        10.0
                                    )
                                )
                            }
                        }
                ) {
                    // 在此处读取 pathVersion。向 Compose 注册了依赖关系
                    // 只要 route.pathVersion 发生变化，这个 Canvas 就会触发重绘阶段
                    val currentVersion = route.pathVersion
                    // 路径绘制：由于 route.waypoints 是 StateList，此处会自动重绘
                    withTransform({
                        translate(mapper.centerX, mapper.centerY)
                        rotate(rotationDegrees, pivot = Offset.Zero)
                        scale(mapper.scale, mapper.scale, pivot = Offset.Zero)
                        translate(canvasLogicalWidth * (originRatioX - 0.5f), canvasLogicalHeight * (originRatioY - 0.5f))
                    }) {
                        val path = Path()
                        val totalTime = route.getTotalTime()
                        if (totalTime > 0) {
                            for (i in 0..curveDrawStep) {
                                val time = (i.toDouble() / curveDrawStep) * totalTime
                                val point = route.getPointAtTime(time) ?: break
                                if (i == 0) path.moveTo(point.x.toFloat(), point.y.toFloat())  // 移动画笔到起点
                                else path.lineTo(point.x.toFloat(), point.y.toFloat())  // 划线到下一个点
                            }
                            drawPath(
                                path = path,
                                color = pathLineColor,
                                style = Stroke(width = canvasLineWidth / mapper.scale)
                            )
                        }
                    }
                }

                // 绘制节点
                // 使用 key 确保在点数量变化时，组件能被正确复用或重置
                route.waypoints.forEachIndexed { index, node ->
                    key(index) {
                        DraggableNode(
                            index = index,
                            node = node,
                            mapper = mapper,
                            bounds = bounds,
                            onMove = { idx, newNode -> route.moveNode(idx, newNode) },
                            onClick = {
                                println("Selected node: $it")
                                selectedNodeIndex.value = index
                            }
                        )
                        // 如果该节点被选中，则显示向量调节手柄
                        if (selectedNodeIndex.value == index) {
                            VectorHandle(
                                node = node,
                                mapper = mapper,
                                onVectorChanged = { newDx, newDy ->
                                    // 更新该节点的向量属性，保持 x, y 不变
                                    val updatedNode = node.copy(dx = newDx, dy = newDy)
                                    route.moveNode(index, updatedNode)
                                }
                            )
                        }
                    }
                }
            }
        }
    }
}

// 简单的边界数据类
data class RectBounds(val minX: Double, val maxX: Double, val minY: Double, val maxY: Double)

// --- Mapper 工具类 (保持不变) ---
class CoordinateMapper(
    physicalWidth: Float, physicalHeight: Float,
    logicalWidth: Float, logicalHeight: Float,
    originRatioX: Float, originRatioY: Float,
    rotationDegrees: Float
) {
    val centerX = physicalWidth / 2f
    val centerY = physicalHeight / 2f
    val scale = minOf(physicalWidth / logicalWidth, physicalHeight / logicalHeight)
    private val offsetX = logicalWidth * (originRatioX - 0.5f)
    private val offsetY = logicalHeight * (originRatioY - 0.5f)
    private val angleRad = (rotationDegrees.toDouble()).toRadians().toFloat()
    private val cosA = cos(angleRad)
    private val sinA = sin(angleRad)

    fun logicalToScreen(lx: Float, ly: Float): Offset {
        val sx = (lx + offsetX) * scale
        val sy = (ly + offsetY) * scale
        return Offset(sx * cosA - sy * sinA + centerX, sx * sinA + sy * cosA + centerY)
    }

    fun screenToLogical(px: Float, py: Float): Offset {
        val rx = px - centerX
        val ry = py - centerY
        val clx = (rx * cosA + ry * sinA) / scale
        val cly = (-rx * sinA + ry * cosA) / scale
        return Offset(clx - offsetX, cly - offsetY)
    }

    fun screenDeltaToLogicalDelta(dx: Float, dy: Float): Offset {
        return Offset((dx * cosA + dy * sinA) / scale, (-dx * sinA + dy * cosA) / scale)
    }
}