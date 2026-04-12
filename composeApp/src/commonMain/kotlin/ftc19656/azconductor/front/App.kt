package ftc19656.azconductor.front

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.wrapContentSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
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
import androidx.compose.ui.tooling.preview.Preview
import azconductor.composeapp.generated.resources.FTC_MAP26
import azconductor.composeapp.generated.resources.Res
import ftc19656.azconductor.* // 确保包含常量定义
import ftc19656.azconductor.back.route.RouteConnector
import org.jetbrains.compose.resources.painterResource
import kotlin.math.cos
import kotlin.math.sin

@Composable
@Preview
fun App(
    route: RouteConnector = RouteConnector(20.0)
) {
    val painter = painterResource(Res.drawable.FTC_MAP26)

    val rotationDegrees by remember { mutableStateOf(canvasRotateDeg) }

    MaterialTheme {
        Canvas(
            modifier = Modifier
                .fillMaxSize()         // 占据尽可能大的地方
                .wrapContentSize(Alignment.Center) // 如果比例不对，居中收缩
                .aspectRatio(canvasLogicalWidth / canvasLogicalHeight) // 2. 强制锁定比例为 16:9
                .drawBehind {
                    // 2. 使用 painter.draw 且指定 size 为当前容器的 size
                    // 这将确保图片始终严格拉伸/缩放到与 Canvas 区域完全一致
                    with(painter) {
                        draw(size = size)
                    }
                }
                .pointerInput(Unit) {
                    awaitPointerEventScope {
                        while (true) {
                            val event = awaitPointerEvent()

                            // 1. 获取物理中心点
                            val centerX = size.width / 2f
                            val centerY = size.height / 2f
                            val sX = size.width.toFloat() / canvasLogicalWidth
                            val sY = size.height.toFloat() / canvasLogicalHeight
                            val scale = minOf(sX, sY)

                            if (event.type == PointerEventType.Press) {
                                val change = event.changes.first()

                                // 2. 坐标转换逻辑（考虑中心点旋转）
                                // 先将像素点平移到以中心为原点的坐标系
                                val relX = change.position.x - centerX
                                val relY = change.position.y - centerY

                                // 逆旋转角度 (弧度)
                                val angleRad = rotationDegrees.toDouble().toRadians()
                                val cosA = cos(angleRad).toFloat()
                                val sinA = sin(angleRad).toFloat()

                                // 逆旋转公式 + 逆缩放
                                // x' = x*cos + y*sin, y' = -x*sin + y*cos
                                val canvasX = (relX * cosA + relY * sinA) / scale
                                val canvasY = (-relX * sinA + relY * cosA) / scale

                                // 如果你的逻辑坐标 (0,0) 是在画布中心，到这里就够了。
                                // 如果逻辑 (0,0) 是左上角，需要再加上逻辑半径：
                                val finalX = canvasX + (canvasLogicalWidth / 2f)
                                val finalY = canvasY + (canvasLogicalHeight / 2f)

                                if (event.buttons.isPrimaryPressed || event.buttons.isSecondaryPressed) {
                                    println("Logic Pos: ($finalX, $finalY)")
                                }
                            }
                        }
                    }
                }
        ) {
            // 获取绘图区域中心
            val centerX = size.width / 2f
            val centerY = size.height / 2f
            val scale = minOf(size.width / canvasLogicalWidth, size.height / canvasLogicalHeight)

            withTransform({
                // 3. 变换顺序：先平移到中心，再旋转，再缩放
                // 这样逻辑坐标 (0,0) 就会对应画布中心
                translate(centerX, centerY)
                rotate(rotationDegrees, pivot = Offset.Zero)
                scale(scale, scale, pivot = Offset.Zero)
                // 将逻辑原点从中心移回左上角（可选，取决于你的算法习惯）
                translate(-canvasLogicalWidth / 2f, -canvasLogicalHeight / 2f)
            }) {
                val path = Path()
                val steps = curveDrawStep
                val totalTime = route.getTotalTime()

                for (i in 0..steps) {
                    val time = (i.toDouble() / steps) * totalTime
                    val point = route.getPointAtTime(time)
                    val px = point.x.toFloat()
                    val py = point.y.toFloat()

                    if (i == 0) path.moveTo(px, py) else path.lineTo(px, py)
                }

                drawPath(
                    path = path,
                    color = Color.Black,
                    style = Stroke(width = canvasLineWidth / scale)
                )
            }
        }
    }
}