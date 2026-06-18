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
import ftc19656.azconductor.ui.screens.CommandsScreen
import ftc19656.azconductor.ui.screens.HomeScreen
import ftc19656.azconductor.ui.screens.PathPlannerScreen
import ftc19656.azconductor.ui.theme.AzConductorTheme

@Composable
@Preview
fun App(route: RouteConnector = RouteConnector()) {
    var currentScreen by remember { mutableStateOf("home") }
    var showSettingsDialog by remember { mutableStateOf(false) }
    var dialogIpInput by remember { mutableStateOf(AppContext.syncManager.robotIp) }

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
                        onNavigateToPlanner = { currentScreen = "pathPlanner" },
                        onNavigateToCommands = { currentScreen = "commands" }
                    )
                    "pathPlanner" -> PathPlannerScreen(
                        route,
                        onNavigateBack = { currentScreen = "home" }
                    )
                    "commands" -> CommandsScreen(
                        route = route,
                        syncManager = AppContext.syncManager,
                        onNavigateBack = { currentScreen = "home" }
                    )
                }
            }

            // ---- Global bottom status bar ----
            Surface(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(24.dp),
                color = MaterialTheme.colorScheme.surfaceVariant,
                tonalElevation = 2.dp
            ) {
                Box(
                    contentAlignment = Alignment.Center,
                    modifier = Modifier.fillMaxWidth()
                ) {
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
                        text = connectionStatus,
                        style = MaterialTheme.typography.labelSmall,
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
