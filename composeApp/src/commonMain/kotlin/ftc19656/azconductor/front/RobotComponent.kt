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
import ftc19656.azconductor.robotComponentTouchThresholdRatio
import kotlin.math.PI
import kotlin.math.atan2

/**
 * 机器人组件：圆角空心方框
 * @param width 宽度 (Dp)
 * @param height 高度 (Dp)
 * @param headingDegrees 当前朝向角度 (单位：度，0度指向正右方/X轴正向)
 * @param onHeadingChange 角度变化回调
 */
@Composable
fun RobotComponent(
    width: Dp,
    height: Dp,
    headingDegrees: Float,
    onHeadingChange: (Float) -> Unit,
    modifier: Modifier = Modifier,
    color: Color = MaterialTheme.colorScheme.primary,
    strokeWidth: Dp = 2.dp
) {
    val density = LocalDensity.current
    val headDotSizeDp = 12.dp
    // 增加一个触摸缓冲区，大小至少要能覆盖容差范围内的方框外区域
    val touchBufferDp = headDotSizeDp * 2
    var componentSizePx by remember { mutableStateOf(IntSize.Zero) }
    var isDraggingHeading by remember { mutableStateOf(false) }

    Box(
        modifier = modifier
            .onSizeChanged { componentSizePx = it }
            // 在最外层扩展触摸区域
            .pointerInput(width, height) {
                detectDragGestures(
                    onDragStart = { offset ->
                        val bufferPx = with(density) { touchBufferDp.toPx() }
                        val visualWidthPx = with(density) { width.toPx() }
                        val visualHeightPx = with(density) { height.toPx() }
                        
                        // 判定中心：相对于外层 Box，圆点中心在 (buffer + width, buffer + height/2)
                        val headDotCenter = Offset(
                            bufferPx + visualWidthPx, 
                            bufferPx + visualHeightPx / 2f
                        )
                        
                        val distance = (offset - headDotCenter).getDistance()
                        val touchThreshold = with(density) { headDotSizeDp.toPx() * robotComponentTouchThresholdRatio }
                        isDraggingHeading = distance <= touchThreshold
                    },
                    onDrag = { change, _ ->
                        if (isDraggingHeading) {
                            change.consume()
                            val bufferPx = with(density) { touchBufferDp.toPx() }
                            val visualWidthPx = with(density) { width.toPx() }
                            val visualHeightPx = with(density) { height.toPx() }
                            val center = Offset(bufferPx + visualWidthPx / 2f, bufferPx + visualHeightPx / 2f)
                            
                            val touchPos = change.position
                            val diff = touchPos - center
                            val angleRad = atan2(diff.y, diff.x)
                            val angleDeg = (angleRad * 180f / PI).toFloat()
                            onHeadingChange(angleDeg)
                        }
                    },
                    onDragEnd = { isDraggingHeading = false },
                    onDragCancel = { isDraggingHeading = false }
                )
            }
            .padding(touchBufferDp), // 内部视觉部分留出 buffer
        contentAlignment = Alignment.Center
    ) {
        Box(
            modifier = Modifier
                .size(width, height)
                .rotate(headingDegrees)
                .border(strokeWidth, color, RoundedCornerShape(8.dp)),
            contentAlignment = Alignment.CenterEnd
        ) {
            // 车头指示小圆点 (位于方框右侧边缘)
            Box(
                modifier = Modifier
                    .offset(x = headDotSizeDp / 2) // 让圆点中心对齐边框
                    .size(headDotSizeDp)
                    .clip(CircleShape)
                    .drawBehind {
                        drawCircle(color)
                    }
            )
        }
    }
}
