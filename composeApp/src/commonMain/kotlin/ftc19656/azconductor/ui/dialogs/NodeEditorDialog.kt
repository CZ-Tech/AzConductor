package ftc19656.azconductor.ui.dialogs

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import ftc19656.azconductor.AppContext
import ftc19656.azconductor.UIConfig
import ftc19656.azconductor.route.ControlNode
import ftc19656.azconductor.route.SplineRouteContract
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.SerialKind
import kotlinx.serialization.descriptors.StructureKind
import kotlinx.serialization.descriptors.elementNames
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.serializer

// 获取序列化器（静态以便提前预热避免点击延迟）
val serializer = serializer<ControlNode>()
val descriptor = serializer.descriptor

private val splineFieldHelp = mapOf(
    "dx" to "Hermite 几何切线 dX/du（英寸），不是机器人实际速度",
    "dy" to "Hermite 几何切线 dY/du（英寸），不是机器人实际速度",
    "dHeading" to "机器人不读取该字段；空间 Spline 预览始终采用零端点朝向导数",
    "duration" to "仅控制规划器时间轴预览，机器人按空间位置前进，不按此时长执行",
    "delayAfterArrive" to "到点后等待的秒数；上传时自动转换为机器人可执行的 wait 步骤，建议先配置末端停车",
    "maxPower" to "本段巡航功率 0~1（由上一点移动至此点的路段）",
    "maxSpeed" to "本段速度上限，单位 in/s；留空表示不限速",
    "endSpeed" to "到达此点的目标速度，单位 in/s；留空为通过点，填 0 为精确停车",
    "brakeZoneIn" to "到达此点前的制动区长度，单位英寸；指定 endSpeed 后必须大于 0",
    "brakeForwardPower" to "制动区正向功率上限 0~1；留空沿用机器人默认值",
    "marker" to "当前机器人自动 OpMode 不消费节点事件，因此 marker 不会触发动作",
    "command" to "当前机器人自动 OpMode 不执行规划器的节点命令"
)

private val splineFieldLabels = mapOf(
    "maxPower" to "巡航功率 maxPower",
    "maxSpeed" to "速度上限 maxSpeed (in/s)",
    "endSpeed" to "到点目标速度 endSpeed (in/s)",
    "brakeZoneIn" to "制动区距离 brakeZoneIn (in)",
    "brakeForwardPower" to "制动区前进功率 brakeForwardPower"
)

@OptIn(ExperimentalSerializationApi::class)
fun preloadSerializer(): ControlNode {
    // 强制预热序列化器引擎
    val serializer = ControlNode.serializer()
    // 读取 descriptor，触发底层结构解析
    val count = serializer.descriptor.elementsCount

    val map: MutableMap<String, String> = hashMapOf()
    for (s in serializer.descriptor.elementNames) {
        map[s] = if (s == "marker") "" else "1.0"  // 填满数据
    }

    // 保存一次数据以供预热
    val jsonContent = map.mapValues { (key, stringValue) ->
        val index = descriptor.getElementIndex(key)
        if (index != -1) {
            val elementDescriptor = descriptor.getElementDescriptor(index)
            when (elementDescriptor.kind) {
                PrimitiveKind.DOUBLE, PrimitiveKind.FLOAT, PrimitiveKind.INT, PrimitiveKind.LONG, PrimitiveKind.SHORT, PrimitiveKind.BYTE ->
                    stringValue.toDoubleOrNull()?.let { JsonPrimitive(it) } ?: JsonPrimitive(stringValue)
                PrimitiveKind.BOOLEAN ->
                    stringValue.toBooleanStrictOrNull()?.let { JsonPrimitive(it) } ?: JsonPrimitive(stringValue)
                else -> JsonPrimitive(stringValue)
            }
        } else {
            JsonPrimitive(stringValue)
        }
    }
    // 预热反序列化
    val newNode = AppContext.jsonConfig.decodeFromJsonElement(serializer, JsonObject(jsonContent))

    println("Serializer preloaded! Got $count fields")
    return newNode
}


/**
 * 此函数能够为ControlNode的每个字段生成一个输入框，并在保存时反序列化为一个对应实例
 * 也就是说添加字段时无需修改此类，弹窗ui会自动适配
 */
@OptIn(ExperimentalSerializationApi::class)
@Composable
fun NodeEditorDialog(
    node: ControlNode,
    onDismiss: () -> Unit,
    onConfirm: (ControlNode) -> Unit,
    onDelete: () -> Unit
) {

    // 先把 node 转成 JsonObject，然后遍历它所有的键值对存入 Map，实现增加字段时自动识别
    val editValues = remember(node) {
        val mutableMap = mutableStateMapOf<String, String>()
        // 使用配置好的 editorJson，确保默认值也会被转成字符串填充到输入框
        val jsonElement = AppContext.jsonConfig.encodeToJsonElement(serializer, node) as JsonObject
        jsonElement.forEach { (key, value) ->
            mutableMap[key] = when (value) {
                is JsonPrimitive -> value.content
                is JsonArray -> value.joinToString(", ") { it.jsonPrimitive.content }
                else -> value.toString()
            }
        }
        // Optional nullable fields are omitted from robot JSON when unset,
        // but must remain editable as empty text fields.
        descriptor.elementNames.forEach { key ->
            if (key !in mutableMap) mutableMap[key] = ""
        }
        mutableMap
    }

    var errorMessage by remember { mutableStateOf<String?>(null) }  // 错误信息

    // 定义字段的显示顺序
    val allFieldNames = descriptor.elementNames.toSet()
    val orderedFieldNames = UIConfig.NODE_EDITOR_FIELD_ORDER.filter { it in allFieldNames } +
            (allFieldNames - UIConfig.NODE_EDITOR_FIELD_ORDER.toSet())

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("编辑节点属性") },
        text = {
            Column(modifier = Modifier.verticalScroll(rememberScrollState())) {
                Text(
                    text = "空间跟踪模式：预览 duration 不等于实际行驶时间。运动限制作用于以当前点为终点的路段。",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                TextButton(onClick = {
                    editValues["endSpeed"] = "0.0"
                    if ((editValues["brakeZoneIn"]?.toDoubleOrNull() ?: 0.0) <= 0.0) {
                        editValues["brakeZoneIn"] = "12.0"
                    }
                }) { Text("设为停车点（12 英寸制动区起始值，需实机标定）") }
                TextButton(onClick = {
                    editValues["endSpeed"] = ""
                    editValues["brakeZoneIn"] = "0.0"
                    editValues["brakeForwardPower"] = ""
                }) { Text("设为通过点（无终点速度约束）") }
                // UI 根据定义的顺序和Json字段全自动生成
                orderedFieldNames.forEach { fieldName ->
                    OutlinedTextField(
                        value = editValues[fieldName] ?: "",
                        onValueChange = { editValues[fieldName] = it },
                        label = { Text(splineFieldLabels[fieldName] ?: fieldName) },
                        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                        singleLine = true,
                        supportingText = splineFieldHelp[fieldName]?.let { help ->
                            { Text(help, style = MaterialTheme.typography.bodySmall) }
                        }
                    )
                }
                if (errorMessage != null) {
                    Text(
                        text = errorMessage!!,
                        color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier.padding(top = 8.dp)
                    )
                }
            }
        },
        confirmButton = {
            TextButton(onClick = {
                try {
                    // 自动保存数据
                    val jsonContent = editValues.mapValues { (key, stringValue) ->
                        val index = descriptor.getElementIndex(key)
                        if (index != -1) {
                            val elementDescriptor = descriptor.getElementDescriptor(index)
                            if (elementDescriptor.isNullable && stringValue.isBlank()) {
                                JsonNull
                            } else {
                            when (elementDescriptor.kind) {
                                PrimitiveKind.DOUBLE, PrimitiveKind.FLOAT, PrimitiveKind.INT, PrimitiveKind.LONG, PrimitiveKind.SHORT, PrimitiveKind.BYTE ->
                                    stringValue.toDoubleOrNull()?.let { JsonPrimitive(it) }
                                        ?: throw IllegalArgumentException("Field $key must be a number")
                                PrimitiveKind.BOOLEAN ->
                                    stringValue.toBooleanStrictOrNull()?.let { JsonPrimitive(it) }
                                        ?: throw IllegalArgumentException("Field $key must be a boolean")
                                StructureKind.LIST -> {
                                    val items = stringValue.split(",").map {
                                        JsonPrimitive(it.trim())
                                    }
                                    JsonArray(items)
                                }
                                else -> JsonPrimitive(stringValue)
                            }
                            }
                        } else {
                            JsonPrimitive(stringValue)
                        }
                    }

                    // 反序列化成类，实现改变节点字段时无需修改此处代码
                    val newNode = AppContext.jsonConfig.decodeFromJsonElement(serializer, JsonObject(jsonContent))
                    val errors = SplineRouteContract.errors(listOf(newNode))
                    if (errors.isNotEmpty()) {
                        throw IllegalArgumentException(errors.joinToString("；") { it.message })
                    }
                    onConfirm(newNode)
                    onDismiss()

                } catch (e: Exception) {
                    // 如果用户在 Double 字段填了 "abc"，这里会报错，可以提示用户
                    println("Save failed: ${e.message}")
                    // 直接在 catch 里捕获逻辑错误并反馈给 UI
                    errorMessage = "格式错误：${e.message ?: "请确保数值字段都填入了有效的数字"}"
                }
            }) {
                Text("保存")
            }
        },
        dismissButton = {
            TextButton(onClick = {
                onDelete()
                onDismiss()
            }) {
                Text("删除节点", color = MaterialTheme.colorScheme.error)
            }
        }
    )
}
