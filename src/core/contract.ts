/**
 * 路径契约校验。逐条移植自 Kotlin SplineRouteContract.validate / validateRobotJson，
 * 校验文案与 Kotlin 逐字一致。
 */
import type { ControlNode } from './node';

export interface Issue {
  field?: keyof ControlNode;
  index?: number;
  message: string;
}

function mk(index: number | undefined, field: keyof ControlNode | undefined, message: string): Issue {
  const issue: Issue = { message };
  if (index !== undefined) issue.index = index;
  if (field !== undefined) issue.field = field;
  return issue;
}

const fin = (v: number): boolean => Number.isFinite(v);
const inUnit = (v: number): boolean => v >= 0 && v <= 1;

/** 对应 SplineRouteContract.validate(points)。 */
export function validateNodes(nodes: readonly ControlNode[]): Issue[] {
  const issues: Issue[] = [];
  if (nodes.length === 0) {
    issues.push(mk(undefined, undefined, '路径至少需要一个起始控制点'));
    return issues;
  }
  nodes.forEach((p, i) => {
    const numeric: ReadonlyArray<readonly [keyof ControlNode, number]> = [
      ['x', p.x], ['y', p.y], ['dx', p.dx], ['dy', p.dy],
      ['heading', p.heading], ['dHeading', p.dHeading],
    ];
    for (const [name, value] of numeric) {
      if (!fin(value)) issues.push(mk(i, name, `${name} 必须为有限数值`));
    }
    if (!fin(p.duration) || p.duration < 0) {
      issues.push(mk(i, 'duration', '预览时长不得为负数或非有限值'));
    }
    if (!fin(p.delayAfterArrive) || p.delayAfterArrive < 0) {
      issues.push(mk(i, 'delayAfterArrive', '到点等待不得为负数或非有限值'));
    }
    if (!fin(p.maxPower) || !inUnit(p.maxPower)) {
      issues.push(mk(i, 'maxPower', '巡航功率必须位于 0 到 1'));
    }
    if (p.maxSpeed != null && (!fin(p.maxSpeed) || p.maxSpeed <= 0)) {
      issues.push(mk(i, 'maxSpeed', '速度上限必须大于 0 in/s，或留空'));
    }
    if (p.endSpeed != null && (!fin(p.endSpeed) || p.endSpeed < 0)) {
      issues.push(mk(i, 'endSpeed', '到点目标速度不得为负数，或留空'));
    }
    if (!fin(p.brakeZoneIn) || p.brakeZoneIn < 0) {
      issues.push(mk(i, 'brakeZoneIn', '制动区距离不得为负数'));
    }
    if (p.brakeForwardPower != null && (!fin(p.brakeForwardPower) || !inUnit(p.brakeForwardPower))) {
      issues.push(mk(i, 'brakeForwardPower', '制动区前进功率必须位于 0 到 1，或留空'));
    }
    if (p.endSpeed != null && p.brakeZoneIn <= 0) {
      issues.push(mk(i, 'brakeZoneIn', '设置 endSpeed 后必须提供大于 0 的制动区距离'));
    }
  });
  return issues;
}

/** 机器人线格式（帧数组）校验问题。field 可能是 "json"/"points"/"wait" 或节点字段名。 */
export interface RobotIssue {
  /** 帧下标（0 起）；整体问题无下标 */
  index?: number;
  field: string;
  message: string;
}

function robotIssue(index: number | undefined, field: string, message: string): RobotIssue {
  const r: RobotIssue = { field, message };
  if (index !== undefined) r.index = index;
  return r;
}

const NUMERIC_STRING = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/** 等价于 Kotlin `(raw as? JsonPrimitive)?.doubleOrNull`：数字或可解析数字的字符串。 */
export function primitiveDouble(raw: unknown): number | null {
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (NUMERIC_STRING.test(t)) return Number(t);
    if (t === 'NaN') return NaN;
    if (t === 'Infinity' || t === '+Infinity') return Infinity;
    if (t === '-Infinity') return -Infinity;
  }
  return null;
}

/** 等价于 Kotlin `(x as? JsonPrimitive)?.contentOrNull`。 */
export function primitiveContent(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
  return null;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const has = (o: Record<string, unknown>, k: string): boolean =>
  Object.prototype.hasOwnProperty.call(o, k);

/** 对应 SplineRouteContract.validateRobotJson（输入已解析为 JS 值）。 */
export function validateRobotIssues(frames: unknown): RobotIssue[] {
  if (!Array.isArray(frames)) {
    return [robotIssue(undefined, 'json', '路径必须是控制点 JSON 数组')];
  }
  if (frames.length === 0) {
    return [robotIssue(undefined, 'points', '不能上传空路径')];
  }
  const issues: RobotIssue[] = [];
  const pointFrames: number[] = [];
  const points: ControlNode[] = [];

  frames.forEach((entry: unknown, index: number) => {
    if (!isObj(entry)) {
      issues.push(robotIssue(index, 'json', '路段必须是 JSON 对象'));
      return;
    }
    const obj = entry;
    const number = (key: string, def: number | null = null, required = false): number | null => {
      if (!has(obj, key)) {
        if (required) issues.push(robotIssue(index, key, `缺少 ${key}`));
        return def;
      }
      const raw = obj[key];
      const value = raw === null ? null : primitiveDouble(raw);
      if (value === null || !Number.isFinite(value)) {
        issues.push(robotIssue(index, key, `${key} 必须为有限数值`));
        return def;
      }
      return value;
    };

    if (has(obj, 'wait')) {
      const wait = number('wait', null, true);
      if (wait !== null && wait < 0) {
        issues.push(robotIssue(index, 'wait', '等待秒数不能为负数'));
      }
      return;
    }
    const x = number('x', null, true);
    const y = number('y', null, true);
    const dx = number('dx', 0);
    const dy = number('dy', 0);
    const heading = number('heading', 0);
    const dHeading = number('dHeading', 0);
    const duration = number('duration', 0);
    const delay = number('delayAfterArrive', 0);
    const maxPower = number('maxPower', 1);
    const maxSpeed = number('maxSpeed');
    const endSpeed = number('endSpeed');
    const brakeZone = number('brakeZoneIn', 0);
    const brakeForward = number('brakeForwardPower');
    if (x === null || y === null) return;
    pointFrames.push(index);
    const node: ControlNode = {
      x, y, dx: dx ?? 0, dy: dy ?? 0,
      heading: heading ?? 0, dHeading: dHeading ?? 0,
      duration: duration ?? 0,
      marker: primitiveContent(obj['marker']) ?? '',
      command: primitiveContent(obj['command']) ?? '',
      commandParams: [],
      delayAfterArrive: delay ?? 0,
      maxPower: maxPower ?? 1,
      brakeZoneIn: brakeZone ?? 0,
    };
    if (maxSpeed !== null) node.maxSpeed = maxSpeed;
    if (endSpeed !== null) node.endSpeed = endSpeed;
    if (brakeForward !== null) node.brakeForwardPower = brakeForward;
    points.push(node);
  });

  if (points.length > 0) {
    for (const issue of validateNodes(points)) {
      const r: RobotIssue = { field: issue.field ?? 'points', message: issue.message };
      if (issue.index !== undefined) {
        const frameIndex = pointFrames[issue.index];
        if (frameIndex !== undefined) r.index = frameIndex;
      }
      issues.push(r);
    }
  }
  return issues;
}

/** 校验机器人帧数组；返回错误文案列表，合法时为空。 */
export function validateRobotFrames(frames: unknown): string[] {
  return validateRobotIssues(frames).map((i) => i.message);
}

/** 校验机器人路径 JSON 文本（解析失败视为非数组）。 */
export function validateRobotJson(text: string): RobotIssue[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  return validateRobotIssues(parsed);
}
