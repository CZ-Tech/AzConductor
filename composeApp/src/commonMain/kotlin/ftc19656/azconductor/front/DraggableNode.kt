package ftc19656.azconductor.front

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
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import ftc19656.azconductor.back.route.DifferentialPoint2D
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlin.math.roundToInt
/**
 * 核心组件：可拖拽的路点
 */
@Composable
fun DraggableNode(
    index: Int,
    node: DifferentialPoint2D,
    mapper: CoordinateMapper,
    bounds: RectBounds,
    onMove: (Int, DifferentialPoint2D) -> Unit,
    onClick: (Int) -> Unit
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
                                // 当你第一次拖动结束时，node 的真实数据已经更新了。但是当你第二次点击拖动时，pointerInput 并没有重启，它里面 lambda 闭包引用的依然是组件刚创建时的那个旧 node。所以 initialVector 被赋予了最开始的旧值，导致向量瞬间跳回原位
                                // 因此使用 currentNode，而不是传进来的被捕获的 node，维持最新状态
                                initialNodeBeforeDrag = currentNode
                                totalDragOffset = Offset.Zero
                            },
                            onDrag = { change, dragAmount ->
                                change.consume()
                                totalDragOffset += dragAmount

                                val startNode = initialNodeBeforeDrag ?: return@detectDragGestures
                                val logicDelta = mapper.screenDeltaToLogicalDelta(totalDragOffset.x, totalDragOffset.y)

                                // 生成新状态并回传给父级
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
    ) {}
}



/** 以下是Gemini关于这些代码的解释
 *
 * 这个问题问得非常深入，触及了 Compose **“声明式 UI”** 的底层逻辑。
 *
 * 简单来说，`DraggableNode` 并不是在“监控”一个不断变化的对象，而是**随着数据的更新不断被“重新描述”**。
 *
 * 以下是保证它能精准跟踪的三个核心机制：
 *
 * ### 1. 状态驱动的重组 (Recomposition)
 * 在 `App.kt` 的循环中，你是这样写的：
 * ```kotlin
 * route.waypoints.forEachIndexed { index, node ->
 *     key(index) {
 *         DraggableNode(node = node, ...)
 *     }
 * }
 * ```
 * * **触发源**：当你在 `RouteConnector` 中执行 `_waypoints[index] = newNode` 时，由于 `_waypoints` 是一个 `mutableStateListOf`，Compose 会立刻感知到这个列表的第 `index` 项发生了变化。
 * * **重新执行**：Compose 会重新调用该索引对应的 `DraggableNode` 函数。
 * * **新旧替换**：此时，新的 `node` 对象（你 `.copy()` 出来的那个新实例）被作为参数传入。对于 `DraggableNode` 来说，它内部计算 `screenPos` 时用到的 `node.x` 和 `node.y` 已经是最新值了。
 *
 * ### 2. `.offset` 修饰符的实时性
 * 在 `DraggableNode` 内部：
 * ```kotlin
 * val screenPos = mapper.logicalToScreen(node.x.toFloat(), node.y.toFloat())
 *
 * Surface(
 *     modifier = Modifier
 *         .offset {
 *             IntOffset(
 *                 (screenPos.x - dotSizePx / 2).roundToInt(),
 *                 (screenPos.y - dotSizePx / 2).roundToInt()
 *             )
 *         }
 * )
 * ```
 * 注意这里使用的是 **`offset { ... }` (Lambda 版本)** 而不是普通的 `offset(x, y)`：
 * * **性能优化**：Lambda 版本的 `offset` 会在 **Layout（布局）阶段** 甚至 **Placement（放置）阶段** 直接执行，而不需要触发整个组件的重绘。
 * * **自动绑定**：只要 `node` 参数发生了变化，`screenPos` 就会重新计算，`offset` 块内部读取到的坐标也就随之更新，圆点在屏幕上的物理位置立刻“瞬移”到正确位置。
 *
 * ### 3. 使用 `key(index)` 保证身份一致性
 * 在 `App.kt` 中使用 `key(index)` 是为了告诉 Compose：**“无论列表怎么刷，这个位置的组件永远对应这个索引。”**
 * * 如果没有 `key`，当列表发生增删时，Compose 可能会搞混哪个组件对应哪个点，导致拖拽手势中途失效。
 * * 有了 `key`，即使点的位置变了，Compose 也能维持该组件的“记忆”（例如内部的 `remember` 状态），确保拖拽过程中的 `totalDragOffset` 能够正确累加。
 *
 * ### 4. 解决“拖拽死循环”的细节处理
 * 你可能会担心：*我在拖动点，点在刷新，刷新又导致组件重排，会不会冲突？*
 *
 * 我们在代码中做了一个非常关键的保护：
 * ```kotlin
 * onDragStart = {
 *     initialNodeBeforeDrag = node // 记录“开始拖拽”那一刻的快照
 *     totalDragOffset = Offset.Zero // 重置累计偏移量
 * }
 * ```
 * * **固定参照物**：在一次完整的拖拽动作中，我们始终以 `initialNodeBeforeDrag` 为基准加上**物理总位移**。
 * * **拒绝误差累加**：即使 `node` 参数因为重组一直在更新，我们的计算公式依然是 `原始位置 + 总位移`。这保证了即使在高频刷新下，点也不会因为浮点数舍入误差而“飘走”。
 *
 * ---
 *
 * ### 总结
 * `DraggableNode` 的跟踪其实是一种 **“被动的同步”**：
 * 1.  **父层** 发现数据变了。
 * 2.  **父层** 把新数据丢给 `DraggableNode`。
 * 3.  **DraggableNode** 根据新坐标重新计算位置并刷新 UI。
 *
 * 这种模式比传统的“监听器”模式更稳定，因为它保证了 **UI 永远是数据的一面镜子**。
 *
 * **有一个小建议**：
 * 如果你发现拖拽时还是有一点点“跟不上手”的感觉，可以把 `DraggableNode` 的 `onMove` 回调中的逻辑尽量精简（只更新坐标，不要执行复杂的计算），或者确保 `rebuildTrajectories()` 的性能足够快。
 */