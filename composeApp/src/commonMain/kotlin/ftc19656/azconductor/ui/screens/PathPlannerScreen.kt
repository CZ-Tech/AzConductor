package ftc19656.azconductor.ui.screens

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.Icons
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
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
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex
import azconductor.composeapp.generated.resources.FTC_MAP26
import azconductor.composeapp.generated.resources.Res
import ftc19656.azconductor.FieldConfig
import ftc19656.azconductor.RobotConfig
import ftc19656.azconductor.UIConfig
import ftc19656.azconductor.toFixed
import ftc19656.azconductor.route.ControlNode
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
fun PathPlannerScreen(route: RouteConnector = remember { RouteConnector() }, onNavigateBack: () -> Unit = {}) {
    DisposableEffect(route) {
        route.startAutoSaveWatcher()
        onDispose { route.stopAutoSaveWatcher() }
    }

    val painter = painterResource(Res.drawable.FTC_MAP26)
    var canvasPhysicalSize by remember { mutableStateOf(IntSize.Zero) }
    val rotationDegrees = UIConfig.CANVAS_ROTATE_DEG

    val selectedNodeIndex = remember { mutableStateOf<Int?>(null) }
    var editingNodeIndex by remember { mutableStateOf<Int?>(null) }
    var draggingNodeIndex by remember { mutableStateOf<Int?>(null) }
    var draggedNodeOffsetY by remember { mutableStateOf(0f) }
    val reorderThresholdPx = with(LocalDensity.current) { 72.dp.toPx() }

    var showContextMenu by remember { mutableStateOf(false) }
    var contextMenuOffset by remember { mutableStateOf(Offset.Zero) }

    var currentTime by remember { mutableStateOf(0f) }
    var isPlaying by remember { mutableStateOf(false) }
    var showGhostRobot by remember { mutableStateOf(true) }
    var showSettingsDialog by remember { mutableStateOf(false) }
    var dialogIpInput by remember { mutableStateOf(route.robotIp) }

    var showExportDialog by remember { mutableStateOf(false) }
    var exportedJson by remember { mutableStateOf("") }
    
    var showImportDialog by remember { mutableStateOf(false) }
    var importJsonText by remember { mutableStateOf("") }

    var isSidebarVisible by remember { mutableStateOf(true) }

    var isPreheated by remember { mutableStateOf(true) }

    fun remapIndexAfterMove(index: Int?, fromIndex: Int, toIndex: Int): Int? {
        if (index == null) return null

        return when {
            index == fromIndex -> toIndex
            fromIndex < toIndex && index in (fromIndex + 1)..toIndex -> index - 1
            toIndex < fromIndex && index in toIndex until fromIndex -> index + 1
            else -> index
        }
    }

    fun moveSidebarNode(fromIndex: Int, toIndex: Int) {
        selectedNodeIndex.value = remapIndexAfterMove(selectedNodeIndex.value, fromIndex, toIndex)
        editingNodeIndex = remapIndexAfterMove(editingNodeIndex, fromIndex, toIndex)
        route.moveNodeOrder(fromIndex, toIndex)
        draggingNodeIndex = toIndex
    }

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
    val addNodeFromSidebar = {
        val lastPoint = route.lastPoint
        val newNode = if (lastPoint == null) {
            ControlNode(
                x = 0.0.coerceIn(bounds.minX, bounds.maxX),
                dx = 10.0 * UIConfig.K_VELOCITY_HANDLE,
                y = 0.0.coerceIn(bounds.minY, bounds.maxY),
                dy = 0.0,
            )
        } else {
            val nextX = (lastPoint.x + 10.0).coerceIn(bounds.minX, bounds.maxX)
            val nextY = if (nextX == lastPoint.x) {
                (lastPoint.y + 10.0).coerceIn(bounds.minY, bounds.maxY)
            } else {
                lastPoint.y.coerceIn(bounds.minY, bounds.maxY)
            }
            lastPoint.copy(x = nextX, y = nextY)
        }

        route.addPoint(newNode)
        selectedNodeIndex.value = route.waypoints.lastIndex
    }

    Box(modifier = Modifier.fillMaxSize()) {
        BoxWithConstraints(modifier = Modifier.fillMaxSize().padding(bottom = 24.dp)) {
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

                // 棰勮鏈哄櫒浜?
                if (showGhostRobot) {
                    route.getPointAtTime(currentTime.toDouble())?.let { ghostNode ->
                        val screenPos = mapper.logicalToScreen(ghostNode.x.toFloat(), ghostNode.y.toFloat())
                        val centerOffsetX = (RobotConfig.ROBOT_LOGICAL_WIDTH + ROBOT_RENDER_PADDING) / 2f * mapper.scale
                        val centerOffsetY = (RobotConfig.ROBOT_LOGICAL_HEIGHT + ROBOT_RENDER_PADDING) / 2f * mapper.scale
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
                                }
                                .alpha(0.5f),
                            enabled = false
                        )
                    }
                }

                // 閫変腑鑺傜偣鐨勬満鍣ㄤ汉缁勪欢
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

                // 鑺傜偣
                route.waypoints.forEachIndexed { index, node ->
                    key(index) {
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

                // 鍙抽敭鑿滃崟
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
                            text = { Text("导出Json") },
                            onClick = {
                                exportedJson = route.exportToJson()
                                showExportDialog = true
                                showContextMenu = false
                            }
                        )
                        DropdownMenuItem(
                            text = { Text("导入Json") },
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

        // 鍙充晶杈规爮涓庡垏鎹㈡寜閽?
        Box(
            modifier = Modifier
                .fillMaxHeight()
                .fillMaxWidth(0.4f)
                .align(Alignment.CenterEnd)
        ) {
            // 鍒囨崲鎸夐挳锛氫晶杈规爮鏀惰捣鍚庝粛鏄剧ず鍦ㄥ彸涓婅
            IconButton(
                onClick = { isSidebarVisible = !isSidebarVisible },
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(8.dp)
                    .size(40.dp)
                    .zIndex(1f),
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
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(end = 40.dp, bottom = 16.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                text = "节点列表",
                                style = MaterialTheme.typography.titleLarge
                            )
                            Text(
                                text = "总时长: ${route.pathVersion.let { route.getTotalTime().toFixed(2) }}s",
                                style = MaterialTheme.typography.titleMedium,
                                color = MaterialTheme.colorScheme.primary
                            )
                        }
                        
                        HorizontalDivider(modifier = Modifier.padding(bottom = 16.dp))
                        
                        Text(
                            text = "控制点",
                            style = MaterialTheme.typography.titleMedium,
                            modifier = Modifier.padding(bottom = 8.dp)
                        )

                        if (route.waypoints.isEmpty()) {
                            Text(
                                text = "暂无控制点",
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                            Box(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(top = 12.dp),
                                contentAlignment = Alignment.Center
                            ) {
                                IconButton(
                                    onClick = addNodeFromSidebar,
                                    modifier = Modifier.size(28.dp)
                                ) {
                                    Icon(
                                        imageVector = Icons.Default.Add,
                                        contentDescription = "New control point",
                                        modifier = Modifier.size(18.dp)
                                    )
                                }
                            }
                            Spacer(modifier = Modifier.weight(1f))
                        } else {
                            LazyColumn(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .weight(1f),
                                verticalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                itemsIndexed(route.waypoints) { index, node ->
                                    val isSelected = selectedNodeIndex.value == index
                                    Card(
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .zIndex(if (draggingNodeIndex == index) 1f else 0f)
                                            .graphicsLayer {
                                                if (draggingNodeIndex == index) {
                                                    translationY = draggedNodeOffsetY
                                                    shadowElevation = 8f
                                                }
                                            }
                                            .pointerInput(route.waypoints.size) {
                                                detectDragGestures(
                                                    onDragStart = {
                                                        draggingNodeIndex = index
                                                        draggedNodeOffsetY = 0f
                                                    },
                                                    onDragCancel = {
                                                        draggingNodeIndex = null
                                                        draggedNodeOffsetY = 0f
                                                    },
                                                    onDragEnd = {
                                                        draggingNodeIndex = null
                                                        draggedNodeOffsetY = 0f
                                                    },
                                                    onDrag = { change, dragAmount ->
                                                        change.consume()
                                                        var currentIndex = draggingNodeIndex ?: return@detectDragGestures
                                                        draggedNodeOffsetY += dragAmount.y

                                                        while (
                                                            draggedNodeOffsetY > reorderThresholdPx &&
                                                            currentIndex < route.waypoints.lastIndex
                                                        ) {
                                                            moveSidebarNode(currentIndex, currentIndex + 1)
                                                            currentIndex += 1
                                                            draggedNodeOffsetY -= reorderThresholdPx
                                                        }

                                                        while (draggedNodeOffsetY < -reorderThresholdPx && currentIndex > 0) {
                                                            moveSidebarNode(currentIndex, currentIndex - 1)
                                                            currentIndex -= 1
                                                            draggedNodeOffsetY += reorderThresholdPx
                                                        }
                                                    }
                                                )
                                            }
                                            .clickable { selectedNodeIndex.value = index },
                                        colors = CardDefaults.cardColors(
                                            containerColor = if (isSelected) {
                                                MaterialTheme.colorScheme.secondaryContainer
                                            } else {
                                                MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.6f)
                                            }
                                        )
                                    ) {
                                        Row(
                                            modifier = Modifier
                                                .fillMaxWidth()
                                                .padding(horizontal = 12.dp, vertical = 10.dp),
                                            verticalAlignment = Alignment.CenterVertically
                                        ) {
                                            Column(modifier = Modifier.weight(1f)) {
                                                Text(
                                                    text = node.marker.ifBlank { "点 ${index + 1}" },
                                                    style = MaterialTheme.typography.titleSmall
                                                )
                                                Text(
                                                    text = "x=${node.x.toFixed(2)}, y=${node.y.toFixed(2)}, heading=${node.heading.toFixed(1)}度, duration=${node.duration.toFixed(1)}s",
                                                    style = MaterialTheme.typography.bodySmall,
                                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                                )
                                            }

                                            IconButton(onClick = { editingNodeIndex = index }) {
                                                Icon(
                                                    imageVector = Icons.Default.Edit,
                                                    contentDescription = "编辑控制点"
                                                )
                                            }
                                            IconButton(
                                                onClick = {
                                                    route.removeNode(index)

                                                    val selected = selectedNodeIndex.value
                                                    selectedNodeIndex.value = when {
                                                        selected == null -> null
                                                        selected == index -> null
                                                        selected > index -> selected - 1
                                                        else -> selected
                                                    }

                                                    if (editingNodeIndex == index) {
                                                        editingNodeIndex = null
                                                    }
                                                }
                                            ) {
                                                Icon(
                                                    imageVector = Icons.Default.Delete,
                                                    contentDescription = "删除控制点"
                                                )
                                            }
                                        }
                                    }
                                }
                                item {
                                    Box(
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .padding(top = 4.dp),
                                        contentAlignment = Alignment.Center
                                    ) {
                                        IconButton(
                                            onClick = addNodeFromSidebar,
                                            modifier = Modifier.size(28.dp)
                                        ) {
                                            Icon(
                                                imageVector = Icons.Default.Add,
                                                contentDescription = "New control point",
                                                modifier = Modifier.size(18.dp)
                                            )
                                        }
                                    }
                                }
                            }
                        }

                        HorizontalDivider(modifier = Modifier.padding(vertical = 12.dp))
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Text(
                                text = "显示幽灵机器人",
                                style = MaterialTheme.typography.bodyMedium
                            )
                            Switch(
                                checked = showGhostRobot,
                                onCheckedChange = { showGhostRobot = it }
                            )
                        }
                    }
                }
            }
        }

        // 杩涘害鏉?
        val totalTime = route.getTotalTime().toFloat()
        val maxTime = maxOf(totalTime, 0.001f)

        LaunchedEffect(totalTime) {
            currentTime = currentTime.coerceIn(0f, maxTime)
            if (totalTime <= 0f) {
                isPlaying = false
            }
        }

        LaunchedEffect(isPlaying, totalTime) {
            while (isPlaying && totalTime > 0f) {
                delay(16)
                currentTime = (currentTime + 0.016f).coerceAtMost(totalTime)
                if (currentTime >= totalTime) {
                    isPlaying = false
                }
            }
        }

        // 杩斿洖鎸夐挳 鈥?濮嬬粓淇濇寔鍦ㄥ乏涓婅锛屼笉闅忚繘搴︽潯绉诲姩
        IconButton(
            onClick = onNavigateBack,
            modifier = Modifier
                .align(Alignment.TopStart)
                .padding(8.dp)
                .size(40.dp)
                .zIndex(2f)
        ) {
            Icon(
                imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                contentDescription = "杩斿洖",
                modifier = Modifier.size(24.dp)
            )
        }
        Box(
            modifier = Modifier
                .padding(8.dp)
                .then(
                    if (isLandscape) {
                        Modifier
                            .width(40.dp)
                            .fillMaxHeight(0.8f)
                            .align(Alignment.CenterStart)
                    } else {
                        Modifier
                            .height(40.dp)
                            .fillMaxWidth(0.8f)
                            .align(Alignment.BottomCenter)
                    }
                ),
            contentAlignment = Alignment.Center
        ) {
            if (isLandscape) {
                Column(
                    modifier = Modifier
                        .fillMaxSize(),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    Box(
                        modifier = Modifier
                            .weight(1f)
                            .fillMaxWidth(),
                        contentAlignment = Alignment.Center
                    ) {
                        BoxWithConstraints(contentAlignment = Alignment.Center) {
                            Slider(
                                value = currentTime.coerceIn(0f, maxTime),
                                onValueChange = {
                                    currentTime = it
                                    isPlaying = false
                                },
                                valueRange = 0f..maxTime,
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
                                    .requiredWidth(maxHeight)
                            )
                        }
                    }
                    IconButton(
                        onClick = {
                            if (!isPlaying && currentTime >= totalTime) {
                                currentTime = 0f
                            }
                            isPlaying = !isPlaying
                        },
                        enabled = totalTime > 0f,
                        modifier = Modifier.size(28.dp)
                    ) {
                        Icon(
                            imageVector = if (isPlaying) Icons.Default.Pause else Icons.Default.PlayArrow,
                            contentDescription = if (isPlaying) "暂停" else "开始",
                            modifier = Modifier.size(16.dp)
                        )
                    }
                }
            } else {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    Slider(
                        value = currentTime.coerceIn(0f, maxTime),
                        onValueChange = {
                            currentTime = it
                            isPlaying = false
                        },
                        valueRange = 0f..maxTime,
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
                        modifier = Modifier.weight(1f)
                    )
                    IconButton(
                        onClick = {
                            if (!isPlaying && currentTime >= totalTime) {
                                currentTime = 0f
                            }
                            isPlaying = !isPlaying
                        },
                        enabled = totalTime > 0f,
                        modifier = Modifier.size(28.dp)
                    ) {
                        Icon(
                            imageVector = if (isPlaying) Icons.Default.Pause else Icons.Default.PlayArrow,
                            contentDescription = if (isPlaying) "暂停" else "开始",
                            modifier = Modifier.size(16.dp)
                        )
                    }
                }
            }

        }
        }

        // 底部状态栏
        Surface(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .height(24.dp),
            color = MaterialTheme.colorScheme.surfaceVariant,
            tonalElevation = 2.dp
        ) {
            Box(contentAlignment = Alignment.Center, modifier = Modifier.fillMaxWidth()) {
                Icon(
                    imageVector = Icons.Default.Settings,
                    contentDescription = "设置",
                    modifier = Modifier
                        .align(Alignment.CenterStart)
                        .padding(start = 4.dp)
                        .size(16.dp)
                        .clickable { showSettingsDialog = true },
                    tint = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Text(
                    text = route.connectionStatus,
                    style = MaterialTheme.typography.labelSmall,
                    color = when (route.connectionStatus) {
                        "连接失败", "未配置IP", "加载失败" -> Color.Red
                        "已保存", "已加载" -> Color(0xFF4CAF50)
                        "已发送" -> Color(0xFFFFA000)
                        else -> MaterialTheme.colorScheme.onSurfaceVariant
                    }
                )
            }
        }

        // 设置对话框
        if (showSettingsDialog) {
            AlertDialog(
                onDismissRequest = { showSettingsDialog = false },
                title = { Text("设置") },
                text = {
                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text(
                            text = "机器人 IP 地址",
                            style = MaterialTheme.typography.titleSmall
                        )
                        OutlinedTextField(
                            value = dialogIpInput,
                            onValueChange = { dialogIpInput = it },
                            singleLine = true,
                            placeholder = { Text("192.168.1.100") },
                            modifier = Modifier.fillMaxWidth()
                        )
                    }
                },
                confirmButton = {
                    TextButton(onClick = {
                        route.robotIp = dialogIpInput
                        showSettingsDialog = false
                    }) {
                        Text("保存")
                    }
                },
                dismissButton = {
                    TextButton(onClick = { showSettingsDialog = false }) {
                        Text("取消")
                    }
                }
            )
        }
    }
}

