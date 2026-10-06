package ftc19656.azconductor.io.network

sealed interface ApiResult<out T> {
    data class Ok<T>(val value: T, val status: Int) : ApiResult<T>
    data class HttpError(
        val status: Int,
        val code: String? = null,
        val message: String? = null,
        val body: String = "",
    ) : ApiResult<Nothing>
    data class NetworkError(
        val message: String,
        val cause: Throwable? = null,
    ) : ApiResult<Nothing>
}

inline fun <T, R> ApiResult<T>.map(transform: (T) -> R): ApiResult<R> = when (this) {
    is ApiResult.Ok -> ApiResult.Ok(transform(value), status)
    is ApiResult.HttpError -> this
    is ApiResult.NetworkError -> this
}
