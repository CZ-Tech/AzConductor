package ftc19656.azconductor.ui.screens

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.Icons
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.PointerEventType
import androidx.compose.ui.input.pointer.isSecondaryPressed
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import azconductor.composeapp.generated.resources.FTC_MAP26
import azconductor.composeapp.generated.resources.Res
import ftc19656.azconductor.FieldConfig
import ftc19656.azconductor.RobotConfig
import ftc19656.azconductor.UIConfig
import ftc19656.azconductor.route.DifferentialPoint2D
import ftc19656.azconductor.route.viewmodel.RouteConnector
import ftc19656.azconductor.core.math.CoordinateMapper
import ftc19656.azconductor.core.math.RectBounds
import ftc19656.azconductor.ui.components.*
import ftc19656.azconductor.ui.dialogs.*
import kotlinx.coroutines.delay
import org.jetbrains.compose.resources.painterResource
import kotlin.math.roundToInt

private const val ROBOT_RENDER_PADDING = 10f

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PathPlannerScreen(route: RouteConnector = remember { RouteConnector() }) {
    val painter = painterResource(Res.drawable.FTC_MAP26)
    var canvasPhysicalSize by remember { mutableStateOf(IntSize.Zero) }
    val rotationDegrees = UIConfig.CANVAS_ROTATE_DEG

    val selectedNodeIndex = remember { mutableStateOf<Int?>(null) }
    var editingNodeIndex by remember { mutableStateOf<Int?>(null) }

    var showContextMenu by remember { mutableStateOf(false) }
    var contextMenuOffset by remember { mutableStateOf(Offset.Zero) }

    var currentTime by remember { mutableStateOf(0f) }

    var showExportDialog by remember { mutableStateOf(false) }
    var exportedJson by remember { mutableStateOf("") }
    
    var showImportDialog by remember { mutableStateOf(false) }
    var importJsonText by remember { mutableStateOf("") }

    var isSidebarVisible by remember { mutableStateOf(true) }

    var isPreheated by remember { mutableStateOf(true) }

    if (!isPreheated) {
        CompositionLocalProvider(LocalContentColor provides Color.Transparent) {
            NodeEditorDialog(
                node = preloadSerializer(),
                onDismiss = { isPreheated = true },
                onConfirm = { isPreheated = true },
                onDelete = { isPreheated = true }
            )
        }
        LaunchedEffect(Unit) {
            delay(100)
            isPreheated = true
        }
    }

    val bounds = remember(FieldConfig.CANVAS_LOGICAL_WIDTH, FieldConfig.CANVAS_LOGICAL_HEIGHT) {
        RectBounds(
            minX = (-FieldConfig.CANVAS_LOGICAL_WIDTH * FieldConfig.ORIGIN_RATIO_X).toDouble(),
            maxX = (FieldConfig.CANVAS_LOGICAL_WIDTH * (1f - FieldConfig.ORIGIN_RATIO_X)).toDouble(),
            minY = (-FieldConfig.CANVAS_LOGICAL_HEIGHT * FieldConfig.ORIGIN_RATIO_Y).toDouble(),
            maxY = (FieldConfig.CANVAS_LOGICAL_HEIGHT * (1f - FieldConfig.ORIGIN_RATIO_Y)).toDouble()
        )
    }

    BoxWithConstraints(modifier = Modifier.fillMaxSize()) {
        val isLandscape = maxWidth > maxHeight

        Box(
            modifier = Modifier
                .fillMaxSize()
                .wrapContentSize(Alignment.Center)
                .aspectRatio(FieldConfig.CANVAS_LOGICAL_WIDTH / FieldConfig.CANVAS_LOGICAL_HEIGHT)
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
                        logicalWidth = FieldConfig.CANVAS_LOGICAL_WIDTH,
                        logicalHeight = FieldConfig.CANVAS_LOGICAL_HEIGHT,
                        originRatioX = FieldConfig.ORIGIN_RATIO_X,
                        originRatioY = FieldConfig.ORIGIN_RATIO_Y,
                        rotationDegrees = rotationDegrees
                    )
                }

                RouteCanvas(
                    route = route,
                    painter = painter,
                    mapper = mapper,
                    bounds = bounds,
                    rotationDegrees = rotationDegrees
                )

                // 预览机器人
                route.getPointAtTime(currentTime.toDouble())?.let { ghostNode ->
                    val screenPos = mapper.logicalToScreen(ghostNode.x.toFloat(), ghostNode.y.toFloat())
                    val centerOffsetX = (RobotConfig.ROBOT_LOGICAL_WIDTH + ROBOT_RENDER_PADDING) / 2f * mapper.scale
                    val centerOffsetY = (RobotConfig.ROBOT_LOGICAL_HEIGHT + ROBOT_RENDER_PADDING) / 2f * mapper.scale
                    Box(modifier = Modifier.alpha(0.5f)) {
                        RobotComponent(
                            index = -2,
                            logicalWidth = RobotConfig.ROBOT_LOGICAL_WIDTH,
                            logicalHeight = RobotConfig.ROBOT_LOGICAL_HEIGHT,
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
                            enabled = false
                        )
                    }
                }

                // 选中节点的机器人组件
                selectedNodeIndex.value?.let { index ->
                    route.waypoints.getOrNull(index)?.let { node ->
                        val screenPos = mapper.logicalToScreen(node.x.toFloat(), node.y.toFloat())
                        val centerOffsetX = (RobotConfig.ROBOT_LOGICAL_WIDTH + ROBOT_RENDER_PADDING) / 2f * mapper.scale
                        val centerOffsetY = (RobotConfig.ROBOT_LOGICAL_HEIGHT + ROBOT_RENDER_PADDING) / 2f * mapper.scale
                        RobotComponent(
                            index = index,
                            logicalWidth = RobotConfig.ROBOT_LOGICAL_WIDTH,
                            logicalHeight = RobotConfig.ROBOT_LOGICAL_HEIGHT,
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

                // 节点
                route.waypoints.forEachIndexed { index, node ->
                    key(index) {
                        DraggableNode(
                            index = index,
                            node = node,
                            mapper = mapper,
                            bounds = bounds,
                            onMove = { idx, newNode -> route.moveNode(idx, newNode) },
                            onClick = {
                                selectedNodeIndex.value = if (selectedNodeIndex.value != index) index else null
                            },
                            onRightClick = { idx ->
                                editingNodeIndex = idx
                            }
                        )
                        if (selectedNodeIndex.value == index) {
                            VectorHandle(
                                node = node,
                                mapper = mapper,
                                onVectorChanged = { newDx, newDy ->
                                    val updatedNode = route.getNodeAt(index).copy(dx = newDx, dy = newDy)
                                    route.moveNode(index, updatedNode)
                                }
                            )
                        }
                    }
                }

                editingNodeIndex?.let { indexToEdit ->
                    route.waypoints.getOrNull(indexToEdit)?.let { targetNode ->
                        NodeEditorDialog(
                            node = targetNode,
                            onDismiss = { editingNodeIndex = null },
                            onConfirm = { updatedNode ->
                                route.moveNode(indexToEdit, updatedNode)
                            },
                            onDelete = {
                                route.removeNode(indexToEdit)
                                if (selectedNodeIndex.value == indexToEdit) {
                                    selectedNodeIndex.value = null
                                }
                            }
                        )
                    } ?: run { editingNodeIndex = null }
                }

                // 右键菜单
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
                                exportedJson = route.exportToJson()
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

                if (showExportDialog) {
                    ExportDialog(
                        exportedJson = exportedJson,
                        onDismiss = { showExportDialog = false }
                    )
                }

                if (showImportDialog) {
                    ImportDialog(
                        importJsonText = importJsonText,
                        onValueChange = { importJsonText = it },
                        onDismiss = { showImportDialog = false },
                        onImport = {
                            if (route.importFromJson(importJsonText)) {
                                showImportDialog = false
                            }
                        }
                    )
                }
            }
        }

        // 右侧边栏与切换按钮
        Box(
            modifier = Modifier
                .fillMaxHeight()
                .fillMaxWidth(0.4f)
                .align(Alignment.CenterEnd)
        ) {
            // 切换按钮 (在边栏左侧边缘)
            IconButton(
                onClick = { isSidebarVisible = !isSidebarVisible },
                modifier = Modifier
                    .align(Alignment.CenterStart)
                    .offset(x = (-24).dp) // 将按钮向左偏移，使其悬浮在边栏边缘
                    .size(48.dp)
                    .graphicsLayer {
                        translationX = if (isSidebarVisible) 0f else (this@BoxWithConstraints.maxWidth.toPx() * 0.4f)
                    },
                colors = IconButtonDefaults.filledIconButtonColors(
                    containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.8f),
                    contentColor = MaterialTheme.colorScheme.onSurfaceVariant
                )
            ) {
                Icon(
                    imageVector = if (isSidebarVisible) Icons.AutoMirrored.Filled.KeyboardArrowRight else Icons.AutoMirrored.Filled.KeyboardArrowLeft,
                    contentDescription = if (isSidebarVisible) "收起侧栏" else "展开侧栏"
                )
            }

            AnimatedVisibility(
                visible = isSidebarVisible,
                enter = slideInHorizontally(
                    initialOffsetX = { it },
                    animationSpec = tween(durationMillis = 300)
                ),
                exit = slideOutHorizontally(
                    targetOffsetX = { it },
                    animationSpec = tween(durationMillis = 300)
                ),
                modifier = Modifier.fillMaxSize()
            ) {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.surface.copy(alpha = 0.95f),
                    tonalElevation = 4.dp,
                    shadowElevation = 16.dp
                ) {
                    Column(
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(16.dp)
                    ) {
                        Text(
                            text = "属性与设置",
                            style = MaterialTheme.typography.titleLarge,
                            modifier = Modifier.padding(bottom = 16.dp)
                        )
                        
                        HorizontalDivider(modifier = Modifier.padding(bottom = 16.dp))
                        
                        // 此处可以放置其他组件
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .weight(1f),
                            contentAlignment = Alignment.Center
                        ) {
                            Text(
                                text = "在此处添加组件",
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                }
            }
        }

        // 进度条
        val totalTime = route.getTotalTime().toFloat()

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
                        activeTrackColor = UIConfig.WIN11_ACCENT,
                        inactiveTrackColor = UIConfig.WIN11_INACTIVE,
                        thumbColor = UIConfig.WIN11_ACCENT
                    ),
                    thumb = {
                        SliderDefaults.Thumb(
                            interactionSource = remember { MutableInteractionSource() },
                            colors = SliderDefaults.colors(thumbColor = UIConfig.WIN11_ACCENT),
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
                        activeTrackColor = UIConfig.WIN11_ACCENT,
                        inactiveTrackColor = UIConfig.WIN11_INACTIVE,
                        thumbColor = UIConfig.WIN11_ACCENT
                    ),
                    thumb = {
                        SliderDefaults.Thumb(
                            interactionSource = remember { MutableInteractionSource() },
                            colors = SliderDefaults.colors(thumbColor = UIConfig.WIN11_ACCENT),
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
