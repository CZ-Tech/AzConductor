package ftc19656.azconductor

import kotlinx.browser.window
import kotlinx.coroutines.await
import org.w3c.fetch.RequestInit

class JsPlatform: Platform {
    override val name: String = "Web with Kotlin/JS"
}

actual fun getPlatform(): Platform = JsPlatform()

actual suspend fun httpPostJson(url: String, jsonBody: String): String? {
    return try {
        val requestInit = RequestInit(
            method = "POST",
            headers = org.w3c.fetch.Headers().also { h ->
                h.set("Content-Type", "application/json")
            },
            body = jsonBody
        )
        val response = window.fetch(url, requestInit).await()
        if (response.ok) {
            response.text().await()
        } else {
            null
        }
    } catch (e: Throwable) {
        println("httpPostJson failed for $url: ${e.message}")
        null
    }
}
