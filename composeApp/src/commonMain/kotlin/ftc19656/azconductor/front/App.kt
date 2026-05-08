package ftc19656.azconductor.front

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.requiredWidth
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.wrapContentSize
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.input.pointer.PointerButton
import androidx.compose.ui.input.pointer.PointerEventType
import androidx.compose.ui.input.pointer.isPrimaryPressed
import androidx.compose.ui.input.pointer.isSecondaryPressed
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.toOffset
import azconductor.composeapp.generated.resources.FTC_MAP26
import azconductor.composeapp.generated.resources.Res
import ftc19656.azconductor.*
import ftc19656.azconductor.back.route.DifferentialPoint2D
import ftc19656.azconductor.back.route.RouteConnector
import kotlinx.coroutines.delay
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.jetbrains.compose.resources.painterResource
import kotlin.math.cos
import kotlin.math.roundToInt
import kotlin.math.sin

@OptIn(ExperimentalMaterial3Api::class)
@Composable
@Preview
fun App(route: RouteConnector = RouteConnector()) {
    val painter = painterResource(Res.drawable.FTC_MAP26)
    var canvasPhysicalSize by remember { mutableStateOf(IntSize.Zero) }
    val rotationDegrees = canvasRotateDeg

    val selectedNodeIndex = remember { mutableStateOf<Int?>(null) }  // 当前被选中显示速度拖拽条的节点
    var editingNodeIndex by remember { mutableStateOf<Int?>(null) }  // 正在右键编辑的节点

    // 右键菜单状态
    var showContextMenu by remember { mutableStateOf(false) }
    var contextMenuOffset by remember { mutableStateOf(Offset.Zero) }

    // 进度条状态
    var currentTime by remember { mutableStateOf(0f) }

    // 导出 JSON 对话框状态
    var showExportDialog by remember { mutableStateOf(false) }
    var exportedJson by remember { mutableStateOf("") }
    
    // 导入 JSON 对话框状态
    var showImportDialog by remember { mutableStateOf(false) }
    var importJsonText by remember { mutableStateOf("") }

    val exportJsonConfig = remember { Json { 
        prettyPrint = true 
        encodeDefaults = true
        ignoreUnknownKeys = true // 导入时允许存在未知键
    } }

    // 决定使用哪套配色，这里简单示例硬编码为浅色
    val colorScheme = MyLightColors

    var isPreheated by remember { mutableStateOf(true) }  // 跳过预热避免firefox bug

    // 预热右键弹窗避免首次右键加载延迟
    // App 启动时，让这个 Dialog 渲染 100 毫秒然后消失
    if (!isPreheated) {
        // 使用一个极其透明且不干扰交互的状态
        CompositionLocalProvider(LocalContentColor provides Color.Transparent) {
            NodeEditorDialog(
                node = preloadSerializer(), // 假数据
                onDismiss = { isPreheated = true },
                onConfirm = { isPreheated = true },
                onDelete = { isPreheated = true }
            )
        }
        // 启动后自动关闭它
        LaunchedEffect(Unit) {
            delay(100) // 给 UI 线程留出足够时间完成第一次 Layout 和 Draw
            isPreheated = true
        }
    }

    // 逻辑边界计算
    val originRatioX = 0.5f
    val originRatioY = 0.5f
    val bounds = remember(canvasLogicalWidth, canvasLogicalHeight) {
        RectBounds(
            minX = (-canvasLogicalWidth * originRatioX).toDouble(),
            maxX = (canvasLogicalWidth * (1f - originRatioX)).toDouble(),
            minY = (-canvasLogicalHeight * originRatioY).toDouble(),
            maxY = (canvasLogicalHeight * (1f - originRatioY)).toDouble()
        )
    }

    MaterialTheme(
        colorScheme = colorScheme,
        typography = MyTypography
    ) {
        BoxWithConstraints(modifier = Modifier.fillMaxSize()) {
            val isLandscape = maxWidth > maxHeight

            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .wrapContentSize(Alignment.Center)
                    .aspectRatio(canvasLogicalWidth / canvasLogicalHeight)
                    .onSizeChanged { canvasPhysicalSize = it }
                    .pointerInput(Unit) {
                        awaitPointerEventScope {
                            while (true) {
                                val event = awaitPointerEvent()
                                if (event.type == PointerEventType.Press && event.buttons.isSecondaryPressed) {
                                    val isConsumed = event.changes.any { it.isConsumed }
                                    if (!isConsumed) {
                                        contextMenuOffset = event.changes.first().position
                                        showContextMenu = true
                                    }
                                }
                            }
                        }
                    }
            ) {
                if (canvasPhysicalSize != IntSize.Zero) {
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

                    // --- 第一层：Canvas 绘制地图背景和路径 ---
                    Canvas(
                        modifier = Modifier
                            .fillMaxSize()
                            .drawBehind { with(painter) { draw(size = size) } }
                            .pointerInput(mapper) {
                                detectTapGestures { offset ->
                                    val logicPos = mapper.screenToLogical(offset.x, offset.y)
                                    route.addPoint(
                                        DifferentialPoint2D(
                                            x = logicPos.x.toDouble().coerceIn(bounds.minX, bounds.maxX),
                                            dx = 10.0 * KVelocityHandle,
                                            y = logicPos.y.toDouble().coerceIn(bounds.minY, bounds.maxY),
                                            dy = 0.0,
                                            // heading, dHeading, duration 将使用默认值
                                        )
                                    )
                                }
                            }
                    ) {
                        // 在此处读取 pathVersion。向 Compose 注册了依赖关系
                        // 只要 route.pathVersion 发生变化，这个 Canvas 就会触发重绘阶段
                        val currentVersion = route.pathVersion
                        // 路径绘制：由于 route.waypoints 是 StateList，此处会自动重绘
                        withTransform({
                            translate(mapper.centerX, mapper.centerY)
                            rotate(rotationDegrees, pivot = Offset.Zero)
                            scale(mapper.scale, mapper.scale, pivot = Offset.Zero)
                        }) {
                            val path = Path()
                            val totalTime = route.getTotalTime()
                            if (totalTime > 0) {
                                for (i in 0..curveDrawStep) {
                                    val time = (i.toDouble() / curveDrawStep) * totalTime
                                    val point = route.getPointAtTime(time) ?: break
                                    val mapped = mapper.logicalToBase(point.x.toFloat(), point.y.toFloat())
                                    if (i == 0) path.moveTo(mapped.x, mapped.y)
                                    else path.lineTo(mapped.x, mapped.y)
                                }
                                drawPath(
                                    path = path,
                                    color = pathLineColor,
                                    style = Stroke(width = canvasLineWidth / mapper.scale)
                                )
                            }
                        }
                    }

                    // 绘制预览机器人（基于进度条）
                    route.getPointAtTime(currentTime.toDouble())?.let { ghostNode ->
                        val screenPos = mapper.logicalToScreen(ghostNode.x.toFloat(), ghostNode.y.toFloat())
                        val centerOffsetX = (robotLogicalWidth + 10f) / 2f * mapper.scale
                        val centerOffsetY = (robotLogicalHeight + 10f) / 2f * mapper.scale
                        // 使用已有的 RobotComponent，但设置透明度
                        Box(modifier = Modifier.alpha(0.5f)) {
                            RobotComponent(
                                index = -2, // 特殊索引表示预览机器人
                                logicalWidth = robotLogicalWidth,
                                logicalHeight = robotLogicalHeight,
                                scale = mapper.scale,
                                headingDegrees = ghostNode.heading.toFloat(),
                                onHeadingChange = {},
                                modifier = Modifier
                                    .offset {
                                        IntOffset(
                                            (screenPos.x - centerOffsetX).roundToInt(),
                                            (screenPos.y - centerOffsetY).roundToInt()
                                        )
                                    },
                                enabled = false // 预览机器人不接收交互，防止遮挡背景点击
                            )
                        }
                    }

                    // 绘制机器人组件（如果选中了节点）
                    selectedNodeIndex.value?.let { index ->
                        route.waypoints.getOrNull(index)?.let { node ->
                            val screenPos = mapper.logicalToScreen(node.x.toFloat(), node.y.toFloat())
                            // 机器人中心偏移量（包含 5 英寸触控缓冲区）：
                            // offsetX = (robotLogicalWidth + 10) / 2
                            // offsetY = (robotLogicalHeight + 10) / 2
                            val centerOffsetX = (robotLogicalWidth + 10f) / 2f * mapper.scale
                            val centerOffsetY = (robotLogicalHeight + 10f) / 2f * mapper.scale
                            RobotComponent(
                                index = index,
                                logicalWidth = robotLogicalWidth,
                                logicalHeight = robotLogicalHeight,
                                scale = mapper.scale,
                                headingDegrees = node.heading.toFloat(),
                                onHeadingChange = { newHeading ->
                                    val updatedNode = route.getNodeAt(index).copy(heading = newHeading.toDouble())
                                    route.moveNode(index, updatedNode)
                                },
                                modifier = Modifier
                                    .offset {
                                        IntOffset(
                                            (screenPos.x - centerOffsetX).roundToInt(),
                                            (screenPos.y - centerOffsetY).roundToInt()
                                        )
                                    }
                            )
                        }
                    }

                    // 绘制节点
                    // 使用 key 确保在点数量变化时，组件能被正确复用或重置
                    route.waypoints.forEachIndexed { index, node ->
                        key(index) {
                            DraggableNode(
                                index = index,
                                node = node,
                                mapper = mapper,
                                bounds = bounds,
                                onMove = { idx, newNode -> route.moveNode(idx, newNode) },
                                onClick = {
                                    println("Clicked node: $it")
                                    selectedNodeIndex.value = if (selectedNodeIndex.value != index) index else null
                                },
                                onRightClick = { idx ->
                                    editingNodeIndex = idx // 触发弹窗显示
                                }
                            )
                            // 如果该节点被选中，则显示向量调节手柄
                            if (selectedNodeIndex.value == index) {
                                VectorHandle(
                                    node = node,
                                    mapper = mapper,
                                    onVectorChanged = { newDx, newDy ->
                                        // 更新该节点的向量属性，保持 x, y 不变（从表中重新获取最新状态避免暂存状态过期导致瞬移）
                                        val updatedNode = route.getNodeAt(index).copy(dx = newDx, dy = newDy)
                                        route.moveNode(index, updatedNode)
                                    }
                                )
                            }
                        }
                    }

                    editingNodeIndex?.let { indexToEdit ->
                        val targetNode = route.waypoints.getOrNull(indexToEdit)
                        if (targetNode != null) {
                            NodeEditorDialog(
                                node = targetNode,
                                onDismiss = { editingNodeIndex = null },
                                onConfirm = { updatedNode ->
                                    route.moveNode(indexToEdit, updatedNode)
                                },
                                onDelete = {
                                    route.removeNode(indexToEdit)
                                    // 如果删除的是当前选中的节点，重置选中状态
                                    if (selectedNodeIndex.value == indexToEdit) {
                                        selectedNodeIndex.value = null
                                    }
                                }
                            )
                        } else {
                            // 防御性编程：如果因为外部原因越界，关闭弹窗
                            editingNodeIndex = null
                        }
                    }

                    // 右键菜单锚点
                    Box(
                        modifier = Modifier
                            .offset {
                                IntOffset(contextMenuOffset.x.roundToInt(), contextMenuOffset.y.roundToInt())
                            }
                    ) {
                        DropdownMenu(
                            expanded = showContextMenu,
                            onDismissRequest = { showContextMenu = false },
                        ) {
                            DropdownMenuItem(
                                text = { Text("导出路径") },
                                onClick = {
                                    exportedJson = exportJsonConfig.encodeToString(route.waypoints)
                                    showExportDialog = true
                                    showContextMenu = false
                                }
                            )
                            DropdownMenuItem(
                                text = { Text("导入路径") },
                                onClick = {
                                    importJsonText = ""
                                    showImportDialog = true
                                    showContextMenu = false
                                }
                            )
                        }
                    }

                    // 导出 JSON 结果的弹窗
                    if (showExportDialog) {
                        val clipboardManager = LocalClipboardManager.current
                        AlertDialog(
                            onDismissRequest = { showExportDialog = false },
                            title = { Text("导出的路径 JSON") },
                            text = {
                                SelectionContainer {
                                    Text(
                                        text = exportedJson,
                                        style = MaterialTheme.typography.bodySmall.copy(
                                            fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace
                                        )
                                    )
                                }
                            },
                            confirmButton = {
                                Row {
                                    TextButton(onClick = {
                                        clipboardManager.setText(AnnotatedString(exportedJson))
                                    }) {
                                        Text("一键复制")
                                    }
                                    TextButton(onClick = { showExportDialog = false }) {
                                        Text("关闭")
                                    }
                                }
                            }
                        )
                    }

                    // 导入 JSON 的弹窗
                    if (showImportDialog) {
                        AlertDialog(
                            onDismissRequest = { showImportDialog = false },
                            title = { Text("导入路径 JSON") },
                            text = {
                                OutlinedTextField(
                                    value = importJsonText,
                                    onValueChange = { importJsonText = it },
                                    modifier = Modifier.fillMaxWidth().height(200.dp),
                                    placeholder = { Text("请在此粘贴导出的路径 JSON") },
                                    textStyle = MaterialTheme.typography.bodySmall.copy(
                                        fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace
                                    )
                                )
                            },
                            confirmButton = {
                                TextButton(onClick = {
                                    try {
                                        val importedWaypoints = exportJsonConfig.decodeFromString<List<DifferentialPoint2D>>(importJsonText)
                                        route.setWaypoints(importedWaypoints)
                                        showImportDialog = false
                                    } catch (e: Exception) {
                                        // 简单提示解析失败，实际项目中可以用 snackbar
                                        println("Import failed: ${e.message}")
                                    }
                                }) {
                                    Text("导入")
                                }
                            },
                            dismissButton = {
                                TextButton(onClick = { showImportDialog = false }) {
                                    Text("取消")
                                }
                            }
                        )
                    }
                }
            }

            // 浮窗进度条 (Win11 风格)
            val totalTime = route.getTotalTime().toFloat()
            val win11Accent = Color(0xFF0067C0)
            val win11Inactive = Color.LightGray.copy(alpha = 0.5f)

            Box(
                modifier = Modifier
                    .padding(8.dp)
                    .then(
                        if (isLandscape) {
                            Modifier
                                .width(40.dp)
                                .fillMaxHeight(0.95f)
                                .align(Alignment.CenterStart)
                        } else {
                            Modifier
                                .height(40.dp)
                                .fillMaxWidth(0.95f)
                                .align(Alignment.BottomCenter)
                        }
                    ),
                contentAlignment = Alignment.Center
            ) {
                if (isLandscape) {
                    Slider(
                        value = currentTime.coerceIn(0f, maxOf(totalTime, 0.001f)),
                        onValueChange = { currentTime = it },
                        valueRange = 0f..maxOf(totalTime, 0.001f),
                        colors = SliderDefaults.colors(
                            activeTrackColor = win11Accent,
                            inactiveTrackColor = win11Inactive,
                            thumbColor = win11Accent
                        ),
                        thumb = {
                            SliderDefaults.Thumb(
                                interactionSource = remember { MutableInteractionSource() },
                                colors = SliderDefaults.colors(thumbColor = win11Accent),
                                thumbSize = androidx.compose.ui.unit.DpSize(16.dp, 16.dp)
                            )
                        },
                        modifier = Modifier
                            .graphicsLayer {
                                rotationZ = -90f
                            }
                            .requiredWidth(this@BoxWithConstraints.maxHeight * 0.9f)
                    )
                } else {
                    Slider(
                        value = currentTime.coerceIn(0f, maxOf(totalTime, 0.001f)),
                        onValueChange = { currentTime = it },
                        valueRange = 0f..maxOf(totalTime, 0.001f),
                        colors = SliderDefaults.colors(
                            activeTrackColor = win11Accent,
                            inactiveTrackColor = win11Inactive,
                            thumbColor = win11Accent
                        ),
                        thumb = {
                            SliderDefaults.Thumb(
                                interactionSource = remember { MutableInteractionSource() },
                                colors = SliderDefaults.colors(thumbColor = win11Accent),
                                thumbSize = androidx.compose.ui.unit.DpSize(16.dp, 16.dp)
                            )
                        },
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 12.dp)
                    )
                }
            }
        }
    }
}

// 简单的边界数据类
data class RectBounds(val minX: Double, val maxX: Double, val minY: Double, val maxY: Double)


// --- Mapper 工具类 ---
class CoordinateMapper(
    physicalWidth: Float, physicalHeight: Float,
    logicalWidth: Float, logicalHeight: Float,
    originRatioX: Float, originRatioY: Float,
    rotationDegrees: Float
) {
    val centerX = physicalWidth / 2f
    val centerY = physicalHeight / 2f
    val scale = minOf(physicalWidth / logicalWidth, physicalHeight / logicalHeight)

    // 逻辑原点偏移（逻辑单位）
    private val logicalOffsetX = logicalWidth * (originRatioX - 0.5f)
    private val logicalOffsetY = logicalHeight * (originRatioY - 0.5f)

    // 基础屏幕偏移（在缩放和旋转之前）
    private val baseOffsetX = logicalOffsetX * logicalXMapToScreenX + logicalOffsetY * logicalYMapToScreenX
    private val baseOffsetY = logicalOffsetX * logicalXMapToScreenY + logicalOffsetY * logicalYMapToScreenY

    private val angleRad = (rotationDegrees.toDouble()).toRadians().toFloat()
    private val cosA = cos(angleRad)
    private val sinA = sin(angleRad)

    // 逆矩阵计算，用于 screenToLogical
    private val det = logicalXMapToScreenX * logicalYMapToScreenY - logicalXMapToScreenY * logicalYMapToScreenX
    private val invXMapX = logicalYMapToScreenY / det
    private val invXMapY = -logicalYMapToScreenX / det
    private val invYMapX = -logicalXMapToScreenY / det
    private val invYMapY = logicalXMapToScreenX / det

    // 将逻辑坐标映射到基础物理坐标（变换前）
    fun logicalToBase(lx: Float, ly: Float): Offset {
        val sxBase = lx * logicalXMapToScreenX + ly * logicalYMapToScreenX + baseOffsetX
        val syBase = lx * logicalXMapToScreenY + ly * logicalYMapToScreenY + baseOffsetY
        return Offset(sxBase, syBase)
    }

    fun logicalToScreen(lx: Float, ly: Float): Offset {
        val base = logicalToBase(lx, ly)
        val sx = base.x * scale
        val sy = base.y * scale
        return Offset(sx * cosA - sy * sinA + centerX, sx * sinA + sy * cosA + centerY)
    }

    fun screenToLogical(px: Float, py: Float): Offset {
        val rx = px - centerX
        val ry = py - centerY
        val sxBase = (rx * cosA + ry * sinA) / scale - baseOffsetX
        val syBase = (-rx * sinA + ry * cosA) / scale - baseOffsetY

        val lx = sxBase * invXMapX + syBase * invXMapY
        val ly = sxBase * invYMapX + syBase * invYMapY
        return Offset(lx, ly)
    }

    fun screenDeltaToLogicalDelta(dx: Float, dy: Float): Offset {
        val sxBase = (dx * cosA + dy * sinA) / scale
        val syBase = (-dx * sinA + dy * cosA) / scale

        val lx = sxBase * invXMapX + syBase * invXMapY
        val ly = sxBase * invYMapX + syBase * invYMapY
        return Offset(lx, ly)
    }
}
