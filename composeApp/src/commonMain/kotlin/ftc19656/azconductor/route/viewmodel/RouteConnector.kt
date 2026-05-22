package ftc19656.azconductor.route.viewmodel

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import ftc19656.azconductor.route.ControlNode
import ftc19656.azconductor.route.OrientedTrajectoryGenerator2D
import ftc19656.azconductor.route.RouteCore
import kotlinx.serialization.encodeToString
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json

class RouteConnector() : ViewModel() {

    // 底层纯逻辑实例
    private val routeLogic = RouteCore()

    // JSON 序列化配置
    private val jsonConfig = Json {
        prettyPrint = true
        encodeDefaults = true
        ignoreUnknownKeys = true
    }

    // UI 专用的版本号
    var pathVersion by mutableStateOf(0)
        private set

    // 维护一个 Compose 专用的 StateList 供 UI 观察
    private val _waypoints = mutableStateListOf<ControlNode>()
    val waypoints: List<ControlNode> get() = _waypoints

    // 派生数据直接从逻辑层获取（如果 UI 需要监听 trajectoryList 的变化，通常依靠 pathVersion 驱动即可）
    val trajectoryList: List<OrientedTrajectoryGenerator2D>
        get() = routeLogic.trajectoryList

    val lastPoint: ControlNode? get() = routeLogic.lastPoint
    val totalLength: Double get() = routeLogic.totalLength

    fun getTotalTime() = routeLogic.totalTime

    // --- 增删改查代理逻辑 ---

    fun addPoint(point: ControlNode) {
        routeLogic.addPoint(point)
        _waypoints.add(point)
        pathVersion++
    }

    fun setWaypoints(points: List<ControlNode>) {
        routeLogic.setWaypoints(points)
        _waypoints.clear()
        _waypoints.addAll(points)
        pathVersion++
    }

    fun moveNode(index: Int, newPoint: ControlNode) {
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

    fun moveNode(sourceNode: ControlNode, destinationNode: ControlNode) {
        val index = _waypoints.indexOfFirst { it isCloseTo sourceNode }
        if (index != -1) moveNode(index, destinationNode) // 复用重载方法同步状态
    }

    fun removeNode(point2D: ControlNode) {
        val index = _waypoints.indexOfFirst { it isCloseTo point2D }
        if (index != -1) removeNode(index) // 复用重载方法同步状态
    }

    // --- 查询与只读方法直接代理给逻辑层 ---

    fun getNodes(): List<ControlNode> = routeLogic.getNodes()

    fun getPointAtTime(time: Double): ControlNode? = routeLogic.getPointAtTime(time)

    override fun toString(): String = routeLogic.toString()

    fun getNodeAt(index: Int): ControlNode = routeLogic.getNodeAt(index)

    /**
     * 将当前路径导出为 JSON 字符串
     */
    fun exportToJson(): String {
        return jsonConfig.encodeToString(_waypoints.toList())
    }

    /**
     * 从 JSON 字符串导入路径
     */
    fun importFromJson(jsonText: String): Boolean {
        return try {
            val importedWaypoints = jsonConfig.decodeFromString<List<ControlNode>>(jsonText)
            setWaypoints(importedWaypoints)
            true
        } catch (e: Exception) {
            println("Import failed: ${e.message}")
            false
        }
    }
}
