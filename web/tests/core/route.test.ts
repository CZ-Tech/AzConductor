import { describe, expect, it } from 'vitest';
import { makeNode } from '../../src/core/node';
import { RouteCore, pathError, polyline, svgPathD } from '../../src/core/route';
import { hermiteToBezier } from '../../src/core/spline';
import { between, randomRoute, rng } from './_util';

const flat = (x: number, extra: Parameters<typeof makeNode>[0] extends infer P ? Partial<P> : never = {}) =>
  makeNode({ x, y: 0, dx: 0, dy: 0, ...extra });

describe('RouteCore（Kotlin ComposeAppCommonTest 移植）', () => {
  it('预览包含 delayAfterArrive', () => {
    const route = new RouteCore([
      flat(0),
      flat(10, { duration: 2, delayAfterArrive: 3 }),
      flat(20, { duration: 2 }),
    ]);
    expect(route.totalTime).toBe(7);
    expect(route.pointAt(2.5)?.x).toBe(10);
    expect(route.pointAt(5)?.x).toBe(10);
    expect(route.pointAt(6)!.x).toBeGreaterThan(10);
  });

  it('起点等待出现在预览时间线中', () => {
    const route = new RouteCore([
      makeNode({ x: 0, dx: 20, y: 0, dy: 0, delayAfterArrive: 1.5 }),
      makeNode({ x: 10, dx: 20, y: 0, dy: 0, duration: 2 }),
    ]);
    expect(route.totalTime).toBe(3.5);
    expect(route.pointAt(1)?.x).toBe(0);
    expect(route.pointAt(2)!.x).toBeGreaterThan(0);
  });
});

describe('RouteCore 基本行为', () => {
  it('空路径 / 单点路径', () => {
    expect(new RouteCore([]).pointAt(0)).toBeNull();
    expect(new RouteCore([]).totalTime).toBe(0);
    const n = flat(4, { delayAfterArrive: 2 });
    const one = new RouteCore([n]);
    expect(one.pointAt(5)).toBe(one.nodes[0]);
    expect(one.totalTime).toBe(2);
    expect(one.trajectories).toHaveLength(0);
  });

  it('不可变：不受外部数组修改影响，nodes 冻结', () => {
    const arr = [flat(0), flat(10, { duration: 1 })];
    const route = new RouteCore(arr);
    arr.push(flat(20));
    expect(route.nodes).toHaveLength(2);
    expect(Object.isFrozen(route.nodes)).toBe(true);
  });

  it('时间被钳制到 [0,total]', () => {
    const route = new RouteCore([flat(0), flat(10, { duration: 2 })]);
    expect(route.pointAt(-5)?.x).toBe(0);
    expect(route.pointAt(100)?.x).toBeCloseTo(10, 12);
  });

  it('负时长 / 负等待按 0 处理', () => {
    const route = new RouteCore([flat(0, { delayAfterArrive: -3 }), flat(10, { duration: -1, delayAfterArrive: -2 })]);
    expect(route.totalTime).toBe(0);
    expect(route.segmentStartTimes).toEqual([0]);
  });

  it('属性：总时间公式 first.delay + Σ(段时长 + 下一点 delay)', () => {
    const r = rng(7);
    for (let i = 0; i < 100; i++) {
      const nodes = randomRoute(r, 2 + Math.floor(r() * 8));
      const route = new RouteCore(nodes);
      let expected = nodes[0]!.delayAfterArrive;
      for (let k = 1; k < nodes.length; k++) expected += nodes[k]!.duration + nodes[k]!.delayAfterArrive;
      expect(route.totalTime).toBeCloseTo(expected, 9);
      // 段起始时间递推
      let t = nodes[0]!.delayAfterArrive;
      route.segmentStartTimes.forEach((s, k) => {
        expect(s).toBeCloseTo(t, 9);
        t += nodes[k + 1]!.duration + nodes[k + 1]!.delayAfterArrive;
      });
      expect(route.segmentStartTimes).toHaveLength(nodes.length - 1);
    }
  });

  it('属性：二分 pointAt 与逐段线性扫描（Kotlin 算法）一致，等待期间停在段终点', () => {
    const r = rng(99);
    for (let i = 0; i < 60; i++) {
      const nodes = randomRoute(r, 2 + Math.floor(r() * 6));
      const route = new RouteCore(nodes);
      const total = route.totalTime;
      const linear = (time: number) => {
        const t = Math.min(Math.max(time, 0), total);
        const init = Math.max(nodes[0]!.delayAfterArrive, 0);
        if (t <= init) return nodes[0]!;
        let acc = init;
        for (let k = 0; k < route.trajectories.length; k++) {
          const traj = route.trajectories[k]!;
          const end = acc + Math.max(traj.duration, 0);
          if (t <= end) return traj.pointAtTime(t - acc);
          const dEnd = end + Math.max(nodes[k + 1]!.delayAfterArrive, 0);
          if (t <= dEnd) return traj.pointAtTime(traj.duration);
          acc = dEnd;
        }
        const last = route.trajectories[route.trajectories.length - 1]!;
        return last.pointAtTime(last.duration);
      };
      for (let s = 0; s <= 80; s++) {
        const t = between(r, -1, total + 1);
        const a = route.pointAt(t)!;
        const b = linear(t);
        expect(a.x).toBeCloseTo(b.x, 9);
        expect(a.y).toBeCloseTo(b.y, 9);
        expect(a.heading).toBeCloseTo(b.heading, 9);
      }
      // 每个节点的到达时刻位置 = 该节点
      route.segmentEndTimes.forEach((e, k) => {
        const p = route.pointAt(e)!;
        const n = nodes[k + 1]!;
        expect(p.x).toBeCloseTo(n.x, 7);
        expect(p.y).toBeCloseTo(n.y, 7);
        // 等待期间仍在原地
        const mid = (e + route.segmentDelayEndTimes[k]!) / 2;
        const pm = route.pointAt(mid)!;
        expect(pm.x).toBeCloseTo(n.x, 7);
        expect(pm.y).toBeCloseTo(n.y, 7);
      });
    }
  });

  it('totalLength = 各段弧长之和', () => {
    const route = new RouteCore([
      makeNode({ x: 0, dx: 30, y: 0, dy: 40 }),
      makeNode({ x: 30, dx: 30, y: 40, dy: 40 }),
      makeNode({ x: 60, dx: 30, y: 80, dy: 40 }),
    ]);
    expect(route.totalLength).toBeCloseTo(100, 8);
  });
});

describe('svgPathD', () => {
  it('少于 2 点为空串', () => {
    expect(svgPathD([])).toBe('');
    expect(svgPathD([flat(1)])).toBe('');
  });

  it('精确格式：M sx sy C …，屏幕 sx=y, sy=x', () => {
    const a = makeNode({ x: 0, y: 0, dx: 30, dy: 0 });
    const b = makeNode({ x: 30, y: 12, dx: 0, dy: 60 });
    // 逻辑 X: 0, 10, 30, 30；逻辑 Y: 0, 0, 0, 12 → 控制点 (p1 - d1/3)=12-20=-8
    expect(svgPathD([a, b])).toBe('M 0 0 C 0 10 -8 30 12 30');
  });

  it('属性：每段的 Bézier 控制点等于 Hermite 转换，端点等于节点', () => {
    const r = rng(5);
    for (let i = 0; i < 50; i++) {
      const nodes = randomRoute(r, 2 + Math.floor(r() * 5));
      const d = svgPathD(nodes);
      const tokens = d.split(' ');
      expect(tokens[0]).toBe('M');
      expect(Number(tokens[1])).toBe(nodes[0]!.y);
      expect(Number(tokens[2])).toBe(nodes[0]!.x);
      const segs = d.split(' C ').slice(1);
      expect(segs).toHaveLength(nodes.length - 1);
      segs.forEach((seg, k) => {
        const v = seg.split(' ').map(Number);
        const a = nodes[k]!;
        const b = nodes[k + 1]!;
        const bx = hermiteToBezier(a.x, a.dx, b.x, b.dx);
        const by = hermiteToBezier(a.y, a.dy, b.y, b.dy);
        expect(v).toEqual([by[1], bx[1], by[2], bx[2], by[3], bx[3]]);
      });
    }
  });

  it('属性：Bézier 曲线与轨迹样条几何一致', () => {
    const r = rng(11);
    const nodes = randomRoute(r, 4);
    const route = new RouteCore(nodes);
    route.trajectories.forEach((traj, k) => {
      const a = nodes[k]!;
      const b = nodes[k + 1]!;
      const bx = hermiteToBezier(a.x, a.dx, b.x, b.dx);
      const by = hermiteToBezier(a.y, a.dy, b.y, b.dy);
      for (const u of [0, 0.2, 0.5, 0.8, 1]) {
        const v = 1 - u;
        const px = v * v * v * bx[0] + 3 * v * v * u * bx[1] + 3 * v * u * u * bx[2] + u * u * u * bx[3];
        const py = v * v * v * by[0] + 3 * v * v * u * by[1] + 3 * v * u * u * by[2] + u * u * u * by[3];
        expect(px).toBeCloseTo(traj.pointAtU(u).x, 8);
        expect(py).toBeCloseTo(traj.pointAtU(u).y, 8);
      }
    });
  });
});

describe('polyline / pathError', () => {
  it('采样含首尾点与节点', () => {
    const nodes = [makeNode({ x: 0, y: 0, dx: 10, dy: 0 }), makeNode({ x: 10, y: 0, dx: 10, dy: 0 }), makeNode({ x: 20, y: 0, dx: 10, dy: 0 })];
    const line = polyline(nodes, 10);
    expect(line).toHaveLength(21);
    expect(line[0]).toEqual({ x: 0, y: 0 });
    expect(line[10]!.x).toBeCloseTo(10, 12);
    expect(line[20]!.x).toBeCloseTo(20, 12);
    expect(polyline([], 5)).toEqual([]);
    expect(polyline([nodes[0]!], 5)).toEqual([{ x: 0, y: 0 }]);
  });

  it('点到线段的投影距离', () => {
    const line = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
    expect(pathError({ x: 5, y: 3 }, line)).toBeCloseTo(3, 12);
    expect(pathError({ x: 12, y: 5 }, line)).toBeCloseTo(2, 12);
    expect(pathError({ x: -3, y: -4 }, line)).toBeCloseTo(5, 12);
    expect(pathError({ x: 10, y: 10 }, line)).toBe(0);
    expect(pathError({ x: 3, y: 4 }, [{ x: 0, y: 0 }])).toBe(5);
    expect(pathError({ x: 0, y: 0 }, [])).toBeNaN();
    expect(pathError({ x: 3, y: 4 }, [{ x: 0, y: 0 }, { x: 0, y: 0 }])).toBe(5);
  });

  it('属性：曲线上任意点的误差接近 0；不超过到最近采样点的距离', () => {
    const r = rng(3);
    const nodes = randomRoute(r, 4);
    const route = new RouteCore(nodes);
    const line = polyline(nodes, 400);
    for (let i = 0; i < 100; i++) {
      const p = route.pointAt(between(r, 0, route.totalTime))!;
      expect(pathError(p, line)).toBeLessThan(0.5);
      const q = { x: between(r, -90, 90), y: between(r, -90, 90) };
      const nearestSample = Math.min(...line.map((s) => Math.hypot(s.x - q.x, s.y - q.y)));
      expect(pathError(q, line)).toBeLessThanOrEqual(nearestSample + 1e-9);
    }
  });
});
