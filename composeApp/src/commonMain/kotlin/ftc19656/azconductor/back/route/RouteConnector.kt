package ftc19656.azconductor.back.route

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel

class RouteConnector() : ViewModel() {

    // 底层纯逻辑实例
    private val routeLogic = RouteCore()

    // UI 专用的版本号
    var pathVersion by mutableStateOf(0)
        private set

    // 维护一个 Compose 专用的 StateList 供 UI 观察
    private val _waypoints = mutableStateListOf<DifferentialPoint2D>()
    val waypoints: List<DifferentialPoint2D> get() = _waypoints

    // 派生数据直接从逻辑层获取（如果 UI 需要监听 trajectoryList 的变化，通常依靠 pathVersion 驱动即可）
    val trajectoryList: List<OrientedTrajectoryGenerator2D>
        get() = routeLogic.trajectoryList

    val lastPoint: DifferentialPoint2D? get() = routeLogic.lastPoint
    val totalLength: Double get() = routeLogic.totalLength

    fun getTotalTime() = routeLogic.totalTime

    // --- 增删改查代理逻辑 ---

    fun addPoint(point: DifferentialPoint2D) {
        routeLogic.addPoint(point)
        _waypoints.add(point)
        pathVersion++
    }

    fun setWaypoints(points: List<DifferentialPoint2D>) {
        routeLogic.setWaypoints(points)
        _waypoints.clear()
        _waypoints.addAll(points)
        pathVersion++
    }

    fun moveNode(index: Int, newPoint: DifferentialPoint2D) {
        routeLogic.moveNode(index, newPoint)
        if (index in _waypoints.indices) {
            // 赋值触发 Compose 列表该元素的重组
            _waypoints[index] = newPoint
            pathVersion++
        }
    }

    fun removeNode(index: Int) {
        routeLogic.removeNode(index)
        if (index in _waypoints.indices) {
            _waypoints.removeAt(index)
            pathVersion++
        }
    }

    fun moveNode(sourceNode: DifferentialPoint2D, destinationNode: DifferentialPoint2D) {
        val index = _waypoints.indexOfFirst { it isCloseTo sourceNode }
        if (index != -1) moveNode(index, destinationNode) // 复用重载方法同步状态
    }

    fun removeNode(point2D: DifferentialPoint2D) {
        val index = _waypoints.indexOfFirst { it isCloseTo point2D }
        if (index != -1) removeNode(index) // 复用重载方法同步状态
    }

    // --- 查询与只读方法直接代理给逻辑层 ---

    fun getNodes(): List<DifferentialPoint2D> = routeLogic.getNodes()

    fun getPointAtTime(time: Double): Point2D? = routeLogic.getPointAtTime(time)

    override fun toString(): String = routeLogic.toString()

    fun getNodeAt(index: Int): DifferentialPoint2D = routeLogic.getNodeAt(index)
}