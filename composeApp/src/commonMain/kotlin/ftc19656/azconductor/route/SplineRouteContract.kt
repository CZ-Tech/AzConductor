package ftc19656.azconductor.route

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull

object SplineRouteContract {
    data class Issue(
        val waypointIndex: Int?,
        val field: String,
        val message: String
    )

    fun validate(points: List<ControlNode>): List<Issue> {
        val issues = mutableListOf<Issue>()
        if (points.isEmpty()) {
            issues += Issue(null, "points", "路径至少需要一个起始控制点")
            return issues
        }
        fun error(index: Int, field: String, message: String) {
            issues += Issue(index, field, message)
        }

        points.forEachIndexed { i, p ->
            listOf(
                "x" to p.x, "y" to p.y, "dx" to p.dx, "dy" to p.dy,
                "heading" to p.heading, "dHeading" to p.dHeading
            ).forEach { (name, value) ->
                if (!value.isFinite()) error(i, name, "$name 必须为有限数值")
            }
            if (!p.duration.isFinite() || p.duration < 0) {
                error(i, "duration", "预览时长不得为负数或非有限值")
            }
            if (!p.delayAfterArrive.isFinite() || p.delayAfterArrive < 0) {
                error(i, "delayAfterArrive", "到点等待不得为负数或非有限值")
            }
            if (!p.maxPower.isFinite() || p.maxPower !in 0.0..1.0) {
                error(i, "maxPower", "巡航功率必须位于 0 到 1")
            }
            if (p.maxSpeed != null && (!p.maxSpeed.isFinite() || p.maxSpeed <= 0)) {
                error(i, "maxSpeed", "速度上限必须大于 0 in/s，或留空")
            }
            if (p.endSpeed != null && (!p.endSpeed.isFinite() || p.endSpeed < 0)) {
                error(i, "endSpeed", "到点目标速度不得为负数，或留空")
            }
            if (!p.brakeZoneIn.isFinite() || p.brakeZoneIn < 0) {
                error(i, "brakeZoneIn", "制动区距离不得为负数")
            }
            if (p.brakeForwardPower != null &&
                (!p.brakeForwardPower.isFinite() || p.brakeForwardPower !in 0.0..1.0)) {
                error(i, "brakeForwardPower", "制动区前进功率必须位于 0 到 1，或留空")
            }
            if (p.endSpeed != null && p.brakeZoneIn <= 0) {
                error(i, "brakeZoneIn", "设置 endSpeed 后必须提供大于 0 的制动区距离")
            }
        }
        return issues
    }

    fun errors(points: List<ControlNode>): List<Issue> = validate(points)

    fun encodeRobotRoute(points: List<ControlNode>, json: Json): String {
        val frames = mutableListOf<kotlinx.serialization.json.JsonElement>()
        points.forEach { point ->
            val data = json.encodeToJsonElement(ControlNode.serializer(), point) as JsonObject
            frames += JsonObject(data.filterKeys { it != "delayAfterArrive" })
            if (point.delayAfterArrive > 0) {
                frames += JsonObject(mapOf("wait" to JsonPrimitive(point.delayAfterArrive)))
            }
        }
        return json.encodeToString(JsonArray.serializer(), JsonArray(frames))
    }

    fun decodeRobotRoute(routeJson: String, json: Json): List<ControlNode> {
        val frames = json.parseToJsonElement(routeJson) as? JsonArray
            ?: throw IllegalArgumentException("机器人路径必须是 JSON 数组")
        val nodes = mutableListOf<ControlNode>()
        frames.forEachIndexed { index, frame ->
            val obj = frame as? JsonObject
                ?: throw IllegalArgumentException("第 ${index + 1} 帧不是对象")
            if ("wait" in obj) {
                val seconds = (obj["wait"] as? JsonPrimitive)?.doubleOrNull
                    ?: throw IllegalArgumentException("第 ${index + 1} 帧 wait 无效")
                require(seconds.isFinite() && seconds >= 0) { "第 ${index + 1} 帧 wait 无效" }
                require(nodes.isNotEmpty()) { "起始点之前的 wait 无法在控制点模型中表示" }
                require((obj["marker"] as? JsonPrimitive)?.contentOrNull.isNullOrEmpty() &&
                        (obj["command"] as? JsonPrimitive)?.contentOrNull.isNullOrEmpty()) {
                    "带事件的独立 wait 无法无损导入控制点模型"
                }
                val last = nodes.lastIndex
                nodes[last] = nodes[last].copy(delayAfterArrive = nodes[last].delayAfterArrive + seconds)
            } else {
                val data = obj.toMutableMap()
                if ("dx" !in data) data["dx"] = JsonPrimitive(0.0)
                if ("dy" !in data) data["dy"] = JsonPrimitive(0.0)
                nodes += json.decodeFromJsonElement(ControlNode.serializer(), JsonObject(data))
            }
        }
        return nodes
    }

    fun validateRobotJson(routeJson: String): List<Issue> {
        val root = runCatching { Json.parseToJsonElement(routeJson) }.getOrNull()
        if (root !is JsonArray) {
            return listOf(Issue(null, "json", "路径必须是控制点 JSON 数组"))
        }
        if (root.isEmpty()) {
            return listOf(Issue(null, "points", "不能上传空路径"))
        }
        val issues = mutableListOf<Issue>()
        val pointFrames = mutableListOf<Int>()
        val points = mutableListOf<ControlNode>()
        root.forEachIndexed { index, entry ->
            val obj = entry as? JsonObject
            if (obj == null) {
                issues += Issue(index, "json", "路段必须是 JSON 对象")
                return@forEachIndexed
            }
            fun number(key: String, default: Double? = null, required: Boolean = false): Double? {
                if (key !in obj) {
                    if (required) issues += Issue(index, key, "缺少 $key")
                    return default
                }
                val raw = obj[key]
                val value = if (raw == JsonNull) null else (raw as? JsonPrimitive)?.doubleOrNull
                if (value == null || !value.isFinite()) {
                    issues += Issue(index, key, "$key 必须为有限数值")
                    return default
                }
                return value
            }
            if ("wait" in obj) {
                val wait = number("wait", required = true)
                if (wait != null && wait < 0) {
                    issues += Issue(index, "wait", "等待秒数不能为负数")
                }
                return@forEachIndexed
            }
            val x = number("x", required = true)
            val y = number("y", required = true)
            val dx = number("dx", default = 0.0)
            val dy = number("dy", default = 0.0)
            val heading = number("heading", default = 0.0)
            val dHeading = number("dHeading", default = 0.0)
            val duration = number("duration", default = 0.0)
            val delay = number("delayAfterArrive", default = 0.0)
            val maxPower = number("maxPower", default = 1.0)
            val maxSpeed = number("maxSpeed")
            val endSpeed = number("endSpeed")
            val brakeZone = number("brakeZoneIn", default = 0.0)
            val brakeForward = number("brakeForwardPower")
            if (x == null || y == null) return@forEachIndexed
            pointFrames += index
            points += ControlNode(
                x = x, y = y, dx = dx!!, dy = dy!!, heading = heading!!,
                dHeading = dHeading!!, duration = duration!!,
                delayAfterArrive = delay!!, maxPower = maxPower!!,
                maxSpeed = maxSpeed, endSpeed = endSpeed,
                brakeZoneIn = brakeZone!!, brakeForwardPower = brakeForward,
                marker = (obj["marker"] as? JsonPrimitive)?.contentOrNull ?: "",
                command = (obj["command"] as? JsonPrimitive)?.contentOrNull ?: ""
            )
        }
        if (points.isNotEmpty()) {
            issues += validate(points).map { issue ->
                issue.copy(waypointIndex = issue.waypointIndex?.let { pointFrames[it] })
            }
        }
        return issues
    }
}
