package ftc19656.azconductor.ui.screens

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
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
import ftc19656.azconductor.io.network.OpModeDescriptorDto
import ftc19656.azconductor.route.ControlNode
import ftc19656.azconductor.route.RouteCore
import ftc19656.azconductor.route.viewmodel.CommandsViewModel
import ftc19656.azconductor.route.viewmodel.RouteConnector
import ftc19656.azconductor.ui.components.RobotComponent
import ftc19656.azconductor.ui.coerceInDp
import ftc19656.azconductor.ui.responsiveLayout
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
    val opModes by commandsViewModel.opModes.collectAsState()
    var selectedOpMode by remember { mutableStateOf("") }

    // ---- OpMode status & robot position (pushed by Network V2 SSE) ----
    val opModeStatus by commandsViewModel.opModeStatus.collectAsState()
    val robotPosition by commandsViewModel.robotPosition.collectAsState()
    val opModeActionStatus by commandsViewModel.opModeActionStatus.collectAsState()

    // 地图像素尺寸（onSizeChanged 回调更新）
    var mapPixelSize by remember { mutableStateOf(IntSize.Zero) }

    // 可编辑的本地路径点副本，切换路径时重置
    val editableWaypoints = remember { mutableStateListOf<ControlNode>() }

    val availableCommands by AppContext.syncManager.availableCommands.collectAsState()

    LaunchedEffect(opModeStatus.activeOpModeName) {
        opModeStatus.activeOpModeName?.let { selectedOpMode = it }
    }

    LaunchedEffect(opModeActionStatus) {
        val message = opModeActionStatus
        if (message != null && !message.startsWith("正在")) {
            delay(5000)
            commandsViewModel.clearOpModeActionStatus()
        }
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
        Scaffold { paddingValues ->
            BoxWithConstraints(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(paddingValues)
            ) {
                val responsive = responsiveLayout(maxWidth, maxHeight)
                val availableHeight = maxHeight
                val gutter = if (responsive.compact) 6.dp else 10.dp
                val gap = if (responsive.compact) 6.dp else 10.dp
                val sideWidth = (maxWidth * 0.24f).coerceInDp(230.dp, 330.dp)
                val chartWidth = (maxWidth * 0.24f).coerceInDp(250.dp, 360.dp)

                val errorHistory = remember { mutableStateListOf<Double>() }

                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(horizontal = gutter, vertical = 4.dp),
                    verticalArrangement = Arrangement.spacedBy(gap)
                ) {
                    Surface(
                        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.35f),
                        shape = RoundedCornerShape(8.dp)
                    ) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 4.dp, vertical = 2.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Row(
                                modifier = Modifier
                                    .weight(1f)
                                    .horizontalScroll(rememberScrollState()),
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                IconButton(
                                    onClick = { scope.launch { drawerState.open() } },
                                    modifier = Modifier.size(36.dp)
                                ) {
                                    Icon(
                                        Icons.Default.Menu,
                                        contentDescription = "菜单",
                                        modifier = Modifier.size(20.dp)
                                    )
                                }

                                OpModeLifecycleControls(
                                    status = opModeStatus,
                                    opModes = opModes,
                                    selectedName = selectedOpMode,
                                    actionStatus = opModeActionStatus,
                                    onSelected = { selectedOpMode = it },
                                    onInit = {
                                        scope.launch { commandsViewModel.initOpMode(selectedOpMode) }
                                    },
                                    onStart = {
                                        scope.launch { commandsViewModel.startOpMode() }
                                    },
                                    onStop = {
                                        scope.launch { commandsViewModel.stopOpMode() }
                                    },
                                    modifier = Modifier
                                )
                            }

                            PositionReadout(
                                robotPosition = robotPosition,
                                modifier = Modifier.padding(start = 10.dp, end = 4.dp)
                            )
                        }
                    }

                    if (responsive.compact) {
                        Column(
                            modifier = Modifier
                                .weight(1f)
                                .fillMaxWidth()
                                .verticalScroll(rememberScrollState()),
                            verticalArrangement = Arrangement.spacedBy(gap)
                        ) {
                            RunFieldMap(
                                waypoints = editableWaypoints,
                                robotPosition = robotPosition,
                                mapPixelSize = mapPixelSize,
                                onMapPixelSizeChanged = { mapPixelSize = it },
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .aspectRatio(
                                        FieldConfig.CANVAS_LOGICAL_WIDTH /
                                            FieldConfig.CANVAS_LOGICAL_HEIGHT
                                    )
                            )
                            WaypointCommandSidebar(
                                waypoints = editableWaypoints,
                                availableCommands = availableCommands,
                                onWaypointUpdate = { index, newPoint ->
                                    editableWaypoints[index] = newPoint
                                },
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .height(320.dp)
                            )
                            TaskListPanel(
                                waypoints = editableWaypoints,
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .height(190.dp)
                            )
                            ErrorTimeChart(
                                xHistory = errorHistory,
                                showLine = errorHistory.isNotEmpty(),
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .height(220.dp)
                            )
                        }
                    } else {
                        Row(
                            modifier = Modifier
                                .weight(1f)
                                .fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(gap)
                        ) {
                            Column(
                                modifier = Modifier
                                    .width(sideWidth)
                                    .fillMaxHeight(),
                                verticalArrangement = Arrangement.spacedBy(gap)
                            ) {
                                WaypointCommandSidebar(
                                    waypoints = editableWaypoints,
                                    availableCommands = availableCommands,
                                    onWaypointUpdate = { index, newPoint ->
                                        editableWaypoints[index] = newPoint
                                    },
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .weight(0.62f)
                                )
                                TaskListPanel(
                                    waypoints = editableWaypoints,
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .weight(0.38f)
                                )
                            }

                            Column(
                                modifier = Modifier
                                    .weight(1f)
                                    .fillMaxHeight(),
                                verticalArrangement = Arrangement.spacedBy(gap)
                            ) {
                                RunFieldMap(
                                    waypoints = editableWaypoints,
                                    robotPosition = robotPosition,
                                    mapPixelSize = mapPixelSize,
                                    onMapPixelSizeChanged = { mapPixelSize = it },
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .weight(1f)
                                )

                                if (!responsive.expanded) {
                                    ErrorTimeChart(
                                        xHistory = errorHistory,
                                        showLine = errorHistory.isNotEmpty(),
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .height(
                                                (availableHeight * 0.24f)
                                                    .coerceInDp(150.dp, 230.dp)
                                            )
                                    )
                                }

                            }

                            if (responsive.expanded) {
                                Column(
                                    modifier = Modifier
                                        .width(chartWidth)
                                        .fillMaxHeight(),
                                    verticalArrangement = Arrangement.Bottom
                                ) {
                                    ErrorTimeChart(
                                        xHistory = errorHistory,
                                        showLine = errorHistory.isNotEmpty(),
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .height(
                                                (availableHeight * 0.32f)
                                                    .coerceInDp(200.dp, 320.dp)
                                            )
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

@Composable
private fun RunFieldMap(
    waypoints: List<ControlNode>,
    robotPosition: RobotPositionResponse?,
    mapPixelSize: IntSize,
    onMapPixelSizeChanged: (IntSize) -> Unit,
    modifier: Modifier = Modifier,
) {
    BoxWithConstraints(modifier = modifier) {
        val fieldSize = minOf(maxWidth, maxHeight)
        Box(
            modifier = Modifier
                .size(fieldSize)
                .align(Alignment.Center)
                .onSizeChanged(onMapPixelSizeChanged)
        ) {
            Image(
                painter = painterResource(Res.drawable.FTC_MAP26),
                contentDescription = "场地地图",
                contentScale = ContentScale.Fit,
                modifier = Modifier.matchParentSize()
            )

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
                    waypoints = waypoints,
                    mapper = mapper,
                    modifier = Modifier.matchParentSize()
                )
                RobotPositionOverlay(
                    robotPosition = robotPosition,
                    mapper = mapper
                )
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

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun OpModeLifecycleControls(
    status: OpModeStatusResponse,
    opModes: List<OpModeDescriptorDto>,
    selectedName: String,
    actionStatus: String?,
    onSelected: (String) -> Unit,
    onInit: () -> Unit,
    onStart: () -> Unit,
    onStop: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var expanded by remember { mutableStateOf(false) }
    val selectedIsAutonomous = opModes.any { it.name == selectedName }
    val activeIsAutonomous = opModes.any { it.name == status.activeOpModeName }

    val phaseColor = when (status.phase) {
        "RUNNING" -> Color(0xFF4CAF50)
        "INIT" -> Color(0xFFFFC107)
        else -> Color(0xFF9E9E9E)
    }
    val phaseText = when (status.phase) {
        "RUNNING" -> (status.activeOpModeName ?: "?") + " · RUNNING"
        "INIT" -> (status.activeOpModeName ?: "?") + " · INIT"
        else -> "STOPPED"
    }

    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        modifier = modifier,
    ) {
        ExposedDropdownMenuBox(
            expanded = expanded,
            onExpandedChange = {
                if (status.controllerAvailable) expanded = it
            },
        ) {
            OutlinedTextField(
                value = selectedName,
                onValueChange = {},
                readOnly = true,
                enabled = status.controllerAvailable,
                placeholder = {
                    Text(
                        "选择 Autonomous",
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                },
                trailingIcon = {
                    ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded)
                },
                singleLine = true,
                textStyle = MaterialTheme.typography.bodyMedium,
                modifier = Modifier
                    .menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable)
                    .width(220.dp),
            )
            ExposedDropdownMenu(
                expanded = expanded,
                onDismissRequest = { expanded = false },
            ) {
                if (opModes.isEmpty()) {
                    DropdownMenuItem(
                        text = { Text("无可用 Autonomous") },
                        enabled = false,
                        onClick = {},
                    )
                } else {
                    opModes.forEach { opMode ->
                        DropdownMenuItem(
                            text = {
                                Column {
                                    Text(opMode.name)
                                    if (opMode.group.isNotBlank()) {
                                        Text(
                                            opMode.group,
                                            style = MaterialTheme.typography.labelSmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        )
                                    }
                                }
                            },
                            onClick = {
                                onSelected(opMode.name)
                                expanded = false
                            },
                        )
                    }
                }
            }
        }

        Button(
            onClick = onInit,
            enabled = status.controllerAvailable
                && status.phase == "STOPPED"
                && selectedIsAutonomous,
            contentPadding = PaddingValues(horizontal = 12.dp),
            modifier = Modifier.height(40.dp),
        ) {
            Text("INIT")
        }

        Button(
            onClick = onStart,
            enabled = status.controllerAvailable
                && status.phase == "INIT"
                && activeIsAutonomous
                && status.activeOpModeName == selectedName,
            contentPadding = PaddingValues(horizontal = 12.dp),
            modifier = Modifier.height(40.dp),
        ) {
            Text("START")
        }

        Button(
            onClick = onStop,
            enabled = status.controllerAvailable
                && status.phase != "STOPPED"
                && activeIsAutonomous
                && status.activeOpModeName != null,
            contentPadding = PaddingValues(horizontal = 12.dp),
            modifier = Modifier.height(40.dp),
        ) {
            Text("STOP")
        }

        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            modifier = Modifier
                .clip(RoundedCornerShape(10.dp))
                .background(phaseColor.copy(alpha = 0.15f))
                .padding(horizontal = 8.dp, vertical = 4.dp),
        ) {
            Icon(
                Icons.Default.Circle,
                contentDescription = null,
                tint = phaseColor,
                modifier = Modifier.size(8.dp),
            )
            Text(
                if (status.controllerAvailable) phaseText else "OpMode 控制不可用",
                color = phaseColor,
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.Medium,
                maxLines = 1,
            )
        }

        actionStatus?.let {
            Text(
                it,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
private fun PositionReadout(
    robotPosition: RobotPositionResponse?,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier
            .clip(RoundedCornerShape(10.dp))
            .background(MaterialTheme.colorScheme.surface.copy(alpha = 0.75f))
            .padding(horizontal = 10.dp, vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        if (robotPosition != null && robotPosition.status == "ok") {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(
                    "X: ${robotPosition.x.toFixed(1)}",
                    color = MaterialTheme.colorScheme.onSurface,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Medium
                )
                Text(
                    "Y: ${robotPosition.y.toFixed(1)}",
                    color = MaterialTheme.colorScheme.onSurface,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Medium
                )
                Text(
                    "H: ${robotPosition.heading.toFixed(1)}°",
                    color = MaterialTheme.colorScheme.onSurface,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Medium
                )
            }
        } else {
            Text(
                "位置: --",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                fontSize = 11.sp
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
