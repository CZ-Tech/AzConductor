package ftc19656.azconductor.io.network

data class NetworkHttpResponse(
    val status: Int,
    val body: String,
    val headers: Map<String, String> = emptyMap(),
)

interface NetworkEventHandle {
    fun close()
}

expect suspend fun platformHttpRequest(
    method: String,
    url: String,
    body: String? = null,
    headers: Map<String, String> = emptyMap(),
): NetworkHttpResponse

expect fun platformOpenEventStream(
    url: String,
    eventNames: List<String>,
    onOpen: () -> Unit,
    onEvent: (event: String, data: String, id: String?) -> Unit,
    onError: (message: String) -> Unit,
): NetworkEventHandle
