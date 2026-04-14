package ftc19656.azconductor.front

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.wrapContentSize
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.input.pointer.PointerEventType
import androidx.compose.ui.input.pointer.isPrimaryPressed
import androidx.compose.ui.input.pointer.isSecondaryPressed
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import azconductor.composeapp.generated.resources.FTC_MAP26
import azconductor.composeapp.generated.resources.Res
import ftc19656.azconductor.*
import ftc19656.azconductor.back.route.DifferentialPoint2D
import ftc19656.azconductor.back.route.RouteConnector
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import org.jetbrains.compose.resources.painterResource
import kotlin.math.cos
import kotlin.math.roundToInt
import kotlin.math.sin

@Composable
@Preview
fun App(
    route: RouteConnector = RouteConnector(20.0)
) {
    val painter = painterResource(Res.drawable.FTC_MAP26)
    val rotationDegrees by remember { mutableStateOf(canvasRotateDeg) }
    var redrawTrigger by remember { mutableStateOf(0) }
    var canvasPhysicalSize by remember { mutableStateOf(IntSize.Zero) }

    val originRatioX = 0.5f
    val originRatioY = 0.5f

    MaterialTheme {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .wrapContentSize(Alignment.Center)
                .aspectRatio(canvasLogicalWidth / canvasLogicalHeight)
                .onSizeChanged { size -> canvasPhysicalSize = size }
        ) {
            val currentTrigger = redrawTrigger // 监听重绘

            // 只有当画布拿到真实的物理尺寸后，我们才实例化 Mapper 开始工作
            if (canvasPhysicalSize != IntSize.Zero) {

                // 使用 remember 固定 mapper 实例
                // 只有当尺寸或旋转角度变化时才重新创建。
                // 这样 redrawTrigger++ 触发重绘时，mapper 保持不变，手势协程就不会被取消。
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

                Canvas(
                    modifier = Modifier
                        .fillMaxSize()
                        .drawBehind { with(painter) { draw(size = size) } }
                        .pointerInput(mapper) {
                            // 替换原有的底层事件，使用更高级的 detectTapGestures
                            detectTapGestures { offset ->
                                // 转换点击坐标
                                val logicPos = mapper.screenToLogical(offset.x, offset.y)

                                // 添加点时也可以加个越界限制，防止点在 Canvas 边缘外围
                                val minLogicX = -canvasLogicalWidth * originRatioX
                                val maxLogicX = canvasLogicalWidth * (1f - originRatioX)
                                val minLogicY = -canvasLogicalHeight * originRatioY
                                val maxLogicY = canvasLogicalHeight * (1f - originRatioY)

                                val clampedX = logicPos.x.coerceIn(minLogicX, maxLogicX)
                                val clampedY = logicPos.y.coerceIn(minLogicY, maxLogicY)

                                println("Add point at: ${logicPos.x}, ${logicPos.y}")
                                route.addPoint(
                                    DifferentialPoint2D(
                                        clampedX.toDouble(),
                                        10.0,
                                        clampedY.toDouble(),
                                        10.0
                                    )
                                )
                                redrawTrigger++
                            }
                        }
                ) {
                    val trigger = redrawTrigger  // 读取状态以便触发重绘
                    // 画线
                    withTransform({
                        translate(mapper.centerX, mapper.centerY)
                        rotate(rotationDegrees, pivot = Offset.Zero)
                        scale(mapper.scale, mapper.scale, pivot = Offset.Zero)

                        val offsetX = canvasLogicalWidth * (originRatioX - 0.5f)
                        val offsetY = canvasLogicalHeight * (originRatioY - 0.5f)
                        translate(offsetX, offsetY)
                    }) {
                        val path = Path()
                        val steps = curveDrawStep
                        val totalTime = route.getTotalTime()

                        if (totalTime > 0) {
                            for (i in 0..steps) {
                                val time = (i.toDouble() / steps) * totalTime
                                val point = route.getPointAtTime(time) ?: break
                                val px = point.x.toFloat()
                                val py = point.y.toFloat()
                                if (i == 0) path.moveTo(px, py) else path.lineTo(px, py)
                            }
                            drawPath(
                                path = path,
                                color = pathLineColor,
                                style = Stroke(width = canvasLineWidth / mapper.scale)
                            )
                        }
                    }
                }

                // ====== 表层：Material3 可点击/可拖拽组件 Overlay ======
                val density = LocalDensity.current
                val dotSizeDp = 20.dp
                val dotSizePx = with(density) { dotSizeDp.toPx() }

                // 计算逻辑坐标边界
                val minLogicX = -canvasLogicalWidth * originRatioX
                val maxLogicX = canvasLogicalWidth * (1f - originRatioX)
                val minLogicY = -canvasLogicalHeight * originRatioY
                val maxLogicY = canvasLogicalHeight * (1f - originRatioY)

                route.getNodes().forEachIndexed { index, node ->
                    // 保存拖拽开始时的原节点与累计滑动偏移量
                    var initialNode by remember { mutableStateOf<DifferentialPoint2D?>(null) }
                    var totalDrag by remember { mutableStateOf(Offset.Zero) }

                    val screenPos = mapper.logicalToScreen(node.x.toFloat(), node.y.toFloat())
                    val finalOffsetX = screenPos.x - (dotSizePx / 2f)
                    val finalOffsetY = screenPos.y - (dotSizePx / 2f)

                    // 保存 node 的最新状态。
                    // 这样即便 pointerInput 的协程不重启，它也能通过 currentNode 拿到每一帧重绘后的最新坐标。
                    val currentNode by rememberUpdatedState(node)

                    Surface(
                        shape = CircleShape,
                        color = MaterialTheme.colorScheme.primary,
                        shadowElevation = 4.dp,
                        modifier = Modifier
                            .offset { IntOffset(finalOffsetX.roundToInt(), finalOffsetY.roundToInt()) }
                            .size(dotSizeDp)
                            .clip(CircleShape)
                            // 核心修复 2：将手势合并，并使用 coroutineScope
                            .pointerInput(mapper) {
                                coroutineScope {
                                    // 启动协程处理点击
                                    launch {
                                        detectTapGestures {
                                            println("点击了节点 #$index")
                                        }
                                    }
                                    // 启动协程处理长按拖拽
                                    launch {
                                        detectDragGestures (
                                            onDragStart = {
                                                println("开始拖拽节点 #$index")
                                                // 记录开始拖拽那一瞬间的原始节点和清空偏移量
                                                initialNode = currentNode
                                                totalDrag = Offset.Zero
                                            },
                                            onDragEnd = { initialNode = null },
                                            onDragCancel = { initialNode = null },
                                            onDrag = { change, dragAmount ->
                                                println("正在拖拽 $dragAmount")
                                                change.consume()

                                                // 累加真实的物理屏幕像素滑动量
                                                totalDrag += dragAmount

                                                // 将总物理滑动量，转换成总逻辑滑动量
                                                val logicTotalDelta = mapper.screenDeltaToLogicalDelta(totalDrag.x, totalDrag.y)

                                                // 使用 mapper 将物理像素增量转换为逻辑坐标增量
                                                val logicDelta = mapper.screenDeltaToLogicalDelta(dragAmount.x, dragAmount.y)
                                                // 核心：永远用 initialNode 加上总 delta，拒绝误差堆叠！并施加边界拦截。
                                                val newX = ((initialNode?:currentNode).x + logicTotalDelta.x)
                                                    .coerceIn(minLogicX.toDouble(), maxLogicX.toDouble())
                                                val newY = ((initialNode?:currentNode).y + logicTotalDelta.y)
                                                    .coerceIn(minLogicY.toDouble(), maxLogicY.toDouble())

                                                val movedNode = DifferentialPoint2D(
                                                    x = newX,
                                                    dx = node.dx,
                                                    y = newY,
                                                    dy = node.dy
                                                )

                                                route.moveNode(index, movedNode)
                                                redrawTrigger++
                                            }
                                        )
                                    }
                                }
                            }
                    ) {}
                }
            }
        }
    }
}

// 提取出的坐标映射工具类
class CoordinateMapper(
    physicalWidth: Float,
    physicalHeight: Float,
    logicalWidth: Float,
    logicalHeight: Float,
    originRatioX: Float,
    originRatioY: Float,
    rotationDegrees: Float
) {
    val centerX = physicalWidth / 2f
    val centerY = physicalHeight / 2f
    val scale = minOf(physicalWidth / logicalWidth, physicalHeight / logicalHeight)

    // 原点偏移量
    private val offsetX = logicalWidth * (originRatioX - 0.5f)
    private val offsetY = logicalHeight * (originRatioY - 0.5f)

    // 旋转三角函数预计算
    private val angleRad = rotationDegrees.toDouble().toRadians()
    private val cosA = cos(angleRad).toFloat()
    private val sinA = sin(angleRad).toFloat()

    /** 将 逻辑坐标 转换为画布上的 物理像素坐标 (用于渲染圆点) */
    fun logicalToScreen(lx: Float, ly: Float): Offset {
        val lxOffset = lx + offsetX
        val lyOffset = ly + offsetY
        val scaledX = lxOffset * scale
        val scaledY = lyOffset * scale
        // 正向旋转
        val rotatedX = scaledX * cosA - scaledY * sinA
        val rotatedY = scaledX * sinA + scaledY * cosA
        return Offset(rotatedX + centerX, rotatedY + centerY)
    }

    // 将屏幕上的 物理像素坐标 转换为 逻辑坐标  (用于点击背景添加点)
    fun screenToLogical(px: Float, py: Float): Offset {
        val relX = px - centerX
        val relY = py - centerY
        // 逆向旋转并除以缩放
        val canvasCenterLogicX = (relX * cosA + relY * sinA) / scale
        val canvasCenterLogicY = (-relX * sinA + relY * cosA) / scale
        return Offset(canvasCenterLogicX - offsetX, canvasCenterLogicY - offsetY)
    }

    // 将屏幕上的 物理滑动差量 转换为逻辑差量 (用于拖拽节点)
    fun screenDeltaToLogicalDelta(dx: Float, dy: Float): Offset {
        // 差量不需要考虑平移(Center和Offset)，只需要考虑旋转和缩放的逆运算
        val logicDx = (dx * cosA + dy * sinA) / scale
        val logicDy = (-dx * sinA + dy * cosA) / scale
        return Offset(logicDx, logicDy)
    }
}