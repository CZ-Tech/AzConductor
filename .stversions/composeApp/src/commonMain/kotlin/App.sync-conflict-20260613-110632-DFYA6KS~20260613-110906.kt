import androidx.compose.runtime.Composable
import androidx.compose.ui.tooling.preview.Preview
import ftc19656.azconductor.route.viewmodel.RouteConnector
import ftc19656.azconductor.ui.screens.PathPlannerScreen
import ftc19656.azconductor.ui.theme.AzConductorTheme

@Composable
@Preview
fun App(route: RouteConnector = RouteConnector()) {
    AzConductorTheme {
        PathPlannerScreen(route)
    }
}

