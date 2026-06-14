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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex
import azconductor.composeapp.generated.resources.FTC_MAP26
import azconductor.composeapp.generated.resources.Res
import ftc19656.azconductor.route.viewmodel.CommandsViewModel
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

    // ---- Commands-scoped ViewModel (robot path list) ----
    val commandsViewModel = remember { CommandsViewModel(route) }
    val robotPaths by commandsViewModel.robotPaths.collectAsState()
    var selectedRobotPath by remember { mutableStateOf("") }
    var pathDropdownExpanded by remember { mutableStateOf(false) }
    var searchQuery by remember { mutableStateOf("") }

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

                    Image(
                        painter = painterResource(Res.drawable.FTC_MAP26),
                        contentDescription = "场地地图",
                        contentScale = ContentScale.FillHeight,
                        modifier = Modifier.height(mapHeight)
                    )
                }

                // ---- Top-left: menu button + robot path selector ----
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
                }
            }
        }
    }
}