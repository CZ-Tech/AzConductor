import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BRAKE_DECELERATION, estimateBrakeZoneAt, isManualBrakeZone, recomputeBrakeZones, type BrakeZoneConfig,
} from '../../src/core/brake';
import { makeNode, type ControlNode } from '../../src/core/node';

const config: BrakeZoneConfig = { brakeDeceleration: 30, speed: { tangentSpeedRatio: 1, maxEstimatedSpeed: 50 } };

/** 30 in 一段、切线 10 in/s 的三点直线路径。 */
function straight(): ControlNode[] {
  return [
    makeNode({ x: 0, y: 0, dx: 0, dy: 0 }),
    makeNode({ x: 30, y: 0, dx: 10, dy: 0 }),
    makeNode({ x: 60, y: 0, dx: 0, dy: 0 }),
  ];
}

describe('制动区批量重算', () => {
  it('离线默认减速度与固件一致', () => {
    expect(DEFAULT_BRAKE_DECELERATION).toBe(30);
  });

  it('只填自动制动区：留空和 0 都视为自动，首个控制点不动', () => {
    const points = straight();
    points[1]!.brakeZoneIn = 0;
    const result = recomputeBrakeZones(points, config);
    expect(result.points[0]).toBe(points[0]);
    expect(result.points[1]!.brakeZoneIn).toBeCloseTo(14.9, 1);
    expect(result.points[2]!.brakeZoneIn).toBeCloseTo(16.56, 1);
    expect(result.updated).toBe(2);
    expect(result.kept).toBe(0);
    expect(result.skipped).toBe(0);
    // 输入不被修改
    expect(points[1]!.brakeZoneIn).toBe(0);
    expect('brakeZoneIn' in points[2]!).toBe(false);
  });

  it('手动值默认保留，勾选覆盖后按机器配置重算', () => {
    const points = straight();
    points[1]!.brakeZoneIn = 5;
    const kept = recomputeBrakeZones(points, config);
    expect(kept.points[1]!.brakeZoneIn).toBe(5);
    expect(kept.kept).toBe(1);
    expect(kept.updated).toBe(1);

    const replaced = recomputeBrakeZones(points, { ...config, overwriteManual: true });
    expect(replaced.points[1]!.brakeZoneIn).toBeCloseTo(14.9, 1);
    expect(replaced.kept).toBe(0);
    expect(replaced.updated).toBe(2);
  });

  it('重复重算幂等：第二次不再产生改动', () => {
    const once = recomputeBrakeZones(straight(), { ...config, overwriteManual: true });
    const twice = recomputeBrakeZones(once.points, { ...config, overwriteManual: true });
    expect(twice.updated).toBe(0);
    expect(twice.points).toEqual(once.points);
  });

  it('估算不出有效制动距离时保持自动（留空）；覆盖模式下清除旧手动值', () => {
    // 两点重叠、无长度：无法估算
    const points = [
      makeNode({ x: 0, y: 0 }),
      makeNode({ x: 0, y: 0, brakeZoneIn: 4 }),
    ];
    expect(estimateBrakeZoneAt(points, 1, config)).toBeUndefined();
    const kept = recomputeBrakeZones(points, config);
    expect(kept.points[1]!.brakeZoneIn).toBe(4);
    expect(kept.skipped).toBe(0);

    const overwritten = recomputeBrakeZones(points, { ...config, overwriteManual: true });
    expect('brakeZoneIn' in overwritten.points[1]!).toBe(false);
    expect(overwritten.skipped).toBe(1);
    expect(overwritten.cleared).toBe(1);
  });

  it('减速配置变化会改变结果，单个点估算与重算结果一致', () => {
    const points = straight();
    const soft = recomputeBrakeZones(points, { ...config, overwriteManual: true });
    const hard = recomputeBrakeZones(points, { ...config, brakeDeceleration: 60, overwriteManual: true });
    expect(hard.points[2]!.brakeZoneIn!).toBeLessThan(soft.points[2]!.brakeZoneIn!);
    expect(hard.points[2]!.brakeZoneIn).toBe(Math.round(estimateBrakeZoneAt(points, 2, { ...config, brakeDeceleration: 60 })! * 100) / 100);
  });

  it('手动制动区的判定：缺省和 0 都是自动', () => {
    expect(isManualBrakeZone(makeNode({ x: 0, y: 0 }))).toBe(false);
    expect(isManualBrakeZone(makeNode({ x: 0, y: 0, brakeZoneIn: 0 }))).toBe(false);
    expect(isManualBrakeZone(makeNode({ x: 0, y: 0, brakeZoneIn: 2 }))).toBe(true);
  });
});
