package ftc19656.azconductor.front

import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
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
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import ftc19656.azconductor.back.route.DifferentialPoint2D
import kotlin.math.roundToInt

@Composable
fun VectorHandle(
    node: DifferentialPoint2D,       // 父节点数据
    mapper: CoordinateMapper,        // 坐标转换器
    color: Color = MaterialTheme.colorScheme.secondary,
    onVectorChanged: (Double, Double) -> Unit // 回调新的 dx, dy
) {
    val density = LocalDensity.current
    val handleSizeDp = 24.dp
    val handleSizePx = with(density) { handleSizeDp.toPx() }

    // 1. 计算父节点和手柄末端的物理屏幕坐标
    val startPx = mapper.logicalToScreen(node.x.toFloat(), node.y.toFloat())
    val endPx = mapper.logicalToScreen(
        (node.x + node.dx).toFloat(),
        (node.y + node.dy).toFloat()
    )

    val currentNode by rememberUpdatedState(node)  // 储存当前节点的最新状态

    // 记录拖拽开始时的初始状态，防止舍入误差积累
    var initialVector by remember { mutableStateOf(Offset(node.dx.toFloat(), node.dy.toFloat())) }
    var totalDragDelta by remember { mutableStateOf(Offset.Zero) }

    Box(
        modifier = Modifier
            .fillMaxSize()
            // 2. 在背景画直线：从父节点画到手柄
            .drawBehind {
                drawLine(
                    color = color.copy(alpha = 0.6f),
                    start = startPx,
                    end = endPx,
                    strokeWidth = 2.dp.toPx()
                )
            }
    ) {
        // 3. 末端按钮（Material3 Surface 模拟按钮）
        Surface(
            shape = CircleShape,
            color = color,
            tonalElevation = 4.dp,
            shadowElevation = 4.dp,
            modifier = Modifier
                .size(handleSizeDp)
                .offset {
                    IntOffset(
                        (endPx.x - handleSizePx / 2).roundToInt(),
                        (endPx.y - handleSizePx / 2).roundToInt()
                    )
                }
                .pointerInput(mapper) { // 使用 mapper 作为 key 比较好，因为画布缩放/旋转时我们需要重置手势的坐标系
                    detectDragGestures(
                        onDragStart = {
                            // 当你第一次拖动结束时，node 的真实数据已经更新了。但是当你第二次点击拖动时，pointerInput 并没有重启，它里面 lambda 闭包引用的依然是组件刚创建时的那个旧 node。所以 initialVector 被赋予了最开始的旧值，导致向量瞬间跳回原位
                            // 因此使用 currentNode，而不是传进来的被捕获的 node，维持最新状态
                            initialVector = Offset(currentNode.dx.toFloat(), currentNode.dy.toFloat())
                            totalDragDelta = Offset.Zero
                        },
                        onDrag = { change, dragAmount ->
                            change.consume()
                            totalDragDelta += dragAmount

                            // 将物理位移增量转换为逻辑位移增量
                            val logicDelta = mapper.screenDeltaToLogicalDelta(
                                totalDragDelta.x,
                                totalDragDelta.y
                            )

                            // 计算新的 dx, dy (相对于父节点坐标)
                            val newDx = (initialVector.x + logicDelta.x).toDouble()
                            val newDy = (initialVector.y + logicDelta.y).toDouble()

                            onVectorChanged(newDx, newDy)
                        }
                    )
                }
        ) {
            // 按钮内部可以放个小图标，比如箭头
            /* Icon(Icons.Default.ArrowForward, contentDescription = null, modifier = Modifier.padding(4.dp)) */
        }
    }
}