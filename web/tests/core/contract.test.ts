import { describe, expect, it } from 'vitest';
import { makeNode, nextWaypoint, type ControlNode } from '../../src/core/node';
import {
  primitiveContent,
  primitiveDouble,
  validateNodes,
  validateRobotFrames,
  validateRobotIssues,
  validateRobotJson,
} from '../../src/core/contract';
import { decodeRobotRoute, encodeRobotRoute } from '../../src/core/wire';
import {
  decodeRoutesDoc,
  encodeStoredNode,
  exportRouteJson,
  importText,
  serializeRoutesDoc,
  wrapRoutes,
} from '../../src/core/archive';
import { OrientedTrajectory2D, normalizeRelative } from '../../src/core/spline';

/** Kotlin: ControlNode(x = x, y = 0.0, dx = 20.0, dy = 0.0) */
const point = (x = 0): ControlNode => makeNode({ x, y: 0, dx: 20, dy: 0 });

describe('SplineRouteContractTest（Kotlin 移植）', () => {
  it('legacyNodesRoundTripWithoutExplicitNullMotionFields', () => {
    const legacy = '[{"x":0,"y":0,"dx":20,"dy":0,"duration":2}]';
    const r = importText(legacy);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const nodes = r.routes[0]!.points;
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.maxPower).toBe(1);
    expect(nodes[0]!.endSpeed).toBeUndefined();
    const serialized = JSON.stringify(nodes.map(encodeStoredNode));
    expect(serialized).not.toContain('"endSpeed"');
    expect(serialized).not.toContain('"maxSpeed"');
    expect(serialized).not.toContain('"brakeForwardPower"');
    expect(serialized).not.toContain(':null');
    expect(serialized).not.toContain('null');
  });

  it('explicitBrakingFieldsSurviveRobotAndArchiveRoundTrip', () => {
    const original = [
      point(),
      { ...point(50), maxPower: 0.7, maxSpeed: 24, endSpeed: 0, brakeZoneIn: 12, brakeForwardPower: 0.2 },
    ];
    // 裸 ControlNode[] JSON（Kotlin: json.encodeToString(original)）
    const robotJson = exportRouteJson(original);
    const r = importText(robotJson);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.kind).toBe('nodes');
    const decoded = r.routes[0]!.points;
    expect(decoded).toStrictEqual(original);
    expect(validateNodes(decoded)).toEqual([]);

    // 机器人线格式也无损
    expect(decodeRobotRoute(JSON.parse(JSON.stringify(encodeRobotRoute(original))))).toStrictEqual(original);

    // 存档
    const archive = serializeRoutesDoc(wrapRoutes([{ name: 'test', points: original }]));
    const decodedArchive = decodeRoutesDoc(JSON.parse(archive));
    expect(decodedArchive[0]!.routes[0]!.points).toStrictEqual(original);
    const viaImport = importText(archive);
    expect(viaImport.ok && viaImport.kind).toBe('archive');
  });

  it('validatorOnlyRejectsInvalidFields', () => {
    const points = [
      point(),
      { ...point(5), endSpeed: 0, dHeading: 20, command: 'shoot', delayAfterArrive: 1 },
    ];
    const issues = validateNodes(points);
    expect(issues.some((i) => i.field === 'brakeZoneIn')).toBe(true);
    expect(issues.some((i) => i.field === 'dHeading')).toBe(false);
    expect(issues.some((i) => i.field === 'command')).toBe(false);
    expect(issues.some((i) => i.field === 'endSpeed')).toBe(false);
    expect(issues).toEqual([
      { index: 1, field: 'brakeZoneIn', message: '设置 endSpeed 后必须提供大于 0 的制动区距离' },
    ]);
  });

  it('waypointInsertionDoesNotCloneCommandsAndStoppingActions', () => {
    const prior = {
      ...point(),
      command: 'shoot',
      marker: 'A',
      commandParams: ['1'],
      delayAfterArrive: 2,
      endSpeed: 0,
      brakeZoneIn: 10,
      maxPower: 0.5,
      maxSpeed: 24,
    };
    const next = nextWaypoint(prior, 12, 10);
    expect(next.marker).toBe('');
    expect(next.command).toBe('');
    expect(next.commandParams).toEqual([]);
    expect(next.endSpeed).toBeUndefined();
    expect('endSpeed' in next).toBe(false);
    expect(next.brakeZoneIn).toBe(0);
    expect(next.maxPower).toBe(0.5);
    expect(next.maxSpeed).toBe(24);
    expect(next.x).toBe(12);
    expect(next.y).toBe(10);
    expect(next.delayAfterArrive).toBe(0);
  });

  it('previewHeadingMatchesRobotZeroDerivativeSplineAndHalfTurnTie', () => {
    const spline = new OrientedTrajectory2D(
      { x: 0, dx: 10, y: 0, dy: 0, heading: 0, dHeading: 100 },
      { x: 10, dx: 10, y: 0, dy: 0, heading: 90, dHeading: -100 },
      2,
    );
    expect(spline.pointAtTime(0.5).heading).toBeCloseTo(14.0625, 7);
    expect(normalizeRelative(0, -180)).toBeCloseTo(180, 7);
  });

  it('rawRobotWireContractAllowsWaitAndRejectsMalformedFields', () => {
    const valid = '[{"x":0,"y":0},{"wait":0.5},{"x":24,"y":0,"maxPower":0.5,"endSpeed":0,"brakeZoneIn":8}]';
    expect(validateRobotJson(valid)).toEqual([]);
    const bad = '[{"x":0,"y":0},{"x":24,"y":0,"endSpeed":null,"maxSpeed":-1}]';
    expect(validateRobotJson(bad).some((i) => i.field === 'endSpeed')).toBe(true);
    expect(validateRobotJson(bad).some((i) => i.field === 'maxSpeed')).toBe(true);
    expect(validateRobotJson('{"routes":[]}').some((i) => i.field === 'json')).toBe(true);
  });

  it('delayWaitFramesRoundTripWithoutDoubleCounting', () => {
    const original = [
      { ...point(), delayAfterArrive: 1.5 },
      { ...point(20), duration: 2, delayAfterArrive: 2.5, endSpeed: 0, brakeZoneIn: 10 },
    ];
    const wire = JSON.stringify(encodeRobotRoute(original));
    const frames = JSON.parse(wire) as Array<Record<string, unknown>>;
    expect(frames).toHaveLength(4);
    expect('delayAfterArrive' in frames[0]!).toBe(false);
    expect(String(frames[1]!['wait'])).toBe('1.5');
    expect(String(frames[3]!['wait'])).toBe('2.5');
    expect(decodeRobotRoute(frames)).toStrictEqual(original);
    expect(validateRobotJson(wire)).toEqual([]);
  });

  it('independentWaitBeforeFirstPointCannotBeSilentlyImported', () => {
    const bad = [{ wait: 2 }, { x: 0, y: 0 }];
    expect(() => decodeRobotRoute(bad)).toThrow('起始点之前的 wait 无法在控制点模型中表示');
    const oldRobotNodes = [{ x: 0, y: 1 }, { x: 2, y: 1, delayAfterArrive: 2 }];
    const nodes = decodeRobotRoute(oldRobotNodes);
    expect(nodes[nodes.length - 1]!.delayAfterArrive).toBe(2);
  });
});

describe('validateNodes 逐条文案（与 Kotlin 逐字一致）', () => {
  const base = point();
  const one = (patch: Partial<ControlNode>) => validateNodes([{ ...base, ...patch }]);

  it('空路径', () => {
    expect(validateNodes([])).toEqual([{ message: '路径至少需要一个起始控制点' }]);
  });

  it('合法节点无问题', () => {
    expect(validateNodes([base, point(10)])).toEqual([]);
    expect(one({ maxPower: 0 })).toEqual([]);
    expect(one({ maxPower: 1 })).toEqual([]);
    expect(one({ duration: 0, delayAfterArrive: 0 })).toEqual([]);
    expect(one({ endSpeed: 0, brakeZoneIn: 0.1 })).toEqual([]);
  });

  it('数值字段必须有限', () => {
    for (const f of ['x', 'y', 'dx', 'dy', 'heading', 'dHeading'] as const) {
      expect(one({ [f]: NaN })).toEqual([{ index: 0, field: f, message: `${f} 必须为有限数值` }]);
      expect(one({ [f]: Infinity })).toEqual([{ index: 0, field: f, message: `${f} 必须为有限数值` }]);
    }
  });

  it('duration / delayAfterArrive', () => {
    expect(one({ duration: -1 })).toEqual([{ index: 0, field: 'duration', message: '预览时长不得为负数或非有限值' }]);
    expect(one({ duration: NaN })).toEqual([{ index: 0, field: 'duration', message: '预览时长不得为负数或非有限值' }]);
    expect(one({ delayAfterArrive: -0.1 })).toEqual([
      { index: 0, field: 'delayAfterArrive', message: '到点等待不得为负数或非有限值' },
    ]);
    expect(one({ delayAfterArrive: Infinity })).toEqual([
      { index: 0, field: 'delayAfterArrive', message: '到点等待不得为负数或非有限值' },
    ]);
  });

  it('maxPower 必须位于 [0,1]', () => {
    const msg = '巡航功率必须位于 0 到 1';
    expect(one({ maxPower: -0.01 })).toEqual([{ index: 0, field: 'maxPower', message: msg }]);
    expect(one({ maxPower: 1.01 })).toEqual([{ index: 0, field: 'maxPower', message: msg }]);
    expect(one({ maxPower: NaN })).toEqual([{ index: 0, field: 'maxPower', message: msg }]);
  });

  it('maxSpeed 须 >0 或留空', () => {
    const msg = '速度上限必须大于 0 in/s，或留空';
    expect(one({ maxSpeed: 0 })).toEqual([{ index: 0, field: 'maxSpeed', message: msg }]);
    expect(one({ maxSpeed: -1 })).toEqual([{ index: 0, field: 'maxSpeed', message: msg }]);
    expect(one({ maxSpeed: Infinity })).toEqual([{ index: 0, field: 'maxSpeed', message: msg }]);
    expect(one({ maxSpeed: 0.001 })).toEqual([]);
    expect(one({ maxSpeed: undefined })).toEqual([]);
  });

  it('endSpeed 不得为负', () => {
    expect(one({ endSpeed: -1, brakeZoneIn: 5 })).toEqual([
      { index: 0, field: 'endSpeed', message: '到点目标速度不得为负数，或留空' },
    ]);
    expect(one({ endSpeed: 0, brakeZoneIn: 5 })).toEqual([]);
  });

  it('brakeZoneIn 不得为负；brakeForwardPower 位于 [0,1]', () => {
    expect(one({ brakeZoneIn: -1 })).toEqual([{ index: 0, field: 'brakeZoneIn', message: '制动区距离不得为负数' }]);
    const msg = '制动区前进功率必须位于 0 到 1，或留空';
    expect(one({ brakeForwardPower: 1.5 })).toEqual([{ index: 0, field: 'brakeForwardPower', message: msg }]);
    expect(one({ brakeForwardPower: -0.5 })).toEqual([{ index: 0, field: 'brakeForwardPower', message: msg }]);
    expect(one({ brakeForwardPower: 0 })).toEqual([]);
    expect(one({ brakeForwardPower: 1 })).toEqual([]);
  });

  it('设置 endSpeed 后 brakeZoneIn 必须 > 0', () => {
    expect(one({ endSpeed: 0, brakeZoneIn: 0 })).toEqual([
      { index: 0, field: 'brakeZoneIn', message: '设置 endSpeed 后必须提供大于 0 的制动区距离' },
    ]);
  });

  it('多个节点的下标正确，且一个节点可有多个问题', () => {
    const issues = validateNodes([base, { ...base, duration: -1, maxPower: 2 }, base, { ...base, dx: NaN }]);
    expect(issues.map((i) => [i.index, i.field])).toEqual([
      [1, 'duration'],
      [1, 'maxPower'],
      [3, 'dx'],
    ]);
  });
});

describe('validateRobotIssues / validateRobotJson', () => {
  it('非数组', () => {
    expect(validateRobotIssues({})).toEqual([{ field: 'json', message: '路径必须是控制点 JSON 数组' }]);
    expect(validateRobotIssues(null)).toEqual([{ field: 'json', message: '路径必须是控制点 JSON 数组' }]);
    expect(validateRobotJson('not json')).toEqual([{ field: 'json', message: '路径必须是控制点 JSON 数组' }]);
    expect(validateRobotJson('{"routes":[]}')).toEqual([{ field: 'json', message: '路径必须是控制点 JSON 数组' }]);
  });

  it('空数组', () => {
    expect(validateRobotJson('[]')).toEqual([{ field: 'points', message: '不能上传空路径' }]);
  });

  it('帧不是对象', () => {
    expect(validateRobotIssues([1])).toEqual([{ index: 0, field: 'json', message: '路段必须是 JSON 对象' }]);
    expect(validateRobotIssues([[], null])).toEqual([
      { index: 0, field: 'json', message: '路段必须是 JSON 对象' },
      { index: 1, field: 'json', message: '路段必须是 JSON 对象' },
    ]);
  });

  it('缺少 x / y', () => {
    expect(validateRobotIssues([{ y: 0 }])).toEqual([{ index: 0, field: 'x', message: '缺少 x' }]);
    expect(validateRobotIssues([{}])).toEqual([
      { index: 0, field: 'x', message: '缺少 x' },
      { index: 0, field: 'y', message: '缺少 y' },
    ]);
  });

  it('x 非有限数值', () => {
    expect(validateRobotIssues([{ x: 'abc', y: 0 }])).toEqual([
      { index: 0, field: 'x', message: 'x 必须为有限数值' },
    ]);
    expect(validateRobotIssues([{ x: null, y: 0 }])).toEqual([
      { index: 0, field: 'x', message: 'x 必须为有限数值' },
    ]);
  });

  it('可解析数字的字符串被接受', () => {
    expect(validateRobotIssues([{ x: '1.5', y: '-2e1' }])).toEqual([]);
  });

  it('wait：缺值 / 负数 / 非数字', () => {
    expect(validateRobotIssues([{ x: 0, y: 0 }, { wait: -1 }])).toEqual([
      { index: 1, field: 'wait', message: '等待秒数不能为负数' },
    ]);
    expect(validateRobotIssues([{ x: 0, y: 0 }, { wait: 'abc' }])).toEqual([
      { index: 1, field: 'wait', message: 'wait 必须为有限数值' },
    ]);
    expect(validateRobotIssues([{ x: 0, y: 0 }, { wait: 0 }])).toEqual([]);
  });

  it('校验节点问题时下标映射回帧下标（wait 帧不计入点下标）', () => {
    const frames = [{ x: 0, y: 0 }, { wait: 1 }, { x: 5, y: 5, maxPower: 2 }];
    expect(validateRobotIssues(frames)).toEqual([
      { index: 2, field: 'maxPower', message: '巡航功率必须位于 0 到 1' },
    ]);
  });

  it('可选字段为 null 视为非法（endSpeed:null）', () => {
    const issues = validateRobotIssues([{ x: 0, y: 0, endSpeed: null }]);
    expect(issues).toEqual([{ index: 0, field: 'endSpeed', message: 'endSpeed 必须为有限数值' }]);
  });

  it('只有 wait 帧时不报告点问题', () => {
    expect(validateRobotIssues([{ wait: 1 }])).toEqual([]);
  });

  it('不含 delayAfterArrive 的帧默认值合法；endSpeed 无 brakeZoneIn 报错', () => {
    expect(validateRobotIssues([{ x: 0, y: 0, endSpeed: 0 }])).toEqual([
      { index: 0, field: 'brakeZoneIn', message: '设置 endSpeed 后必须提供大于 0 的制动区距离' },
    ]);
  });

  it('validateRobotFrames 返回文案列表', () => {
    expect(validateRobotFrames([])).toEqual(['不能上传空路径']);
    expect(validateRobotFrames([{ x: 0, y: 0 }])).toEqual([]);
  });
});

describe('primitiveDouble / primitiveContent', () => {
  it('primitiveDouble', () => {
    expect(primitiveDouble(3)).toBe(3);
    expect(primitiveDouble('3.5')).toBe(3.5);
    expect(primitiveDouble(' -.5 ')).toBe(-0.5);
    expect(primitiveDouble('1e3')).toBe(1000);
    expect(primitiveDouble('5.')).toBe(5);
    expect(primitiveDouble('NaN')).toBeNaN();
    expect(primitiveDouble('Infinity')).toBe(Infinity);
    expect(primitiveDouble('+Infinity')).toBe(Infinity);
    expect(primitiveDouble('-Infinity')).toBe(-Infinity);
    expect(primitiveDouble('abc')).toBeNull();
    expect(primitiveDouble('')).toBeNull();
    expect(primitiveDouble('0x10')).toBeNull();
    expect(primitiveDouble(null)).toBeNull();
    expect(primitiveDouble(true)).toBeNull();
    expect(primitiveDouble([1])).toBeNull();
  });

  it('primitiveContent', () => {
    expect(primitiveContent('a')).toBe('a');
    expect(primitiveContent('')).toBe('');
    expect(primitiveContent(1.5)).toBe('1.5');
    expect(primitiveContent(true)).toBe('true');
    expect(primitiveContent(null)).toBeNull();
    expect(primitiveContent(undefined)).toBeNull();
    expect(primitiveContent({})).toBeNull();
    expect(primitiveContent([])).toBeNull();
  });
});
