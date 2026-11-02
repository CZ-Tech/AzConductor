/**
 * 场地坐标纯函数。
 *
 * 已核对 Kotlin：FieldConfig 中 LOGICAL_X→屏幕(0,1)（x 朝屏幕下），LOGICAL_Y→屏幕(1,0)（y 朝屏幕右），
 * 原点比例 0.5/0.5（场地中心），CANVAS_ROTATE_DEG=0，因此 屏幕 sx = 逻辑 y，sy = 逻辑 x；
 * fieldXAngleDeg = atan2(1,0) = 90°，机器人屏幕旋转角 = fieldXAngleDeg − heading = 90 − heading（度，顺时针为正的屏幕角）。
 * SVG viewBox = "-72 -72 144 144"，逻辑与屏幕原点均为中心，单位 1 inch = 1 SVG 单位。
 */
import { makeNode, mirrorY, nextWaypoint, type ControlNode } from './node';
import type { Vec2 } from './route';

export const FIELD_SIZE = 144;
export const FIELD_HALF = 72;
export const FIELD_VIEWBOX = '-72 -72 144 144';
export const ORIGIN_RATIO = 0.5;

export const ROBOT_WIDTH = 18;
export const ROBOT_HEIGHT = 18;
/** 车头圆点直径（inch，RobotComponent.headDotLogicalSize） */
export const ROBOT_HEAD_DOT = 2.5;

/** 速度手柄缩放：手柄位置 = 节点 + (dx,dy)/K */
export const K_VELOCITY_HANDLE = 5.0;
/** 新点（首点/点击添加）的 dx = 10 * K_VELOCITY_HANDLE = 50 */
export const NEW_POINT_DX = 10.0 * K_VELOCITY_HANDLE;
/** 侧栏追加点沿 x 前进的步长（inch） */
export const NEW_POINT_STEP = 10;
/** 场地逻辑 X 轴在屏幕上的角度（度） */
export const FIELD_X_ANGLE_DEG = 90;

export interface ScreenPoint {
  sx: number;
  sy: number;
}

export interface FieldBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export const FIELD_BOUNDS: FieldBounds = {
  minX: -FIELD_SIZE * ORIGIN_RATIO,
  maxX: FIELD_SIZE * (1 - ORIGIN_RATIO),
  minY: -FIELD_SIZE * ORIGIN_RATIO,
  maxY: FIELD_SIZE * (1 - ORIGIN_RATIO),
};

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** 逻辑 (x,y) → SVG 屏幕 (sx=y, sy=x)。 */
export function logicalToScreen(x: number, y: number): ScreenPoint {
  return { sx: y, sy: x };
}

/** SVG 屏幕 (sx,sy) → 逻辑 (x=sy, y=sx)。 */
export function screenToLogical(sx: number, sy: number): Vec2 {
  return { x: sy, y: sx };
}

/** 屏幕位移 → 逻辑位移。 */
export function screenDeltaToLogicalDelta(dsx: number, dsy: number): Vec2 {
  return { x: dsy, y: dsx };
}

/** 逻辑坐标限制在场地内 [-72,72]。 */
export function clampToField(x: number, y: number): Vec2 {
  return {
    x: clamp(x, FIELD_BOUNDS.minX, FIELD_BOUNDS.maxX),
    y: clamp(y, FIELD_BOUNDS.minY, FIELD_BOUNDS.maxY),
  };
}

/** 机器人在屏幕上的旋转角（度，SVG rotate 方向）= 90 − heading。 */
export function robotScreenRotation(headingDeg: number): number {
  return FIELD_X_ANGLE_DEG - headingDeg;
}

/** 规格化到 (-180, 180]（与 RobotComponent 拖拽一致）。 */
export function wrapHeading(deg: number): number {
  let h = deg;
  while (h <= -180) h += 360;
  while (h > 180) h -= 360;
  return h;
}

/** 屏幕角（度，atan2(dsy,dsx)）→ heading，规格化到 (-180,180]。 */
export function headingFromScreenAngle(screenAngleDeg: number): number {
  return wrapHeading(FIELD_X_ANGLE_DEG - screenAngleDeg);
}

/** 由旋转中心指向指针的屏幕向量求 heading（度）。 */
export function headingFromPointer(centerSx: number, centerSy: number, pointerSx: number, pointerSy: number): number {
  const angle = (Math.atan2(pointerSy - centerSy, pointerSx - centerSx) * 180) / Math.PI;
  return headingFromScreenAngle(angle);
}

/** 车头圆点相对机器人中心的屏幕位置（距离 = ROBOT_WIDTH/2）。 */
export function headDotOffsetScreen(headingDeg: number): ScreenPoint {
  const rad = (robotScreenRotation(headingDeg) * Math.PI) / 180;
  const dist = ROBOT_WIDTH / 2;
  return { sx: dist * Math.cos(rad), sy: dist * Math.sin(rad) };
}

/** 速度手柄的逻辑位置 = 节点 + (dx,dy)/K。 */
export function velocityHandleLogical(n: { x: number; y: number; dx: number; dy: number }): Vec2 {
  return { x: n.x + n.dx / K_VELOCITY_HANDLE, y: n.y + n.dy / K_VELOCITY_HANDLE };
}

/** 速度手柄的屏幕位置。 */
export function velocityHandleScreen(n: { x: number; y: number; dx: number; dy: number }): ScreenPoint {
  const h = velocityHandleLogical(n);
  return logicalToScreen(h.x, h.y);
}

/** 手柄被拖到逻辑位置 (hx,hy) 时对应的 (dx,dy)。 */
export function velocityFromHandleLogical(
  n: { x: number; y: number }, hx: number, hy: number,
): { dx: number; dy: number } {
  return { dx: (hx - n.x) * K_VELOCITY_HANDLE, dy: (hy - n.y) * K_VELOCITY_HANDLE };
}

/** 手柄被拖到屏幕位置时对应的 (dx,dy)。 */
export function velocityFromHandleScreen(
  n: { x: number; y: number }, hsx: number, hsy: number,
): { dx: number; dy: number } {
  const l = screenToLogical(hsx, hsy);
  return velocityFromHandleLogical(n, l.x, l.y);
}

// ---- 新点 ----

/** 空路径的首点：(0,0)，dx=NEW_POINT_DX，dy=0（侧栏"添加"）。 */
export function firstNode(): ControlNode {
  return makeNode({ x: 0, y: 0, dx: NEW_POINT_DX, dy: 0 });
}

/** 点击场地添加：逻辑点位被限制在场地内，dx=NEW_POINT_DX，dy=0（RouteCanvas 点击）。 */
export function nodeAtLogical(x: number, y: number): ControlNode {
  const c = clampToField(x, y);
  return makeNode({ x: c.x, y: c.y, dx: NEW_POINT_DX, dy: 0 });
}

/** 侧栏追加点：沿 x 前进 10；到边界无法前进时沿 y 前进 10；继承上一点几何/功率（nextWaypoint）。 */
export function appendedNode(last: ControlNode | undefined): ControlNode {
  if (last === undefined) return firstNode();
  const nextX = clamp(last.x + NEW_POINT_STEP, FIELD_BOUNDS.minX, FIELD_BOUNDS.maxX);
  const nextY =
    nextX === last.x
      ? clamp(last.y + NEW_POINT_STEP, FIELD_BOUNDS.minY, FIELD_BOUNDS.maxY)
      : clamp(last.y, FIELD_BOUNDS.minY, FIELD_BOUNDS.maxY);
  return nextWaypoint(last, nextX, nextY);
}

// ---- 镜像 ----

/** 逻辑点沿 x 轴镜像（y 取反）。 */
export function mirrorLogical(x: number, y: number): Vec2 {
  return { x, y: -y };
}

/** 屏幕点对应的镜像（sx 取反）。 */
export function mirrorScreen(sx: number, sy: number): ScreenPoint {
  return { sx: -sx, sy };
}

/** 整条路径镜像（蓝→红）。 */
export function mirrorNodes(nodes: readonly ControlNode[]): ControlNode[] {
  return nodes.map(mirrorY);
}
