import { describe, expect, it } from 'vitest';
import { cloneCommands, makeNode, nodesClose } from '../../src/core/node';
import { decodeRobotRoute, encodeNodeFrame, encodeRobotRoute, canonicalRoute, fingerprint } from '../../src/core/wire';
import { validateNodes, validateRobotIssues } from '../../src/core/contract';
import { decodeRoutesDoc, encodeRoutesDoc, exportRouteJson, exportRobotWireJson, importValue } from '../../src/core/archive';

const commands = [
  { name: 'auto.shoot', params: ['3200', '500', '250'] },
  { name: 'auto.waitMillis', params: ['100'] },
  { name: 'auto.shoot', params: ['3000', '0', '200'] },
];

describe('版本化路线和命令列表', () => {
  it('makeNode/cloneCommands 深复制每层，默认无命令', () => {
    expect(makeNode({ x: 0, y: 0 }).commands).toEqual([]);
    const node = makeNode({ x: 0, y: 0, commands });
    const copy = cloneCommands(node.commands);
    expect(node.commands).not.toBe(commands);
    copy.forEach((command, i) => {
      expect(command).not.toBe(node.commands[i]);
      expect(command.params).not.toBe(node.commands[i]!.params);
    });
    copy[0]!.params[0] = 'changed';
    expect(node.commands).toEqual(commands);
  });

  it('只输出v2路线封装及commands，重复命令和顺序无损', () => {
    const nodes = [makeNode({ x: 0, y: 0, commands, delayAfterArrive: 0.5 })];
    const encoded = encodeRobotRoute(nodes);
    expect(encoded.version).toBe(2);
    expect(encoded.frames[0]).toMatchObject({ commands });
    expect(encoded.frames[0]).not.toHaveProperty('command');
    expect(encoded.frames[0]).not.toHaveProperty('commandParams');
    expect(encoded.frames[0]).not.toHaveProperty('version');
    expect(encoded.frames[1]).toEqual({ wait: 0.5 });
    expect(encodeNodeFrame(makeNode({ x: 0, y: 0 }))['commands']).toEqual([]);
    expect(decodeRobotRoute(JSON.parse(JSON.stringify(encoded)))).toEqual(nodes);
  });

  it.each([
    {}, { frames: [] }, { version: 2 }, { version: 2, frames: null },
    { version: 2, frames: {} }, { version: '2', frames: [] },
    { version: 1, frames: [] }, { version: 3, frames: [] }, { version: null, frames: [] },
  ])('错误封装严格拒绝 %j', (value) => {
    expect(() => decodeRobotRoute(value)).toThrow();
    expect(importValue(value).ok).toBe(false);
    expect(validateRobotIssues(value).length).toBeGreaterThan(0);
  });

  it('v1单字段与v2单元素列表具有相同语义，缺省params为空', () => {
    const old = decodeRobotRoute([{ x: 1, y: 2, command: 'shoot', commandParams: ['1', ''] }]);
    const modern = decodeRobotRoute({ version: 2, frames: [{ x: 1, y: 2, commands: [{ name: 'shoot', params: ['1', ''] }] }] });
    expect(old).toEqual(modern);
    expect(canonicalRoute(old)).toBe(canonicalRoute(modern));
    expect(decodeRobotRoute([{ x: 0, y: 0, commands: [{ name: 'go' }] }])[0]!.commands).toEqual([{ name: 'go', params: [] }]);
  });

  it.each([
    { commands: null }, { commands: {} }, { commands: [null] }, { commands: ['shoot'] },
    { commands: [{}] }, { commands: [{ name: '' }] }, { commands: [{ name: ' ' }] },
    { commands: [{ name: 1 }] }, { commands: [{ name: 'shoot', params: null }] },
    { commands: [{ name: 'shoot', params: '1' }] }, { commands: [{ name: 'shoot', params: [1] }] },
    { command: 'old', commands: [{ name: 'new' }] }, { command: 1 }, { command: 'old', commandParams: [false] },
  ])('导入与上传校验共同拒绝非法命令 %j', (extra) => {
    const value = { version: 2, frames: [{ x: 0, y: 0, ...extra }] };
    expect(() => decodeRobotRoute(value)).toThrow();
    expect(importValue(value).ok).toBe(false);
    expect(validateRobotIssues(value).some((i) => i.field === 'commands')).toBe(true);
  });

  it('旧/新只有一侧非空允许；wait上的列表事件拒绝导入而不丢失', () => {
    expect(decodeRobotRoute([{ x: 0, y: 0, command: 'old', commands: [] }])[0]!.commands).toEqual([{ name: 'old', params: [] }]);
    expect(decodeRobotRoute([{ x: 0, y: 0, command: '', commands: [{ name: 'new' }] }])[0]!.commands).toEqual([{ name: 'new', params: [] }]);
    const value = { version: 2, frames: [{ x: 0, y: 0 }, { wait: 1, commands: [{ name: 'shoot' }] }] };
    expect(() => decodeRobotRoute(value)).toThrow('带事件的独立 wait 无法无损导入控制点模型');
    expect(importValue(value).ok).toBe(false);
    // 固件支持这种帧，上传校验只校验结构，不套用ControlNode的无损导入限制。
    expect(validateRobotIssues(value)).toEqual([]);
    expect(decodeRobotRoute([{ x: 0, y: 0 }, { wait: 1, commands: [] }])[0]!.delayAfterArrive).toBe(1);
  });

  it('nodesClose及内部校验比较有序列表和参数', () => {
    const a = makeNode({ x: 0, y: 0, commands });
    const b = makeNode(a);
    expect(nodesClose(a, b)).toBe(true);
    b.commands[0]!.params[0] = 'changed';
    expect(nodesClose(a, b)).toBe(false);
    expect(validateNodes([makeNode({ x: 0, y: 0, commands: [{ name: '', params: [] }] })]).some((i) => i.field === 'commands')).toBe(true);
  });

  it('每路存档版本化，旧存档升级，内部RouteData形状不变', () => {
    const legacy = [{ robotName: 'r', routes: [{ name: 'old', points: [{ x: 0, y: 0, command: 'shoot', commandParams: ['1'] }] }] }];
    const doc = decodeRoutesDoc(legacy);
    expect(Object.keys(doc[0]!.routes[0]!)).toEqual(['name', 'points']);
    const stored = encodeRoutesDoc(doc) as Array<{ routes: Array<{ version: number; points: unknown[] }> }>;
    expect(stored[0]!.routes[0]!.version).toBe(2);
    expect(stored[0]!.routes[0]!.points[0]).toMatchObject({ commands: [{ name: 'shoot', params: ['1'] }] });
    expect(decodeRoutesDoc(stored)).toEqual(doc);
    for (const version of [1, 3, '2', null]) {
      expect(() => decodeRoutesDoc([{ routes: [{ name: 'bad', version, points: [] }] }])).toThrow();
      expect(importValue([{ routes: [{ name: 'bad', version, points: [] }] }]).ok).toBe(false);
    }
    const points = [makeNode({ x: 0, y: 0, commands, delayAfterArrive: 2 })];
    expect(JSON.parse(exportRouteJson(points))).toEqual(JSON.parse(exportRobotWireJson(points)));
    expect(importValue(JSON.parse(exportRouteJson(points))).ok).toBe(true);
  });
});

describe('版本无关语义指纹回归', () => {
  it('旧规范文本与硬编码FNV基线保持不变', () => {
    const old = '[{"x":0,"dx":0,"y":0,"dy":0,"heading":0,"dHeading":0,"duration":1,"marker":"","command":"","commandParams":[],"maxPower":1,"brakeZoneIn":0}]';
    const canonical = canonicalRoute(decodeRobotRoute(JSON.parse(old)));
    expect(canonical).toBe(old);
    expect(fingerprint(canonical)).toBe('bce00bbcba463bf8');
  });

  it('多命令列表参数和顺序都参与指纹，封装版本不参与', () => {
    const nodes = [makeNode({ x: 0, y: 0, commands })];
    const canonical = canonicalRoute(nodes);
    expect(canonical).toContain('"commands"');
    expect(canonical).not.toContain('"version"');
    expect(canonicalRoute(decodeRobotRoute(encodeRobotRoute(nodes).frames))).toBe(canonical);
    expect(canonicalRoute(decodeRobotRoute(encodeRobotRoute(nodes)))).toBe(canonical);
    const changed = [makeNode(nodes[0]!)];
    changed[0]!.commands[0]!.params[0] = '3300';
    const reordered = [makeNode({ x: 0, y: 0, commands: [...commands].reverse() })];
    expect(new Set([nodes, changed, reordered].map((n) => fingerprint(canonicalRoute(n)))).size).toBe(3);
  });
});
