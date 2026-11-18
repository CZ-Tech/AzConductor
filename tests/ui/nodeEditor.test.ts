import { describe, expect, it } from 'vitest';
import { fromDraft, toDraft } from '../../src/ui/components/nodeEditor';
import { commandDraft } from '../../src/ui/components/nodeCommands';
import { estimateBrakeZone, estimateStartSpeed, parkingBrakeZone } from '../../src/ui/nodeFields';
import { DEFAULT_TANGENT_SPEED_SETTINGS, makeNode } from '../../src/core/node';

const draft = {
  x: '0', y: '0', dx: '0', dy: '0', heading: '0', dHeading: '0', duration: '1',
  delayAfterArrive: '0', marker: '', commands: [], maxPower: '1',
  maxSpeed: '30', stopAtNode: false, brakeZoneIn: '', brakeForwardPower: '',
};

describe('有序指令草稿', () => {
  it('完整保留几何、高级字段、重复指令及原参数长度，UI id 不落盘', () => {
    const node = makeNode({ x: 1, y: 2, dx: 3, dy: 4, heading: 50, dHeading: 6,
      duration: 7, delayAfterArrive: 8, marker: 'tag', maxPower: 0.9, maxSpeed: 20,
      stopAtNode: true, brakeZoneIn: 12, brakeForwardPower: 0.2,
      commands: [{ name: 'same', params: ['a', '', 'extra'] }, { name: 'same', params: [] }] });
    const d = toDraft(node);
    expect(new Set(d.commands.map((c) => c.uiId)).size).toBe(2);
    const result = fromDraft(d);
    expect(result).toEqual({ node });
    expect(JSON.stringify(result)).not.toContain('uiId');
    d.commands[0]!.params[0] = 'changed';
    expect(node.commands[0]!.params[0]).toBe('a');
    expect('node' in result && result.node.commands[0]!.params[0]).toBe('a');
  });

  it('空白新增行可忽略，但带参数的无名行必须报错', () => {
    expect(fromDraft({ ...draft, commands: [commandDraft()] })).toMatchObject({ node: { commands: [] } });
    expect(fromDraft({ ...draft, commands: [commandDraft({ name: '  ', params: [''] })] })).toHaveProperty('errors.commands');
  });

  it('重排保留行身份和独立参数，保存保持顺序及无效参数草稿', () => {
    const a = commandDraft({ name: 'same', params: ['1'] });
    const b = commandDraft({ name: 'same', params: ['2', ''] });
    const d = { ...draft, commands: [b, a] };
    expect(d.commands.map((c) => c.uiId)).toEqual([b.uiId, a.uiId]);
    expect(fromDraft(d)).toMatchObject({ node: { commands: [
      { name: 'same', params: ['2', ''] }, { name: 'same', params: ['1'] },
    ] } });
  });
});

describe('目标段起速估算', () => {
  const speed = (tangentSpeedRatio: number) => ({ ...DEFAULT_TANGENT_SPEED_SETTINGS, tangentSpeedRatio });
  const point = (x: number, extra: Partial<Parameters<typeof makeNode>[0]> = {}) => makeNode({ ...extra, x, y: 0 });

  it('按同一全局比例从上一节点推算，忽略旧固定速度并遵守限速', () => {
    const nodes = [point(0), point(10, { dx: 3, dy: 4, endSpeed: 999, maxSpeed: 8 })];
    expect(estimateStartSpeed(nodes, speed(0.5))).toEqual({ speed: 2.5, source: 'tangent' });
    expect(estimateStartSpeed(nodes, speed(2))).toEqual({ speed: 8, source: 'tangent' });
    expect(estimateStartSpeed(nodes, { ...speed(2), maxEstimatedSpeed: 4 })).toEqual({ speed: 4, source: 'tangent' });
    expect(estimateStartSpeed(nodes, speed(0))).toEqual({ speed: 0, source: 'tangent' });
    expect(estimateStartSpeed([nodes[0]!], speed(2))).toEqual({ speed: 0, source: 'initial' });
  });

  it('等待、停车和纯转向后从零开始', () => {
    const head = [point(0)];
    expect(estimateStartSpeed([...head, point(10, { dx: 3, delayAfterArrive: 1 })], speed(1))).toEqual({ speed: 0, source: 'delay' });
    expect(estimateStartSpeed([...head, point(10, { dx: 3, stopAtNode: true })], speed(1))).toEqual({ speed: 0, source: 'tangent' });
    expect(estimateStartSpeed([...head, point(0.01, { heading: 90 })], speed(1))).toEqual({ speed: 0, source: 'heading-only' });
  });

  it('拒绝空列表和无法估算的比例、几何、等待或速度上限', () => {
    expect(estimateStartSpeed([], speed(1))).toBeUndefined();
    for (const ratio of [-1, NaN, Infinity]) expect(estimateStartSpeed([point(0)], speed(ratio))).toBeUndefined();
    for (const extra of [{ dx: Infinity }, { delayAfterArrive: -1 }, { maxSpeed: NaN }, { maxSpeed: 0 }]) {
      expect(estimateStartSpeed([point(0), point(10, extra)], speed(1))).toBeUndefined();
    }
  });
});

describe('制动区编辑', () => {
  it('联立加速与放大后的制动距离，支持非零起点和目标速度', () => {
    const acceleration = 1.05 * 10;
    const brakingFactor = 1.05 / (2 * 10);
    const accelerationFactor = 1 / (2 * acceleration);
    const peakSquared = (100 + 10 ** 2 * accelerationFactor + 5 ** 2 * brakingFactor) /
      (accelerationFactor + brakingFactor);
    expect(estimateBrakeZone(100, 10, 10, undefined, 5)).toBeCloseTo((peakSquared - 25) * brakingFactor);
    expect(estimateBrakeZone(100, 0, 10, 20, 0)).toBeCloseTo(21);
    expect(estimateBrakeZone(100, 0, 10, 100, 0)).toBeCloseTo(100 * brakingFactor / (accelerationFactor + brakingFactor));
  });

  it('起点超限时以起点速度保守估算，路径不足时不截断制动距离', () => {
    expect(estimateBrakeZone(100, 30, 10, 20, 0)).toBeCloseTo(47.25);
    expect(estimateBrakeZone(20, 30, 10, undefined, 0)).toBeCloseTo(47.25);
    expect(estimateBrakeZone(0, 0, 10, undefined, 30)).toBe(0);
    expect(estimateBrakeZone(1, 0, 10, undefined, 30)).toBe(0);
  });

  it('拒绝无效参数', () => {
    for (const invalid of [-1, NaN, Infinity]) {
      expect(estimateBrakeZone(invalid, 0, 10, undefined, 0)).toBeUndefined();
      expect(estimateBrakeZone(10, invalid, 10, undefined, 0)).toBeUndefined();
      expect(estimateBrakeZone(10, 0, invalid, undefined, 0)).toBeUndefined();
      expect(estimateBrakeZone(10, 0, 10, invalid, 0)).toBeUndefined();
      expect(estimateBrakeZone(10, 0, 10, undefined, invalid)).toBeUndefined();
    }
    expect(estimateBrakeZone(10, 0, 0, undefined, 0)).toBeUndefined();
  });

  it('保存停车动作但不保留旧路线的固定速度', () => {
    const old = makeNode({ x: 0, y: 0, endSpeed: 0 });
    expect(fromDraft(toDraft(old))).not.toHaveProperty('node.endSpeed');
    expect(fromDraft({ ...draft, stopAtNode: true })).toHaveProperty('node.stopAtNode', true);
    expect(fromDraft(draft)).not.toHaveProperty('node.stopAtNode');
  });

  it('自动值不写入节点；手动值及零值保留，清空恢复自动', () => {
    const auto = fromDraft(draft);
    expect('node' in auto && Object.hasOwn(auto.node, 'brakeZoneIn')).toBe(false);
    expect(fromDraft({ ...draft, brakeZoneIn: '12' })).toMatchObject({ node: { brakeZoneIn: 12 } });
    expect(fromDraft({ ...draft, brakeZoneIn: '0' })).toMatchObject({ node: { brakeZoneIn: 0 } });
    const cleared = fromDraft({ ...draft, brakeZoneIn: '  ' });
    expect('node' in cleared && Object.hasOwn(cleared.node, 'brakeZoneIn')).toBe(false);
    expect(fromDraft({ ...draft, brakeZoneIn: 'bad' })).toHaveProperty('errors.brakeZoneIn');
  });

  it('停车预设仅保留已有正手动值', () => {
    expect(parkingBrakeZone('12.5')).toBe('12.5');
    for (const value of ['', '0', '-1', 'bad']) expect(parkingBrakeZone(value)).toBe('');
  });
});
