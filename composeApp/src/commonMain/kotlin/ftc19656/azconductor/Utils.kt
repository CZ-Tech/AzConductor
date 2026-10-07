package ftc19656.azconductor

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.roundToLong

fun Double.toRadians(): Double = this * PI / 180.0
fun Double.toDegrees(): Double = this * 180.0 / PI

fun Double.toFixed(decimals: Int): String {
    require(decimals >= 0) { "decimals must be non-negative" }

    var scale = 1L
    repeat(decimals) {
        scale *= 10L
    }

    val rounded = (this * scale).roundToLong()
    val sign = if (rounded < 0) "-" else ""
    val absolute = abs(rounded)
    val whole = absolute / scale

    if (decimals == 0) {
        return "$sign$whole"
    }

    val fraction = (absolute % scale).toString().padStart(decimals, '0')
    return "$sign$whole.$fraction"
}

fun Float.toTimeString(): String = this.toDouble().toFixed(1) + "s"

/**
 * 播放倍速的显示文本，例如 `1x`、`0.5x`、`1.5x`。
 * 整数倍速不显示小数位，非整数倍速最多保留两位小数并去掉末尾的 0。
 */
fun Float.toSpeedLabel(): String {
    val text = if (this == toInt().toFloat()) {
        toInt().toString()
    } else {
        toDouble().toFixed(2).trimEnd('0').trimEnd('.')
    }
    return text + "x"
}
