package ftc19656.azconductor.io

private const val STORAGE_KEY = "robot_routes"

actual fun saveRouteData(json: String) {
    kotlinx.browser.window.localStorage.setItem(STORAGE_KEY, json)
}

actual fun loadRouteData(): String? {
    return kotlinx.browser.window.localStorage.getItem(STORAGE_KEY)
}

actual fun removeRouteData() {
    kotlinx.browser.window.localStorage.removeItem(STORAGE_KEY)
}
