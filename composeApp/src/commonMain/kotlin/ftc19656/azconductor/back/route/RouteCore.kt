package ftc19656.azconductor.back.route

class RouteCore(var totalTime: Double) {
    // 使用标准的 MutableList 存储点位
    private val _waypoints = mutableListOf<DifferentialPoint2D>()
    val waypoints: List<DifferentialPoint2D> get() = _waypoints

    // 轨迹列表
    val trajectoryList = mutableListOf<OrientedTrajectoryGenerator2D>()

    // 获取最后一个点
    val lastPoint: DifferentialPoint2D? get() = waypoints.lastOrNull()
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
            trajectoryList.add(OrientedTrajectoryGenerator2D(start, end, 0.0, 0.0))
        }
        recalculateTimes()
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

    fun addPoint(point: DifferentialPoint2D) {
        _waypoints.add(point)
        rebuildTrajectories()
    }

    fun moveNode(index: Int, newPoint: DifferentialPoint2D) {
        if (index in _waypoints.indices) {
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

    fun getNodes(): List<DifferentialPoint2D> = waypoints.toList()

    /**
     * 获取指定绝对时间点 t 的机器人坐标
     * 采用二分查找 (O(log N)) 定位轨迹段
     * @return 若列表为空则返回null
     * @throws IndexOutOfBoundsException 若超出时间范围
     */
    fun getPointAtTime(time: Double): Point2D? {
        if (trajectoryList.isEmpty()) {
            return null
        }
        val epsilon = 1e-7
        if (time < -epsilon || time > totalTime + epsilon) throw IndexOutOfBoundsException("Time out of range.")

        // 避免变量遮蔽，这里改用局部变量 coercedTime
        val coercedTime = time.coerceIn(0.0, totalTime)

        var low = 0
        var high = trajectoryList.lastIndex

        while (low <= high) {
            val mid = (low + high) / 2
            val traj = trajectoryList[mid]

            when {
                coercedTime < traj.startTime -> high = mid - 1
                coercedTime > traj.endTime -> low = mid + 1
                // 命中直接调用该段轨迹的局部时间计算
                else -> return traj.getPointAtTime(coercedTime)
            }
        }
        // 理论上二分查找一定能命中，但为了防止极限情况下的浮点精度微小误差导致跳出循环
        // 直接返回最后一段轨迹的终点状态
        return trajectoryList.last().getPointAtTime(coercedTime)
    }

    override fun toString(): String {
        val stringBuilder = StringBuilder()
        var i = 0
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

    fun getNodeAt(index: Int): DifferentialPoint2D {
        return _waypoints[index]
    }
}