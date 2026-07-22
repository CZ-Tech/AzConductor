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
import ftc19656.azconductor.io.RobotCommandItem
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
import ftc19656.azconductor.AppContext
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
    // Auto-save is handled globally by SyncManager (started in App.kt)
    val waypoints by route.waypoints.collectAsState()
    val availableCommands by AppContext.syncManager.availableCommands.collectAsState()
    val pv by route.pathVersion.collectAsState()

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
    var expandedCardIndex by remember { mutableStateOf<Int?>(null) }

    var showGhostRobot by remember { mutableStateOf(true) }

    var showExportDialog by remember { mutableStateOf(false) }
    var exportedJson by remember { mutableStateOf("") }
    
    var showImportDialog by remember { mutableStateOf(false) }
    var importJsonText by remember { mutableStateOf("") }

    var isSidebarVisible by remember { mutableStateOf(true) }
    var isSidebarOnRight by remember { mutableStateOf(true) }

    var showLeaveConfirmDialog by remember { mutableStateOf(false) }

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

    /** 校验参数值是否符合其声明的类型 */
    fun isValidParamValue(value: String, typeName: String): Boolean {
        if (value.isBlank()) return false
        return when (typeName) {
            "double", "float" -> value.toDoubleOrNull() != null
            "int" -> value.toIntOrNull() != null
            "long" -> value.toLongOrNull() != null
            "short" -> value.toShortOrNull() != null
            "byte" -> value.toByteOrNull() != null
            "boolean" -> value.toBooleanStrictOrNull() != null
            else -> true // String 和未知类型不做校验
        }
    }

    /** 检查指定索引的节点是否有未填写或类型错误的命令参数 */
    fun nodeHasUnfilledParams(index: Int): Boolean {
        val node = waypoints.getOrNull(index) ?: return false
        if (node.command.isBlank()) return false
        val cmd = availableCommands.find { it.name == node.command } ?: return false
        if (cmd.params.isEmpty()) return false
        return cmd.params.indices.any { i ->
            val v = node.commandParams.getOrElse(i) { "" }
            v.isBlank() || !isValidParamValue(v, cmd.params[i])
        }
    }

    if (!isPreheated) {
        CompositionLocalProvider(LocalContentColor provides Color.Transparent) {
            NodeEditorDialog(
                node = preloadSerializer(),
                onDismiss = { },
                onConfirm = { },
                onDelete = { }
            )
        }
        LaunchedEffect(Unit) {
            delay(100)
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
        selectedNodeIndex.value = waypoints.lastIndex
    }

    Box(modifier = Modifier.fillMaxSize()) {
        BoxWithConstraints(modifier = Modifier.fillMaxSize()) {
        val isLandscape = maxWidth > maxHeight
        val playbackState = rememberPlaybackState(route.getTotalTime().toFloat())
        val totalTime = route.getTotalTime().toFloat()

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
                    route.getPointAtTime(playbackState.currentTime.toDouble())?.let { ghostNode ->
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
                    waypoints.getOrNull(index)?.let { node ->
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
                waypoints.forEachIndexed { index, node ->
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
                    waypoints.getOrNull(indexToEdit)?.let { targetNode ->
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
                .align(if (isSidebarOnRight) Alignment.CenterEnd else Alignment.CenterStart)
        ) {
            // 对换左右侧 + 收起/展开按钮
            Row(
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(8.dp)
                    .zIndex(1f),
                verticalAlignment = Alignment.CenterVertically
            ) {
                IconButton(
                    onClick = { isSidebarOnRight = !isSidebarOnRight },
                    modifier = Modifier.size(40.dp),
                    colors = IconButtonDefaults.filledIconButtonColors(
                        containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.8f),
                        contentColor = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                ) {
                    Icon(
                        imageVector = Icons.Default.SwapHoriz,
                        contentDescription = "对换左右侧",
                        modifier = Modifier.size(20.dp)
                    )
                }
                Spacer(modifier = Modifier.width(4.dp))
                IconButton(
                    onClick = { isSidebarVisible = !isSidebarVisible },
                    modifier = Modifier.size(40.dp),
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
            }

            AnimatedVisibility(
                visible = isSidebarVisible,
                enter = slideInHorizontally(
                    initialOffsetX = { if (isSidebarOnRight) it else -it },
                    animationSpec = tween(durationMillis = 300)
                ),
                exit = slideOutHorizontally(
                    targetOffsetX = { if (isSidebarOnRight) it else -it },
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
                                .padding(end = 88.dp, bottom = 16.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                text = "节点列表",
                                style = MaterialTheme.typography.titleLarge
                            )
                            Text(
                                text = "总时长: ${pv.let { route.getTotalTime().toFixed(2) }}s",
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

                        if (waypoints.isEmpty()) {
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
                                itemsIndexed(waypoints) { index, node ->
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
                                            .pointerInput(waypoints.size) {
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
                                                            currentIndex < waypoints.lastIndex
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
                                            },
                                        colors = CardDefaults.cardColors(
                                            containerColor = if (isSelected) {
                                                MaterialTheme.colorScheme.secondaryContainer
                                            } else {
                                                MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.6f)
                                            }
                                        )
                                    ) {
                                        Column {
                                            Row(
                                                modifier = Modifier
                                                    .fillMaxWidth()
                                                    .clickable { selectedNodeIndex.value = index }
                                                    .padding(start = 4.dp, end = 12.dp, top = 10.dp, bottom = 10.dp),
                                                verticalAlignment = Alignment.CenterVertically
                                            ) {
                                                IconButton(
                                                    onClick = {
                                                        if (expandedCardIndex == index && nodeHasUnfilledParams(index)) {
                                                            // 参数未填写时，不允许收起
                                                        } else {
                                                            expandedCardIndex = if (expandedCardIndex == index) null else index
                                                        }
                                                    },
                                                    modifier = Modifier.size(UIConfig.EXPAND_ARROW_BUTTON_SIZE_DIP.dp)
                                                ) {
                                                    Icon(
                                                        imageVector = if (expandedCardIndex == index) Icons.Default.KeyboardArrowDown else Icons.AutoMirrored.Filled.KeyboardArrowRight,
                                                        contentDescription = if (expandedCardIndex == index) "收起" else "展开",
                                                        modifier = Modifier.size(UIConfig.EXPAND_ARROW_ICON_SIZE_DIP.dp)
                                                    )
                                                }

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
                                                    if (node.command.isNotBlank()) {
                                                        Text(
                                                            text = "⚡ ${node.command}",
                                                            style = MaterialTheme.typography.bodySmall,
                                                            color = UIConfig.WIN11_ACCENT
                                                        )
                                                    }
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

                                            AnimatedVisibility(visible = expandedCardIndex == index) {
                                                Column(
                                                    modifier = Modifier
                                                        .fillMaxWidth()
                                                        .padding(start = 12.dp, end = 12.dp, bottom = 10.dp)
                                                ) {
                                                    var filterText by remember { mutableStateOf(node.command) }
                                                    var dropdownExpanded by remember { mutableStateOf(false) }
                                                    val availableCommandsList = availableCommands
                                                    val filteredCommands = remember(filterText, availableCommandsList) {
                                                        if (filterText.isBlank()) {
                                                            availableCommandsList
                                                        } else {
                                                            val lower = filterText.lowercase()
                                                            availableCommandsList.filter { command ->
                                                                command.name.lowercase().contains(lower)
                                                            }
                                                        }
                                                    }
                                                    val currentCommand = availableCommands.find { it.name == node.command }
                                                    ExposedDropdownMenuBox(
                                                        expanded = dropdownExpanded,
                                                        onExpandedChange = { dropdownExpanded = it }
                                                    ) {
                                                        OutlinedTextField(
                                                            value = filterText,
                                                            onValueChange = {
                                                                filterText = it
                                                                dropdownExpanded = true
                                                            },
                                                            placeholder = { Text("选择指令") },
                                                            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = dropdownExpanded) },
                                                            modifier = Modifier
                                                                .fillMaxWidth()
                                                                .menuAnchor(ExposedDropdownMenuAnchorType.PrimaryEditable),
                                                            singleLine = true,
                                                            textStyle = MaterialTheme.typography.bodySmall
                                                        )
                                                        ExposedDropdownMenu(
                                                            expanded = dropdownExpanded,
                                                            onDismissRequest = { dropdownExpanded = false }
                                                        ) {
                                                            // "无"选项：清空 command
                                                            DropdownMenuItem(
                                                                text = { Text("无") },
                                                                onClick = {
                                                                    val current = waypoints.getOrNull(index)
                                                                    if (current != null && current.command.isNotBlank()) {
                                                                        route.moveNode(index, current.copy(command = "", commandParams = emptyList()))
                                                                    }
                                                                    filterText = ""
                                                                    dropdownExpanded = false
                                                                }
                                                            )
                                                            if (filteredCommands.isEmpty()) {
                                                                DropdownMenuItem(
                                                                    text = { Text("无匹配指令") },
                                                                    onClick = { dropdownExpanded = false },
                                                                    enabled = false
                                                                )
                                                            } else {
                                                                filteredCommands.forEach { command: RobotCommandItem ->
                                                                    DropdownMenuItem(
                                                                        text = { Text(command.name) },
                                                                        onClick = {
                                                                            val current = waypoints.getOrNull(index)
                                                                            if (current != null && current.command != command.name) {
                                                                                route.moveNode(index, current.copy(command = command.name, commandParams = emptyList()))
                                                                            }
                                                                            filterText = command.name
                                                                            dropdownExpanded = false
                                                                        }
                                                                    )
                                                                }
                                                            }
                                                        }
                                                    }

                                                    // 当选中命令有参数时，显示参数输入框
                                                    if (currentCommand != null && currentCommand.params.isNotEmpty()) {
                                                        Spacer(modifier = Modifier.height(4.dp))
                                                        currentCommand.params.forEachIndexed { paramIndex, paramType ->
                                                            val paramValue = node.commandParams.getOrElse(paramIndex) { "" }
                                                            if (paramType == "boolean") {
                                                                // boolean 类型使用复选框
                                                                val isChecked = paramValue.toBooleanStrictOrNull() ?: false
                                                                Row(
                                                                    verticalAlignment = Alignment.CenterVertically,
                                                                    modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp)
                                                                ) {
                                                                    Checkbox(
                                                                        checked = isChecked,
                                                                        onCheckedChange = { checked ->
                                                                            val updatedParams = node.commandParams.toMutableList()
                                                                            while (updatedParams.size <= paramIndex) {
                                                                                updatedParams.add("")
                                                                            }
                                                                            updatedParams[paramIndex] = checked.toString()
                                                                            route.moveNode(index, node.copy(commandParams = updatedParams))
                                                                        }
                                                                    )
                                                                    Text(
                                                                        text = currentCommand.paramNames.getOrElse(paramIndex) { "参数${paramIndex + 1}" } + " (boolean)",
                                                                        style = MaterialTheme.typography.bodySmall
                                                                    )
                                                                }
                                                            } else {
                                                                val hasError = paramValue.isBlank() || !isValidParamValue(paramValue, paramType)
                                                                OutlinedTextField(
                                                                    value = paramValue,
                                                                    onValueChange = { newValue ->
                                                                        val updatedParams = node.commandParams.toMutableList()
                                                                        while (updatedParams.size <= paramIndex) {
                                                                            updatedParams.add("")
                                                                        }
                                                                        updatedParams[paramIndex] = newValue
                                                                        route.moveNode(index, node.copy(commandParams = updatedParams))
                                                                    },
                                                                    isError = hasError,
                                                                    label = { Text(currentCommand.paramNames.getOrElse(paramIndex) { "参数${paramIndex + 1}" } + " ($paramType)") },
                                                                modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
                                                                singleLine = true,
                                                                textStyle = MaterialTheme.typography.bodySmall
                                                            )
                                                        }
                                                    }
                                                    }

                                                    Spacer(modifier = Modifier.height(8.dp))

                                                    Box(
                                                        modifier = Modifier
                                                            .fillMaxWidth()
                                                            .clickable {
                                                                val current = waypoints.getOrNull(index)
                                                                val newNode = if (current == null) {
                                                                    ControlNode(
                                                                        x = 0.0.coerceIn(bounds.minX, bounds.maxX),
                                                                        dx = 10.0 * UIConfig.K_VELOCITY_HANDLE,
                                                                        y = 0.0.coerceIn(bounds.minY, bounds.maxY),
                                                                        dy = 0.0
                                                                    )
                                                                } else {
                                                                    val nextX = (current.x + 10.0).coerceIn(bounds.minX, bounds.maxX)
                                                                    val nextY = if (nextX == current.x) {
                                                                        (current.y + 10.0).coerceIn(bounds.minY, bounds.maxY)
                                                                    } else {
                                                                        current.y.coerceIn(bounds.minY, bounds.maxY)
                                                                    }
                                                                    current.copy(x = nextX, y = nextY)
                                                                }
                                                                route.addPointAt(index + 1, newNode)
                                                                selectedNodeIndex.value = index + 1
                                                                if (!nodeHasUnfilledParams(index)) {
                                                                    expandedCardIndex = null
                                                                }
                                                            },
                                                        contentAlignment = Alignment.Center
                                                    ) {
                                                        Icon(
                                                            imageVector = Icons.Default.Add,
                                                            contentDescription = "在此节点后添加控制点",
                                                            modifier = Modifier.size(18.dp),
                                                            tint = MaterialTheme.colorScheme.onSurfaceVariant
                                                        )
                                                    }
                                                }
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

        // 返回按钮 — 始终保持在左上角，不随进度条移动
        IconButton(
            onClick = {
                val hasAnyUnfilled = waypoints.indices.any { nodeHasUnfilledParams(it) }
                if (hasAnyUnfilled) {
                    showLeaveConfirmDialog = true
                } else {
                    onNavigateBack()
                }
            },
            modifier = Modifier
                .align(if (isSidebarOnRight) Alignment.TopStart else Alignment.TopEnd)
                .padding(8.dp)
                .size(40.dp)
                .zIndex(2f)
        ) {
            Icon(
                imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                contentDescription = "返回",
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
                            .align(if (isSidebarOnRight) Alignment.CenterStart else Alignment.CenterEnd)
                    } else {
                        Modifier
                            .height(40.dp)
                            .fillMaxWidth(0.8f)
                            .align(Alignment.BottomCenter)
                    }
                ),
            contentAlignment = Alignment.Center
        ) {
            PlaybackProgressBar(
                currentTime = playbackState.currentTime,
                totalTime = totalTime,
                onValueChange = playbackState.onSeek,
                isPlaying = playbackState.isPlaying,
                onPlayPauseToggle = playbackState.onTogglePlayPause,
                isVertical = isLandscape,
                modifier = Modifier.fillMaxSize()
            )
        }
        }

        // 参数未填写时退出路径编辑页面的确认对话框
        if (showLeaveConfirmDialog) {
            AlertDialog(
                onDismissRequest = { showLeaveConfirmDialog = false },
                title = { Text("参数未填写") },
                text = { Text("当前路径中有命令参数未填写，确定要离开吗？") },
                confirmButton = {
                    TextButton(onClick = {
                        showLeaveConfirmDialog = false
                        onNavigateBack()
                    }) {
                        Text("确定离开")
                    }
                },
                dismissButton = {
                    TextButton(onClick = { showLeaveConfirmDialog = false }) {
                        Text("继续编辑")
                    }
                }
            )
        }
    }
}
