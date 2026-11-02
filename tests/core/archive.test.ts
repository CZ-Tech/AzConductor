import { describe, expect, it } from 'vitest';
import { makeNode, type ControlNode } from '../../src/core/node';
import {
  DEFAULT_IMPORT_NAME,
  DEFAULT_ROBOT_NAME,
  ROUTES_STORAGE_KEY,
  allRoutes,
  decodeRoutesDoc,
  encodeRoutesDoc,
  encodeStoredNode,
  exportArchiveJson,
  exportRobotWireJson,
  exportRouteJson,
  importText,
  importValue,
  parseRoutesDoc,
  serializeRoutesDoc,
  wrapRoutes,
  type ImportResult,
  type RouteData,
  type RoutesDoc,
} from '../../src/core/archive';
import { decodeRobotRoute } from '../../src/core/wire';
import { randomRoute, rng } from './_util';

const err = (r: ImportResult): string => {
  if (r.ok) throw new Error('expected error, got ok');
  return r.error;
};
const ok = (r: ImportResult) => {
  if (!r.ok) throw new Error(`expected ok, got error: ${r.error}`);
  return r;
};

describe('常量', () => {
  it('存储键 / 默认名', () => {
    expect(ROUTES_STORAGE_KEY).toBe('robot_routes');
    expect(DEFAULT_ROBOT_NAME).toBe('default');
    expect(DEFAULT_IMPORT_NAME).toBe('导入路径');
  });
});

describe('importText 检测顺序', () => {
  it('1. 裸 ControlNode[]（元素均含数值 x/dx/y/dy）', () => {
    const text = JSON.stringify([
      { x: 0, dx: 1, y: 0, dy: 0, delayAfterArrive: 2, marker: 'A' },
      { x: 5, dx: 1, y: 3, dy: 0 },
    ]);
    const r = ok(importText(text));
    expect(r.kind).toBe('nodes');
    expect(r.routes).toHaveLength(1);
    expect(r.routes[0]!.name).toBe('导入路径');
    expect(r.routes[0]!.points).toHaveLength(2);
    // 裸节点中的 delayAfterArrive 原样保留（不是 wait 帧）
    expect(r.routes[0]!.points[0]!.delayAfterArrive).toBe(2);
    expect(r.routes[0]!.points[0]!.marker).toBe('A');
    expect(r.routes[0]!.points[1]!.duration).toBe(1);
  });

  it('自定义默认名', () => {
    const r = ok(importText('[{"x":0,"dx":0,"y":0,"dy":0}]', '我的路径'));
    expect(r.routes[0]!.name).toBe('我的路径');
    const w = ok(importText('[{"x":0,"y":0}]', 'w'));
    expect(w.routes[0]!.name).toBe('w');
  });

  it('2. 机器人线格式：缺省 dx/dy 视为线格式，{"wait":s} 并入上一点的 delayAfterArrive', () => {
    const text = '[{"x":0,"y":0},{"wait":0.5},{"x":24,"y":0,"maxPower":0.5,"endSpeed":0,"brakeZoneIn":8}]';
    const r = ok(importText(text));
    expect(r.kind).toBe('wire');
    const pts = r.routes[0]!.points;
    expect(pts).toHaveLength(2);
    expect(pts[0]!.delayAfterArrive).toBe(0.5);
    expect(pts[1]).toMatchObject({ x: 24, maxPower: 0.5, endSpeed: 0, brakeZoneIn: 8 });
  });

  it('只要有一个元素不是完整 x/dx/y/dy 数值，整体按线格式处理', () => {
    const r = ok(importText('[{"x":0,"dx":0,"y":0,"dy":0},{"x":1,"y":1}]'));
    expect(r.kind).toBe('wire');
    // x 为数字字符串也不算"裸节点"，但线格式接受
    const s = ok(importText('[{"x":"1","dx":0,"y":0,"dy":0}]'));
    expect(s.kind).toBe('wire');
    expect(s.routes[0]!.points[0]!.x).toBe(1);
  });

  it('3. 存档 [{robotName, routes}]，多个机器人的路径被展平', () => {
    const text = JSON.stringify([
      { robotName: 'a', routes: [{ name: 'R1', points: [{ x: 0, y: 0 }] }] },
      {
        robotName: 'b',
        routes: [
          { name: 'R2', points: [{ x: 1, y: 1, delayAfterArrive: 3 }] },
          { name: 'R3', points: [] },
        ],
      },
    ]);
    const r = ok(importText(text));
    expect(r.kind).toBe('archive');
    expect(r.routes.map((x) => x.name)).toEqual(['R1', 'R2', 'R3']);
    expect(r.routes[1]!.points[0]!.delayAfterArrive).toBe(3);
    expect(r.routes[2]!.points).toEqual([]);
  });

  it('存档：空 routes、缺省 robotName / routes', () => {
    const a = ok(importText('[{"robotName":"r","routes":[]}]'));
    expect(a.kind).toBe('archive');
    expect(a.routes).toEqual([]);
    const b = ok(importText('[{"routes":[{"name":"x"}]}]'));
    expect(b.kind).toBe('archive');
    expect(b.routes).toEqual([{ name: 'x', points: [] }]);
    const c = ok(importText('[{"robotName":"only"}]'));
    expect(c.kind).toBe('archive');
    expect(c.routes).toEqual([]);
  });

  it('空数组按裸节点处理（0 个点的单条路径）', () => {
    const r = ok(importText('[]'));
    expect(r.kind).toBe('nodes');
    expect(r.routes).toEqual([{ name: '导入路径', points: [] }]);
  });

  it('裸节点解码失败回退到线格式，错误信息来自线格式', () => {
    const text = '[{"x":0,"dx":0,"y":0,"dy":0,"marker":5}]';
    expect(err(importText(text))).toBe('第 1 帧 marker 必须为字符串');
  });
});

describe('importText 错误信息', () => {
  it('JSON 解析失败', () => {
    expect(err(importText('not json'))).toBe('JSON 解析失败');
    expect(err(importText(''))).toBe('JSON 解析失败');
    expect(err(importText('[1,'))).toBe('JSON 解析失败');
  });

  it('不是数组', () => {
    expect(err(importText('{"routes":[]}'))).toBe('导入内容必须是 JSON 数组');
    expect(err(importText('3'))).toBe('导入内容必须是 JSON 数组');
    expect(err(importText('null'))).toBe('导入内容必须是 JSON 数组');
    expect(err(importText('"x"'))).toBe('导入内容必须是 JSON 数组');
  });

  it('线格式错误透传 WireError 文案', () => {
    expect(err(importText('[{"x":1}]'))).toBe('第 1 帧缺少 y');
    expect(err(importText('[{"x":0,"y":0},{"foo":1}]'))).toBe('第 2 帧缺少 x');
    expect(err(importText('[1,2]'))).toBe('第 1 帧不是对象');
    expect(err(importText('[{"wait":1},{"x":0,"y":0}]'))).toBe('起始点之前的 wait 无法在控制点模型中表示');
    expect(err(importText('[{"x":0,"y":0},{"wait":-1}]'))).toBe('第 2 帧 wait 无效');
    expect(err(importText('[{"x":0,"y":0},{"wait":1,"marker":"m"}]')).startsWith('带事件的独立 wait')).toBe(true);
  });

  it('存档结构错误文案', () => {
    const arch = (v: unknown) => err(importValue(v));
    expect(arch([{ robotName: 'r', routes: [{ points: [] }] }])).toBe('第 1 项路径 1 缺少 name');
    expect(arch([{ robotName: 'r', routes: [{ name: 'a', points: {} }] }])).toBe('第 1 项路径 1 的 points 必须是数组');
    expect(arch([{ robotName: 'r', routes: [{ name: 'a', points: [1] }] }])).toBe('第 1 项路径 1 第 1 个点不是对象');
    expect(arch([{ robotName: 'r', routes: [{ name: 'a', points: [{ y: 1 }] }] }])).toBe('第 1 帧缺少 x');
    expect(arch([{ robotName: 'r', routes: [] }, { robotName: 'q', routes: [1] }])).toBe('第 2 项路径 1 不是对象');
    expect(arch([{ robotName: 'r', routes: {} }])).toBe('第 1 项 routes 必须是数组');
    expect(arch([{ robotName: 5, routes: [] }])).toBe('第 1 项 robotName 无效');
  });

  it('既不像线格式也不像存档：给出线格式错误', () => {
    expect(err(importValue([{ foo: 1 }]))).toBe('第 1 帧缺少 x');
    // 只有部分元素像存档
    expect(err(importValue([{ robotName: 'a', routes: [] }, { foo: 1 }]))).toBe('第 1 帧缺少 x');
  });
});

describe('导出函数', () => {
  const nodes: ControlNode[] = [
    makeNode({ x: 0, y: 0, delayAfterArrive: 1.5, marker: 'A' }),
    makeNode({ x: 20, y: 5, duration: 2, delayAfterArrive: 2.5, endSpeed: 0, brakeZoneIn: 10, maxSpeed: 24 }),
  ];

  it('exportRouteJson：默认缩进 2 空格，裸节点含 delayAfterArrive，可被导入识别为 nodes', () => {
    const text = exportRouteJson(nodes);
    expect(text).toBe(JSON.stringify(nodes.map(encodeStoredNode), null, 2));
    expect(text).toContain('\n  {');
    expect(text).toContain('"delayAfterArrive": 1.5');
    expect(text).not.toContain('"wait"');
    const r = ok(importText(text));
    expect(r.kind).toBe('nodes');
    expect(r.routes[0]!.points).toStrictEqual(nodes);
  });

  it('exportRouteJson(pretty=false) 为紧凑文本', () => {
    const text = exportRouteJson(nodes, false);
    expect(text).not.toContain('\n');
    expect(text.startsWith('[{"x":0,"dx":0,"y":0,"dy":0')).toBe(true);
    expect(JSON.parse(text)).toHaveLength(2);
  });

  it('exportRobotWireJson：默认紧凑，wait 帧，无 delayAfterArrive，可被导入识别为 wire', () => {
    const text = exportRobotWireJson(nodes);
    expect(text).not.toContain('\n');
    expect(text).not.toContain('delayAfterArrive');
    const frames = JSON.parse(text) as Array<Record<string, unknown>>;
    expect(frames).toHaveLength(4);
    expect(frames[1]).toEqual({ wait: 1.5 });
    expect(frames[3]).toEqual({ wait: 2.5 });
    const r = ok(importText(text));
    expect(r.kind).toBe('wire');
    expect(r.routes[0]!.points).toStrictEqual(nodes);
    expect(decodeRobotRoute(frames)).toStrictEqual(nodes);
  });

  it('exportRobotWireJson(pretty=true) 缩进', () => {
    expect(exportRobotWireJson(nodes, true)).toContain('\n  ');
  });

  it('exportArchiveJson：默认缩进，robotName=default，可被导入识别为 archive', () => {
    const routes: RouteData[] = [
      { name: '甲', points: nodes },
      { name: 'B', points: [makeNode({ x: 1, y: 1 })] },
    ];
    const text = exportArchiveJson(routes);
    expect(text).toContain('\n  ');
    const parsed = JSON.parse(text) as Array<{ robotName: string; routes: Array<{ name: string }> }>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.robotName).toBe('default');
    expect(parsed[0]!.routes.map((r) => r.name)).toEqual(['甲', 'B']);
    const r = ok(importText(text));
    expect(r.kind).toBe('archive');
    expect(r.routes).toStrictEqual(routes);
    expect(exportArchiveJson(routes, false)).not.toContain('\n');
  });

  it('导出空路径列表', () => {
    expect(exportArchiveJson([], false)).toBe('[{"robotName":"default","routes":[]}]');
    expect(exportRouteJson([], false)).toBe('[]');
    expect(exportRobotWireJson([])).toBe('[]');
  });
});

describe('wrapRoutes / allRoutes', () => {
  it('wrapRoutes 默认 robotName，复制数组', () => {
    const routes: RouteData[] = [{ name: 'a', points: [] }];
    const doc = wrapRoutes(routes);
    expect(doc).toEqual([{ robotName: 'default', routes }]);
    expect(doc[0]!.routes).not.toBe(routes);
    expect(wrapRoutes(routes, 'bot')[0]!.robotName).toBe('bot');
  });
  it('allRoutes 展平', () => {
    const doc: RoutesDoc = [
      { robotName: 'a', routes: [{ name: '1', points: [] }] },
      { robotName: 'b', routes: [{ name: '2', points: [] }, { name: '3', points: [] }] },
    ];
    expect(allRoutes(doc).map((r) => r.name)).toEqual(['1', '2', '3']);
    expect(allRoutes([])).toEqual([]);
  });
});

describe('encodeRoutesDoc / parseRoutesDoc（localStorage robot_routes 格式）', () => {
  const doc: RoutesDoc = [
    {
      robotName: 'default',
      routes: [
        { name: 'A', points: [makeNode({ x: 0, y: 0, delayAfterArrive: 1 }), makeNode({ x: 5, y: 5, maxSpeed: 12 })] },
        { name: '空', points: [] },
      ],
    },
  ];

  it('存储格式：[{robotName, routes:[{name, points}]}]，点含 delayAfterArrive', () => {
    const enc = encodeRoutesDoc(doc) as Array<{ robotName: string; routes: Array<{ name: string; points: Array<Record<string, unknown>> }> }>;
    expect(Object.keys(enc[0]!)).toEqual(['robotName', 'routes']);
    expect(Object.keys(enc[0]!.routes[0]!)).toEqual(['name', 'points']);
    expect(Object.keys(enc[0]!.routes[0]!.points[0]!)).toEqual([
      'x', 'dx', 'y', 'dy', 'heading', 'dHeading', 'duration', 'marker', 'command', 'commandParams',
      'delayAfterArrive', 'maxPower', 'brakeZoneIn',
    ]);
    expect(enc[0]!.routes[0]!.points[0]!['delayAfterArrive']).toBe(1);
    expect(Object.keys(enc[0]!.routes[0]!.points[1]!)).toEqual([
      'x', 'dx', 'y', 'dy', 'heading', 'dHeading', 'duration', 'marker', 'command', 'commandParams',
      'delayAfterArrive', 'maxPower', 'maxSpeed', 'brakeZoneIn',
    ]);
  });

  it('可选字段缺省时省略，永不输出 null', () => {
    const text = serializeRoutesDoc(doc);
    expect(text).not.toContain('null');
    expect(text).not.toContain('"endSpeed"');
    expect(text).not.toContain('"brakeForwardPower"');
    expect(text).toContain('"maxSpeed":12');
    const forced: ControlNode = { ...makeNode({ x: 0, y: 0 }), maxSpeed: undefined, endSpeed: undefined, brakeForwardPower: undefined };
    expect(JSON.stringify(encodeStoredNode(forced))).not.toMatch(/null|maxSpeed|endSpeed|brakeForwardPower/);
    // 0 是有效值，必须保留
    expect(encodeStoredNode(makeNode({ x: 0, y: 0, endSpeed: 0 }))['endSpeed']).toBe(0);
  });

  it('serialize 默认紧凑，pretty 缩进', () => {
    expect(serializeRoutesDoc(doc)).not.toContain('\n');
    expect(serializeRoutesDoc(doc, true)).toContain('\n  ');
    expect(serializeRoutesDoc([])).toBe('[]');
  });

  it('parseRoutesDoc(serializeRoutesDoc(doc)) 还原', () => {
    expect(parseRoutesDoc(serializeRoutesDoc(doc))).toStrictEqual(doc);
    expect(parseRoutesDoc(serializeRoutesDoc(doc, true))).toStrictEqual(doc);
  });

  it('属性：随机文档往返无损，且二次序列化文本不变', () => {
    const r = rng(314159);
    for (let i = 0; i < 100; i++) {
      const random: RoutesDoc = [
        {
          robotName: i % 3 === 0 ? 'other' : 'default',
          routes: Array.from({ length: 1 + Math.floor(r() * 3) }, (_, k) => ({
            name: `路径${k}`,
            points: randomRoute(r, Math.floor(r() * 6)),
          })),
        },
      ];
      const text = serializeRoutesDoc(random);
      const back = parseRoutesDoc(text);
      expect(back).toStrictEqual(random);
      expect(serializeRoutesDoc(back!)).toBe(text);
      expect(text).not.toContain('null');
    }
  });

  it('parseRoutesDoc：空白 / null / undefined / 损坏 / 非数组返回 null', () => {
    expect(parseRoutesDoc(null)).toBeNull();
    expect(parseRoutesDoc(undefined)).toBeNull();
    expect(parseRoutesDoc('')).toBeNull();
    expect(parseRoutesDoc('  \n ')).toBeNull();
    expect(parseRoutesDoc('{oops')).toBeNull();
    expect(parseRoutesDoc('{}')).toBeNull();
    expect(parseRoutesDoc('[1]')).toBeNull();
    expect(parseRoutesDoc('[{"robotName":"a","routes":[{"points":[]}]}]')).toBeNull();
  });

  it('parseRoutesDoc：空数组有效，缺省 robotName / routes 补默认', () => {
    expect(parseRoutesDoc('[]')).toEqual([]);
    expect(parseRoutesDoc('[{}]')).toEqual([{ robotName: 'default', routes: [] }]);
    expect(parseRoutesDoc('[{"routes":[{"name":"n"}]}]')).toEqual([
      { robotName: 'default', routes: [{ name: 'n', points: [] }] },
    ]);
  });

  it('decodeRoutesDoc 非数组抛 WireError 文案', () => {
    expect(() => decodeRoutesDoc({})).toThrow('存档必须是 JSON 数组');
    expect(() => decodeRoutesDoc([3])).toThrow('第 1 项不是对象');
  });
});
