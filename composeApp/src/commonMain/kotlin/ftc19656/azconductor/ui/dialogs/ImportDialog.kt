package ftc19656.azconductor.ui.dialogs

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp

@Composable
fun ImportDialog(
    importJsonText: String,
    onValueChange: (String) -> Unit,
    onDismiss: () -> Unit,
    onImport: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("导入路径 JSON") },
        text = {
            OutlinedTextField(
                value = importJsonText,
                onValueChange = onValueChange,
                modifier = Modifier.fillMaxWidth().height(200.dp),
                placeholder = { Text("请在此粘贴导出的路径 JSON") },
                textStyle = MaterialTheme.typography.bodySmall.copy(
                    fontFamily = FontFamily.Monospace
                )
            )
        },
        confirmButton = {
            TextButton(onClick = onImport) {
                Text("导入")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("取消")
            }
        }
    )
}

