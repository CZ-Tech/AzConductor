package ftc19656.azconductor

import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.res.loadImageBitmap
import org.jetbrains.compose.resources.decodeToImageBitmap
import java.io.File
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URI
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class JVMPlatform: Platform {
    override val name: String = "Java ${System.getProperty("java.version")}"
}


class DesktopImageLoader : PlatformImageLoader {
    override fun loadFromFile(path: String): ImageBitmap? {
        return try {
            val file = File(path)
            if (file.exists()) {
                file.inputStream().buffered().use { it.readAllBytes().decodeToImageBitmap() }
            } else null
        } catch (e: Exception) {
            e.printStackTrace()
            null
        }
    }
}

actual fun getPlatform(): Platform = JVMPlatform()

actual suspend fun httpPostJson(url: String, jsonBody: String): String? = withContext(Dispatchers.IO) {
    try {
        val uri = URI(url)
        val connection = uri.toURL().openConnection() as HttpURLConnection
        connection.requestMethod = "POST"
        connection.doOutput = true
        connection.setRequestProperty("Content-Type", "application/json")
        connection.setRequestProperty("Content-Length", jsonBody.toByteArray(Charsets.UTF_8).size.toString())
        connection.connectTimeout = 3000
        connection.readTimeout = 3000

        connection.outputStream.use { os ->
            os.write(jsonBody.toByteArray(Charsets.UTF_8))
            os.flush()
        }

        val responseCode = connection.responseCode
        if (responseCode in 200..299) {
            connection.inputStream.use { it.readAllBytes().toString(Charsets.UTF_8) }
        } else {
            null
        }
    } catch (e: Exception) {
        println("httpPostJson failed for $url: ${e.message}")
        null
    }
}
