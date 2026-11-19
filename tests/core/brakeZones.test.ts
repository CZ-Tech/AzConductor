import { describe, expect, it } from 'vitest';
import { clearBrakeZones, makeNode } from '../../src/core/node';
import { encodeRobotRoute } from '../../src/core/wire';

describe('清空手动制动区', () => {
  it('删除所有显式 brakeZoneIn（含 0），未填写的点保持原对象', () => {
    const manual = makeNode({ x: 0, y: 0, brakeZoneIn: 12 });
    const zero = makeNode({ x: 1, y: 0, brakeZoneIn: 0 });
    const blank = makeNode({ x: 2, y: 0 });
    const result = clearBrakeZones([manual, zero, blank]);
    expect(result.cleared).toBe(2);
    expect('brakeZoneIn' in result.nodes[0]!).toBe(false);
    expect('brakeZoneIn' in result.nodes[1]!).toBe(false);
    expect(result.nodes[2]).toBe(blank);
    // 输入不被修改
    expect(manual.brakeZoneIn).toBe(12);
  });

  it('清空后的线路不再下发 brakeZoneIn，由机器人自动计算', () => {
    const route = [makeNode({ x: 0, y: 0 }), makeNode({ x: 24, y: 0, dx: 10, brakeZoneIn: 8 })];
    const cleared = clearBrakeZones(route).nodes;
    const frames = encodeRobotRoute(cleared).frames;
    expect(frames[1]).not.toHaveProperty('brakeZoneIn');
    expect(route[1]!.brakeZoneIn).toBe(8);
  });

  it('没有显式值时清空数量为 0，返回原数组内容', () => {
    const route = [makeNode({ x: 0, y: 0 }), makeNode({ x: 10, y: 0 })];
    const result = clearBrakeZones(route);
    expect(result.cleared).toBe(0);
    expect(result.nodes).toEqual(route);
  });
});
