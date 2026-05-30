package ftc19656.azconductor

import kotlinx.browser.window
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlin.coroutines.suspendCoroutine
import kotlinx.coroutines.await
import org.w3c.fetch.RequestInit
import org.w3c.fetch.RequestMode

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
    } catch (e: Exception) {
        println("httpPostJson failed for $url: ${e.message}")
        null
    }
}
