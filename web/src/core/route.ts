/**
 * 不可变路径内核。移植自 Kotlin RouteCore：时间线、pointAt、弧长，以及 SVG 三次 Bézier 路径。
 */
import type { ControlNode } from './node';
import { hermiteToBezier, OrientedTrajectory2D, type PathPoint } from './spline';

export interface Vec2 {
  x: number;
  y: number;
}

const nonNeg = (v: number): number => Math.max(v, 0);

export class RouteCore {
  readonly nodes: readonly ControlNode[];
  readonly trajectories: readonly OrientedTrajectory2D[];
  /** 起始点到达后的初始等待 = max(first.delayAfterArrive, 0) */
  readonly initialDelay: number;
  /** 每段的起始时间（含初始等待与此前所有等待）。 */
  readonly segmentStartTimes: readonly number[];
  /** 每段运动结束时间 = start + max(duration, 0)。 */
  readonly segmentEndTimes: readonly number[];
  /** 每段结束且到点等待完毕的时间（= 下一段起始时间）。 */
  readonly segmentDelayEndTimes: readonly number[];
  readonly totalTime: number;

  constructor(nodes: readonly ControlNode[]) {
    this.nodes = Object.freeze([...nodes]);
    const trajs: OrientedTrajectory2D[] = [];
    for (let i = 0; i + 1 < this.nodes.length; i++) {
      const s = this.nodes[i] as ControlNode;
      const e = this.nodes[i + 1] as ControlNode;
      trajs.push(new OrientedTrajectory2D(s, e, e.duration));
    }
    this.trajectories = Object.freeze(trajs);

    this.initialDelay = this.nodes.length > 0 ? nonNeg((this.nodes[0] as ControlNode).delayAfterArrive) : 0;
    const starts: number[] = [];
    const ends: number[] = [];
    const delayEnds: number[] = [];
    let acc = this.initialDelay;
    trajs.forEach((traj, i) => {
      starts.push(acc);
      const end = acc + nonNeg(traj.duration);
      ends.push(end);
      const next = this.nodes[i + 1] as ControlNode;
      const delayEnd = end + nonNeg(next.delayAfterArrive);
      delayEnds.push(delayEnd);
      acc = delayEnd;
    });
    this.segmentStartTimes = Object.freeze(starts);
    this.segmentEndTimes = Object.freeze(ends);
    this.segmentDelayEndTimes = Object.freeze(delayEnds);
    // 与 Kotlin 一致（含浮点求和顺序）：initialDelay + Σ(max(duration,0) + max(下一点 delay,0))
    let sum = 0;
    trajs.forEach((traj, i) => {
      sum += nonNeg(traj.duration) + nonNeg((this.nodes[i + 1] as ControlNode).delayAfterArrive);
    });
    this.totalTime = this.initialDelay + sum;
  }

  get length(): number {
    return this.trajectories.reduce((s, t) => s + t.length, 0);
  }

  get totalLength(): number {
    return this.length;
  }

  /**
   * 绝对时间 t 的状态。t 会被钳到 [0,totalTime]；等待期间停在该段终点。
   * 空路径返回 null；单点路径返回该点。
   */
  pointAt(time: number): PathPoint | null {
    const first = this.nodes[0];
    if (first === undefined) return null;
    if (this.trajectories.length === 0) return first;

    const t = Math.min(Math.max(time, 0), this.totalTime);
    if (t <= this.initialDelay) return first;

    // 二分：第一个满足 t <= segmentDelayEndTimes[i] 的段
    const ends = this.segmentDelayEndTimes;
    let lo = 0;
    let hi = ends.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (t <= (ends[mid] as number)) {
        found = mid;
        hi = mid - 1;
      } else {
        lo = mid + 1;
      }
    }
    if (found < 0) {
      const last = this.trajectories[this.trajectories.length - 1] as OrientedTrajectory2D;
      return last.pointAtTime(last.duration);
    }
    const traj = this.trajectories[found] as OrientedTrajectory2D;
    const start = this.segmentStartTimes[found] as number;
    if (t <= (this.segmentEndTimes[found] as number)) return traj.pointAtTime(t - start);
    return traj.pointAtTime(traj.duration);
  }

  /** 每段 n 等分采样的逻辑坐标折线（含首点），用于误差计算；单点路径返回该点；空路径返回 []。 */
  polyline(n: number): Vec2[] {
    return polyline(this.nodes, n);
  }

  svgPathD(): string {
    return svgPathD(this.nodes);
  }
}

/** 数值 → SVG 文本（去掉 -0，保留完整精度）。 */
function num(v: number): string {
  return Object.is(v, -0) ? '0' : String(v);
}

/**
 * 路径的 SVG path d：`M sx sy C c1x c1y c2x c2y ex ey …`，坐标为屏幕坐标（sx=y, sy=x）。
 * 每段 Hermite 转精确三次 Bézier（u 为线性时间，几何与按时间采样一致）。
 * 少于 2 个点返回空串。
 */
export function svgPathD(nodes: readonly ControlNode[]): string {
  if (nodes.length < 2) return '';
  const first = nodes[0] as ControlNode;
  const parts: string[] = [`M ${num(first.y)} ${num(first.x)}`];
  for (let i = 0; i + 1 < nodes.length; i++) {
    const a = nodes[i] as ControlNode;
    const b = nodes[i + 1] as ControlNode;
    const bx = hermiteToBezier(a.x, a.dx, b.x, b.dx);
    const by = hermiteToBezier(a.y, a.dy, b.y, b.dy);
    // 屏幕 x = 逻辑 y，屏幕 y = 逻辑 x
    parts.push(
      `C ${num(by[1])} ${num(bx[1])} ${num(by[2])} ${num(bx[2])} ${num(by[3])} ${num(bx[3])}`,
    );
  }
  return parts.join(' ');
}

/**
 * 逻辑坐标折线：每段在 u ∈ [0,1] 上均分 n 份（n>=1），含首点，段间端点不重复。
 */
export function polyline(nodes: readonly ControlNode[], n: number): Vec2[] {
  const first = nodes[0];
  if (first === undefined) return [];
  if (nodes.length === 1) return [{ x: first.x, y: first.y }];
  const steps = Math.max(1, Math.floor(n));
  const route = new RouteCore(nodes);
  const out: Vec2[] = [{ x: first.x, y: first.y }];
  for (const traj of route.trajectories) {
    for (let k = 1; k <= steps; k++) {
      const u = k / steps;
      out.push({ x: traj.splineX.pos(u), y: traj.splineY.pos(u) });
    }
  }
  return out;
}

/** 点到折线的最短距离（逐段投影）。折线为空返回 NaN；单点则为到该点的距离。 */
export function pathError(pose: Vec2, line: readonly Vec2[]): number {
  const p0 = line[0];
  if (p0 === undefined) return NaN;
  if (line.length === 1) return Math.hypot(pose.x - p0.x, pose.y - p0.y);
  let best = Infinity;
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i] as Vec2;
    const b = line[i + 1] as Vec2;
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const len2 = abx * abx + aby * aby;
    let t = len2 === 0 ? 0 : ((pose.x - a.x) * abx + (pose.y - a.y) * aby) / len2;
    t = Math.min(1, Math.max(0, t));
    const d = Math.hypot(pose.x - (a.x + t * abx), pose.y - (a.y + t * aby));
    if (d < best) best = d;
  }
  return best;
}
