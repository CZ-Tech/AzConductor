import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import ftc19656.azconductor.AppContext
import ftc19656.azconductor.route.viewmodel.RouteConnector
import ftc19656.azconductor.ui.dialogs.SyncConflictDialog
import ftc19656.azconductor.ui.components.AppDestination
import ftc19656.azconductor.ui.screens.CommandsScreen
import ftc19656.azconductor.ui.screens.HomeScreen
import ftc19656.azconductor.ui.screens.PathPlannerScreen
import ftc19656.azconductor.ui.theme.AzConductorTheme

/**
 * 导航抽屉目的地与页面路由之间的唯一映射。
 * 新增目的地时 `when` 必须补全，避免路由字符串散落在多个页面里。
 */
private fun AppDestination.toRoute(): String = when (this) {
    AppDestination.Paths -> "home"
    AppDestination.Run -> "commands"
}

@Composable
@Preview
fun App(route: RouteConnector = RouteConnector()) {
    var currentScreen by remember { mutableStateOf("home") }
    var showSettingsDialog by remember { mutableStateOf(false) }
    var dialogIpInput by remember { mutableStateOf(AppContext.syncManager.robotIp) }

    // 由当前路由反推抽屉选中项，页面不再各自维护 selectedDrawerItem。
    val currentDestination = when (currentScreen) {
        "commands" -> AppDestination.Run
        else -> AppDestination.Paths
    }

    val connectionStatus by AppContext.syncManager.connectionStatus.collectAsState()
    val syncConflict by AppContext.syncManager.conflictState.collectAsState()

    // Wire SyncManager callbacks and start periodic loops for the lifetime of the app.
    DisposableEffect(Unit) {
        AppContext.syncManager.onDataChanged = { route.reloadFromRepo() }
        AppContext.syncManager.localRoutesProvider = { route.allRoutes }
        AppContext.syncManager.start()
        onDispose {
            AppContext.syncManager.stop()
            AppContext.syncManager.onDataChanged = null
            AppContext.syncManager.localRoutesProvider = null
        }
    }

    AzConductorTheme {
        Column(modifier = Modifier.fillMaxSize()) {
            // Main content area: fills all remaining space above the status bar
            Box(modifier = Modifier.weight(1f).fillMaxWidth()) {
                when (currentScreen) {
                    "home" -> HomeScreen(
                        route = route,
                        selectedDestination = currentDestination,
                        onNavigate = { currentScreen = it.toRoute() },
                        onNavigateToPlanner = { currentScreen = "pathPlanner" }
                    )
                    "pathPlanner" -> PathPlannerScreen(
                        route,
                        onNavigateBack = { currentScreen = "home" }
                    )
                    "commands" -> CommandsScreen(
                        syncManager = AppContext.syncManager,
                        selectedDestination = currentDestination,
                        onNavigate = { currentScreen = it.toRoute() },
                    )
                }
            }

            // ---- Global bottom status bar ----
            Surface(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 32.dp),
                color = MaterialTheme.colorScheme.surfaceVariant,
                tonalElevation = 2.dp
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 6.dp, vertical = 4.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.Settings,
                        contentDescription = "设置",
                        modifier = Modifier
                            .size(20.dp)
                            .clickable { showSettingsDialog = true },
                        tint = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Spacer(Modifier.width(8.dp))
                    Text(
                        text = connectionStatus,
                        modifier = Modifier.weight(1f),
                        style = MaterialTheme.typography.labelSmall,
                        maxLines = 2,
                        color = when (connectionStatus) {
                            "连接失败", "未配置IP", "加载失败" -> Color.Red
                            "已保存", "已加载", "已连接" -> Color(0xFF4CAF50)
                            "已发送", "正在连接..." -> Color(0xFFFFA000)
                            else -> MaterialTheme.colorScheme.onSurfaceVariant
                        }
                    )
                }
            }
        }

        // ---- Settings dialog ----
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
                            placeholder = { Text("192.168.43.1") },
                            modifier = Modifier.fillMaxWidth()
                        )
                    }
                },
                confirmButton = {
                    TextButton(onClick = {
                        AppContext.syncManager.robotIp = dialogIpInput
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

        // ---- Sync conflict dialog (global, can appear on any screen) ----
        syncConflict?.let { conflict ->
            SyncConflictDialog(
                conflict = conflict,
                onKeepLocal = { AppContext.syncManager.resolveKeepLocal() },
                onKeepRemote = { AppContext.syncManager.resolveKeepRemote() },
                onKeepBoth = { AppContext.syncManager.resolveKeepBoth() }
            )
        }
    }
}
