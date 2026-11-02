import { describe, expect, it } from 'vitest';
import {
  FRAME_STEP,
  SPEED_DEFAULT,
  SPEED_MAX,
  SPEED_MIN,
  SPEED_PRESETS,
  advance,
  clampSpeed,
  speedLabel,
} from '../../src/core/playback';
import { between, rng } from './_util';

describe('advance（Kotlin ComposeAppCommonTest 移植）', () => {
  it('testAdvancePlaybackTimeAppliesSpeed', () => {
    // 原速推进一帧
    expect(advance(1, FRAME_STEP, 1, 10).t).toBeCloseTo(1.016, 6);
    // 2 倍速推进一帧
    expect(advance(1, FRAME_STEP, 2, 10).t).toBeCloseTo(1.032, 6);
    // 0.5 倍速推进一帧
    expect(advance(1, FRAME_STEP, 0.5, 10).t).toBeCloseTo(1.008, 6);
  });

  it('testAdvancePlaybackTimeClampsAtTotalTime', () => {
    const s = advance(9.99, FRAME_STEP, 4, 10);
    expect(s.t).toBeCloseTo(10, 6);
    expect(s.finished).toBe(true);
    // 无有效路径时不推进
    expect(advance(0, FRAME_STEP, 4, 0).t).toBeCloseTo(0, 6);
  });

  it('testAdvancePlaybackTimeClampsSpeedToAllowedRange', () => {
    expect(advance(1, FRAME_STEP, SPEED_MIN, 10).t).toBeCloseTo(advance(1, FRAME_STEP, 0, 10).t, 6);
    expect(advance(1, FRAME_STEP, SPEED_MAX, 10).t).toBeCloseTo(advance(1, FRAME_STEP, 100, 10).t, 6);
  });

  it('testSpeedLabelFormatting', () => {
    expect(speedLabel(1)).toBe('1x');
    expect(speedLabel(2)).toBe('2x');
    expect(speedLabel(3)).toBe('3x');
    expect(speedLabel(0.5)).toBe('0.5x');
    expect(speedLabel(1.5)).toBe('1.5x');
    expect(speedLabel(0.25)).toBe('0.25x');
  });

  it('testPlaybackSpeedPresetsStayWithinClampRange', () => {
    const presets = SPEED_PRESETS;
    expect(presets.length, '倍速档位不能为空').toBeGreaterThan(0);
    expect([...presets].sort((a, b) => a - b), '倍速档位应递增排列').toEqual([...presets]);
    expect(presets, '默认倍速应在档位中').toContain(SPEED_DEFAULT);
    expect(presets, '应包含 3 倍速档位').toContain(3);
    expect(presets, '不应再包含 8 倍速档位').not.toContain(8);
    expect(presets, '不应再包含 1.5 倍速档位').not.toContain(1.5);
    for (const p of presets) {
      expect(p >= SPEED_MIN && p <= SPEED_MAX, `倍速档位 ${p} 超出钳制区间`).toBe(true);
    }
  });
});

describe('常量', () => {
  it('与 Kotlin TimingConfig 一致', () => {
    expect(SPEED_PRESETS).toEqual([0.25, 0.5, 1, 2, 3, 4]);
    expect(SPEED_MIN).toBe(0.25);
    expect(SPEED_MAX).toBe(4);
    expect(SPEED_DEFAULT).toBe(1);
    expect(FRAME_STEP).toBe(0.016);
  });
});

describe('clampSpeed', () => {
  it('钳制到 [0.25, 4]', () => {
    expect(clampSpeed(0)).toBe(0.25);
    expect(clampSpeed(-5)).toBe(0.25);
    expect(clampSpeed(0.25)).toBe(0.25);
    expect(clampSpeed(1.7)).toBe(1.7);
    expect(clampSpeed(4)).toBe(4);
    expect(clampSpeed(100)).toBe(4);
  });
});

describe('advance 边界', () => {
  it('total <= 0（含负数、NaN）恒为 {t:0, finished:false}', () => {
    expect(advance(5, 0.1, 1, 0)).toEqual({ t: 0, finished: false });
    expect(advance(5, 0.1, 1, -3)).toEqual({ t: 0, finished: false });
    expect(advance(5, 0.1, 1, NaN)).toEqual({ t: 0, finished: false });
  });

  it('未到终点：finished=false', () => {
    const s = advance(1, 0.1, 1, 10);
    expect(s.t).toBeCloseTo(1.1, 12);
    expect(s.finished).toBe(false);
  });

  it('恰好到达终点：finished=true 且 t=total', () => {
    expect(advance(9, 1, 1, 10)).toEqual({ t: 10, finished: true });
  });

  it('已位于终点：保持并 finished=true', () => {
    expect(advance(10, 0.016, 1, 10)).toEqual({ t: 10, finished: true });
  });

  it('t 超出范围被钳制', () => {
    expect(advance(50, 0, 1, 10)).toEqual({ t: 10, finished: true });
    expect(advance(-5, 0, 1, 10)).toEqual({ t: 0, finished: false });
  });

  it('负 dt（倒退）不低于 0', () => {
    expect(advance(0.01, -1, 1, 10)).toEqual({ t: 0, finished: false });
  });

  it('属性：结果始终在 [0,total]，单调不减，finished 当且仅当 t==total', () => {
    const r = rng(77);
    for (let i = 0; i < 500; i++) {
      const total = between(r, 0.1, 30);
      const t = between(r, 0, total);
      const speed = between(r, -1, 8);
      const s = advance(t, FRAME_STEP, speed, total);
      expect(s.t).toBeGreaterThanOrEqual(t);
      expect(s.t).toBeLessThanOrEqual(total);
      expect(s.finished).toBe(s.t >= total);
      // 步长 = dt * clampSpeed(speed)（未触顶时）
      if (!s.finished) expect(s.t - t).toBeCloseTo(FRAME_STEP * clampSpeed(speed), 10);
    }
  });
});

describe('speedLabel', () => {
  it('整数不带小数；其余最多两位并去掉末尾 0', () => {
    expect(speedLabel(4)).toBe('4x');
    expect(speedLabel(0)).toBe('0x');
    expect(speedLabel(1.25)).toBe('1.25x');
    expect(speedLabel(1.2)).toBe('1.2x');
    expect(speedLabel(0.1)).toBe('0.1x');
    expect(speedLabel(2.005)).toMatch(/^2(\.0?1)?x$/);
  });

  it('超过两位小数四舍五入', () => {
    expect(speedLabel(0.333)).toBe('0.33x');
    expect(speedLabel(0.666)).toBe('0.67x');
  });

  it('所有预设的标签', () => {
    expect(SPEED_PRESETS.map(speedLabel)).toEqual(['0.25x', '0.5x', '1x', '2x', '3x', '4x']);
  });
});
