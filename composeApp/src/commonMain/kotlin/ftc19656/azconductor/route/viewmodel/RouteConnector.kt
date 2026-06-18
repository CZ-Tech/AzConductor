package ftc19656.azconductor.route.viewmodel

import ftc19656.azconductor.AppContext
import ftc19656.azconductor.route.ControlNode
import ftc19656.azconductor.route.OrientedTrajectoryGenerator2D
import ftc19656.azconductor.route.RouteCore
import ftc19656.azconductor.route.RouteData
import ftc19656.azconductor.io.RouteRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

class RouteConnector(
    private val routeRepo: RouteRepository = AppContext.routeRepo,
) {

    // ---- Observable state ----

    private val _pathVersion = MutableStateFlow(0)
    val pathVersion: StateFlow<Int> = _pathVersion.asStateFlow()

    private val _currentRouteName = MutableStateFlow("默认路径")
    val currentRouteName: StateFlow<String> = _currentRouteName.asStateFlow()

    // ---- Internal model ----

    private val routeLogic = RouteCore()
    private val _waypoints = MutableStateFlow<List<ControlNode>>(emptyList())
    val waypoints: StateFlow<List<ControlNode>> = _waypoints.asStateFlow()

    private val _allRoutes = MutableStateFlow(listOf(RouteData(name = "默认路径")))

    /** Exposed for [SyncManager]'s local-routes provider callback. */
    internal val allRoutes: List<RouteData> get() = _allRoutes.value

    init {
        val loadedRoutes = routeRepo.loadAll()
        if (loadedRoutes.isNotEmpty()) {
            _allRoutes.value = loadedRoutes
            val first = loadedRoutes.first()
            _currentRouteName.value = first.name
            _waypoints.value = first.points
            routeLogic.setWaypoints(first.points)
        }
    }

    /**
     * Reload all local state from [routeRepo].  Called by [SyncManager]
     * after a conflict resolution mutates the repository.
     */
    internal fun reloadFromRepo() {
        val routes = routeRepo.loadAll()
        _allRoutes.value = routes

        val current = routes.find { it.name == _currentRouteName.value }
        if (current != null) {
            _waypoints.value = current.points
            routeLogic.setWaypoints(current.points)
        } else if (routes.isNotEmpty()) {
            val first = routes.first()
            _currentRouteName.value = first.name
            _waypoints.value = first.points
            routeLogic.setWaypoints(first.points)
        } else {
            _currentRouteName.value = ""
            _waypoints.value = emptyList()
            routeLogic.setWaypoints(emptyList())
        }
        _pathVersion.update { it + 1 }
    }

    val trajectoryList: List<OrientedTrajectoryGenerator2D>
        get() = routeLogic.trajectoryList

    val lastPoint: ControlNode? get() = routeLogic.lastPoint
    val totalLength: Double get() = routeLogic.totalLength

    fun getTotalTime() = routeLogic.totalTime

    // ---- Route management ----

    fun getRouteNames(): List<String> = _allRoutes.value.map { it.name }

    fun createRoute(name: String) {
        if (_allRoutes.value.any { it.name == name }) return
        _allRoutes.value = _allRoutes.value + RouteData(name = name)
        switchRoute(name)
    }

    fun switchRoute(name: String) {
        val route = _allRoutes.value.find { it.name == name } ?: return
        _currentRouteName.value = name
        _waypoints.value = route.points
        routeLogic.setWaypoints(route.points)
        _pathVersion.update { it + 1 }
    }

    fun deleteRoute(name: String) {
        _allRoutes.value = _allRoutes.value.filter { it.name != name }
        if (_allRoutes.value.isEmpty()) {
            _currentRouteName.value = ""
            _waypoints.value = emptyList()
            routeLogic.setWaypoints(emptyList())
            _pathVersion.update { it + 1 }
        } else if (_currentRouteName.value == name) {
            val next = _allRoutes.value.first()
            switchRoute(next.name)
        }
        // auto-saved by SyncManager timer
    }

    fun renameRoute(oldName: String, newName: String) {
        if (oldName == newName || _allRoutes.value.any { it.name == newName }) return
        _allRoutes.value = _allRoutes.value.map { if (it.name == oldName) it.copy(name = newName) else it }
        if (_currentRouteName.value == oldName) {
            _currentRouteName.value = newName
        }
        // auto-saved by SyncManager timer
    }

    fun moveRouteOrder(fromIndex: Int, toIndex: Int) {
        if (fromIndex !in _allRoutes.value.indices || toIndex !in _allRoutes.value.indices || fromIndex == toIndex) return
        _allRoutes.value = _allRoutes.value.toMutableList().apply {
            val item = removeAt(fromIndex)
            add(toIndex, item)
        }
        // auto-saved by SyncManager timer
    }

    // ---- In-memory sync ----
    // Persistence is handled externally by SyncManager's auto-save timer.

    /**
     * Copies the current route's waypoints into [_allRoutes] so that
     * [exportToJson] and the auto-save timer see the latest points.
     * Does NOT touch storage or network — pure in-memory operation.
     */
    private fun syncCurrentRoute() {
        val updated = _allRoutes.value.map { route ->
            if (route.name == _currentRouteName.value) route.copy(points = _waypoints.value.toList())
            else route
        }
        _allRoutes.value = updated
    }

    // ---- CRUD with auto-persist ----

    fun addPoint(point: ControlNode) {
        routeLogic.addPoint(point)
        _waypoints.value = _waypoints.value + point
        _pathVersion.update { it + 1 }
        syncCurrentRoute()
    }

    fun addPointAt(index: Int, point: ControlNode) {
        routeLogic.addPointAt(index, point)
        _waypoints.value = _waypoints.value.toMutableList().apply { add(index, point) }
        _pathVersion.update { it + 1 }
        syncCurrentRoute()
    }

    fun setWaypoints(points: List<ControlNode>) {
        routeLogic.setWaypoints(points)
        _waypoints.value = points
        _pathVersion.update { it + 1 }
        syncCurrentRoute()
    }

    fun moveNode(index: Int, newPoint: ControlNode) {
        routeLogic.moveNode(index, newPoint)
        if (index in _waypoints.value.indices) {
            _waypoints.value = _waypoints.value.toMutableList().apply { this[index] = newPoint }
            _pathVersion.update { it + 1 }
            syncCurrentRoute()
        }
    }

    fun moveNodeOrder(fromIndex: Int, toIndex: Int) {
        if (fromIndex !in _waypoints.value.indices || toIndex !in _waypoints.value.indices || fromIndex == toIndex) return
        routeLogic.moveNodeOrder(fromIndex, toIndex)
        _waypoints.value = _waypoints.value.toMutableList().apply {
            val node = removeAt(fromIndex)
            add(toIndex, node)
        }
        _pathVersion.update { it + 1 }
        syncCurrentRoute()
    }

    fun removeNode(index: Int) {
        routeLogic.removeNode(index)
        if (index in _waypoints.value.indices) {
            _waypoints.value = _waypoints.value.toMutableList().apply { removeAt(index) }
            _pathVersion.update { it + 1 }
            syncCurrentRoute()
        }
    }

    fun moveNode(sourceNode: ControlNode, destinationNode: ControlNode) {
        val index = _waypoints.value.indexOfFirst { it isCloseTo sourceNode }
        if (index != -1) moveNode(index, destinationNode)
    }

    fun removeNode(point2D: ControlNode) {
        val index = _waypoints.value.indexOfFirst { it isCloseTo point2D }
        if (index != -1) removeNode(index)
    }

    // ---- read-only delegation ----

    fun getNodes(): List<ControlNode> = routeLogic.getNodes()
    fun getPointAtTime(time: Double): ControlNode? = routeLogic.getPointAtTime(time)
    override fun toString(): String = routeLogic.toString()
    fun getNodeAt(index: Int): ControlNode = routeLogic.getNodeAt(index)

    // ---- export / import ----

    fun exportToJson(): String {
        syncCurrentRoute()
        return routeRepo.exportJson(_allRoutes.value)
    }

    fun importFromJson(jsonText: String): Boolean {
        val routes = routeRepo.importJson(jsonText) ?: return false
        if (routes.isEmpty()) return false
        _allRoutes.value = routes
        val first = routes.first()
        _currentRouteName.value = first.name
        _waypoints.value = first.points
        routeLogic.setWaypoints(first.points)
        _pathVersion.update { it + 1 }
        // auto-saved by SyncManager timer
        return true
    }
}
