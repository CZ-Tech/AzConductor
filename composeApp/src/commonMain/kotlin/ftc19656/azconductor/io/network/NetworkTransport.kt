package ftc19656.azconductor.io.network

data class NetworkHttpResponse(
    val status: Int,
    val body: String,
    val headers: Map<String, String> = emptyMap(),
)

interface NetworkEventHandle {
    fun close()
}

interface RobotTransport {
    suspend fun request(
        method: String,
        url: String,
        body: String? = null,
        headers: Map<String, String> = emptyMap(),
    ): NetworkHttpResponse

    fun openEventStream(
        url: String,
        eventNames: List<String>,
        onOpen: () -> Unit,
        onEvent: (event: String, data: String, id: String?) -> Unit,
        onError: (message: String) -> Unit,
    ): NetworkEventHandle
}

object PlatformRobotTransport : RobotTransport {
    override suspend fun request(
        method: String,
        url: String,
        body: String?,
        headers: Map<String, String>,
    ): NetworkHttpResponse =
        platformHttpRequest(method, url, body, headers)

    override fun openEventStream(
        url: String,
        eventNames: List<String>,
        onOpen: () -> Unit,
        onEvent: (event: String, data: String, id: String?) -> Unit,
        onError: (message: String) -> Unit,
    ): NetworkEventHandle =
        platformOpenEventStream(url, eventNames, onOpen, onEvent, onError)
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
