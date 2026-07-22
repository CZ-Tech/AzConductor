package ftc19656.azconductor.ui.screens

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.filled.Circle
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.zIndex
import azconductor.composeapp.generated.resources.FTC_MAP26
import azconductor.composeapp.generated.resources.Res
import ftc19656.azconductor.AppContext
import ftc19656.azconductor.FieldConfig
import ftc19656.azconductor.RobotConfig
import ftc19656.azconductor.UIConfig
import ftc19656.azconductor.core.math.CoordinateMapper
import ftc19656.azconductor.io.OpModeStatusResponse
import ftc19656.azconductor.io.RobotCommandItem
import ftc19656.azconductor.io.RobotPositionResponse
import ftc19656.azconductor.io.SyncManager
import ftc19656.azconductor.route.ControlNode
import ftc19656.azconductor.route.RouteCore
import ftc19656.azconductor.route.viewmodel.CommandsViewModel
import ftc19656.azconductor.route.viewmodel.RouteConnector
import ftc19656.azconductor.ui.components.RobotComponent
import ftc19656.azconductor.toFixed
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.jetbrains.compose.resources.painterResource

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CommandsScreen(route: RouteConnector, syncManager: SyncManager, onNavigateBack: () -> Unit) {
    val drawerState = rememberDrawerState(initialValue = DrawerValue.Closed)
    var selectedDrawerItem by remember { mutableStateOf("运行") }
    val scope = rememberCoroutineScope()

    // ---- Commands-scoped ViewModel (robot path list) ----
    val commandsViewModel = remember { CommandsViewModel(syncManager) }
    val robotPaths by commandsViewModel.robotPaths.collectAsState()
    var selectedRobotPath by remember { mutableStateOf("") }
    var pathDropdownExpanded by remember { mutableStateOf(false) }
    var searchQuery by remember { mutableStateOf("") }

    // ---- OpMode status & robot position (auto-polled by RobotSyncService) ----
    val opModeStatus by commandsViewModel.opModeStatus.collectAsState()
    val robotPosition by commandsViewModel.robotPosition.collectAsState()
    val executionStatus by commandsViewModel.executionStatus.collectAsState()
    val fetchedWaypoints by commandsViewModel.fetchedWaypoints.collectAsState()

    // 地图像素尺寸（onSizeChanged 回调更新）
    var mapPixelSize by remember { mutableStateOf(IntSize.Zero) }

    // 可编辑的本地路径点副本，切换路径时重置
    val editableWaypoints = remember { mutableStateListOf<ControlNode>() }
    LaunchedEffect(selectedRobotPath, fetchedWaypoints) {
        editableWaypoints.clear()
        editableWaypoints.addAll(fetchedWaypoints)
    }

    val availableCommands by AppContext.syncManager.availableCommands.collectAsState()

    // Auto-clear execution status after 5 seconds on success
    LaunchedEffect(executionStatus) {
        if (executionStatus != null && executionStatus != "正在执行...") {
            delay(5000)
            commandsViewModel.clearExecutionStatus()
        }
    }

    val filteredPaths = remember(robotPaths, searchQuery) {
        if (searchQuery.isBlank()) robotPaths
        else robotPaths.filter { it.contains(searchQuery, ignoreCase = true) }
    }

    ModalNavigationDrawer(
        drawerState = drawerState,
        drawerContent = {
            ModalDrawerSheet {
                Spacer(modifier = Modifier.height(16.dp))
                Text(
                    text = "导航",
                    style = MaterialTheme.typography.titleMedium,
                    modifier = Modifier.padding(horizontal = 28.dp, vertical = 8.dp)
                )
                HorizontalDivider(modifier = Modifier.padding(horizontal = 28.dp))
                Spacer(modifier = Modifier.height(8.dp))
                NavigationDrawerItem(
                    icon = { Icon(Icons.Default.Menu, contentDescription = null) },
                    label = { Text("路径") },
                    selected = selectedDrawerItem == "路径",
                    onClick = {
                        selectedDrawerItem = "路径"
                        scope.launch { drawerState.close() }
                        onNavigateBack()
                    },
                    modifier = Modifier.padding(horizontal = 12.dp)
                )
                NavigationDrawerItem(
                    icon = { Icon(Icons.AutoMirrored.Filled.List, contentDescription = null) },
                    label = { Text("运行") },
                    selected = selectedDrawerItem == "运行",
                    onClick = {
                        selectedDrawerItem = "运行"
                        scope.launch { drawerState.close() }
                    },
                    modifier = Modifier.padding(horizontal = 12.dp)
                )
            }
        }
    ) {
        Scaffold {
            Row(
                modifier = Modifier
                    .fillMaxSize()
            ) {
                // ---- 右侧：地图 + 控制 ----
                BoxWithConstraints(
                    modifier = Modifier
                        .weight(1f)
                        .fillMaxHeight()
                ) {
                    val mapHeight = maxHeight * UIConfig.RUN_MAP_HEIGHT_RATIO

                    val fieldAspect = FieldConfig.CANVAS_LOGICAL_WIDTH / FieldConfig.CANVAS_LOGICAL_HEIGHT

                    // 地图容器：固定 1:1 宽高比，右上角
                    Box(
                        modifier = Modifier
                            .height(mapHeight)
                            .aspectRatio(fieldAspect)
                            .align(Alignment.TopEnd)
                            .onSizeChanged { mapPixelSize = it }
                    ) {
                        // Layer 1: 场地图底图
                        Image(
                            painter = painterResource(Res.drawable.FTC_MAP26),
                            contentDescription = "场地地图",
                            contentScale = ContentScale.Fit,
                            modifier = Modifier.matchParentSize()
                        )

                        // Layer 2: 路径 Spline + 机器人位置叠加
                        if (mapPixelSize.width > 0 && mapPixelSize.height > 0) {
                            val mapper = remember(mapPixelSize) {
                                CoordinateMapper(
                                    physicalWidth = mapPixelSize.width.toFloat(),
                                    physicalHeight = mapPixelSize.height.toFloat(),
                                    logicalWidth = FieldConfig.CANVAS_LOGICAL_WIDTH,
                                    logicalHeight = FieldConfig.CANVAS_LOGICAL_HEIGHT,
                                    originRatioX = FieldConfig.ORIGIN_RATIO_X,
                                    originRatioY = FieldConfig.ORIGIN_RATIO_Y,
                                    rotationDegrees = UIConfig.CANVAS_ROTATE_DEG
                                )
                            }

                            PathOverlay(
                                waypoints = editableWaypoints,
                                mapper = mapper,
                                modifier = Modifier.matchParentSize()
                            )

                            RobotPositionOverlay(
                                robotPosition = robotPosition,
                                mapper = mapper
                            )
                        }
                    }

                    // ---- 左上角：菜单按钮 + 路径选择器 ----
                    Row(
                        modifier = Modifier
                            .align(Alignment.TopStart)
                            .padding(4.dp)
                            .zIndex(2f),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        IconButton(
                            onClick = { scope.launch { drawerState.open() } },
                            modifier = Modifier.size(36.dp)
                        ) {
                            Icon(
                                Icons.Default.Menu,
                                contentDescription = "菜单",
                                modifier = Modifier.size(22.dp)
                            )
                        }

                        Spacer(modifier = Modifier.width(4.dp))

                        ExposedDropdownMenuBox(
                            expanded = pathDropdownExpanded,
                            onExpandedChange = { pathDropdownExpanded = it }
                        ) {
                            OutlinedTextField(
                                value = searchQuery,
                                onValueChange = {
                                    searchQuery = it
                                    pathDropdownExpanded = true
                                },
                                placeholder = {
                                    Text(
                                        "选择路径",
                                        style = MaterialTheme.typography.bodyMedium
                                    )
                                },
                                singleLine = true,
                                trailingIcon = {
                                    ExposedDropdownMenuDefaults.TrailingIcon(expanded = pathDropdownExpanded)
                                },
                                colors = ExposedDropdownMenuDefaults.outlinedTextFieldColors(
                                    focusedBorderColor = MaterialTheme.colorScheme.primary.copy(alpha = 0.5f),
                                    unfocusedBorderColor = MaterialTheme.colorScheme.outline.copy(alpha = 0.3f),
                                    focusedTextColor = MaterialTheme.colorScheme.onSurface,
                                    unfocusedTextColor = MaterialTheme.colorScheme.onSurface,
                                    focusedPlaceholderColor = MaterialTheme.colorScheme.onSurfaceVariant,
                                    unfocusedPlaceholderColor = MaterialTheme.colorScheme.onSurfaceVariant
                                ),
                                textStyle = MaterialTheme.typography.bodyMedium,
                                modifier = Modifier
                                    .menuAnchor(ExposedDropdownMenuAnchorType.PrimaryEditable)
                                    .width(160.dp)
                            )

                            ExposedDropdownMenu(
                                expanded = pathDropdownExpanded,
                                onDismissRequest = { pathDropdownExpanded = false }
                            ) {
                                if (filteredPaths.isEmpty()) {
                                    DropdownMenuItem(
                                        text = {
                                            Text(
                                                "无可用路径",
                                                style = MaterialTheme.typography.labelSmall,
                                                color = MaterialTheme.colorScheme.onSurfaceVariant
                                            )
                                        },
                                        onClick = { pathDropdownExpanded = false },
                                        enabled = false
                                    )
                                } else {
                                    filteredPaths.forEach { pathName ->
                                        DropdownMenuItem(
                                            text = {
                                                Text(
                                                    pathName,
                                                    style = MaterialTheme.typography.labelSmall,
                                                    maxLines = 1,
                                                    overflow = TextOverflow.Ellipsis
                                                )
                                            },
                                            onClick = {
                                                selectedRobotPath = pathName
                                                searchQuery = pathName
                                                pathDropdownExpanded = false
                                                scope.launch { commandsViewModel.fetchPathData(pathName) }
                                            },
                                            leadingIcon = {
                                                Icon(
                                                    Icons.AutoMirrored.Filled.List,
                                                    contentDescription = null,
                                                    modifier = Modifier.size(16.dp)
                                                )
                                            }
                                        )
                                    }
                                }
                            }
                        }

                        Spacer(modifier = Modifier.width(6.dp))

                        OpModeStatusBadge(
                            status = opModeStatus,
                            selectedPath = selectedRobotPath,
                            onExecute = {
                                scope.launch { commandsViewModel.executeSavedPath(selectedRobotPath) }
                            }
                        )
                    }

                    // ---- 左对齐：路径点指令 + 任务列表 ----
                    val panelWidth = maxWidth / 4f
                    Row(
                        modifier = Modifier
                            .align(Alignment.TopStart)
                            .padding(top = 100.dp, bottom = 50.dp)
                            .zIndex(1f)
                    ) {
                        WaypointCommandSidebar(
                            waypoints = editableWaypoints,
                            availableCommands = availableCommands,
                            onWaypointUpdate = { index, newPoint ->
                                editableWaypoints[index] = newPoint
                            },
                            modifier = Modifier.padding(horizontal = 50.dp).width(panelWidth).fillMaxHeight()
                        )
                        TaskListPanel(
                            waypoints = editableWaypoints,
                            modifier = Modifier.padding(horizontal = 50.dp).width(panelWidth).fillMaxHeight()
                        )
                    }

                    // ---- 右下：路径误差—时间图 ----
                    val errorHistory = remember { mutableStateListOf<Double>() }
                    val routeCore = remember(fetchedWaypoints) {
                        RouteCore().apply { setWaypoints(fetchedWaypoints) }
                    }
                    var startTime by remember { mutableStateOf<kotlin.time.TimeMark?>(null) }

                    LaunchedEffect(opModeStatus.isExecuting) {
                        if (opModeStatus.isExecuting) {
                            errorHistory.clear()
                            startTime = kotlin.time.TimeSource.Monotonic.markNow()
                        }
                    }
                    LaunchedEffect(opModeStatus.isExecuting) {
                        if (!opModeStatus.isExecuting && startTime != null) {
                            delay(30000)
                            startTime = null
                        }
                    }
                    LaunchedEffect(Unit) {
                        while (true) {
                            val s = startTime ?: run { delay(250); continue }
                            delay(250)
                            val elapsed = s.elapsedNow().inWholeSeconds.toDouble()
                            val pos = robotPosition ?: continue
                            val expected = routeCore.getPointAtTime(elapsed) ?: continue
                            val dx = pos.x - expected.x
                            val dy = pos.y - expected.y
                            val error = kotlin.math.sqrt(dx * dx + dy * dy)
                            errorHistory.add(error)
                        }
                    }
                    // ---- 底部：机器人位置 + 执行状态反馈 ----
                    BottomInfoBar(
                        robotPosition = robotPosition,
                        executionStatus = executionStatus,
                        modifier = Modifier
                            .align(Alignment.BottomStart)
                            .fillMaxWidth(0.63f)
                            .padding(horizontal = 50.dp, vertical = 4.dp)
                            .zIndex(1f)
                    )

                    ErrorTimeChart(
                        xHistory = errorHistory,
                        showLine = startTime == null && errorHistory.isNotEmpty(),
                        modifier = Modifier
                            .align(Alignment.BottomEnd)
                            .padding(end = 12.dp, bottom = 4.dp)
                            .fillMaxWidth(0.37f)
                            .aspectRatio(2f)
                            .zIndex(1f)
                    )
                }
            }
        }
    }
}

// ---- Map overlay composables ----

/**
 * Draws the spline path from waypoints onto the field map Canvas,
 * using the same coordinate transform as [RouteCanvas] for consistency.
 */
@Composable
private fun PathOverlay(
    waypoints: List<ControlNode>,
    mapper: CoordinateMapper,
    modifier: Modifier = Modifier
) {
    if (waypoints.size < 2) return

    val routeCore = remember(waypoints) {
        RouteCore().apply { setWaypoints(waypoints) }
    }
    val totalTime = routeCore.totalTime

    Canvas(modifier = modifier) {
        withTransform({
            translate(mapper.centerX, mapper.centerY)
            rotate(UIConfig.CANVAS_ROTATE_DEG, pivot = Offset.Zero)
            scale(mapper.scale, mapper.scale, pivot = Offset.Zero)
        }) {
            val path = Path()
            for (i in 0..UIConfig.CURVE_DRAW_STEP) {
                val time = (i.toDouble() / UIConfig.CURVE_DRAW_STEP) * totalTime
                val point = routeCore.getPointAtTime(time) ?: continue
                val mapped = mapper.logicalToBase(point.x.toFloat(), point.y.toFloat())
                if (i == 0) path.moveTo(mapped.x, mapped.y)
                else path.lineTo(mapped.x, mapped.y)
            }
            drawPath(
                path = path,
                color = UIConfig.PATH_LINE_COLOR.copy(alpha = 0.7f),
                style = Stroke(
                    width = UIConfig.CANVAS_LINE_WIDTH / mapper.scale,
                    cap = StrokeCap.Round
                )
            )
        }
    }
}

/**
 * Draws the robot's current position on the field map as a [RobotComponent].
 * Position comes from [RobotPositionResponse] (x, y, heading in logical units).
 * Uses the exact same [CoordinateMapper.logicalToScreen] + offset-centering
 * pattern as the ghost robot in [PathPlannerScreen].
 */
@Composable
private fun RobotPositionOverlay(
    robotPosition: RobotPositionResponse?,
    mapper: CoordinateMapper
) {
    val pos = robotPosition ?: return
    if (pos.status != "ok") return

    val screenPos = mapper.logicalToScreen(pos.x.toFloat(), pos.y.toFloat())
    val nodePixelWidth = mapper.scale * RobotConfig.ROBOT_LOGICAL_WIDTH
    val nodePixelHeight = mapper.scale * RobotConfig.ROBOT_LOGICAL_HEIGHT

    RobotComponent(
        index = -1,
        logicalWidth = RobotConfig.ROBOT_LOGICAL_WIDTH,
        logicalHeight = RobotConfig.ROBOT_LOGICAL_HEIGHT,
        scale = mapper.scale,
        headingDegrees = pos.heading.toFloat(),
        onHeadingChange = {},
        enabled = false,
        color = Color(0xFF2196F3), // 蓝色，区别于编辑页
        modifier = Modifier
            .offset {
                IntOffset(
                    (screenPos.x - nodePixelWidth / 2).toInt(),
                    (screenPos.y - nodePixelHeight / 2).toInt()
                )
            }
    )
}

// ---- Supporting composables ----

/**
 * 就绪状态指示（上）+ 运行按钮（下），垂直排列在路径选择框右侧。
 */
@Composable
private fun OpModeStatusBadge(
    status: OpModeStatusResponse,
    selectedPath: String,
    onExecute: () -> Unit
) {
    val canExecute = status.executionReady && selectedPath.isNotBlank() && !status.isExecuting

    // Status indicator chip
    val (chipColor, chipText) = when {
        status.isExecuting -> Color(0xFF2196F3) to "执行中..."
        status.executionReady -> {
            val name = status.activeOpModeName ?: "未知OpMode"
            Color(0xFF4CAF50) to "$name 就绪"
        }
        status.opModeActive -> Color(0xFFFFC107) to "等待就绪..."
        else -> Color(0xFF9E9E9E) to "无活跃 OpMode"
    }

    Column(
        horizontalAlignment = Alignment.Start,
        verticalArrangement = Arrangement.spacedBy(4.dp)
    ) {
        // 就绪状态指示
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            modifier = Modifier
                .clip(RoundedCornerShape(10.dp))
                .background(chipColor.copy(alpha = 0.15f))
                .padding(horizontal = 8.dp, vertical = 2.dp)
        ) {
            Icon(
                Icons.Default.Circle,
                contentDescription = null,
                tint = chipColor,
                modifier = Modifier.size(8.dp)
            )
            Text(
                chipText,
                color = chipColor,
                fontSize = 11.sp,
                fontWeight = FontWeight.Medium
            )
        }

        // 运行按钮
        Button(
            onClick = onExecute,
            enabled = canExecute,
            contentPadding = PaddingValues(horizontal = 10.dp, vertical = 2.dp),
            modifier = Modifier.height(28.dp)
        ) {
            Icon(
                Icons.Default.PlayArrow,
                contentDescription = null,
                modifier = Modifier.size(14.dp)
            )
            Spacer(Modifier.width(2.dp))
            Text("运行", fontSize = 11.sp)
        }
    }
}

/**
 * Bottom bar showing robot position readout and execution status feedback.
 */
@Composable
private fun BottomInfoBar(
    robotPosition: RobotPositionResponse?,
    executionStatus: String?,
    modifier: Modifier = Modifier
    ) {
        Row(
            modifier = modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(8.dp))
                .background(Color.Black.copy(alpha = 0.55f))
                .padding(horizontal = 12.dp, vertical = 6.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        // --- Robot position readout ---
        if (robotPosition != null && robotPosition.status == "ok") {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(
                    "X: ${robotPosition.x.toFixed(1)}",
                    color = Color.White,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Medium
                )
                Text(
                    "Y: ${robotPosition.y.toFixed(1)}",
                    color = Color.White,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Medium
                )
                Text(
                    "H: ${robotPosition.heading.toFixed(1)}°",
                    color = Color.White,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Medium
                )
            }
        } else {
            Text(
                "位置: --",
                color = Color.White.copy(alpha = 0.5f),
                fontSize = 12.sp
            )
        }

        // --- Execution status feedback ---
        if (executionStatus != null) {
            val statusColor = when {
                executionStatus.contains("失败") -> Color(0xFFFF5252)
                executionStatus == "正在执行..." -> Color(0xFF2196F3)
                else -> Color(0xFF4CAF50)
            }
            Text(
                executionStatus,
                color = statusColor,
                fontSize = 12.sp,
                fontWeight = FontWeight.Medium
            )
        }
    }
}
//任务列表
@Composable
private fun TaskListPanel(
    waypoints: List<ControlNode> = emptyList(),
    modifier: Modifier = Modifier
) {
    val tasks = remember(waypoints) {
        waypoints.filter { it.command.isNotBlank() }
    }
    Surface(
        modifier = modifier,
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.3f),
        shape = RoundedCornerShape(12.dp)
    ) {
        Box(modifier = Modifier.fillMaxSize()) {
            Column(
                modifier = Modifier.padding(10.dp).align(Alignment.TopStart)
            ) {
                Text(
                    text = "任务列表",
                    style = MaterialTheme.typography.labelLarge,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurface,
                    modifier = Modifier.padding(bottom = 8.dp)
                )
                HorizontalDivider(
                    color = MaterialTheme.colorScheme.outlineVariant,
                    thickness = 0.5.dp
                )
                Spacer(modifier = Modifier.height(8.dp))
                if (tasks.isEmpty()) {
                    Text(
                        text = "暂无任务",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                } else {
                    tasks.forEach { node ->
                        val cmdText = if (node.commandParams.isEmpty()) node.command
                            else "${node.command}(${node.commandParams.joinToString(", ")})"
                        Text(
                            text = cmdText,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurface
                        )
                        Spacer(modifier = Modifier.height(2.dp))
                    }
                }
            }
        }
    }
}
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun WaypointCommandSidebar(
    waypoints: MutableList<ControlNode>,
    availableCommands: List<RobotCommandItem>,
    onWaypointUpdate: (Int, ControlNode) -> Unit,
    modifier: Modifier = Modifier
) {
    var expandedIndex by remember { mutableStateOf<Int?>(null) }

    Surface(
        modifier = modifier,
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.3f),
        shape = RoundedCornerShape(12.dp)
    ) {
        Column(
            modifier = Modifier.fillMaxSize().padding(8.dp)
        ) {
            Text(
                text = "路径点指令",
                style = MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onSurface,
                modifier = Modifier.padding(bottom = 4.dp)
            )
            HorizontalDivider(
                color = MaterialTheme.colorScheme.outlineVariant,
                thickness = 0.5.dp
            )
            Spacer(modifier = Modifier.height(4.dp))

            if (waypoints.isNotEmpty()) {
                LazyColumn(
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                    modifier = Modifier.fillMaxSize()
            ) {
                itemsIndexed(waypoints) { index, node ->
                    val isExpanded = expandedIndex == index
                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        colors = CardDefaults.cardColors(
                            containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.6f)
                        )
                    ) {
                        Column {
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clickable {
                                        expandedIndex = if (isExpanded) null else index
                                    }
                                    .padding(horizontal = 8.dp, vertical = 6.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Icon(
                                    imageVector = if (isExpanded) Icons.Default.KeyboardArrowDown
                                        else Icons.AutoMirrored.Filled.KeyboardArrowRight,
                                    contentDescription = null,
                                    modifier = Modifier.size(18.dp)
                                )
                                Spacer(modifier = Modifier.width(4.dp))
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(
                                        text = node.marker.ifBlank { "点 ${index + 1}" },
                                        style = MaterialTheme.typography.labelMedium,
                                        fontWeight = FontWeight.SemiBold
                                    )
                                    if (node.command.isNotBlank()) {
                                        Text(
                                            text = "⚡ ${node.command}",
                                            style = MaterialTheme.typography.bodySmall,
                                            color = UIConfig.WIN11_ACCENT
                                        )
                                    }
                                }
                            }

                            AnimatedVisibility(visible = isExpanded) {
                                Column(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(start = 8.dp, end = 8.dp, bottom = 8.dp)
                                ) {
                                    var filterText by remember(node) { mutableStateOf(node.command) }
                                    var dropdownExpanded by remember { mutableStateOf(false) }

                                    val filteredCommands = remember(filterText, availableCommands) {
                                        if (filterText.isBlank()) availableCommands
                                        else availableCommands.filter {
                                            it.name.lowercase().contains(filterText.lowercase())
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
                                            trailingIcon = {
                                                ExposedDropdownMenuDefaults.TrailingIcon(expanded = dropdownExpanded)
                                            },
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
                                            DropdownMenuItem(
                                                text = { Text("无") },
                                                onClick = {
                                                    if (node.command.isNotBlank()) {
                                                        onWaypointUpdate(index, node.copy(command = "", commandParams = emptyList()))
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
                                                filteredCommands.forEach { command ->
                                                    DropdownMenuItem(
                                                        text = { Text(command.name) },
                                                        onClick = {
                                                            if (node.command != command.name) {
                                                                onWaypointUpdate(index, node.copy(command = command.name, commandParams = emptyList()))
                                                            }
                                                            filterText = command.name
                                                            dropdownExpanded = false
                                                        }
                                                    )
                                                }
                                            }
                                        }
                                    }

                                    if (currentCommand != null && currentCommand.params.isNotEmpty()) {
                                        Spacer(modifier = Modifier.height(4.dp))
                                        currentCommand.params.forEachIndexed { paramIndex, paramType ->
                                            val paramValue = node.commandParams.getOrElse(paramIndex) { "" }
                                            if (paramType == "boolean") {
                                                val isChecked = paramValue.toBooleanStrictOrNull() ?: false
                                                Row(
                                                    verticalAlignment = Alignment.CenterVertically,
                                                    modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp)
                                                ) {
                                                    Checkbox(
                                                        checked = isChecked,
                                                        onCheckedChange = { checked ->
                                                            val updatedParams = node.commandParams.toMutableList()
                                                            while (updatedParams.size <= paramIndex) updatedParams.add("")
                                                            updatedParams[paramIndex] = checked.toString()
                                                            onWaypointUpdate(index, node.copy(commandParams = updatedParams))
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
                                                        while (updatedParams.size <= paramIndex) updatedParams.add("")
                                                        updatedParams[paramIndex] = newValue
                                                        onWaypointUpdate(index, node.copy(commandParams = updatedParams))
                                                    },
                                                    isError = hasError,
                                                    label = {
                                                        Text(currentCommand.paramNames.getOrElse(paramIndex) { "参数${paramIndex + 1}" } + " ($paramType)")
                                                    },
                                                    modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
                                                    singleLine = true,
                                                    textStyle = MaterialTheme.typography.bodySmall
                                                )
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
}

private fun isValidParamValue(value: String, typeName: String): Boolean {
    if (value.isBlank()) return false
    return when (typeName) {
        "double", "float" -> value.toDoubleOrNull() != null
        "int" -> value.toIntOrNull() != null
        "long" -> value.toLongOrNull() != null
        "short" -> value.toShortOrNull() != null
        "byte" -> value.toByteOrNull() != null
        "boolean" -> value.toBooleanStrictOrNull() != null
        else -> true
    }
}

@Composable
private fun ErrorTimeChart(xHistory: List<Double>, showLine: Boolean = false, modifier: Modifier = Modifier) {
    val textColor = MaterialTheme.colorScheme.onSurface
    val gridColor = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.4f)
    val axisColor = textColor.copy(alpha = 0.6f)
    val bgColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.3f)

    val yLabels = listOf("5", "4", "3", "2", "1", "0")
    val xLabels = listOf("0", "5", "10", "15", "20", "25", "30")

    Surface(
        modifier = modifier,
        color = bgColor,
        shape = RoundedCornerShape(12.dp)
    ) {
        Column(modifier = Modifier.fillMaxSize().padding(8.dp)) {
            Text(
                text = "路径误差(in) — 时间(s)",
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.SemiBold,
                color = textColor
            )
            Spacer(modifier = Modifier.height(4.dp))

            Row(
                modifier = Modifier.fillMaxSize()
            ) {
                Column(
                    horizontalAlignment = Alignment.End,
                    verticalArrangement = Arrangement.SpaceBetween,
                    modifier = Modifier
                        .fillMaxHeight()
                        .width(28.dp)
                        .padding(bottom = 16.dp, top = 2.dp)
                ) {
                    yLabels.forEach { label ->
                        Text(
                            text = label,
                            color = axisColor,
                            fontSize = 8.sp
                        )
                    }
                }

                Column(modifier = Modifier.weight(1f).fillMaxHeight()) {
                    Box(
                        modifier = Modifier
                            .weight(1f)
                            .fillMaxWidth()
                    ) {
                        Canvas(modifier = Modifier.matchParentSize()) {
                            val w = size.width
                            val h = size.height

                            // horizontal grid lines (0.2in intervals)
                            val ySteps = 30
                            for (i in 0..ySteps) {
                                val y = h * i / ySteps
                                drawLine(
                                    color = gridColor,
                                    start = Offset(0f, y),
                                    end = Offset(w, y),
                                    strokeWidth = 0.5f
                                )
                            }

                            // vertical grid lines (30s intervals)
                            val xSteps = 120
                            for (i in 0..xSteps) {
                                val x = w * i / xSteps
                                drawLine(
                                    color = gridColor,
                                    start = Offset(x, 0f),
                                    end = Offset(x, h),
                                    strokeWidth = 0.5f
                                )
                            }

                            // X axis
                            drawLine(
                                color = axisColor,
                                start = Offset(0f, h),
                                end = Offset(w, h),
                                strokeWidth = 1f
                            )

                            // Y axis
                            drawLine(
                                color = axisColor,
                                start = Offset(0f, 0f),
                                end = Offset(0f, h),
                                strokeWidth = 1f
                            )

                            // data line (only shown after collection is complete)
                            if (showLine && xHistory.size >= 2) {
                                val points = xHistory.mapIndexed { i, v ->
                                    val px = w * i / (xHistory.size - 1).coerceAtLeast(1)
                                    val py = (h - h * (v.toFloat() / 5f)).coerceIn(0f, h)
                                    Offset(px, py)
                                }
                                for (i in 0 until points.size - 1) {
                                    drawLine(
                                        color = androidx.compose.ui.graphics.Color(0xFF4FC3F7),
                                        start = points[i],
                                        end = points[i + 1],
                                        strokeWidth = 2f
                                    )
                                }
                            }
                        }

                        Row(
                            modifier = Modifier.fillMaxWidth().padding(top = 2.dp),
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            xLabels.forEach { label ->
                                Text(
                                    text = label,
                                    color = axisColor,
                                    fontSize = 8.sp
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}