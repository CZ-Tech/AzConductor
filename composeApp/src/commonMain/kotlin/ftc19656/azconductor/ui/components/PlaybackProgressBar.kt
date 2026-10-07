package ftc19656.azconductor.ui.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import ftc19656.azconductor.TimingConfig
import ftc19656.azconductor.UIConfig
import ftc19656.azconductor.toSpeedLabel
import ftc19656.azconductor.toTimeString
import kotlinx.coroutines.delay

/**
 * 计算播放推进一帧之后的当前时间。
 *
 * 每帧步长 [step] 乘以倍速 [speed]，并钳制在 `0f..totalTime` 之间，
 * 倍速本身也被限制在 [TimingConfig.PLAYBACK_SPEED_MIN]..[TimingConfig.PLAYBACK_SPEED_MAX] 之内。
 *
 * @param currentTime 当前播放时间（秒）
 * @param totalTime 路径总时长（秒），小于等于 0 时始终返回 0
 * @param speed 播放倍速，1f 表示原速
 * @param step 每帧时间步长（秒）
 */
fun advancePlaybackTime(
    currentTime: Float,
    totalTime: Float,
    speed: Float,
    step: Float = TimingConfig.PLAYBACK_FRAME_STEP,
): Float {
    if (totalTime <= 0f) return 0f
    val effectiveSpeed = speed.coerceIn(TimingConfig.PLAYBACK_SPEED_MIN, TimingConfig.PLAYBACK_SPEED_MAX)
    return (currentTime + step * effectiveSpeed).coerceIn(0f, totalTime)
}

/**
 * Reusable playback progress bar with slider, time text, speed selector and play/pause button.
 * Supports both vertical (rotated slider) and horizontal layouts.
 *
 * State management (currentTime, isPlaying, speed, LaunchedEffect loop) is owned by the caller;
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
    speed: Float = TimingConfig.PLAYBACK_SPEED_DEFAULT,
    onSpeedChange: (Float) -> Unit = {},
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
                style = MaterialTheme.typography.labelSmall,
                maxLines = 1
            )
            PlaybackSpeedControl(
                speed = speed,
                onSpeedChange = onSpeedChange,
                enabled = totalTime > 0f
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
                style = MaterialTheme.typography.labelSmall,
                maxLines = 1
            )
            PlaybackSpeedControl(
                speed = speed,
                onSpeedChange = onSpeedChange,
                enabled = totalTime > 0f
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
 * 倍速选择控件：显示当前倍速（如 `1x`、`2x`），点击后弹出 [TimingConfig.PLAYBACK_SPEED_PRESETS] 预设菜单。
 * 布局紧凑，可同时用于竖直与水平两种播放条。
 */
@Composable
private fun PlaybackSpeedControl(
    speed: Float,
    onSpeedChange: (Float) -> Unit,
    enabled: Boolean,
    modifier: Modifier = Modifier,
) {
    var expanded by remember { mutableStateOf(false) }

    LaunchedEffect(enabled) {
        if (!enabled) expanded = false
    }

    Box(modifier = modifier, contentAlignment = Alignment.Center) {
        Box(
            modifier = Modifier
                .clip(RoundedCornerShape(4.dp))
                .clickable(enabled = enabled) { expanded = true }
                .padding(horizontal = 4.dp, vertical = 2.dp)
        ) {
            Text(
                text = speed.toSpeedLabel(),
                style = MaterialTheme.typography.labelSmall,
                color = if (enabled) UIConfig.WIN11_ACCENT else UIConfig.WIN11_INACTIVE,
                maxLines = 1
            )
        }

        DropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false }
        ) {
            Text(
                text = "播放倍速",
                style = MaterialTheme.typography.labelSmall,
                modifier = Modifier.padding(start = 12.dp, end = 12.dp, top = 4.dp, bottom = 4.dp)
            )
            TimingConfig.PLAYBACK_SPEED_PRESETS.forEach { preset ->
                DropdownMenuItem(
                    text = {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            Text(preset.toSpeedLabel())
                            if (preset == speed) {
                                Icon(
                                    imageVector = Icons.Default.Check,
                                    contentDescription = "当前倍速",
                                    tint = UIConfig.WIN11_ACCENT,
                                    modifier = Modifier.size(16.dp)
                                )
                            }
                        }
                    },
                    onClick = {
                        onSpeedChange(preset)
                        expanded = false
                    }
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
    val speed: Float,
    val onSeek: (Float) -> Unit,
    val onTogglePlayPause: () -> Unit,
    val onSpeedChange: (Float) -> Unit,
)

/**
 * Composable that manages playback time progression via two [LaunchedEffect]s:
 * one clamps [currentTime] when [totalTime] changes, the other advances
 * [currentTime] every [TimingConfig.PLAYBACK_FRAME_MS] while playing.
 *
 * Playback speed is applied per frame ([advancePlaybackTime]) and can be changed
 * at any time — including while playing — without restarting the frame loop.
 *
 * @param totalTime 路径总时长（秒）
 * @param initialSpeed 初始倍速，默认 [TimingConfig.PLAYBACK_SPEED_DEFAULT]
 */
@Composable
fun rememberPlaybackState(
    totalTime: Float,
    initialSpeed: Float = TimingConfig.PLAYBACK_SPEED_DEFAULT,
): PlaybackState {
    var currentTime by remember { mutableStateOf(0f) }
    var isPlaying by remember { mutableStateOf(false) }
    var speed by remember {
        mutableStateOf(initialSpeed.coerceIn(TimingConfig.PLAYBACK_SPEED_MIN, TimingConfig.PLAYBACK_SPEED_MAX))
    }
    val maxTime = maxOf(totalTime, 0.001f)
    val currentSpeed by rememberUpdatedState(speed)

    LaunchedEffect(totalTime) {
        currentTime = currentTime.coerceIn(0f, maxTime)
        if (totalTime <= 0f) isPlaying = false
    }

    LaunchedEffect(isPlaying, totalTime) {
        while (isPlaying && totalTime > 0f) {
            delay(TimingConfig.PLAYBACK_FRAME_MS)
            currentTime = advancePlaybackTime(currentTime, totalTime, currentSpeed)
            if (currentTime >= totalTime) isPlaying = false
        }
    }

    return PlaybackState(
        currentTime = currentTime,
        isPlaying = isPlaying,
        speed = speed,
        onSeek = { currentTime = it; isPlaying = false },
        onTogglePlayPause = {
            if (!isPlaying && currentTime >= totalTime) currentTime = 0f
            isPlaying = !isPlaying
        },
        onSpeedChange = {
            speed = it.coerceIn(TimingConfig.PLAYBACK_SPEED_MIN, TimingConfig.PLAYBACK_SPEED_MAX)
        }
    )
}
