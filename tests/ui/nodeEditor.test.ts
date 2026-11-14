import { describe, expect, it } from 'vitest';
import { fromDraft } from '../../src/ui/components/nodeEditor';
import { estimateBrakeZone, parkingBrakeZone } from '../../src/ui/nodeFields';

const draft = {
  x: '0', y: '0', dx: '0', dy: '0', heading: '0', dHeading: '0', duration: '1',
  delayAfterArrive: '0', marker: '', command: '', commandParams: [], maxPower: '1',
  maxSpeed: '30', endSpeed: '0', brakeZoneIn: '', brakeForwardPower: '',
};

describe('制动区编辑', () => {
  it('仅在两个速度均有值时静态估算，速度差为负时归零', () => {
    expect(estimateBrakeZone('30', '0')).toBeCloseTo(15.75);
    expect(estimateBrakeZone('30', '10')).toBeCloseTo(14);
    expect(estimateBrakeZone('10', '30')).toBe(0);
    expect(estimateBrakeZone('', '0')).toBeUndefined();
    expect(estimateBrakeZone('30', '')).toBeUndefined();
    expect(estimateBrakeZone('bad', '0')).toBeUndefined();
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
