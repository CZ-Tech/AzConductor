package ftc19656.azconductor

import androidx.compose.ui.window.Window
import androidx.compose.ui.window.application
import App

fun main() = application {
    Window(
        onCloseRequest = ::exitApplication,
        title = "AzConductor",
    ) {
        App()
    }
}

// 在gemini cli中输入 ide enable 以启用 Companion 插件
// gemini powershell 启动命令：$env:https_proxy="http://127.0.0.1:7897"; gemini
