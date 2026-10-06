package ftc19656.azconductor.io.network

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URI
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

actual suspend fun platformHttpRequest(
    method: String,
    url: String,
    body: String?,
    headers: Map<String, String>,
): NetworkHttpResponse = withContext(Dispatchers.IO) {
    val connection = URI(url).toURL().openConnection() as HttpURLConnection
    try {
        connection.requestMethod = method
        connection.connectTimeout = 3000
        connection.readTimeout = 5000
        connection.useCaches = false
        headers.forEach { (name, value) -> connection.setRequestProperty(name, value) }

        if (body != null) {
            connection.doOutput = true
            val bytes = body.toByteArray(Charsets.UTF_8)
            connection.setRequestProperty("Content-Length", bytes.size.toString())
            connection.outputStream.use { it.write(bytes) }
        }

        val status = connection.responseCode
        val stream = if (status in 200..299) connection.inputStream else connection.errorStream
        val responseBody = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
        val responseHeaders = buildMap {
            connection.headerFields.forEach { (name, values) ->
                if (name != null && !values.isNullOrEmpty()) {
                    put(name.lowercase(), values.joinToString(","))
                }
            }
        }
        NetworkHttpResponse(status, responseBody, responseHeaders)
    } finally {
        connection.disconnect()
    }
}

actual fun platformOpenEventStream(
    url: String,
    eventNames: List<String>,
    onOpen: () -> Unit,
    onEvent: (event: String, data: String, id: String?) -> Unit,
    onError: (message: String) -> Unit,
): NetworkEventHandle {
    val closed = AtomicBoolean(false)
    val connectionRef = AtomicReference<HttpURLConnection?>(null)

    val thread = Thread({
        var connection: HttpURLConnection? = null
        try {
            connection = URI(url).toURL().openConnection() as HttpURLConnection
            connectionRef.set(connection)
            connection.requestMethod = "GET"
            connection.setRequestProperty("Accept", "text/event-stream")
            connection.connectTimeout = 3000
            connection.readTimeout = 0
            connection.useCaches = false

            val status = connection.responseCode
            if (status !in 200..299) {
                val error = connection.errorStream?.bufferedReader(Charsets.UTF_8)
                    ?.use { it.readText() }.orEmpty()
                onError("SSE HTTP " + status + if (error.isBlank()) "" else ": " + error)
                return@Thread
            }
            onOpen()

            BufferedReader(InputStreamReader(connection.inputStream, Charsets.UTF_8)).use { reader ->
                var event = "message"
                var id: String? = null
                val data = StringBuilder()

                while (!closed.get()) {
                    val line = reader.readLine() ?: break
                    if (line.isEmpty()) {
                        if (data.isNotEmpty()) {
                            val payload = if (data.endsWith("\n")) {
                                data.substring(0, data.length - 1)
                            } else {
                                data.toString()
                            }
                            onEvent(event, payload, id)
                        }
                        event = "message"
                        id = null
                        data.setLength(0)
                        continue
                    }
                    if (line.startsWith(":")) continue
                    val colon = line.indexOf(':')
                    val field = if (colon >= 0) line.substring(0, colon) else line
                    var value = if (colon >= 0) line.substring(colon + 1) else ""
                    if (value.startsWith(" ")) value = value.substring(1)
                    when (field) {
                        "event" -> event = value
                        "id" -> id = value
                        "data" -> data.append(value).append('\n')
                    }
                }
            }
            if (!closed.get()) onError("SSE connection closed")
        } catch (t: Throwable) {
            if (!closed.get()) onError(t.message ?: "SSE connection failed")
        } finally {
            connectionRef.set(null)
            connection?.disconnect()
        }
    }, "AzConductor-SSE")
    thread.isDaemon = true
    thread.start()

    return object : NetworkEventHandle {
        override fun close() {
            if (closed.compareAndSet(false, true)) {
                connectionRef.getAndSet(null)?.disconnect()
                thread.interrupt()
            }
        }
    }
}
