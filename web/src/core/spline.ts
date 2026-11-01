/**
 * 样条数学。逐条移植自 Kotlin Spline.kt，数值行为一致。
 */

/** 一维三次 Hermite 样条，u ∈ [0,1]。 */
export class CubicHermiteSpline1D {
  private readonly a: number;
  private readonly b: number;
  private readonly c: number;
  private readonly d: number;

  constructor(x0: number, dx0: number, x1: number, dx1: number) {
    this.a = 2 * x0 + dx0 - 2 * x1 + dx1;
    this.b = -3 * x0 - 2 * dx0 + 3 * x1 - dx1;
    this.c = dx0;
    this.d = x0;
  }

  /** 位置 f(u) = a·u³ + b·u² + c·u + d */
  pos(u: number): number {
    return this.a * u * u * u + this.b * u * u + this.c * u + this.d;
  }

  /** 导数（对 u）f'(u) = 3a·u² + 2b·u + c */
  vel(u: number): number {
    return 3 * this.a * u * u + 2 * this.b * u + this.c;
  }
}

/**
 * 将目标角度调整为相对起始角度的最短路径对应值。
 * 与 Kotlin 一致：diff 用 fmod（符号同被除数）；>180 减 360；<=-180 加 360；返回 start + diff。
 */
export function normalizeRelative(start: number, end: number): number {
  let diff = (end - start) % 360;
  if (diff > 180) diff -= 360;
  if (diff <= -180) diff += 360;
  return start + diff;
}

/** 三次 Hermite（u∈[0,1]）→ 三次 Bézier 的 4 个控制值：p0, p0+d0/3, p1-d1/3, p1。 */
export function hermiteToBezier(
  p0: number, d0: number, p1: number, d1: number,
): [number, number, number, number] {
  return [p0, p0 + d0 / 3, p1 - d1 / 3, p1];
}

/** 轨迹端点状态（对应 Kotlin DifferentialPoint2D）。 */
export interface DifferentialPoint2D {
  x: number;
  dx: number;
  y: number;
  dy: number;
  heading?: number;
  dHeading?: number;
}

/** 轨迹上某时刻的状态（ControlNode 的几何子集，ControlNode 可直接赋值给它）。 */
export interface PathPoint {
  x: number;
  dx: number;
  y: number;
  dy: number;
  heading: number;
  dHeading: number;
}

/** 辛普森积分步数（Kotlin 固定 100）。 */
export const ARC_LENGTH_STEPS = 100;

/**
 * 带朝向的两点轨迹（对应 Kotlin OrientedTrajectoryGenerator2D）。
 * x、y 为 Hermite 样条；heading 为端点导数为 0 的 Hermite 样条，终点经 normalizeRelative。
 */
export class OrientedTrajectory2D {
  readonly startX: number;
  readonly startY: number;
  readonly startDx: number;
  readonly startDy: number;
  readonly startHeading: number;
  readonly startDHeading: number;
  readonly endX: number;
  readonly endY: number;
  readonly endDx: number;
  readonly endDy: number;
  readonly endHeading: number;
  readonly endDHeading: number;
  readonly duration: number;
  readonly splineX: CubicHermiteSpline1D;
  readonly splineY: CubicHermiteSpline1D;
  readonly splineHeading: CubicHermiteSpline1D;
  private lengthCache: number | undefined;

  constructor(start: DifferentialPoint2D, end: DifferentialPoint2D, duration: number) {
    this.startX = start.x;
    this.startY = start.y;
    this.startDx = start.dx;
    this.startDy = start.dy;
    this.startHeading = start.heading ?? 0;
    this.startDHeading = start.dHeading ?? 0;
    this.endX = end.x;
    this.endY = end.y;
    this.endDx = end.dx;
    this.endDy = end.dy;
    this.endHeading = end.heading ?? 0;
    this.endDHeading = end.dHeading ?? 0;
    this.duration = duration;
    this.splineX = new CubicHermiteSpline1D(this.startX, this.startDx, this.endX, this.endDx);
    this.splineY = new CubicHermiteSpline1D(this.startY, this.startDy, this.endY, this.endDy);
    this.splineHeading = new CubicHermiteSpline1D(
      this.startHeading, 0, normalizeRelative(this.startHeading, this.endHeading), 0,
    );
  }

  /** 局部时间 → 归一化进度 u；duration<=0 时恒为 1。 */
  getU(localTime: number): number {
    if (this.duration > 0) return Math.min(1, Math.max(0, localTime / this.duration));
    return 1;
  }

  /** 归一化进度 u 处的完整状态。 */
  pointAtU(u: number): PathPoint {
    return {
      x: this.splineX.pos(u),
      dx: this.splineX.vel(u),
      y: this.splineY.pos(u),
      dy: this.splineY.vel(u),
      heading: this.splineHeading.pos(u),
      dHeading: this.splineHeading.vel(u),
    };
  }

  pointAtTime(localTime: number): PathPoint {
    return this.pointAtU(this.getU(localTime));
  }

  /** 辛普森法弧长（n=100）。 */
  get length(): number {
    if (this.lengthCache === undefined) this.lengthCache = this.arcLength(ARC_LENGTH_STEPS);
    return this.lengthCache;
  }

  arcLength(n: number): number {
    if (n % 2 !== 0) return this.arcLength(n + 1);
    const speedAt = (u: number): number => Math.hypot(this.splineX.vel(u), this.splineY.vel(u));
    const du = 1.0 / n;
    let sum = speedAt(0) + speedAt(1);
    for (let i = 1; i < n; i++) {
      const u = i * du;
      const weight = i % 2 === 1 ? 4 : 2;
      sum += weight * speedAt(u);
    }
    return (du / 3.0) * sum;
  }
}
