package ftc19656.azconductor

import kotlinx.browser.window
import kotlinx.coroutines.await
import org.w3c.fetch.RequestInit
import org.w3c.fetch.Response

class WasmPlatform: Platform {
    override val name: String = "Web with Kotlin/Wasm"
}

actual fun getPlatform(): Platform = WasmPlatform()

actual suspend fun httpPostJson(url: String, jsonBody: String): String? {
    return try {
        val headers = org.w3c.fetch.Headers()
        headers.set("Content-Type", "application/json")
        val requestInit = RequestInit(
            method = "POST",
            headers = headers,
            body = jsonBody.toJsString()
        )
        val response: Response = window.fetch(url, requestInit).await()
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
