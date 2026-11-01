/** 回放推进。移植自 Kotlin advancePlaybackTime / TimingConfig。 */

export const SPEED_PRESETS: readonly number[] = [0.25, 0.5, 1, 2, 3, 4];
export const SPEED_MIN = 0.25;
export const SPEED_MAX = 4;
export const SPEED_DEFAULT = 1;
/** 每帧时间步长（秒，Kotlin PLAYBACK_FRAME_STEP） */
export const FRAME_STEP = 0.016;

export function clampSpeed(speed: number): number {
  return Math.min(SPEED_MAX, Math.max(SPEED_MIN, speed));
}

export interface PlaybackStep {
  t: number;
  finished: boolean;
}

/**
 * t' = clamp(t + dt * clampSpeed(speed), 0, total)；total<=0 时恒为 0（不推进，finished=false）。
 * finished 在到达（或已位于）终点时为 true。
 */
export function advance(t: number, dt: number, speed: number, total: number): PlaybackStep {
  if (!(total > 0)) return { t: 0, finished: false };
  const next = Math.min(total, Math.max(0, t + dt * clampSpeed(speed)));
  return { t: next, finished: next >= total };
}

/** 倍速标签：整数不带小数（"1x"），否则最多两位小数并去掉末尾 0（"0.25x"、"1.5x"）。 */
export function speedLabel(speed: number): string {
  if (Number.isInteger(speed)) return `${speed}x`;
  const text = (Math.round(speed * 100) / 100).toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  return `${text}x`;
}
