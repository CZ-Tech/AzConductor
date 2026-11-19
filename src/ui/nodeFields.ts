/**
 * 节点编辑表单的字段表。`satisfies Record<keyof ControlNode, …>`：给 ControlNode 加字段而不在此登记，编译不通过。
 */
import { isNonNegativeFiniteNumber, targetEndSpeed, type ControlNode, type TangentSpeedSettings } from '../core/node';
import { OrientedTrajectory2D } from '../core/spline';

export type FieldKind = 'text' | 'number' | 'optNumber' | 'commands' | 'flag';
/** 表单分组；`advanced` 放进折叠区。 */
export type FieldSection = 'pose' | 'motion' | 'command' | 'advanced';
export interface FieldSpec {
  kind: FieldKind;
  section: FieldSection;
  step?: string;
}

export const NODE_FIELDS = {
  marker: { kind: 'text', section: 'command' },
  commands: { kind: 'commands', section: 'command' },
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
  endSpeed: { kind: 'optNumber', section: 'advanced' }, // 机器人线格式，不显示输入框
  stopAtNode: { kind: 'flag', section: 'motion' }, // 由停车 / 通过按钮操作
  brakeZoneIn: { kind: 'optNumber', section: 'advanced', step: '1' },
  brakeForwardPower: { kind: 'optNumber', section: 'advanced', step: '0.05' },
} as const satisfies Record<keyof ControlNode, FieldSpec>;

export type NodeFieldKey = keyof typeof NODE_FIELDS;

/** 表单显示顺序（各字段按 section 分组呈现）。 */
export type VisibleNodeFieldKey = Exclude<NodeFieldKey, 'endSpeed' | 'stopAtNode'>;
export const NODE_FIELD_ORDER: readonly VisibleNodeFieldKey[] = [
  'x', 'y', 'dx', 'dy', 'heading', 'dHeading', 'duration', 'delayAfterArrive', 'marker', 'commands',
  'maxPower', 'maxSpeed', 'brakeZoneIn', 'brakeForwardPower',
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
export type StartSpeedSource = 'initial' | 'tangent' | 'delay' | 'heading-only';
export interface StartSpeedEstimate {
  speed: number;
  source: StartSpeedSource;
}

/** 目标段的起速由上一段的到点速度决定；短段阈值沿用机器人默认值（in）。 */
export function estimateStartSpeed(
  previousNodes: readonly ControlNode[], speedSettings: TangentSpeedSettings,
): StartSpeedEstimate | undefined {
  const last = previousNodes.at(-1);
  if (!last || !isNonNegativeFiniteNumber(speedSettings.tangentSpeedRatio) ||
      !isNonNegativeFiniteNumber(speedSettings.maxEstimatedSpeed) || !Number.isFinite(last.delayAfterArrive) || last.delayAfterArrive < 0) return undefined;
  const before = previousNodes.at(-2);
  if (![last.x, last.y, last.dx, last.dy].every(Number.isFinite) ||
      (before && ![before.x, before.y, before.dx, before.dy].every(Number.isFinite))) return undefined;
  if (last.delayAfterArrive > 0) return { speed: 0, source: 'delay' };
  if (!before) return { speed: 0, source: 'initial' };
  const length = new OrientedTrajectory2D(before, last, 1).length;
  if (!Number.isFinite(length)) return undefined;
  if (length < 0.05) return { speed: 0, source: 'heading-only' };
  if (last.maxSpeed !== undefined && (!Number.isFinite(last.maxSpeed) || last.maxSpeed <= 0)) return undefined;
  const speed = targetEndSpeed(last, speedSettings);
  return Number.isFinite(speed) ? { speed, source: 'tangent' } : undefined;
}

/** 停车预设只保留正的手动制动距离。 */
export function parkingBrakeZone(value: string): string {
  const n = Number(value);
  return value.trim() && Number.isFinite(n) && n > 0 ? value : '';
}
