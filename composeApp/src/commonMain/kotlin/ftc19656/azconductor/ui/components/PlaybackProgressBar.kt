package ftc19656.azconductor.ui.components

import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import ftc19656.azconductor.UIConfig
import ftc19656.azconductor.toTimeString

/**
 * Reusable playback progress bar with slider, time text, and play/pause button.
 * Supports both vertical (rotated slider) and horizontal layouts.
 *
 * State management (currentTime, isPlaying, LaunchedEffect loop) is owned by the caller;
 * this composable only handles rendering.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PlaybackProgressBar(
    currentTime: Float,
    totalTime: Float,
    onValueChange: (Float) -> Unit,
    isPlaying: Boolean,
    onPlayPauseToggle: () -> Unit,
    isVertical: Boolean,
    modifier: Modifier = Modifier,
) {
    val maxTime = maxOf(totalTime, 0.001f)
    val clampedValue = currentTime.coerceIn(0f, maxTime)

    if (isVertical) {
        Column(
            modifier = modifier,
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            Box(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth(),
                contentAlignment = Alignment.Center
            ) {
                BoxWithConstraints(contentAlignment = Alignment.Center) {
                    Slider(
                        value = clampedValue,
                        onValueChange = onValueChange,
                        valueRange = 0f..maxTime,
                        colors = SliderDefaults.colors(
                            activeTrackColor = UIConfig.WIN11_ACCENT,
                            inactiveTrackColor = UIConfig.WIN11_INACTIVE,
                            thumbColor = UIConfig.WIN11_ACCENT
                        ),
                        thumb = {
                            SliderDefaults.Thumb(
                                interactionSource = remember { MutableInteractionSource() },
                                colors = SliderDefaults.colors(thumbColor = UIConfig.WIN11_ACCENT),
                                thumbSize = DpSize(16.dp, 16.dp)
                            )
                        },
                        modifier = Modifier
                            .graphicsLayer { rotationZ = -90f }
                            .requiredWidth(maxHeight)
                    )
                }
            }
            Text(
                text = currentTime.toTimeString() + " / " + totalTime.toTimeString(),
                style = MaterialTheme.typography.labelSmall
            )
            IconButton(
                onClick = onPlayPauseToggle,
                enabled = totalTime > 0f,
                modifier = Modifier.size(28.dp)
            ) {
                Icon(
                    imageVector = if (isPlaying) Icons.Default.Pause else Icons.Default.PlayArrow,
                    contentDescription = if (isPlaying) "暂停" else "开始",
                    modifier = Modifier.size(16.dp)
                )
            }
        }
    } else {
        Row(
            modifier = modifier,
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            Slider(
                value = clampedValue,
                onValueChange = onValueChange,
                valueRange = 0f..maxTime,
                colors = SliderDefaults.colors(
                    activeTrackColor = UIConfig.WIN11_ACCENT,
                    inactiveTrackColor = UIConfig.WIN11_INACTIVE,
                    thumbColor = UIConfig.WIN11_ACCENT
                ),
                thumb = {
                    SliderDefaults.Thumb(
                        interactionSource = remember { MutableInteractionSource() },
                        colors = SliderDefaults.colors(thumbColor = UIConfig.WIN11_ACCENT),
                        thumbSize = DpSize(16.dp, 16.dp)
                    )
                },
                modifier = Modifier.weight(1f)
            )
            Text(
                text = currentTime.toTimeString() + " / " + totalTime.toTimeString(),
                style = MaterialTheme.typography.labelSmall
            )
            IconButton(
                onClick = onPlayPauseToggle,
                enabled = totalTime > 0f,
                modifier = Modifier.size(28.dp)
            ) {
                Icon(
                    imageVector = if (isPlaying) Icons.Default.Pause else Icons.Default.PlayArrow,
                    contentDescription = if (isPlaying) "暂停" else "开始",
                    modifier = Modifier.size(16.dp)
                )
            }
        }
    }
}
