package ftc19656.azconductor.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

val MyLightColors = lightColorScheme(
    primary = RobotBlue,
    secondary = RobotOrange,
    surface = Color.White,
    background = Color.White,
)

private val MyDarkColors = darkColorScheme(
    primary = Color(0xFFD0BCFF),
    secondary = RobotOrange,
    surface = DarkGrey,
    background = Color(0xFF1C1B1F)
)

@Composable
fun AzConductorTheme(
    darkTheme: Boolean = false, // 目前固定为浅色，预留开关
    content: @Composable () -> Unit
) {
    val colorScheme = if (darkTheme) MyDarkColors else MyLightColors

    MaterialTheme(
        colorScheme = colorScheme,
        typography = MyTypography,
        content = content
    )
}

