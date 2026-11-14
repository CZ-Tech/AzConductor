import { describe, expect, it } from 'vitest';
import { fromDraft } from '../../src/ui/components/nodeEditor';
import { estimateBrakeZone, parkingBrakeZone } from '../../src/ui/nodeFields';

const draft = {
  x: '0', y: '0', dx: '0', dy: '0', heading: '0', dHeading: '0', duration: '1',
  delayAfterArrive: '0', marker: '', command: '', commandParams: [], maxPower: '1',
  maxSpeed: '30', endSpeed: '0', brakeZoneIn: '', brakeForwardPower: '',
};

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
