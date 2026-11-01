/**
 * 路径存储 / 导入导出文档格式。
 *
 * localStorage 键 `robot_routes` 的值 = `[{robotName, routes:[{name, points}]}]`（Kotlin List<RobotRoutes>），
 * points 为完整 ControlNode（含 delayAfterArrive，可选字段缺省时省略）。
 * 导入按结构顺序识别（与 Kotlin RouteRepository.importJson 一致）：
 *   1. 裸 ControlNode[]（元素均含数值 x/dx/y/dy）
 *   2. 机器人线格式帧（可含 {"wait":s}、缺省 dx/dy）
 *   3. 存档格式 [{robotName, routes:[…]}]
 */
import type { ControlNode } from './node';
import { WireError, decodeNodeFrame, decodeRobotRoute, encodeRobotRoute } from './wire';

export const ROUTES_STORAGE_KEY = 'robot_routes';
export const DEFAULT_ROBOT_NAME = 'default';
export const DEFAULT_IMPORT_NAME = '导入路径';

export interface RouteData {
  name: string;
  points: ControlNode[];
}
export interface RobotRoutes {
  robotName: string;
  routes: RouteData[];
}
export type RoutesDoc = RobotRoutes[];

export type ImportKind = 'nodes' | 'wire' | 'archive';
export type ImportResult =
  | { ok: true; kind: ImportKind; routes: RouteData[] }
  | { ok: false; error: string };

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const has = (o: Record<string, unknown>, k: string): boolean =>
  Object.prototype.hasOwnProperty.call(o, k);

/** 存储形态的单节点：Kotlin 声明顺序，含 delayAfterArrive，null 可选字段省略。 */
export function encodeStoredNode(n: ControlNode): Record<string, unknown> {
  const f: Record<string, unknown> = {
    x: n.x,
    dx: n.dx,
    y: n.y,
    dy: n.dy,
    heading: n.heading,
    dHeading: n.dHeading,
    duration: n.duration,
    marker: n.marker,
    command: n.command,
    commandParams: [...n.commandParams],
    delayAfterArrive: n.delayAfterArrive,
    maxPower: n.maxPower,
  };
  if (n.maxSpeed != null) f['maxSpeed'] = n.maxSpeed;
  if (n.endSpeed != null) f['endSpeed'] = n.endSpeed;
  f['brakeZoneIn'] = n.brakeZoneIn;
  if (n.brakeForwardPower != null) f['brakeForwardPower'] = n.brakeForwardPower;
  return f;
}

function stringify(value: unknown, pretty: boolean): string {
  return pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value);
}

export function encodeRoutesDoc(doc: readonly RobotRoutes[]): unknown[] {
  return doc.map((r) => ({
    robotName: r.robotName,
    routes: r.routes.map((rt) => ({ name: rt.name, points: rt.points.map(encodeStoredNode) })),
  }));
}

/** 将路径列表包成单机器人存档文档（robotName = "default"）。 */
export function wrapRoutes(routes: readonly RouteData[], robotName: string = DEFAULT_ROBOT_NAME): RoutesDoc {
  return [{ robotName, routes: [...routes] }];
}

/** 展平文档中的全部路径。 */
export function allRoutes(doc: readonly RobotRoutes[]): RouteData[] {
  return doc.flatMap((r) => r.routes);
}

// ---- 解码 ----

function decodeRoute(raw: unknown, where: string): RouteData {
  if (!isObj(raw)) throw new WireError(`${where} 不是对象`);
  if (typeof raw['name'] !== 'string') throw new WireError(`${where} 缺少 name`);
  const pts = has(raw, 'points') ? raw['points'] : [];
  if (!Array.isArray(pts)) throw new WireError(`${where} 的 points 必须是数组`);
  const points = pts.map((p: unknown, i: number) => {
    if (!isObj(p)) throw new WireError(`${where} 第 ${i + 1} 个点不是对象`);
    return decodeNodeFrame(p, i + 1);
  });
  return { name: raw['name'], points };
}

function decodeRobot(raw: unknown, index: number): RobotRoutes {
  if (!isObj(raw)) throw new WireError(`第 ${index + 1} 项不是对象`);
  const robotName = has(raw, 'robotName') ? raw['robotName'] : DEFAULT_ROBOT_NAME;
  if (typeof robotName !== 'string') throw new WireError(`第 ${index + 1} 项 robotName 无效`);
  const rts = has(raw, 'routes') ? raw['routes'] : [];
  if (!Array.isArray(rts)) throw new WireError(`第 ${index + 1} 项 routes 必须是数组`);
  return {
    robotName,
    routes: rts.map((r: unknown, i: number) => decodeRoute(r, `第 ${index + 1} 项路径 ${i + 1}`)),
  };
}

/** 解码已解析的存档值；结构不符抛 WireError。 */
export function decodeRoutesDoc(value: unknown): RoutesDoc {
  if (!Array.isArray(value)) throw new WireError('存档必须是 JSON 数组');
  return value.map(decodeRobot);
}

/** 读取 localStorage 的 robot_routes 文本；空白/损坏返回 null。 */
export function parseRoutesDoc(text: string | null | undefined): RoutesDoc | null {
  if (text == null || text.trim() === '') return null;
  try {
    return decodeRoutesDoc(JSON.parse(text));
  } catch {
    return null;
  }
}

export function serializeRoutesDoc(doc: readonly RobotRoutes[], pretty = false): string {
  return stringify(encodeRoutesDoc(doc), pretty);
}

// ---- 导入 ----

function isBareNodeArray(frames: readonly unknown[]): boolean {
  return frames.every(
    (f) =>
      isObj(f) &&
      ['x', 'dx', 'y', 'dy'].every((k) => has(f, k) && typeof f[k] === 'number'),
  );
}

function looksLikeArchive(frames: readonly unknown[]): boolean {
  return frames.every(
    (f) => isObj(f) && (Array.isArray(f['routes']) || typeof f['robotName'] === 'string'),
  );
}

/** 解析已解析的 JSON 值：裸节点 → 机器人线格式 → 存档。 */
export function importValue(value: unknown, defaultName: string = DEFAULT_IMPORT_NAME): ImportResult {
  if (!Array.isArray(value)) return { ok: false, error: '导入内容必须是 JSON 数组' };

  if (isBareNodeArray(value)) {
    try {
      const points = value.map((f: unknown, i: number) => decodeNodeFrame(f as Record<string, unknown>, i + 1));
      return { ok: true, kind: 'nodes', routes: [{ name: defaultName, points }] };
    } catch {
      // 继续尝试其他格式
    }
  }
  try {
    return { ok: true, kind: 'wire', routes: [{ name: defaultName, points: decodeRobotRoute(value) }] };
  } catch (e) {
    if (!looksLikeArchive(value)) {
      return { ok: false, error: e instanceof WireError ? e.message : '无法识别的路径格式' };
    }
  }
  try {
    return { ok: true, kind: 'archive', routes: allRoutes(decodeRoutesDoc(value)) };
  } catch (e) {
    return { ok: false, error: e instanceof WireError ? e.message : '无法识别的路径格式' };
  }
}

/** 解析导入文本。JSON 无效返回错误。 */
export function importText(text: string, defaultName: string = DEFAULT_IMPORT_NAME): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'JSON 解析失败' };
  }
  return importValue(parsed, defaultName);
}

// ---- 导出 ----

/** 单条路径（裸 ControlNode[]，含 delayAfterArrive，可被导入识别）。 */
export function exportRouteJson(points: readonly ControlNode[], pretty = true): string {
  return stringify(points.map(encodeStoredNode), pretty);
}

/** 机器人线格式（wait 帧）。 */
export function exportRobotWireJson(points: readonly ControlNode[], pretty = false): string {
  return stringify(encodeRobotRoute(points), pretty);
}

/** 全部路径的存档（等同 Kotlin exportJson）。 */
export function exportArchiveJson(routes: readonly RouteData[], pretty = true): string {
  return serializeRoutesDoc(wrapRoutes(routes), pretty);
}
