package ftc19656.azconductor.io

import ftc19656.azconductor.httpPostJson
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * Sends waypoint JSON to the robot's onboard HTTP service (port 8888)
 * and persists it under a named path with POST /save/{pathName}.
 *
 * Usage:
 *   val remoteSave = RemoteSave("192.168.1.100") { status -> println(status) }
 *   remoteSave.send(jsonPayload, "autoRoute")
 */
class RemoteSave(
    private val robotIp: String,
    private val port: Int = 8888,
    private val scope: CoroutineScope = CoroutineScope(Dispatchers.Default + SupervisorJob()),
    private val onStatusChange: (String) -> Unit = {}
) {
    private val baseUrl: String = "http://$robotIp:$port"

    /**
     * Fire-and-forget: POST the JSON payload to the robot, then trigger /save/{pathName}.
     * Runs on a background coroutine so it never blocks the UI thread.
     *
     * Workflow:
     *   1. POST / with JSON body -> stores in current memory
     *   2. POST /save/{pathName} (empty body) -> persists current memory to named path
     *
     * @param jsonBody  The serialized waypoints JSON string.
     * @param pathName  The path name to save under on the robot.
     */
    fun send(jsonBody: String, pathName: String) {
        scope.launch {
            try {
                // Step 1: send the JSON payload to current memory
                val uploadResult = httpPostJson("$baseUrl/", jsonBody)
                if (uploadResult == null) {
                    onStatusChange("连接失败")
                    println("RemoteSave: failed to upload to $baseUrl/")
                    return@launch
                }

                // Step 2: persist under the named path (no body needed)
                val saveResult = httpPostJson("$baseUrl/save/$pathName", "")
                if (saveResult == null) {
                    onStatusChange("已发送")
                    println("RemoteSave: failed to persist at $baseUrl/save/$pathName")
                } else {
                    onStatusChange("已保存")
                    println("RemoteSave: successfully sent and saved to robot at $baseUrl")
                }
            } catch (e: Throwable) {
                onStatusChange("连接失败")
                println("RemoteSave: exception in send: ${e.message}")
            }
        }
    }

    /**
     * Load a previously saved path from the robot.
     * @param pathName  The path name to load from the robot.
     */
    fun load(pathName: String, onResult: (String?) -> Unit) {
        scope.launch {
            try {
                val result = httpPostJson("$baseUrl/load/$pathName", "")
                if (result != null) {
                    onStatusChange("已加载")
                    onResult(result)
                } else {
                    onStatusChange("加载失败")
                    onResult(null)
                }
            } catch (e: Throwable) {
                onStatusChange("加载失败")
                onResult(null)
                println("RemoteSave: exception in load: ${e.message}")
            }
        }
    }
}
