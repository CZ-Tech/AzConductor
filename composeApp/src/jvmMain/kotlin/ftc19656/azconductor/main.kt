package ftc19656.azconductor

import androidx.compose.ui.window.Window
import androidx.compose.ui.window.application
import ftc19656.azconductor.back.route.RouteConnector
import ftc19656.azconductor.front.App

fun main() = application {
    Window(
        onCloseRequest = ::exitApplication,
        title = "AzConductor",
    ) {
        App()
    }
}