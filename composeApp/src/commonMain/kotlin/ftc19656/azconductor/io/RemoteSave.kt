package ftc19656.azconductor.io

import ftc19656.azconductor.httpPostJson
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * Sends waypoint JSON to the robot's onboard HTTP service (port 8888)
 * and persists it with POST /save.
 *
 * Usage:
 *   val remoteSave = RemoteSave("192.168.1.100") { status -> println(status) }
 *   remoteSave.send(jsonPayload)
 */
class RemoteSave(
    private val robotIp: String,
    private val port: Int = 8888,
    private val scope: CoroutineScope = CoroutineScope(Dispatchers.Default + SupervisorJob()),
    private val onStatusChange: (String) -> Unit = {}
) {
    private val baseUrl: String = "http://$robotIp:$port"

    /**
     * Fire-and-forget: POST the JSON payload to the robot, then trigger /save.
     * Runs on a background coroutine so it never blocks the UI thread.
     *
     * Follows the typical workflow from the API docs:
     *   1. POST /  with JSON body -> stores in memory
     *   2. POST /save -> persists to SharedPreferences
     *
     * @param jsonBody  The serialized waypoints JSON string.
     */
    fun send(jsonBody: String) {
        scope.launch {
            // Step 1: send the JSON payload
            val uploadResult = httpPostJson("$baseUrl/", jsonBody)
            if (uploadResult == null) {
                onStatusChange("连接失败")
                println("RemoteSave: failed to upload to $baseUrl/")
                return@launch
            }

            // Step 2: persist on the robot side
            val saveResult = httpPostJson("$baseUrl/save", jsonBody)
            if (saveResult == null) {
                onStatusChange("已发送")
                println("RemoteSave: failed to persist at $baseUrl/save")
            } else {
                onStatusChange("已保存")
                println("RemoteSave: successfully sent and saved to robot at $baseUrl")
            }
        }
    }
}
