package ftc19656.azconductor

import androidx.compose.ui.window.Window
import androidx.compose.ui.window.application
import ftc19656.azconductor.front.App

fun main() = application {
    Window(
        onCloseRequest = ::exitApplication,
        title = "AzConductor",
    ) {
        App()
    }
}

// 在gemini cli中输入/ide enable以启用Companion插件