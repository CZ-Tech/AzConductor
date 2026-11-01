import { describe, expect, it } from 'vitest';
import { makeNode, nodesClose, type ControlNode } from '../../src/core/node';
import { encodeStoredNode, importText } from '../../src/core/archive';
import {
  WireError,
  canonicalRoute,
  decodeNodeFrame,
  decodeRobotRoute,
  encodeNodeFrame,
  encodeRobotRoute,
  fingerprint,
} from '../../src/core/wire';
import { randomRoute, rng } from './_util';

const roundTripJson = (nodes: readonly ControlNode[]): unknown =>
  JSON.parse(JSON.stringify(encodeRobotRoute(nodes)));

describe('ComposeAppCommonTest（Kotlin 移植：ControlNode 序列化）', () => {
  it('testControlNodeMarkerSerialization', () => {
    const point = makeNode({ x: 10, dx: 1, y: 20, dy: 2, marker: 'test-marker' });
    const json = JSON.stringify(encodeStoredNode(point));
    expect(json).toContain('"marker":"test-marker"');

    const r = importText(`[${json}]`);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const decoded = r.routes[0]!.points[0]!;
    expect(decoded.marker).toBe('test-marker');
    expect(nodesClose(point, decoded)).toBe(true);
  });

  it('testControlNodeIsCloseTo', () => {
    const p1 = makeNode({ x: 1, dx: 1, y: 1, dy: 1, marker: 'a' });
    const p2 = makeNode({ x: 1, dx: 1, y: 1, dy: 1, marker: 'a' });
    const p3 = makeNode({ x: 1, dx: 1, y: 1, dy: 1, marker: 'b' });
    expect(nodesClose(p1, p2)).toBe(true);
    expect(nodesClose(p1, p3)).toBe(false);
  });
});

describe('nodesClose', () => {
  const a = makeNode({ x: 1, y: 2, maxSpeed: 5 });
  it('容差 1e-7', () => {
    expect(nodesClose(a, { ...a, x: 1 + 5e-8 })).toBe(true);
    expect(nodesClose(a, { ...a, x: 1 + 2e-7 })).toBe(false);
  });
  it('可选字段：缺省与有值不相等', () => {
    const { maxSpeed: _m, ...rest } = a;
    expect(nodesClose(a, rest as ControlNode)).toBe(false);
    expect(nodesClose(rest as ControlNode, rest as ControlNode)).toBe(true);
    expect(nodesClose(a, { ...a, maxSpeed: 5 + 1e-9 })).toBe(true);
  });
  it('commandParams 逐项比较', () => {
    expect(nodesClose({ ...a, commandParams: ['1'] }, { ...a, commandParams: ['1'] })).toBe(true);
    expect(nodesClose({ ...a, commandParams: ['1'] }, { ...a, commandParams: ['2'] })).toBe(false);
    expect(nodesClose({ ...a, commandParams: ['1'] }, { ...a, commandParams: [] })).toBe(false);
  });
});

describe('encodeNodeFrame', () => {
  it('键序与 Kotlin 声明顺序一致，去掉 delayAfterArrive，可选字段缺省则省略', () => {
    const n = makeNode({ x: 1, y: 2, delayAfterArrive: 3 });
    const f = encodeNodeFrame(n);
    expect(Object.keys(f)).toEqual([
      'x', 'dx', 'y', 'dy', 'heading', 'dHeading', 'duration', 'marker', 'command', 'commandParams',
      'maxPower', 'brakeZoneIn',
    ]);
    expect('delayAfterArrive' in f).toBe(false);
  });

  it('可选字段全有时的键序', () => {
    const n = makeNode({ x: 1, y: 2, maxSpeed: 3, endSpeed: 0, brakeZoneIn: 4, brakeForwardPower: 0.5 });
    expect(Object.keys(encodeNodeFrame(n))).toEqual([
      'x', 'dx', 'y', 'dy', 'heading', 'dHeading', 'duration', 'marker', 'command', 'commandParams',
      'maxPower', 'maxSpeed', 'endSpeed', 'brakeZoneIn', 'brakeForwardPower',
    ]);
  });

  it('永不输出 null（含显式 undefined 字段）', () => {
    const n: ControlNode = { ...makeNode({ x: 0, y: 0 }), maxSpeed: undefined, endSpeed: undefined, brakeForwardPower: undefined };
    const text = JSON.stringify(encodeNodeFrame(n));
    expect(text).not.toContain('null');
    expect(text).not.toContain('maxSpeed');
    expect(text).not.toContain('endSpeed');
    expect(text).not.toContain('brakeForwardPower');
  });

  it('endSpeed = 0 与 maxSpeed = 0 会输出（0 不是缺省）', () => {
    const f = encodeNodeFrame(makeNode({ x: 0, y: 0, endSpeed: 0 }));
    expect(f['endSpeed']).toBe(0);
  });

  it('commandParams 为拷贝', () => {
    const n = makeNode({ x: 0, y: 0, commandParams: ['a'] });
    const f = encodeNodeFrame(n);
    expect(f['commandParams']).toEqual(['a']);
    expect(f['commandParams']).not.toBe(n.commandParams);
  });
});

describe('encodeRobotRoute / decodeRobotRoute', () => {
  it('delayAfterArrive > 0 生成紧随的 {wait} 帧；0 不生成', () => {
    const nodes = [
      makeNode({ x: 0, y: 0, delayAfterArrive: 1.5 }),
      makeNode({ x: 1, y: 0 }),
      makeNode({ x: 2, y: 0, delayAfterArrive: 0.25 }),
    ];
    const frames = encodeRobotRoute(nodes) as Array<Record<string, unknown>>;
    expect(frames).toHaveLength(5);
    expect(frames[1]).toEqual({ wait: 1.5 });
    expect(frames[4]).toEqual({ wait: 0.25 });
    expect(frames[2]!['x']).toBe(1);
  });

  it('空路径', () => {
    expect(encodeRobotRoute([])).toEqual([]);
    expect(decodeRobotRoute([])).toEqual([]);
  });

  it('连续 wait 累加到上一点', () => {
    const nodes = decodeRobotRoute([{ x: 0, y: 0 }, { wait: 1 }, { wait: 2 }]);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.delayAfterArrive).toBe(3);
  });

  it('点帧里的 delayAfterArrive 与随后的 wait 相加', () => {
    const nodes = decodeRobotRoute([{ x: 0, y: 0, delayAfterArrive: 2 }, { wait: 1 }]);
    expect(nodes[0]!.delayAfterArrive).toBe(3);
  });

  it('wait 帧带非空 marker/command 无法导入；空字符串可以', () => {
    const base = { x: 0, y: 0 };
    expect(() => decodeRobotRoute([base, { wait: 1, marker: 'm' }])).toThrow('带事件的独立 wait 无法无损导入控制点模型');
    expect(() => decodeRobotRoute([base, { wait: 1, command: 'c' }])).toThrow('带事件的独立 wait 无法无损导入控制点模型');
    expect(decodeRobotRoute([base, { wait: 1, marker: '', command: '' }])[0]!.delayAfterArrive).toBe(1);
    expect(decodeRobotRoute([base, { wait: 1, marker: null }])[0]!.delayAfterArrive).toBe(1);
  });

  it('错误文案', () => {
    const err = (v: unknown): string => {
      try {
        decodeRobotRoute(v);
      } catch (e) {
        expect(e).toBeInstanceOf(WireError);
        expect((e as Error).name).toBe('WireError');
        return (e as Error).message;
      }
      return '<no error>';
    };
    expect(err({})).toBe('机器人路径必须是 JSON 数组');
    expect(err('x')).toBe('机器人路径必须是 JSON 数组');
    expect(err([1])).toBe('第 1 帧不是对象');
    expect(err([{ x: 0, y: 0 }, null])).toBe('第 2 帧不是对象');
    expect(err([{ x: 0, y: 0 }, []])).toBe('第 2 帧不是对象');
    expect(err([{ x: 0 }])).toBe('第 1 帧缺少 y');
    expect(err([{ y: 0 }])).toBe('第 1 帧缺少 x');
    expect(err([{ x: 'a', y: 0 }])).toBe('第 1 帧 x 必须为数值');
    expect(err([{ x: 0, y: 0 }, { x: 1, y: 1, dx: 'z' }])).toBe('第 2 帧 dx 必须为数值');
    expect(err([{ x: 0, y: 0, marker: 5 }])).toBe('第 1 帧 marker 必须为字符串');
    expect(err([{ x: 0, y: 0, command: [] }])).toBe('第 1 帧 command 必须为字符串');
    expect(err([{ x: 0, y: 0, commandParams: 'a' }])).toBe('第 1 帧 commandParams 必须为字符串数组');
    expect(err([{ x: 0, y: 0, commandParams: [1] }])).toBe('第 1 帧 commandParams 必须为字符串数组');
    expect(err([{ x: 0, y: 0 }, { wait: -1 }])).toBe('第 2 帧 wait 无效');
    expect(err([{ x: 0, y: 0 }, { wait: 'abc' }])).toBe('第 2 帧 wait 无效');
    expect(err([{ x: 0, y: 0 }, { wait: null }])).toBe('第 2 帧 wait 无效');
    expect(err([{ x: 0, y: 0 }, { wait: 'Infinity' }])).toBe('第 2 帧 wait 无效');
    expect(err([{ wait: 1 }, { x: 0, y: 0 }])).toBe('起始点之前的 wait 无法在控制点模型中表示');
  });

  it('缺省字段取 Kotlin 默认值（duration=1, maxPower=1, 其余 0/空）', () => {
    const [n] = decodeRobotRoute([{ x: 3, y: 4 }]);
    expect(n).toStrictEqual({
      x: 3, dx: 0, y: 4, dy: 0, heading: 0, dHeading: 0, duration: 1,
      marker: '', command: '', commandParams: [], delayAfterArrive: 0, maxPower: 1, brakeZoneIn: 0,
    });
  });

  it('可选字段 null 视为缺省；数字字符串被接受；NaN 字符串被拒绝', () => {
    const [n] = decodeRobotRoute([{ x: '1', y: '2', maxSpeed: null, endSpeed: null, brakeForwardPower: null }]);
    expect(n).toMatchObject({ x: 1, y: 2 });
    expect('maxSpeed' in n!).toBe(false);
    expect('endSpeed' in n!).toBe(false);
    expect('brakeForwardPower' in n!).toBe(false);
    expect(() => decodeRobotRoute([{ x: 'NaN', y: 0 }])).toThrow('第 1 帧 x 必须为数值');
  });

  it('可选字段存在时解码', () => {
    const [n] = decodeRobotRoute([{ x: 0, y: 0, maxSpeed: 24, endSpeed: 0, brakeForwardPower: 0.2 }]);
    expect(n!.maxSpeed).toBe(24);
    expect(n!.endSpeed).toBe(0);
    expect(n!.brakeForwardPower).toBe(0.2);
  });

  it('decodeNodeFrame 报错帧号即传入的 frameNo', () => {
    expect(() => decodeNodeFrame({ x: 0 }, 7)).toThrow('第 7 帧缺少 y');
  });

  it('属性：encode → JSON → decode 还原原始节点（随机路径）', () => {
    const r = rng(20240601);
    for (let i = 0; i < 200; i++) {
      const nodes = randomRoute(r, 1 + Math.floor(r() * 8));
      expect(decodeRobotRoute(roundTripJson(nodes))).toStrictEqual(nodes);
    }
  });

  it('属性：wire 编码文本永不含 null，且 delayAfterArrive 不出现在点帧', () => {
    const r = rng(7);
    for (let i = 0; i < 100; i++) {
      const text = JSON.stringify(encodeRobotRoute(randomRoute(r, 5)));
      expect(text).not.toContain('null');
      expect(text).not.toContain('delayAfterArrive');
    }
  });

  it('属性：帧数 = 点数 + 有等待的点数', () => {
    const r = rng(11);
    for (let i = 0; i < 100; i++) {
      const nodes = randomRoute(r, 6);
      const waits = nodes.filter((n) => n.delayAfterArrive > 0).length;
      expect(encodeRobotRoute(nodes)).toHaveLength(nodes.length + waits);
    }
  });
});

describe('canonicalRoute', () => {
  it('等于 encode 的 JSON 且对 decode∘encode 稳定（幂等）', () => {
    const r = rng(99);
    for (let i = 0; i < 100; i++) {
      const nodes = randomRoute(r, 1 + Math.floor(r() * 6));
      const c = canonicalRoute(nodes);
      expect(c).toBe(JSON.stringify(encodeRobotRoute(nodes)));
      expect(canonicalRoute(decodeRobotRoute(JSON.parse(c)))).toBe(c);
    }
  });

  it('不受输入对象键序 / 缺省字段影响', () => {
    const a = decodeRobotRoute([{ y: 0, x: 1, dx: 0, duration: 1, maxPower: 1 }]);
    const b = decodeRobotRoute([{ x: 1, y: 0 }]);
    expect(canonicalRoute(a)).toBe(canonicalRoute(b));
  });

  it('不同路径得到不同文本；空路径为 []', () => {
    expect(canonicalRoute([])).toBe('[]');
    expect(canonicalRoute([makeNode({ x: 1, y: 0 })])).not.toBe(canonicalRoute([makeNode({ x: 2, y: 0 })]));
  });

  it('等待被拆分为多个 wait 的路径与合并 wait 的路径规范化后相同', () => {
    const split = decodeRobotRoute([{ x: 0, y: 0 }, { wait: 1 }, { wait: 0.5 }]);
    const merged = decodeRobotRoute([{ x: 0, y: 0 }, { wait: 1.5 }]);
    expect(canonicalRoute(split)).toBe(canonicalRoute(merged));
  });
});

describe('fingerprint（FNV-1a 64，小写十六进制，不补零）', () => {
  /** 参考实现：用 Node Buffer 取 UTF-8 字节，独立于被测代码的 TextEncoder 路径。 */
  const reference = (s: string): string => {
    let h = 0xcbf29ce484222325n;
    for (const b of Buffer.from(s, 'utf8')) {
      h ^= BigInt(b);
      h = (h * 0x100000001b3n) % (1n << 64n);
    }
    return h.toString(16);
  };

  it('已知向量', () => {
    expect(fingerprint('')).toBe('cbf29ce484222325');
    expect(fingerprint('a')).toBe('af63dc4c8601ec8c');
    expect(fingerprint('foobar')).toBe('85944171f73967e8');
  });

  it('UTF-8 字节（中文 / emoji）', () => {
    for (const s of ['中文路径', 'é', '\u{1F600}', 'a中b']) {
      expect(fingerprint(s)).toBe(reference(s));
    }
  });

  it('小写十六进制且不补零（存在不足 16 位的哈希）', () => {
    // "10" 的哈希最高位半字节为 0（0x07f89207b4ba08a4），补零会得到 16 位
    expect(fingerprint('10')).toBe('7f89207b4ba08a4');
    expect(fingerprint('10')).toHaveLength(15);
    expect(fingerprint('11')).toBe('7f89307b4ba0a57');
    for (let i = 0; i < 300; i++) {
      const fp = fingerprint(String(i));
      expect(fp).toMatch(/^[0-9a-f]{1,16}$/);
      expect(fp).toBe(reference(String(i)));
      expect(fp.startsWith('0')).toBe(false);
    }
  });

  it('属性：随机路径指纹与参考实现一致，且不同路径几乎不碰撞', () => {
    const r = rng(5);
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const c = canonicalRoute(randomRoute(r, 3));
      const fp = fingerprint(c);
      expect(fp).toBe(reference(c));
      seen.add(fp);
    }
    expect(seen.size).toBe(100);
  });
});
