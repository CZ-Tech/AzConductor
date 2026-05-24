package ftc19656.azconductor.route

class RouteCore() {
    // 使用标准 MutableList 存储点位
    private val _waypoints = mutableListOf<ControlNode>()
    val waypoints: List<ControlNode> get() = _waypoints

    // 轨迹列表
    val trajectoryList = mutableListOf<OrientedTrajectoryGenerator2D>()

    // 获取最后一个点
    val lastPoint: ControlNode? get() = waypoints.lastOrNull()
    val totalLength: Double get() = trajectoryList.sumOf { it.length }
    val totalTime: Double
        get() = trajectoryList.indices.sumOf { index ->
            trajectoryList[index].duration.coerceAtLeast(0.0) + arrivalDelayForTrajectory(index)
        }

    private fun arrivalDelayForTrajectory(index: Int): Double {
        return _waypoints.getOrNull(index + 1)?.delayAfterArrive?.coerceAtLeast(0.0) ?: 0.0
    }

    // 根据 waypoints 重新构建整条轨迹
    private fun rebuildTrajectories() {
        trajectoryList.clear()
        if (waypoints.size < 2) return
        // 顺序生成轨迹
        for (i in 0 until waypoints.lastIndex) {
            val start = waypoints[i]
            val end = waypoints[i + 1]
            // 使用 end 点的 duration 作为轨迹段的持续时间
            trajectoryList.add(
                OrientedTrajectoryGenerator2D(
                    start = DifferentialPoint2D(
                        x = start.x,
                        dx = start.dx,
                        y = start.y,
                        dy = start.dy,
                        heading = start.heading,
                        dHeading = start.dHeading
                    ),
                    end = DifferentialPoint2D(
                        x = end.x,
                        dx = end.dx,
                        y = end.y,
                        dy = end.dy,
                        heading = end.heading,
                        dHeading = end.dHeading
                    ),
                    duration = end.duration
                )
            )
        }
    }

    fun addPoint(point: ControlNode) {
        _waypoints.add(point)
        rebuildTrajectories()
    }

    fun setWaypoints(points: List<ControlNode>) {
        _waypoints.clear()
        _waypoints.addAll(points)
        rebuildTrajectories()
    }

    fun moveNode(index: Int, newPoint: ControlNode) {
        if (index in _waypoints.indices) {
            _waypoints[index] = newPoint
            rebuildTrajectories()
        }
    }

    fun moveNodeOrder(fromIndex: Int, toIndex: Int) {
        if (fromIndex !in _waypoints.indices || toIndex !in _waypoints.indices || fromIndex == toIndex) return

        val node = _waypoints.removeAt(fromIndex)
        _waypoints.add(toIndex, node)
        rebuildTrajectories()
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
    fun moveNode(sourceNode: ControlNode, destinationNode: ControlNode) {
        val index = waypoints.indexOfFirst { it isCloseTo sourceNode }
        if (index != -1) moveNode(index, destinationNode)
    }

    /**
     * 删除目标点（如果目标位置有两个点则只删除第一个）
     * 如果没找到则不会改变点集，也不会异常
     */
    fun removeNode(point2D: ControlNode) {
        val index = waypoints.indexOfFirst { it isCloseTo point2D }
        if (index != -1) removeNode(index)
    }

    fun getNodes(): List<ControlNode> = waypoints.toList()

    /**
     * 获取指定绝对时间 t 的机器人坐标
     * @return 若列表为空则返回 null
     * @throws IndexOutOfBoundsException 若超出时间范围
     */
    fun getPointAtTime(time: Double): ControlNode? {
        if (_waypoints.isEmpty()) return null
        if (trajectoryList.isEmpty()) return _waypoints.first()

        val totalTime = this.totalTime
        val epsilon = 1e-7
        if (time < -epsilon || time > totalTime + epsilon) throw IndexOutOfBoundsException("Time out of range.")

        val coercedTime = time.coerceIn(0.0, totalTime)

        var accumulatedTime = 0.0
        for ((index, traj) in trajectoryList.withIndex()) {
            val trajectoryDuration = traj.duration.coerceAtLeast(0.0)
            val trajectoryEndTime = accumulatedTime + trajectoryDuration
            if (coercedTime <= trajectoryEndTime) {
                val localTime = coercedTime - accumulatedTime
                return traj.getPointAtTime(localTime)
            }

            val delayEndTime = trajectoryEndTime + arrivalDelayForTrajectory(index)
            if (coercedTime <= delayEndTime) {
                return traj.getPointAtTime(traj.duration)
            }

            accumulatedTime = delayEndTime
        }
        // 理论上循环一定能命中，但为了防止极限情况下的浮点精度微小误差导致跳出循环
        // 直接返回最后一段轨迹的终点状态
        return trajectoryList.last().getPointAtTime(trajectoryList.last().duration)
    }


    // 移除 updateTrajectoryDuration 方法，因为 duration 现在是 ControlNode 的属性

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

    fun getNodeAt(index: Int): ControlNode {
        return _waypoints[index]
    }
}
