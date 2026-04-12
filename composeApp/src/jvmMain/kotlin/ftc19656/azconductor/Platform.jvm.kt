package ftc19656.azconductor

import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.res.loadImageBitmap
import org.jetbrains.compose.resources.decodeToImageBitmap
import java.io.File
import java.io.InputStream

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