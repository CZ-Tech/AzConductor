package ftc19656.azconductor.ui.components

import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.isSecondaryPressed
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import ftc19656.azconductor.route.DifferentialPoint2D
import ftc19656.azconductor.core.math.CoordinateMapper
import ftc19656.azconductor.core.math.RectBounds
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

/**
 * 核心组件：可拖拽的路径点
 */
@Composable
fun DraggableNode(
    index: Int,
    node: DifferentialPoint2D,
    mapper: CoordinateMapper,
    bounds: RectBounds,
    onMove: (Int, DifferentialPoint2D) -> Unit,
    onClick: (Int) -> Unit,
    onRightClick: (Int) -> Unit
) {
    val density = LocalDensity.current
    val dotSizeDp = 20.dp
    val dotSizePx = with(density) { dotSizeDp.toPx() }

    // 获取最新 node 的引用同步状态
    val currentNode by rememberUpdatedState(node)

    // 计算当前物理屏幕位置
    val screenPos = mapper.logicalToScreen(node.x.toFloat(), node.y.toFloat())

    // 内部状态：仅用于处理拖拽过程中的累加偏移，避免舍入误差
    var totalDragOffset by remember { mutableStateOf(Offset.Zero) }
    var initialNodeBeforeDrag by remember { mutableStateOf<DifferentialPoint2D?>(null) }

    Surface(
        shape = CircleShape,
        color = MaterialTheme.colorScheme.primary,
        shadowElevation = 6.dp,
        modifier = Modifier
            .size(dotSizeDp)
            .offset {
                IntOffset(
                    (screenPos.x - dotSizePx / 2).roundToInt(),
                    (screenPos.y - dotSizePx / 2).roundToInt()
                )
            }
            .clip(CircleShape)
            .pointerInput(index, mapper) { // 当索引或映射规则改变时重新绑定手势
                coroutineScope {
                    // 处理点击选中
                    launch {
                        detectTapGestures { onClick(index) }
                    }
                    // 处理拖拽移动
                    launch {
                        detectDragGestures(
                            onDragStart = {
                                initialNodeBeforeDrag = currentNode
                                totalDragOffset = Offset.Zero
                            },
                            onDrag = { change, dragAmount ->
                                change.consume()
                                totalDragOffset += dragAmount

                                val startNode = initialNodeBeforeDrag ?: return@detectDragGestures
                                val logicDelta = mapper.screenDeltaToLogicalDelta(totalDragOffset.x, totalDragOffset.y)

                                // 生成新状态并回传给父组件
                                val newNode = startNode.copy(
                                    x = (startNode.x + logicDelta.x).coerceIn(bounds.minX, bounds.maxX),
                                    y = (startNode.y + logicDelta.y).coerceIn(bounds.minY, bounds.maxY)
                                )
                                onMove(index, newNode)
                            }
                        )
                    }
                }
            }
            .pointerInput(index) {
                awaitPointerEventScope {
                    while (true) {
                        val event = awaitPointerEvent(PointerEventPass.Initial)
                        // 判断是否为鼠标右键按下
                        if (event.type == androidx.compose.ui.input.pointer.PointerEventType.Press &&
                            event.buttons.isSecondaryPressed
                        ) {
                            event.changes.forEach { it.consume() } // 消费事件，防止穿透
                            onRightClick(index)
                        }
                    }
                }
            }
    ) {}
}

