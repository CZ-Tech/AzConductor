import { describe, expect, it } from 'vitest';
import { fromDraft } from '../../src/ui/components/nodeEditor';
import { estimateBrakeZone, estimateStartSpeed, parkingBrakeZone } from '../../src/ui/nodeFields';
import { makeNode } from '../../src/core/node';
import { OrientedTrajectory2D } from '../../src/core/spline';

const draft = {
  x: '0', y: '0', dx: '0', dy: '0', heading: '0', dHeading: '0', duration: '1',
  delayAfterArrive: '0', marker: '', command: '', commandParams: [], maxPower: '1',
  maxSpeed: '30', endSpeed: '0', brakeZoneIn: '', brakeForwardPower: '',
};

describe('目标段起速估算', () => {
  const point = (x: number, extra: Partial<Parameters<typeof makeNode>[0]> = {}) =>
    makeNode({ ...extra, x, y: extra.y ?? 0 });

  it('从首点零速累计多个通过点，使用 Hermite 弧长并忽略首点末速度', () => {
    const nodes = [point(0, { x: 0, y: 0, endSpeed: 999, dy: 8 }), point(10), point(20), point(30)];
    const length = nodes.slice(1).reduce((sum, n, i) => sum + new OrientedTrajectory2D(nodes[i]!, n, 1).length, 0);
    const estimate = estimateStartSpeed(nodes, 10);
    expect(estimate?.source).toBe('estimated');
    expect(estimate?.speed).toBeCloseTo(Math.sqrt(2 * 10.5 * length));
    expect(estimateStartSpeed([nodes[0]!], 10)).toEqual({ speed: 0, source: 'initial' });
  });

  it('采用显式目标速度，即使超过限速，再用于后续估算', () => {
    const nodes = [point(0), point(10, { x: 10, y: 0, endSpeed: 30, maxSpeed: 5 })];
    expect(estimateStartSpeed(nodes, 10)).toEqual({ speed: 30, source: 'explicit' });
    expect(estimateStartSpeed([...nodes, point(20)], 10)?.speed).toBeCloseTo(Math.sqrt(30 ** 2 + 2 * 10.5 * 10));
  });

  it('等待后从零重新加速，也处理目标段前点的等待', () => {
    const nodes = [point(0), point(10, { x: 10, y: 0, endSpeed: 20, delayAfterArrive: 1 })];
    expect(estimateStartSpeed(nodes, 10)).toEqual({ speed: 0, source: 'delay' });
    expect(estimateStartSpeed([...nodes, point(20)], 10)?.speed).toBeCloseTo(Math.sqrt(210));
  });

  it('限制加速末速，但不把超限起速瞬间降到限速', () => {
    expect(estimateStartSpeed([point(0), point(10, { x: 10, y: 0, maxSpeed: 5 })], 10)?.speed).toBe(5);
    expect(estimateStartSpeed([point(0), point(10, { x: 10, y: 0, endSpeed: 30 }),
      point(20, { x: 20, y: 0, maxSpeed: 5 })], 10)?.speed).toBe(30);
  });

  it('纯转向短段停车，即使配置显式末速', () => {
    const nodes = [point(0), point(10, { x: 10, y: 0, endSpeed: 20 }),
      point(10.01, { x: 10.01, y: 0, heading: 90, endSpeed: 12 })];
    expect(estimateStartSpeed(nodes, 10)).toEqual({ speed: 0, source: 'heading-only' });
    expect(estimateStartSpeed([...nodes, point(20.01)], 10)?.speed).toBeCloseTo(Math.sqrt(210));
  });

  it('拒绝空列表、无效减速度、几何、等待和后续速度', () => {
    expect(estimateStartSpeed([], 10)).toBeUndefined();
    for (const value of [0, -1, NaN, Infinity]) expect(estimateStartSpeed([point(0)], value)).toBeUndefined();
    for (const extra of [{ x: NaN, y: 0 }, { x: 1, y: 0, dx: Infinity },
      { x: 1, y: 0, delayAfterArrive: -1 }, { x: 1, y: 0, endSpeed: -1 },
      { x: 1, y: 0, maxSpeed: NaN }, { x: 1, y: 0, maxSpeed: 0 }]) {
      expect(estimateStartSpeed([point(0), makeNode(extra)], 10)).toBeUndefined();
    }
    expect(estimateStartSpeed([point(0, { x: 0, y: 0, endSpeed: NaN })], 10))
      .toEqual({ speed: 0, source: 'initial' });
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
