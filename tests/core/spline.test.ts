import { describe, expect, it } from 'vitest';
import {
  CubicHermiteSpline1D,
  OrientedTrajectory2D,
  hermiteToBezier,
  normalizeRelative,
} from '../../src/core/spline';
import { between, rng } from './_util';

const bezier = (p: readonly number[], u: number): number => {
  const [a, b, c, d] = p as [number, number, number, number];
  const v = 1 - u;
  return v * v * v * a + 3 * v * v * u * b + 3 * v * u * u * c + u * u * u * d;
};
const bezierVel = (p: readonly number[], u: number): number => {
  const [a, b, c, d] = p as [number, number, number, number];
  const v = 1 - u;
  return 3 * (v * v * (b - a) + 2 * v * u * (c - b) + u * u * (d - c));
};

describe('normalizeRelative', () => {
  it('半圈平局取 +180（Kotlin 测试）', () => {
    expect(normalizeRelative(0, -180)).toBeCloseTo(180, 7);
    expect(normalizeRelative(0, 180)).toBeCloseTo(180, 7);
  });
  it('最短路径展开', () => {
    expect(normalizeRelative(350, 10)).toBeCloseTo(370, 9);
    expect(normalizeRelative(10, 350)).toBeCloseTo(-10, 9);
    expect(normalizeRelative(0, 540)).toBeCloseTo(180, 9);
    expect(normalizeRelative(0, 90)).toBe(90);
    expect(normalizeRelative(30, 30)).toBe(30);
  });
  it('结果与目标相差 360 的整数倍且 |diff|<=180', () => {
    const r = rng(1);
    for (let i = 0; i < 500; i++) {
      const s = between(r, -720, 720);
      const e = between(r, -720, 720);
      const out = normalizeRelative(s, e);
      const diff = out - s;
      expect(diff).toBeGreaterThan(-180 - 1e-9);
      expect(diff).toBeLessThanOrEqual(180 + 1e-9);
      const k = (out - e) / 360;
      expect(Math.abs(k - Math.round(k))).toBeLessThan(1e-9);
    }
  });
});

describe('CubicHermiteSpline1D', () => {
  it('端点位置与导数', () => {
    const s = new CubicHermiteSpline1D(1, 2, 7, -3);
    expect(s.pos(0)).toBe(1);
    expect(s.pos(1)).toBeCloseTo(7, 12);
    expect(s.vel(0)).toBe(2);
    expect(s.vel(1)).toBeCloseTo(-3, 12);
  });
  it('系数：a=2x0+dx0-2x1+dx1 等', () => {
    // x0=0,dx0=0,x1=90,dx1=0, u=0.25 → 14.0625（Kotlin 测试数值）
    const s = new CubicHermiteSpline1D(0, 0, 90, 0);
    expect(s.pos(0.25)).toBeCloseTo(14.0625, 7);
  });
});

describe('hermiteToBezier', () => {
  it('返回 p0, p0+d0/3, p1-d1/3, p1', () => {
    expect(hermiteToBezier(3, 6, 12, 9)).toEqual([3, 5, 9, 12]);
  });
  it('属性：Hermite 与 Bézier 在多个 u 上的位置与导数相等', () => {
    const r = rng(42);
    for (let i = 0; i < 200; i++) {
      const x0 = between(r, -72, 72);
      const x1 = between(r, -72, 72);
      const d0 = between(r, -100, 100);
      const d1 = between(r, -100, 100);
      const h = new CubicHermiteSpline1D(x0, d0, x1, d1);
      const b = hermiteToBezier(x0, d0, x1, d1);
      for (const u of [0, 0.1, 0.25, 0.5, 0.77, 0.9, 1]) {
        expect(bezier(b, u)).toBeCloseTo(h.pos(u), 8);
        expect(bezierVel(b, u)).toBeCloseTo(h.vel(u), 8);
      }
    }
  });
});

describe('OrientedTrajectory2D', () => {
  it('预览朝向 = 端点导数为 0 的 Hermite 样条（Kotlin 测试）', () => {
    const t = new OrientedTrajectory2D(
      { x: 0, dx: 10, y: 0, dy: 0, heading: 0, dHeading: 100 },
      { x: 10, dx: 10, y: 0, dy: 0, heading: 90, dHeading: -100 },
      2,
    );
    expect(t.pointAtTime(0.5).heading).toBeCloseTo(14.0625, 7);
  });
  it('朝向终点经 normalizeRelative：350→10 走 +20°', () => {
    const t = new OrientedTrajectory2D(
      { x: 0, dx: 0, y: 0, dy: 0, heading: 350 },
      { x: 1, dx: 0, y: 0, dy: 0, heading: 10 },
      1,
    );
    expect(t.pointAtU(1).heading).toBeCloseTo(370, 9);
    expect(t.pointAtU(0).heading).toBe(350);
  });
  it('duration<=0 时 u 恒为 1；局部时间被钳制', () => {
    const z = new OrientedTrajectory2D({ x: 0, dx: 0, y: 0, dy: 0 }, { x: 5, dx: 0, y: 0, dy: 0 }, 0);
    expect(z.getU(0)).toBe(1);
    expect(z.pointAtTime(0).x).toBeCloseTo(5, 12);
    const t = new OrientedTrajectory2D({ x: 0, dx: 0, y: 0, dy: 0 }, { x: 5, dx: 0, y: 0, dy: 0 }, 2);
    expect(t.getU(-1)).toBe(0);
    expect(t.getU(1)).toBe(0.5);
    expect(t.getU(99)).toBe(1);
  });
  it('弧长（Simpson n=100）：直线段长度精确', () => {
    const t = new OrientedTrajectory2D({ x: 0, dx: 30, y: 0, dy: 40 }, { x: 30, dx: 30, y: 40, dy: 40 }, 1);
    expect(t.length).toBeCloseTo(50, 9);
    const odd = t.arcLength(7);
    expect(odd).toBeCloseTo(50, 9);
  });
  it('弧长随曲线单调：弯曲段长于弦长', () => {
    const t = new OrientedTrajectory2D({ x: 0, dx: 0, y: 0, dy: 80 }, { x: 40, dx: 0, y: 0, dy: -80 }, 1);
    expect(t.length).toBeGreaterThan(40);
  });
});
