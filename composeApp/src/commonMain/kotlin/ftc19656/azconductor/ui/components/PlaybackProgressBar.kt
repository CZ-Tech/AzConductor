package ftc19656.azconductor.ui.components

import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import ftc19656.azconductor.TimingConfig
import ftc19656.azconductor.UIConfig
import ftc19656.azconductor.toTimeString
import kotlinx.coroutines.delay

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

/**
 * State holder for playback controls — extracted to eliminate duplicate
 * [LaunchedEffect] loops in [PathPlannerScreen] and [CommandsScreen].
 */
class PlaybackState(
    val currentTime: Float,
    val isPlaying: Boolean,
    val onSeek: (Float) -> Unit,
    val onTogglePlayPause: () -> Unit
)

/**
 * Composable that manages playback time progression via two [LaunchedEffect]s:
 * one clamps [currentTime] when [totalTime] changes, the other advances
 * [currentTime] every [TimingConfig.PLAYBACK_FRAME_MS] while playing.
 */
@Composable
fun rememberPlaybackState(totalTime: Float): PlaybackState {
    var currentTime by remember { mutableStateOf(0f) }
    var isPlaying by remember { mutableStateOf(false) }
    val maxTime = maxOf(totalTime, 0.001f)

    LaunchedEffect(totalTime) {
        currentTime = currentTime.coerceIn(0f, maxTime)
        if (totalTime <= 0f) isPlaying = false
    }

    LaunchedEffect(isPlaying, totalTime) {
        while (isPlaying && totalTime > 0f) {
            delay(TimingConfig.PLAYBACK_FRAME_MS)
            currentTime = (currentTime + TimingConfig.PLAYBACK_FRAME_STEP).coerceAtMost(totalTime)
            if (currentTime >= totalTime) isPlaying = false
        }
    }

    return PlaybackState(
        currentTime = currentTime,
        isPlaying = isPlaying,
        onSeek = { currentTime = it; isPlaying = false },
        onTogglePlayPause = {
            if (!isPlaying && currentTime >= totalTime) currentTime = 0f
            isPlaying = !isPlaying
        }
    )
}
