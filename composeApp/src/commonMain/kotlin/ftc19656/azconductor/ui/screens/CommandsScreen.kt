package ftc19656.azconductor.ui.screens

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex
import azconductor.composeapp.generated.resources.FTC_MAP26
import azconductor.composeapp.generated.resources.Res
import ftc19656.azconductor.route.viewmodel.RouteConnector
import ftc19656.azconductor.ui.components.PlaybackProgressBar
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.jetbrains.compose.resources.painterResource

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CommandsScreen(route: RouteConnector, onNavigateBack: () -> Unit) {
    val drawerState = rememberDrawerState(initialValue = DrawerValue.Closed)
    var selectedDrawerItem by remember { mutableStateOf("运行") }
    val scope = rememberCoroutineScope()

    // Playback state
    var currentTime by remember { mutableStateOf(0f) }
    var isPlaying by remember { mutableStateOf(false) }
    val totalTime = route.getTotalTime().toFloat()
    val maxTime = maxOf(totalTime, 0.001f)

    LaunchedEffect(totalTime) {
        currentTime = currentTime.coerceIn(0f, maxTime)
        if (totalTime <= 0f) isPlaying = false
    }

    LaunchedEffect(isPlaying, totalTime) {
        while (isPlaying && totalTime > 0f) {
            delay(16)
            currentTime = (currentTime + 0.016f).coerceAtMost(totalTime)
            if (currentTime >= totalTime) isPlaying = false
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
        Scaffold {
            BoxWithConstraints(
                modifier = Modifier
                    .fillMaxSize()
            ) {
                val mapHeight = maxHeight * 2f / 3f

                Row(
                    modifier = Modifier.fillMaxSize(),
                    horizontalArrangement = Arrangement.End,
                    verticalAlignment = Alignment.Top
                ) {
                    // Vertical progress bar — same height as map
                    PlaybackProgressBar(
                        currentTime = currentTime,
                        totalTime = totalTime,
                        onValueChange = {
                            currentTime = it
                            isPlaying = false
                        },
                        isPlaying = isPlaying,
                        onPlayPauseToggle = {
                            if (!isPlaying && currentTime >= totalTime) currentTime = 0f
                            isPlaying = !isPlaying
                        },
                        isVertical = true,
                        modifier = Modifier.height(mapHeight).width(60.dp)
                    )

                    Spacer(modifier = Modifier.width(8.dp))

                    // Field map — height = 2/3 screen, width from aspect ratio
                    Image(
                        painter = painterResource(Res.drawable.FTC_MAP26),
                        contentDescription = "场地地图",
                        contentScale = ContentScale.FillHeight,
                        modifier = Modifier.height(mapHeight)
                    )
                }

                // Floating menu button on top of the map
                IconButton(
                    onClick = { scope.launch { drawerState.open() } },
                    modifier = Modifier
                        .align(Alignment.TopStart)
                        .padding(4.dp)
                        .size(36.dp)
                        .zIndex(2f)
                ) {
                    Icon(
                        Icons.Default.Menu,
                        contentDescription = "菜单",
                        modifier = Modifier.size(22.dp)
                    )
                }
            }
        }
    }
}
