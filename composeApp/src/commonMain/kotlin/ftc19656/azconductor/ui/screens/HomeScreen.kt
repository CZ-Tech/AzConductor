package ftc19656.azconductor.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import ftc19656.azconductor.UIConfig
import ftc19656.azconductor.route.viewmodel.RouteConnector

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(route: RouteConnector, onNavigateToPlanner: () -> Unit) {
    var routeNames by remember { mutableStateOf(route.getRouteNames()) }

    fun refreshRouteNames() {
        routeNames = route.getRouteNames()
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("路径管理") },
                navigationIcon = {
                    IconButton(onClick = { }) {
                        Icon(Icons.Default.Menu, contentDescription = "菜单")
                    }
                }
            )
        },
        floatingActionButton = {
            FloatingActionButton(onClick = {
                route.createRoute("新路径${routeNames.size + 1}")
                refreshRouteNames()
            }) {
                Icon(Icons.Default.Add, contentDescription = "新建路径")
            }
        }
    ) { paddingValues ->
        if (routeNames.isEmpty()) {
            Box(
                modifier = Modifier.fillMaxSize().padding(paddingValues),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    "暂无路径，点击右下角 + 新建",
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        } else {
            LazyVerticalGrid(
                columns = GridCells.Adaptive(UIConfig.PATH_CARD_SIZE_DIP.dp),
                modifier = Modifier
                    .fillMaxSize()
                    .padding(paddingValues)
                    .padding(8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                items(routeNames) { name ->
                    ElevatedCard(
                        onClick = {
                            route.switchRoute(name)
                            onNavigateToPlanner()
                        },
                        modifier = Modifier
                            .aspectRatio(1f)
                            .fillMaxWidth()
                    ) {
                        Box(
                            modifier = Modifier.fillMaxSize().padding(8.dp),
                            contentAlignment = Alignment.Center
                        ) {
                            Text(
                                text = name,
                                style = MaterialTheme.typography.titleSmall,
                                textAlign = TextAlign.Center
                            )
                        }
                    }
                }
            }
        }
    }
}
