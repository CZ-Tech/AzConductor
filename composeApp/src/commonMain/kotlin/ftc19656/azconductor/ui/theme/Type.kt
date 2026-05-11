package ftc19656.azconductor.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.runtime.Composable
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import azconductor.composeapp.generated.resources.Res
import azconductor.composeapp.generated.resources.SourceHanSansCN_Bold
import azconductor.composeapp.generated.resources.SourceHanSansCN_Regular
import org.jetbrains.compose.resources.Font

val defaultFontFamily @Composable get() = FontFamily(
    Font(Res.font.SourceHanSansCN_Regular),
    Font(Res.font.SourceHanSansCN_Bold, weight = FontWeight.Bold)
)

val MyTypography @Composable get() = Typography(
    bodyLarge = TextStyle(fontFamily = defaultFontFamily),
    bodyMedium = TextStyle(fontFamily = defaultFontFamily),
    bodySmall = TextStyle(fontFamily = defaultFontFamily),
    labelLarge = TextStyle(fontFamily = defaultFontFamily),
    labelMedium = TextStyle(fontFamily = defaultFontFamily),
    labelSmall = TextStyle(fontFamily = defaultFontFamily),
    displayLarge = TextStyle(fontFamily = defaultFontFamily),
    displayMedium = TextStyle(fontFamily = defaultFontFamily),
    displaySmall = TextStyle(fontFamily = defaultFontFamily),
    headlineLarge = TextStyle(fontFamily = defaultFontFamily),
    headlineMedium = TextStyle(fontFamily = defaultFontFamily),
    headlineSmall = TextStyle(fontFamily = defaultFontFamily),
    titleLarge = TextStyle(fontFamily = defaultFontFamily),
    titleMedium = TextStyle(fontFamily = defaultFontFamily),
    titleSmall = TextStyle(fontFamily = defaultFontFamily),
)

