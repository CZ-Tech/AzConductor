package ftc19656.azconductor.ui

import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

enum class WindowWidthClass {
    Compact,
    Medium,
    Expanded,
}

data class ResponsiveLayout(
    val widthClass: WindowWidthClass,
    val shortHeight: Boolean,
) {
    val compact: Boolean get() = widthClass == WindowWidthClass.Compact
    val expanded: Boolean get() = widthClass == WindowWidthClass.Expanded
}

fun responsiveLayout(width: Dp, height: Dp): ResponsiveLayout {
    val widthClass = when {
        width < 720.dp -> WindowWidthClass.Compact
        width < 1180.dp -> WindowWidthClass.Medium
        else -> WindowWidthClass.Expanded
    }
    return ResponsiveLayout(
        widthClass = widthClass,
        shortHeight = height < 620.dp,
    )
}

fun Dp.coerceInDp(minimum: Dp, maximum: Dp): Dp =
    when {
        this < minimum -> minimum
        this > maximum -> maximum
        else -> this
    }
