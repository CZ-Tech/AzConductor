package ftc19656.azconductor.route

class RouteCore() {
    // 使用标准 MutableList 存储点位
    private val _waypoints = mutableListOf<DifferentialPoint2D>()
    val waypoints: List<DifferentialPoint2D> get() = _waypoints

    // 轨迹列表
    val trajectoryList = mutableListOf<OrientedTrajectoryGenerator2D>()

    // 获取最后一个点
    val lastPoint: DifferentialPoint2D? get() = waypoints.lastOrNull()
    val totalLength: Double get() = trajectoryList.sumOf { it.length }
    val totalTime: Double get() = trajectoryList.sumOf { it.duration }

    // 根据 waypoints 重新构建整条轨迹
    private fun rebuildTrajectories() {
        trajectoryList.clear()
        if (waypoints.size < 2) return
        // 顺序生成轨迹
        for (i in 0 until waypoints.lastIndex) {
            val start = waypoints[i]
            val end = waypoints[i + 1]
            // 使用 end 点的 duration 作为轨迹段的持续时间
            trajectoryList.add(OrientedTrajectoryGenerator2D(start, end, end.duration))
        }
    }

    fun addPoint(point: DifferentialPoint2D) {
        _waypoints.add(point)
        rebuildTrajectories()
    }

    fun setWaypoints(points: List<DifferentialPoint2D>) {
        _waypoints.clear()
        _waypoints.addAll(points)
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
     * 获取指定绝对时间 t 的机器人坐标
     * @return 若列表为空则返回 null
     * @throws IndexOutOfBoundsException 若超出时间范围
     */
    fun getPointAtTime(time: Double): DifferentialPoint2D? {
        if (_waypoints.isEmpty()) return null
        if (trajectoryList.isEmpty()) return _waypoints.first()

        val totalTime = this.totalTime
        val epsilon = 1e-7
        if (time < -epsilon || time > totalTime + epsilon) throw IndexOutOfBoundsException("Time out of range.")

        val coercedTime = time.coerceIn(0.0, totalTime)

        var accumulatedTime = 0.0
        for (traj in trajectoryList) {
            val nextAccumulatedTime = accumulatedTime + traj.duration
            if (coercedTime <= nextAccumulatedTime) {
                val localTime = coercedTime - accumulatedTime
                return traj.getPointAtTime(localTime)
            }
            accumulatedTime = nextAccumulatedTime
        }
        // 理论上循环一定能命中，但为了防止极限情况下的浮点精度微小误差导致跳出循环
        // 直接返回最后一段轨迹的终点状态
        return trajectoryList.last().getPointAtTime(trajectoryList.last().duration)
    }


    // 移除 updateTrajectoryDuration 方法，因为 duration 现在是 DifferentialPoint2D 的属性

    override fun toString(): String {
        val stringBuilder = StringBuilder()
        var i = 0
        for (trajectory in trajectoryList) {
            stringBuilder.append(i).append(": ").append("start: (x ").append(trajectory.startX).append(", dx ").append(trajectory.startDx).append(", ")
                .append("y: ").append(trajectory.startY).append(", dy: ").append(trajectory.startDy).append("), ")
                .append("end: (x ").append(trajectory.endX).append(", dx ").append(trajectory.endDx).append(", ")
                .append("y: ").append(trajectory.endY).append(", dy: ").append(trajectory.endDy).append("), ")
                .append("\n")
            i++
        }
        return stringBuilder.toString()
    }

    fun getNodeAt(index: Int): DifferentialPoint2D {
        return _waypoints[index]
    }
}
