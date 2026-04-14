package ftc19656.azconductor.front

import androidx.compose.foundation.Canvas
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

@Composable
fun LongArrow(
    modifier: Modifier = Modifier,
    color: Color = Color.Black,
    strokeWidth: Dp = 2.dp,
    arrowHeadLength: Dp = 10.dp
) {
    Canvas(modifier = modifier) {
        // 获取画布当前的宽高
        val canvasWidth = size.width
        val canvasHeight = size.height

        // 箭头的起点和终点 (这里画的是一个从左到右的箭头，垂直居中)
        val startX = 0f
        val startY = canvasHeight / 2
        val endX = canvasWidth
        val endY = canvasHeight / 2

        val strokePx = strokeWidth.toPx()
        val headLengthPx = arrowHeadLength.toPx()

        // 1. 绘制长柄 (线段)
        drawLine(
            color = color,
            start = Offset(startX, startY),
            end = Offset(endX, endY),
            strokeWidth = strokePx,
            cap = StrokeCap.Round
        )

        // 2. 绘制箭头头部 (使用 Path 确保转角平滑)
        val path = Path().apply {
            moveTo(endX - headLengthPx, startY - headLengthPx) // 左上
            lineTo(endX, endY)                                 // 顶点 (右中)
            lineTo(endX - headLengthPx, startY + headLengthPx) // 左下
        }

        drawPath(
            path = path,
            color = color,
            style = Stroke(
                width = strokePx,
                cap = StrokeCap.Round,
                join = StrokeJoin.Round // 让箭头尖端和拐角更圆润
            )
        )
    }
}