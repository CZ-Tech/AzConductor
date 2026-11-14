/**
 * 节点编辑表单的字段表。`satisfies Record<keyof ControlNode, …>`：给 ControlNode 加字段而不在此登记，编译不通过。
 */
import type { ControlNode } from '../core/node';
import { OrientedTrajectory2D } from '../core/spline';

export type FieldKind = 'text' | 'number' | 'optNumber' | 'command' | 'params';
/** 表单分组；`advanced` 放进折叠区。 */
export type FieldSection = 'pose' | 'motion' | 'command' | 'advanced';
export interface FieldSpec {
  kind: FieldKind;
  section: FieldSection;
  step?: string;
}

export const NODE_FIELDS = {
  marker: { kind: 'text', section: 'command' },
  command: { kind: 'command', section: 'command' },
  commandParams: { kind: 'params', section: 'command' },
  heading: { kind: 'number', section: 'motion', step: '1' },
  dHeading: { kind: 'number', section: 'motion', step: '1' },
  duration: { kind: 'number', section: 'motion', step: '0.1' },
  delayAfterArrive: { kind: 'number', section: 'motion', step: '0.1' },
  x: { kind: 'number', section: 'pose', step: '0.5' },
  dx: { kind: 'number', section: 'pose', step: '1' },
  y: { kind: 'number', section: 'pose', step: '0.5' },
  dy: { kind: 'number', section: 'pose', step: '1' },
  maxPower: { kind: 'number', section: 'advanced', step: '0.05' },
  maxSpeed: { kind: 'optNumber', section: 'advanced', step: '1' },
  endSpeed: { kind: 'optNumber', section: 'advanced', step: '1' },
  brakeZoneIn: { kind: 'optNumber', section: 'advanced', step: '1' },
  brakeForwardPower: { kind: 'optNumber', section: 'advanced', step: '0.05' },
} as const satisfies Record<keyof ControlNode, FieldSpec>;

export type NodeFieldKey = keyof typeof NODE_FIELDS;

/** 表单显示顺序（各字段按 section 分组呈现）。 */
export const NODE_FIELD_ORDER: readonly NodeFieldKey[] = [
  'x', 'y', 'dx', 'dy', 'heading', 'dHeading', 'duration', 'delayAfterArrive', 'marker', 'command', 'commandParams',
  'maxPower', 'maxSpeed', 'endSpeed', 'brakeZoneIn', 'brakeForwardPower',
];

/** 主表单分组的显示顺序。 */
export const NODE_MAIN_SECTIONS = ['pose', 'motion', 'command'] as const satisfies readonly FieldSection[];

/** 静态估算仅供显示，不作为机器人运行时的制动距离。速度及距离须使用一致的单位。 */
export function estimateBrakeZone(
  segmentLength: number, startSpeed: number, brakeDeceleration: number,
  maxSpeed: number | undefined, targetSpeed: number,
): number | undefined {
  if (![segmentLength, startSpeed, brakeDeceleration, targetSpeed].every(Number.isFinite) ||
      segmentLength < 0 || startSpeed < 0 || brakeDeceleration <= 0 || targetSpeed < 0 ||
      (maxSpeed !== undefined && (!Number.isFinite(maxSpeed) || maxSpeed < 0))) return undefined;

  const acceleration = 1.05 * brakeDeceleration;
  const brakeDistance = (speed: number) => Math.max(0, speed * speed - targetSpeed * targetSpeed) / (2 * brakeDeceleration) * 1.05;
  const initialBrakeDistance = brakeDistance(startSpeed);
  if (!Number.isFinite(acceleration) || !Number.isFinite(initialBrakeDistance)) return undefined;
  if (initialBrakeDistance > segmentLength) return initialBrakeDistance;

  const accelerationFactor = 1 / (2 * acceleration);
  const brakingFactor = 1.05 / (2 * brakeDeceleration);
  const peakSpeedSquared = (segmentLength + startSpeed * startSpeed * accelerationFactor +
    targetSpeed * targetSpeed * brakingFactor) / (accelerationFactor + brakingFactor);
  if (!Number.isFinite(peakSpeedSquared)) return undefined;
  const unconstrainedPeak = Math.max(startSpeed, Math.sqrt(peakSpeedSquared));
  const peakSpeed = maxSpeed === undefined ? unconstrainedPeak : Math.min(unconstrainedPeak, Math.max(startSpeed, maxSpeed));
  const result = brakeDistance(peakSpeed);
  return Number.isFinite(result) ? result : undefined;
}

/** 来源表示最后一次决定目标段起速的原因；显式末速度只是约定值，并非物理保证。 */
export type StartSpeedSource = 'initial' | 'explicit' | 'estimated' | 'delay' | 'heading-only';
export interface StartSpeedEstimate {
  speed: number;
  source: StartSpeedSource;
}

/**
 * 根据从首点到目标段前点（含）的完整节点推算目标段起速。
 * 短段阈值对应机器人默认 DEGENERATE_ARC_THRESHOLD（英寸）。
 */
export function estimateStartSpeed(
  previousNodes: readonly ControlNode[], brakeDeceleration: number,
): StartSpeedEstimate | undefined {
  if (!Array.isArray(previousNodes) || previousNodes.length === 0 ||
      !Number.isFinite(brakeDeceleration) || brakeDeceleration <= 0) return undefined;
  const acceleration = 1.05 * brakeDeceleration;
  if (!Number.isFinite(acceleration)) return undefined;
  let result: StartSpeedEstimate = { speed: 0, source: 'initial' };
  for (let i = 0; i < previousNodes.length; i++) {
    const node = previousNodes[i];
    if (!node || ![node.x, node.y, node.dx, node.dy, node.delayAfterArrive].every(Number.isFinite) ||
        node.delayAfterArrive < 0 || (i > 0 &&
        ((node.endSpeed !== undefined && (!Number.isFinite(node.endSpeed) || node.endSpeed < 0)) ||
         (node.maxSpeed !== undefined && (!Number.isFinite(node.maxSpeed) || node.maxSpeed <= 0))))) return undefined;
    if (i > 0) {
      const length = new OrientedTrajectory2D(previousNodes[i - 1], node, 1).length;
      if (!Number.isFinite(length)) return undefined;
      if (length < 0.05) {
        result = { speed: 0, source: 'heading-only' };
      } else if (node.endSpeed !== undefined) {
        result = { speed: node.endSpeed, source: 'explicit' };
      } else {
        const speedSquared = result.speed ** 2 + 2 * acceleration * length;
        if (!Number.isFinite(speedSquared)) return undefined;
        const limit = node.maxSpeed === undefined ? Infinity : Math.max(result.speed, node.maxSpeed);
        result = { speed: Math.min(Math.sqrt(speedSquared), limit), source: 'estimated' };
      }
    }
    if (node.delayAfterArrive > 0) result = { speed: 0, source: 'delay' };
  }
  return result;
}

/** 停车预设只保留正的手动制动距离。 */
export function parkingBrakeZone(value: string): string {
  const n = Number(value);
  return value.trim() && Number.isFinite(n) && n > 0 ? value : '';
}
