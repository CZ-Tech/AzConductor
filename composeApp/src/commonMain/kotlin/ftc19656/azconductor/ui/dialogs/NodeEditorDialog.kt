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
import ftc19656.azconductor.UIConfig
import ftc19656.azconductor.route.DifferentialPoint2D
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.elementNames
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.serializer

// 获取序列化器（静态以便提前预热避免点击延迟）
val serializer = serializer<DifferentialPoint2D>()
val descriptor = serializer.descriptor

// 配置 Json 实例，强制包含默认值，确保 UI 能够显示 duration, heading 等默认字段
val editorJson = Json {
    encodeDefaults = true
    ignoreUnknownKeys = true
}

@OptIn(ExperimentalSerializationApi::class)
fun preloadSerializer(): DifferentialPoint2D {
    // 强制预热序列化器引擎
    val serializer = DifferentialPoint2D.serializer()
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
    val newNode = editorJson.decodeFromJsonElement(serializer, JsonObject(jsonContent))

    println("Serializer preloaded! Got $count fields")
    return newNode
}


/**
 * 此函数能够为DifferentialPoint2D的每个字段生成一个输入框，并在保存时反序列化为一个对应实例
 * 也就是说添加字段时无需修改此类，弹窗ui会自动适配
 */
@OptIn(ExperimentalSerializationApi::class)
@Composable
fun NodeEditorDialog(
    node: DifferentialPoint2D,
    onDismiss: () -> Unit,
    onConfirm: (DifferentialPoint2D) -> Unit,
    onDelete: () -> Unit
) {

    // 先把 node 转成 JsonObject，然后遍历它所有的键值对存入 Map，实现增加字段时自动识别
    val editValues = remember(node) {
        val mutableMap = mutableStateMapOf<String, String>()
        // 使用配置好的 editorJson，确保默认值也会被转成字符串填充到输入框
        val jsonElement = editorJson.encodeToJsonElement(serializer, node) as JsonObject
        jsonElement.forEach { (key, value) ->
            // .jsonPrimitive.content 能把 20.0 或者 "hello" 都变成字符串 "20.0" 或 "hello"
            mutableMap[key] = value.jsonPrimitive.content
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
                // UI 根据定义的顺序和Json字段全自动生成
                orderedFieldNames.forEach { fieldName ->
                    OutlinedTextField(
                        value = editValues[fieldName] ?: "",
                        onValueChange = { editValues[fieldName] = it },
                        label = { Text(fieldName) },
                        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                        singleLine = true
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
                            when (elementDescriptor.kind) {
                                PrimitiveKind.DOUBLE, PrimitiveKind.FLOAT, PrimitiveKind.INT, PrimitiveKind.LONG, PrimitiveKind.SHORT, PrimitiveKind.BYTE ->
                                    stringValue.toDoubleOrNull()?.let { JsonPrimitive(it) }
                                        ?: throw IllegalArgumentException("Field $key must be a number")
                                PrimitiveKind.BOOLEAN ->
                                    stringValue.toBooleanStrictOrNull()?.let { JsonPrimitive(it) }
                                        ?: throw IllegalArgumentException("Field $key must be a boolean")
                                else -> JsonPrimitive(stringValue)
                            }
                        } else {
                            JsonPrimitive(stringValue)
                        }
                    }

                    // 反序列化成类，实现改变节点字段时无需修改此处代码
                    val newNode = editorJson.decodeFromJsonElement(serializer, JsonObject(jsonContent))
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
