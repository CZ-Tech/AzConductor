/**
 * 机器人线格式（wire）编解码。移植自 SplineRouteContract.encodeRobotRoute / decodeRobotRoute。
 *
 * - delayAfterArrive 编码为紧随该点的独立 {"wait": 秒} 帧，点帧中不含 delayAfterArrive。
 * - 可选字段 maxSpeed/endSpeed/brakeForwardPower 缺省时省略，永不输出 null。
 * - 比较路径一律比较解析后的结构 / canonicalRoute，不要比较原始文本。
 */
import type { ControlNode } from './node';
import { primitiveContent, primitiveDouble } from './contract';

export class WireError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WireError';
  }
}

/** 点帧键序（与 Kotlin ControlNode 声明顺序一致，去掉 delayAfterArrive）。 */
export function encodeNodeFrame(n: ControlNode): Record<string, unknown> {
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
    maxPower: n.maxPower,
  };
  if (n.maxSpeed != null) f['maxSpeed'] = n.maxSpeed;
  if (n.endSpeed != null) f['endSpeed'] = n.endSpeed;
  f['brakeZoneIn'] = n.brakeZoneIn;
  if (n.brakeForwardPower != null) f['brakeForwardPower'] = n.brakeForwardPower;
  return f;
}

export function encodeRobotRoute(nodes: readonly ControlNode[]): unknown[] {
  const frames: unknown[] = [];
  for (const n of nodes) {
    frames.push(encodeNodeFrame(n));
    if (n.delayAfterArrive > 0) frames.push({ wait: n.delayAfterArrive });
  }
  return frames;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const has = (o: Record<string, unknown>, k: string): boolean =>
  Object.prototype.hasOwnProperty.call(o, k);

function reqNum(obj: Record<string, unknown>, key: string, frameNo: number): number {
  if (!has(obj, key)) throw new WireError(`第 ${frameNo} 帧缺少 ${key}`);
  return optNum(obj, key, frameNo, 0);
}

function optNum(obj: Record<string, unknown>, key: string, frameNo: number, def: number): number {
  if (!has(obj, key)) return def;
  const v = primitiveDouble(obj[key]);
  if (v === null || Number.isNaN(v)) throw new WireError(`第 ${frameNo} 帧 ${key} 必须为数值`);
  return v;
}

function optNullableNum(obj: Record<string, unknown>, key: string, frameNo: number): number | undefined {
  if (!has(obj, key) || obj[key] === null) return undefined;
  return optNum(obj, key, frameNo, 0);
}

function optStr(obj: Record<string, unknown>, key: string, frameNo: number): string {
  if (!has(obj, key)) return '';
  const v = obj[key];
  if (typeof v !== 'string') throw new WireError(`第 ${frameNo} 帧 ${key} 必须为字符串`);
  return v;
}

/** 解码单个点帧（缺省 dx/dy/heading… 取 Kotlin 默认值）；frameNo 为 1 起的帧序号，仅用于报错。 */
export function decodeNodeFrame(obj: Record<string, unknown>, frameNo: number): ControlNode {
  const x = reqNum(obj, 'x', frameNo);
  const y = reqNum(obj, 'y', frameNo);
  let commandParams: string[] = [];
  if (has(obj, 'commandParams')) {
    const cp = obj['commandParams'];
    if (!Array.isArray(cp) || cp.some((s) => typeof s !== 'string')) {
      throw new WireError(`第 ${frameNo} 帧 commandParams 必须为字符串数组`);
    }
    commandParams = [...(cp as string[])];
  }
  const node: ControlNode = {
    x,
    dx: optNum(obj, 'dx', frameNo, 0),
    y,
    dy: optNum(obj, 'dy', frameNo, 0),
    heading: optNum(obj, 'heading', frameNo, 0),
    dHeading: optNum(obj, 'dHeading', frameNo, 0),
    duration: optNum(obj, 'duration', frameNo, 1),
    marker: optStr(obj, 'marker', frameNo),
    command: optStr(obj, 'command', frameNo),
    commandParams,
    delayAfterArrive: optNum(obj, 'delayAfterArrive', frameNo, 0),
    maxPower: optNum(obj, 'maxPower', frameNo, 1),
    brakeZoneIn: optNum(obj, 'brakeZoneIn', frameNo, 0),
  };
  const maxSpeed = optNullableNum(obj, 'maxSpeed', frameNo);
  const endSpeed = optNullableNum(obj, 'endSpeed', frameNo);
  const brakeForwardPower = optNullableNum(obj, 'brakeForwardPower', frameNo);
  if (maxSpeed !== undefined) node.maxSpeed = maxSpeed;
  if (endSpeed !== undefined) node.endSpeed = endSpeed;
  if (brakeForwardPower !== undefined) node.brakeForwardPower = brakeForwardPower;
  return node;
}

export function decodeRobotRoute(frames: unknown): ControlNode[] {
  if (!Array.isArray(frames)) throw new WireError('机器人路径必须是 JSON 数组');
  const nodes: ControlNode[] = [];
  frames.forEach((frame: unknown, index: number) => {
    const frameNo = index + 1;
    if (!isObj(frame)) throw new WireError(`第 ${frameNo} 帧不是对象`);
    if (has(frame, 'wait')) {
      const seconds = primitiveDouble(frame['wait']);
      if (seconds === null || !Number.isFinite(seconds) || seconds < 0) {
        throw new WireError(`第 ${frameNo} 帧 wait 无效`);
      }
      if (nodes.length === 0) throw new WireError('起始点之前的 wait 无法在控制点模型中表示');
      const m = primitiveContent(frame['marker']);
      const c = primitiveContent(frame['command']);
      if (!((m === null || m === '') && (c === null || c === ''))) {
        throw new WireError('带事件的独立 wait 无法无损导入控制点模型');
      }
      const last = nodes.length - 1;
      const prev = nodes[last] as ControlNode;
      nodes[last] = { ...prev, delayAfterArrive: prev.delayAfterArrive + seconds };
    } else {
      nodes.push(decodeNodeFrame(frame, frameNo));
    }
  });
  return nodes;
}

/** 规范化文本：encode(decode(encode(nodes))) 的 JSON，键序固定。仅用于指纹，比较请用解析后的结构。 */
export function canonicalRoute(nodes: readonly ControlNode[]): string {
  return JSON.stringify(encodeRobotRoute(decodeRobotRoute(encodeRobotRoute(nodes))));
}

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;

/** FNV-1a 64 位（UTF-8 字节），十六进制小写、不补零——与 Kotlin RouteSyncEngine.stableFingerprint 完全一致。 */
export function fingerprint(canonical: string): string {
  let hash = FNV_OFFSET;
  for (const byte of new TextEncoder().encode(canonical)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * FNV_PRIME);
  }
  return hash.toString(16);
}
