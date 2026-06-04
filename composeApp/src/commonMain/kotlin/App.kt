import androidx.compose.runtime.*
import androidx.compose.ui.tooling.preview.Preview
import ftc19656.azconductor.route.viewmodel.RouteConnector
import ftc19656.azconductor.ui.screens.HomeScreen
import ftc19656.azconductor.ui.screens.PathPlannerScreen
import ftc19656.azconductor.ui.theme.AzConductorTheme

@Composable
@Preview
fun App(route: RouteConnector = RouteConnector()) {
    var currentScreen by remember { mutableStateOf("home") }

    AzConductorTheme {
        when (currentScreen) {
            "home" -> HomeScreen(route = route, onNavigateToPlanner = { currentScreen = "pathPlanner" })
            "pathPlanner" -> PathPlannerScreen(route, onNavigateBack = { currentScreen = "home" })
        }
    }
}
