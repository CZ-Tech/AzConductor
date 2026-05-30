package ftc19656.azconductor

import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.ImageBitmap

interface Platform {
    val name: String
}

interface PlatformImageLoader {
    fun loadFromFile(path: String): ImageBitmap?
}

// 提供一个全局访问点或使用 CompositionLocal
val LocalImageLoader = staticCompositionLocalOf<PlatformImageLoader> {
    error("No ImageLoader provided")
}

expect fun getPlatform(): Platform

/**
 * Send a POST request with a JSON body to [url] and return the response body string.
 * Returns null on failure (network error, timeout, non-2xx).
 *
 * Platform implementations:
 * - JVM: java.net.HttpURLConnection
 * - JS/WASM: browser fetch() API
 */
expect suspend fun httpPostJson(url: String, jsonBody: String): String?
