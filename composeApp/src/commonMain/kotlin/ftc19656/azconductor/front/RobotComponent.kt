package ftc19656.azconductor.front

import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import ftc19656.azconductor.fieldXAngleDeg
import ftc19656.azconductor.robotComponentTouchThresholdRatio
import kotlin.math.PI
import kotlin.math.atan2

/**
 * 机器人组件：圆角空心方框
 * @param index 节点索引，用于区分不同的组件实例，防止 pointerInput 复用导致的更新错误
 * @param logicalWidth 逻辑宽度 (英寸)
 * @param logicalHeight 逻辑高度 (英寸)
 * @param scale 像素/英寸 比例
 * @param headingDegrees 当前朝向角度 (单位：度)
 * @param onHeadingChange 角度变化回调
 */
@Composable
fun RobotComponent(
    index: Int,
    logicalWidth: Float,
    logicalHeight: Float,
    scale: Float,
    headingDegrees: Float,
    onHeadingChange: (Float) -> Unit,
    modifier: Modifier = Modifier,
    color: Color = MaterialTheme.colorScheme.primary,
    strokeWidth: Dp = 2.dp,
    enabled: Boolean = true
) {
    val density = LocalDensity.current
    
    // 物理像素尺寸
    val physicalWidthPx = logicalWidth * scale
    val physicalHeightPx = logicalHeight * scale
    
    // 转换为 Dp 供 Compose 布局使用
    val widthDp = with(density) { physicalWidthPx.toDp() }
    val heightDp = with(density) { physicalHeightPx.toDp() }

    // 车头圆点：逻辑上约 2.5 英寸
    val headDotLogicalSize = 2.5f 
    val headDotSizePx = headDotLogicalSize * scale
    val headDotSizeDp = with(density) { headDotSizePx.toDp() }
    
    // 触摸缓冲区：确保判定范围超出视觉方框
    val touchBufferDp = headDotSizeDp * 2f
    var componentSizePx by remember { mutableStateOf(IntSize.Zero) }
    var isDraggingHeading by remember { mutableStateOf(false) }

    val currentHeading by rememberUpdatedState(headingDegrees)
    val currentOnHeadingChange by rememberUpdatedState(onHeadingChange)

    Box(
        modifier = modifier
            .onSizeChanged { componentSizePx = it }
            // 增加 index 作为 key，确保切换节点时重置手势监听
            .then(
                if (enabled) {
                    Modifier.pointerInput(logicalWidth, logicalHeight, scale, index) {
                        detectDragGestures(
                            onDragStart = { offset ->
                                val bufferPx = with(density) { touchBufferDp.toPx() }
                                // 旋转中心
                                val centerX = bufferPx + physicalWidthPx / 2f
                                val centerY = bufferPx + physicalHeightPx / 2f
                                
                                // 车头圆点在 0 度时相对于中心的偏移距离
                                val dist = physicalWidthPx / 2f
                                
                                // 计算当前旋转后的圆点物理位置
                                // heading 为 0 时应指向场地 X 轴 (fieldXAngleDeg)
                                val angleRad = (currentHeading + fieldXAngleDeg) * (PI.toFloat() / 180f)
                                val headDotCenter = Offset(
                                    centerX + dist * kotlin.math.cos(angleRad),
                                    centerY + dist * kotlin.math.sin(angleRad)
                                )
                                
                                val distance = (offset - headDotCenter).getDistance()
                                val touchThreshold = headDotSizePx * ftc19656.azconductor.robotComponentTouchThresholdRatio
                                isDraggingHeading = distance <= touchThreshold
                            },
                            onDrag = { change, _ ->
                                if (isDraggingHeading) {
                                    change.consume()
                                    val bufferPx = with(density) { touchBufferDp.toPx() }
                                    // 旋转中心位于视觉组件的中心
                                    val center = Offset(
                                        bufferPx + physicalWidthPx / 2f, 
                                        bufferPx + physicalHeightPx / 2f
                                    )
                                    
                                    val touchPos = change.position
                                    val diff = touchPos - center
                                    val angleRad = atan2(diff.y, diff.x)
                                    val angleDeg = (angleRad * 180f / PI).toFloat()
                                    
                                    // 减去偏移量，使得指向场地 X 轴时 heading 为 0
                                    var newHeading = angleDeg - ftc19656.azconductor.fieldXAngleDeg
                                    
                                    // 规格化到 [-180, 180] 避免数值跳变
                                    while (newHeading <= -180f) newHeading += 360f
                                    while (newHeading > 180f) newHeading -= 360f
                                    
                                    currentOnHeadingChange(newHeading)
                                }
                            },
                            onDragEnd = { isDraggingHeading = false },
                            onDragCancel = { isDraggingHeading = false }
                        )
                    }
                } else Modifier
            )
            .padding(touchBufferDp),
        contentAlignment = Alignment.Center
    ) {
        // 视觉组件
        Box(
            modifier = Modifier
                .size(widthDp, heightDp)
                // 旋转角度增加偏移量，使 0 度指向场地 X 轴
                .rotate(headingDegrees + ftc19656.azconductor.fieldXAngleDeg)
                .border(strokeWidth, color, RoundedCornerShape(8.dp)),
            contentAlignment = Alignment.CenterEnd
        ) {
            // 车头指示小圆点
            Box(
                modifier = Modifier
                    .offset(x = headDotSizeDp / 2) // 中心对齐边框
                    .size(headDotSizeDp)
                    .clip(CircleShape)
                    .drawBehind {
                        drawCircle(color)
                    }
            )
        }
    }
}
