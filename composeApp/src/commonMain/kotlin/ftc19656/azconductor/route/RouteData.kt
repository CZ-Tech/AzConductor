package ftc19656.azconductor.route

import kotlinx.serialization.Serializable

@Serializable
data class RouteData(
    val name: String,
    val points: List<ControlNode> = emptyList()
)

@Serializable
data class RobotRoutes(
    val robotName: String = "default",
    val routes: List<RouteData> = emptyList()
)
