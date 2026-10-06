package ftc19656.azconductor.io.network

import kotlinx.browser.window
import kotlinx.coroutines.await
import org.w3c.dom.EventSource
import org.w3c.dom.MessageEvent
import org.w3c.fetch.Headers
import org.w3c.fetch.RequestInit

actual suspend fun platformHttpRequest(
    method: String,
    url: String,
    body: String?,
    headers: Map<String, String>,
): NetworkHttpResponse {
    val requestHeaders = Headers()
    headers.forEach { (name, value) -> requestHeaders.set(name, value) }
    val response = window.fetch(
        url,
        RequestInit(
            method = method,
            headers = requestHeaders,
            body = body,
        ),
    ).await()
    val responseHeaders = mutableMapOf<String, String>()
    listOf("etag", "x-route-revision").forEach { key ->
        response.headers.get(key)?.let { value -> responseHeaders[key] = value }
    }
    return NetworkHttpResponse(
        status = response.status.toInt(),
        body = response.text().await(),
        headers = responseHeaders,
    )
}

actual fun platformOpenEventStream(
    url: String,
    eventNames: List<String>,
    onOpen: () -> Unit,
    onEvent: (event: String, data: String, id: String?) -> Unit,
    onError: (message: String) -> Unit,
): NetworkEventHandle {
    val source = EventSource(url)
    source.onopen = { onOpen() }
    source.onerror = { onError("SSE connection error") }
    eventNames.forEach { eventName ->
        source.addEventListener(eventName, { raw ->
            val message = raw as MessageEvent
            onEvent(eventName, message.data.toString(), message.lastEventId.ifBlank { null })
        })
    }
    return object : NetworkEventHandle {
        override fun close() {
            source.close()
        }
    }
}
