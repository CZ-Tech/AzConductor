package ftc19656.azconductor

import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.ImageBitmap

interface Platform {
    val name: String
}

interface PlatformImageLoader {
    fun loadFromFile(path: String): ImageBitmap?
}

val LocalImageLoader = staticCompositionLocalOf<PlatformImageLoader> {
    error("No ImageLoader provided")
}

expect fun getPlatform(): Platform
