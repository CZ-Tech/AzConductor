package ftc19656.azconductor.front

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.tooling.preview.Preview
import ftc19656.azconductor.back.route.Point2D
import ftc19656.azconductor.back.route.RouteConnector

// 1. 定义数据结构和提供者
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.PointerEventType
import androidx.compose.ui.input.pointer.isPrimaryPressed
import androidx.compose.ui.input.pointer.isSecondaryPressed



@Composable
@Preview
fun App(
    route: RouteConnector = RouteConnector(20.0)
) {
    MaterialTheme {
        Canvas(
            modifier = Modifier
                .fillMaxSize()
                .pointerInput(Unit) {
                    awaitPointerEventScope {
                        while (true) {
                            val event = awaitPointerEvent()

                            if (event.type == PointerEventType.Press) {
                                val change = event.changes.first()
                                val buttons = event.buttons

                                val isLeft = buttons.isPrimaryPressed
                                val isRight = buttons.isSecondaryPressed

                                if (isLeft || isRight) {
                                    // -----------------------------------------
                                    // 【留空闭包】
                                    // 常用信息提取示例：
                                    // val x = change.position.x
                                    // val y = change.position.y
                                    // val modifiers = event.keyboardModifiers  //
                                    // -----------------------------------------



                                }
                            }
                        }
                    }
                }
        ) {
            val path = Path()

            // 定义你的时间/参数域范围和步长
            val timeStart = 0.0
            val timeEnd = 1000.0
            val steps = 1000

            for (i in 0..steps) {
                val time = timeStart + (i.toDouble() / steps) * (timeEnd - timeStart)
                val point = route.getPointAtTime(time)

                // 直接将获取到的点作为像素坐标绘制
                val px = point.x.toFloat()
                val py = point.y.toFloat()

                if (i == 0) {
                    path.moveTo(px, py)
                } else {
                    path.lineTo(px, py)
                }
            }

            drawPath(
                path = path,
                color = Color.Black,
                style = Stroke(width = 2f)
            )
        }
    }
}