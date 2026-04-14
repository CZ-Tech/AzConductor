package ftc19656.azconductor.back.route

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel

class RouteConnector(private var totalTime: Double) : ViewModel() {
    // 增加一个状态，专门用来通知 UI 路径已经更新
    var pathVersion by mutableStateOf(0)
        private set

    // 使用 Compose 提供的 State List，这样增删改会自动触发关联的 UI 重组
    // 不需要直接修改它，只需通过暴露的方法修改即可a
    private val _waypoints = mutableStateListOf<DifferentialPoint2D>()
    val waypoints: List<DifferentialPoint2D> get() = _waypoints

    // 2. 派生数据：轨迹列表
    val trajectoryList = mutableListOf<TrajectoryGenerator2D>()

    // 获取最后一个点
    val lastPoint: DifferentialPoint2D? get() = waypoints.lastOrNull()

    fun getTotalTime() = totalTime
    val totalLength: Double get() = trajectoryList.sumOf { it.length }


    // 根据 waypoints 重新构建整条轨迹
    private fun rebuildTrajectories() {
        trajectoryList.clear()
        if (waypoints.size < 2) return

        // 顺序生成轨迹段
        for (i in 0 until waypoints.lastIndex) {
            val start = waypoints[i]
            val end = waypoints[i + 1]
            // 时间先随便填，稍后重新分配
            trajectoryList.add(TrajectoryGenerator2D(start, end, 0.0, 0.0))
        }
        recalculateTimes()
        // 轨迹重新生成完毕，版本号 +1
        pathVersion++
    }

    private fun recalculateTimes() {
        if (totalLength == 0.0) return
        val totalLengthTemp = totalLength
        var currentTime = 0.0
        for (trajectory in trajectoryList) {
            trajectory.startTime = currentTime
            val timeCost = (trajectory.length / totalLengthTemp) * totalTime
            currentTime += timeCost
            trajectory.endTime = currentTime
        }
    }

    // --- 增删改查 ---

    fun addPoint(point: DifferentialPoint2D) {
        _waypoints.add(point)
        rebuildTrajectories()
    }

    fun moveNode(index: Int, newPoint: DifferentialPoint2D) {
        if (index in _waypoints.indices) {
            // 赋值一个全新复制的对象（触发 Compose 重组）
            _waypoints[index] = newPoint
            rebuildTrajectories()
        }
    }

    /**
     * 按索引删除节点
     * @throws IndexOutOfBoundsException 如果索引越界则抛出
     */
    fun removeNode(index: Int) {
        if (index in waypoints.indices) {
            _waypoints.removeAt(index)
            rebuildTrajectories()
        }
    }

    /**
     * 移动目标位置的节点（如果目标位置有两个点则只移动第一个）
     * 如果未找到则不会改变点集
     */
    fun moveNode(sourceNode: DifferentialPoint2D, destinationNode: DifferentialPoint2D) {
        // 使用 indexOfFirst 找到第一个匹配的点（如果有自交情况，建议还是改用 index 传参）
        val index = waypoints.indexOfFirst { it isCloseTo sourceNode }
        if (index != -1) moveNode(index, destinationNode)
    }

    /**
     * 删除目标点（如果目标位置有两个点则只删除第一个）
     * 如果没找到则不会改变点集，也不会异常
     */
    fun removeNode(point2D: DifferentialPoint2D) {
        val index = waypoints.indexOfFirst { it isCloseTo point2D }
        if (index != -1) removeNode(index)
    }

    // 获取所有点
    fun getNodes(): List<DifferentialPoint2D> = waypoints.toList()


    /**
     * 获取指定绝对时间点 t 的机器人坐标
     * 采用二分查找 (O(log N)) 定位轨迹段
     * @return 若列表为空则返回null
     * @throws IndexOutOfBoundsException 若超出时间范围
     */
     fun getPointAtTime(time: Double): Point2D? {
        // 如果没有轨迹，则null
        if (trajectoryList.isEmpty()) {
            return null
        }
        val epsilon = 1e-7
        if (time < -epsilon || time > totalTime + epsilon)  throw IndexOutOfBoundsException("Time out of range.")  // Fail-Fast
        val time = time.coerceIn(0.0, totalTime)

        // O(log N) 二分查找对应的轨迹段
        var low = 0
        var high = trajectoryList.lastIndex

        while (low <= high) {
            val mid = (low + high) / 2
            val traj = trajectoryList[mid]

            when {
                time < traj.startTime -> high = mid - 1   // 目标在左半边
                time > traj.endTime -> low = mid + 1      // 目标在右半边
                else -> {
                    // 命中！直接调用该段轨迹的局部时间计算
                    return traj.getPointAtTime(time)
                }
            }
        }

        // 理论上二分查找一定能命中，但为了防止极限情况下的浮点精度微小误差导致跳出循环
        // 直接返回最后一段轨迹的终点状态
        return trajectoryList.last().getPointAtTime(time)
    }

    override fun toString(): String {
        val stringBuilder = StringBuilder()
        var i = 0;
        for (trajectory in trajectoryList) {
            stringBuilder.append(i).append(": ").append("start: (x ", trajectory.startX, ", dx ", trajectory.startDx, ", ")
                .append("y: ", trajectory.startY, ", dy: ", trajectory.startDy, "), ")
                .append("end: (x ", trajectory.endX, ", dx ", trajectory.endDx, ", ")
                .append("y: ", trajectory.endY, ", dy: ", trajectory.endDy, "), ")
                .append("\n")
            i++
        }
        return stringBuilder.toString()
    }



}