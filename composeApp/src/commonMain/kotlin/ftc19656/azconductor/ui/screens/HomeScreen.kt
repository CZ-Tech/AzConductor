package ftc19656.azconductor.ui.screens

import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInParent
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex
import ftc19656.azconductor.UIConfig
import ftc19656.azconductor.route.viewmodel.RouteConnector

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(route: RouteConnector, onNavigateToPlanner: () -> Unit) {
    var routeNames by remember(route.pathVersion) { mutableStateOf(route.getRouteNames()) }

    // New route dialog
    var showCreateDialog by remember { mutableStateOf(false) }
    var newRouteName by remember { mutableStateOf("") }

    // Rename dialog
    var renameTarget by remember { mutableStateOf<String?>(null) }
    var renameText by remember { mutableStateOf("") }

    // Delete confirmation dialog
    var deleteTarget by remember { mutableStateOf<String?>(null) }

    // Drag state
    var draggedIndex by remember { mutableStateOf<Int?>(null) }
    var dragOffset by remember { mutableStateOf(Offset.Zero) }
    var itemRects by remember { mutableStateOf(mapOf<Int, Rect>()) }

    fun refreshRouteNames() {
        routeNames = route.getRouteNames()
    }

    fun computeDropTarget(): Int? {
        val src = draggedIndex ?: return null
        val srcRect = itemRects[src] ?: return null
        val targetCenter = Offset(
            srcRect.center.x + dragOffset.x,
            srcRect.center.y + dragOffset.y
        )
        return itemRects.entries
            .filter { it.key != src }
            .minByOrNull { (_, r) -> (targetCenter - r.center).getDistance() }
            ?.key
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
                newRouteName = ""
                showCreateDialog = true
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
            val cardSizeDp = UIConfig.PATH_CARD_SIZE_DIP.dp
            val spacingDp = 8.dp

            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(paddingValues)
                    .padding(8.dp)
                    .verticalScroll(rememberScrollState())
            ) {
                FlowRow(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(spacingDp),
                    verticalArrangement = Arrangement.spacedBy(spacingDp)
                ) {
                    routeNames.forEachIndexed { index, name ->
                        val isDragging = draggedIndex == index

                        Box(
                            modifier = Modifier
                                .size(cardSizeDp)
                                .zIndex(if (isDragging) 2f else 1f)
                                .then(
                                    if (isDragging) Modifier.shadow(8.dp) else Modifier
                                )
                                .graphicsLayer {
                                    if (isDragging) {
                                        translationX = dragOffset.x
                                        translationY = dragOffset.y
                                        scaleX = 1.06f
                                        scaleY = 1.06f
                                    }
                                }
                                .onGloballyPositioned { coords ->
                                    val pos = coords.positionInParent()
                                    val size = coords.size
                                    itemRects = itemRects + (index to Rect(
                                        left = pos.x,
                                        top = pos.y,
                                        right = pos.x + size.width,
                                        bottom = pos.y + size.height
                                    ))
                                }
                                .pointerInput(index) {
                                    detectDragGesturesAfterLongPress(
                                        onDragStart = {
                                            draggedIndex = index
                                            dragOffset = Offset.Zero
                                        },
                                        onDrag = { change, dragAmount ->
                                            change.consume()
                                            dragOffset += Offset(dragAmount.x, dragAmount.y)
                                            val target = computeDropTarget()
                                            if (target != null && target != index) {
                                                route.moveRouteOrder(index, target)
                                                refreshRouteNames()
                                                draggedIndex = target
                                                dragOffset = Offset.Zero
                                                itemRects = emptyMap()
                                            }
                                        },
                                        onDragEnd = {
                                            draggedIndex = null
                                            dragOffset = Offset.Zero
                                            itemRects = emptyMap()
                                        },
                                        onDragCancel = {
                                            draggedIndex = null
                                            dragOffset = Offset.Zero
                                            itemRects = emptyMap()
                                        }
                                    )
                                }
                        ) {
                            ElevatedCard(
                                onClick = {
                                    if (draggedIndex == null) {
                                        route.switchRoute(name)
                                        onNavigateToPlanner()
                                    }
                                },
                                modifier = Modifier.fillMaxSize()
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
                                    // Delete button
                                    IconButton(
                                        onClick = { deleteTarget = name },
                                        modifier = Modifier
                                            .align(Alignment.TopStart)
                                            .size(24.dp)
                                    ) {
                                        Icon(
                                            Icons.Default.Delete,
                                            contentDescription = "删除",
                                            modifier = Modifier.size(14.dp)
                                        )
                                    }
                                    IconButton(
                                        onClick = {
                                            renameTarget = name
                                            renameText = name
                                        },
                                        modifier = Modifier
                                            .align(Alignment.TopEnd)
                                            .size(24.dp)
                                    ) {
                                        Icon(
                                            Icons.Default.Edit,
                                            contentDescription = "改名",
                                            modifier = Modifier.size(14.dp)
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

    // New route name dialog
    if (showCreateDialog) {
        AlertDialog(
            onDismissRequest = { showCreateDialog = false },
            title = { Text("新建路径") },
            text = {
                OutlinedTextField(
                    value = newRouteName,
                    onValueChange = { newRouteName = it },
                    singleLine = true,
                    placeholder = { Text("输入路径名称") },
                    modifier = Modifier.fillMaxWidth()
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        if (newRouteName.isNotBlank()) {
                            route.createRoute(newRouteName)
                            refreshRouteNames()
                            showCreateDialog = false
                        }
                    }
                ) {
                    Text("确定")
                }
            },
            dismissButton = {
                TextButton(onClick = { showCreateDialog = false }) {
                    Text("取消")
                }
            }
        )
    }

    // Rename dialog
    if (renameTarget != null) {
        AlertDialog(
            onDismissRequest = { renameTarget = null },
            title = { Text("重命名路径") },
            text = {
                OutlinedTextField(
                    value = renameText,
                    onValueChange = { renameText = it },
                    singleLine = true,
                    placeholder = { Text("输入新名称") },
                    modifier = Modifier.fillMaxWidth()
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        if (renameText.isNotBlank()) {
                            route.renameRoute(renameTarget!!, renameText)
                            refreshRouteNames()
                        }
                        renameTarget = null
                    }
                ) {
                    Text("确定")
                }
            },
            dismissButton = {
                TextButton(onClick = { renameTarget = null }) {
                    Text("取消")
                }
            }
        )
    }

    // Delete confirmation dialog
    if (deleteTarget != null) {
        AlertDialog(
            onDismissRequest = { deleteTarget = null },
            title = { Text("删除路径") },
            text = { Text("确定要删除路径「${deleteTarget}」吗？此操作不可撤销。") },
            confirmButton = {
                TextButton(
                    onClick = {
                        route.deleteRoute(deleteTarget!!)
                        refreshRouteNames()
                        deleteTarget = null
                    }
                ) {
                    Text("删除", color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = {
                TextButton(onClick = { deleteTarget = null }) {
                    Text("取消")
                }
            }
        )
    }
}
