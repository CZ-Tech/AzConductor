package ftc19656.azconductor.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.input.pointer.pointerInput
import ftc19656.azconductor.UIConfig
import ftc19656.azconductor.route.DifferentialPoint2D
import ftc19656.azconductor.route.viewmodel.RouteConnector
import ftc19656.azconductor.core.math.CoordinateMapper
import ftc19656.azconductor.core.math.RectBounds

@Composable
fun RouteCanvas(
    route: RouteConnector,
    painter: Painter,
    mapper: CoordinateMapper,
    bounds: RectBounds,
    rotationDegrees: Float,
    modifier: Modifier = Modifier
) {
    Canvas(
        modifier = modifier
            .fillMaxSize()
            .drawBehind { with(painter) { draw(size = size) } }
            .pointerInput(mapper) {
                detectTapGestures { offset ->
                    val logicPos = mapper.screenToLogical(offset.x, offset.y)
                    route.addPoint(
                        DifferentialPoint2D(
                            x = logicPos.x.toDouble().coerceIn(bounds.minX, bounds.maxX),
                            dx = 10.0 * UIConfig.K_VELOCITY_HANDLE,
                            y = logicPos.y.toDouble().coerceIn(bounds.minY, bounds.maxY),
                            dy = 0.0,
                        )
                    )
                }
            }
            ) {
            // 在此处读取 pathVersion。向 Compose 注册了依赖关系
            // 只要 route.pathVersion 发生变化，这个 Canvas 就会触发重绘阶段
            @Suppress("UNUSED_VARIABLE")
            val currentVersion = route.pathVersion
        
        withTransform({
            translate(mapper.centerX, mapper.centerY)
            rotate(rotationDegrees, pivot = Offset.Zero)
            scale(mapper.scale, mapper.scale, pivot = Offset.Zero)
        }) {
            val path = Path()
            val totalTime = route.getTotalTime()
            if (totalTime > 0) {
                for (i in 0..UIConfig.CURVE_DRAW_STEP) {
                    val time = (i.toDouble() / UIConfig.CURVE_DRAW_STEP) * totalTime
                    val point = route.getPointAtTime(time) ?: break
                    val mapped = mapper.logicalToBase(point.x.toFloat(), point.y.toFloat())
                    if (i == 0) path.moveTo(mapped.x, mapped.y)
                    else path.lineTo(mapped.x, mapped.y)
                }
                drawPath(
                    path = path,
                    color = UIConfig.PATH_LINE_COLOR,
                    style = Stroke(width = UIConfig.CANVAS_LINE_WIDTH / mapper.scale)
                )
            }
        }
    }
}

