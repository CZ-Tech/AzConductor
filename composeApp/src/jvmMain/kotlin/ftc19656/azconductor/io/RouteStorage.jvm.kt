package ftc19656.azconductor.io

import java.io.File

private val routeFile by lazy {
    val home = System.getProperty("user.home")
    val dir = File(home, ".azconductor")
    if (!dir.exists()) dir.mkdirs()
    File(dir, "routes.json")
}

actual fun saveRouteData(json: String) {
    routeFile.writeText(json, Charsets.UTF_8)
}

actual fun loadRouteData(): String? {
    return if (routeFile.exists()) routeFile.readText(Charsets.UTF_8) else null
}

actual fun removeRouteData() {
    routeFile.delete()
}
