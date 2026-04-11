package ftc19656.azconductor.back.route

import androidx.lifecycle.ViewModel

class RouteConnector(private var totalTime: Double) : ViewModel() {
    val trajectoryList = mutableListOf<TrajectoryGenerator2D>()

    val lastPoint get() = trajectoryList.getOrNull(trajectoryList.lastIndex)?.getEndPoint() ?:
                                            DifferentialPoint2D(0.0, 0.0, 0.0, 0.0)

    fun getTotalTime() = totalTime

    val totalLength: Double get() = trajectoryList.sumOf { it.length }
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

    private fun recalculateTimes(newTotalTime: Double) {
        totalTime = newTotalTime
        recalculateTimes()
    }

    fun addPoint(point2D: DifferentialPoint2D) {
        val trajectory = TrajectoryGenerator2D(
            lastPoint.x,
            lastPoint.y,
            lastPoint.dx,
            lastPoint.dy,
            point2D.x,
            point2D.y,
            point2D.dx,
            point2D.dy,
            0.0,
            20.0
        )
        trajectoryList.add(trajectory)
        recalculateTimes()
    }

    /**
     * 从路径中删除一个点，会自动生成从上一个点到下一个点的新曲线
     * @param point2D 要删除的点
     * @return 生成的新曲线。若未找到要删除的点或删除的点为起/终点则为null
     */
    fun removePoint(point2D: DifferentialPoint2D): TrajectoryGenerator2D? {
        if (trajectoryList.isEmpty()) return null

        // 检查是否是第一个点
        if (trajectoryList.first().getStartPoint() isCloseTo point2D) {
            trajectoryList.removeFirst()
            recalculateTimes()
            return null
        }

        // 找该点作为终点的轨迹的索引
        val indexBefore = trajectoryList.indexOfFirst { it.getEndPoint() isCloseTo point2D }
        if (indexBefore == -1) return null // 压根没找到这个点

        // 检查是否是最后一点
        if (indexBefore == trajectoryList.lastIndex) {
            trajectoryList.removeLast()
            recalculateTimes()
            return null
        }

        // 确实是中间点则取当前段和下一段进行缝合
        val trajectoryBefore = trajectoryList[indexBefore]
        val trajectoryAfter = trajectoryList[indexBefore + 1] // 因为不是 lastIndex，所以 i+1 必然存在

        val newTrajectory = TrajectoryGenerator2D(
            trajectoryBefore.getStartPoint(),
            trajectoryAfter.getEndPoint(),
            0.0, 0.0 // 随便填，马上会被重算
        )

        // 替换前一段，删除后一段
        trajectoryList[indexBefore] = newTrajectory
        trajectoryList.removeAt(indexBefore + 1)

        recalculateTimes() // 重算时间

        return newTrajectory
    }

    /**
     * 获取指定绝对时间点 t 的机器人坐标
     * 采用二分查找 (O(log N)) 定位轨迹段
     */
     fun getPointAtTime(time: Double): Point2D {
        // 边界：如果没有轨迹，直接返回零点或你设定的默认起点
        if (trajectoryList.isEmpty()) {
            return Point2D(0.0, 0.0)
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

}