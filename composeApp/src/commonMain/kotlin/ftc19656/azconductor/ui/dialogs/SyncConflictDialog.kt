package ftc19656.azconductor.ui.dialogs

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import ftc19656.azconductor.io.SyncConflictData

/**
 * Dialog shown when a sync conflict is detected between the local path
 * and the robot's stored version. Offers three resolution options.
 */
@Composable
fun SyncConflictDialog(
    conflict: SyncConflictData,
    onKeepLocal: () -> Unit,
    onKeepRemote: () -> Unit,
    onKeepBoth: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onKeepLocal,
        title = { Text("路径冲突") },
        text = {
            Column {
                Text(
                    text = "路径「${conflict.pathName}」在电脑端与机器端不一致，请选择保留哪个版本：",
                    style = MaterialTheme.typography.bodyMedium
                )
                Spacer(modifier = Modifier.height(12.dp))
                TextButton(
                    onClick = onKeepLocal,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text("仅保留电脑端")
                }
                TextButton(
                    onClick = onKeepRemote,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text("仅保留机器端")
                }
                TextButton(
                    onClick = onKeepBoth,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text("保留两者，下载机器端")
                }
            }
        },
        confirmButton = {},
        dismissButton = {
            TextButton(onClick = onKeepLocal) {
                Text("关闭")
            }
        }
    )
}
