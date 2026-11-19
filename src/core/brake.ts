/**
 * 制动区估算与批量重算（纯函数，不依赖 DOM）。
 * 节点编辑器的静态预估与路径页「按机器配置重算默认刹车区」共用这里的模型。
 */
import { isNonNegativeFiniteNumber, targetEndSpeed, type ControlNode, type TangentSpeedSettings } from './node';
import { OrientedTrajectory2D } from './spline';

/** 机器人调参表里的制动减速度字段（in/s²）。 */
export const BRAKE_DECELERATION_FIELD = 'Auto.SAFE_BRAKE_DECEL';
/** 读不到机器人配置时使用的离线默认值（与固件源码默认一致）。 */
export const DEFAULT_BRAKE_DECELERATION = 30;

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

/** 最短可估算段长（in），与节点编辑器的显示条件一致。 */
export const MIN_ESTIMATE_SEGMENT_IN = 0.05;

/**
 * 手动制动区：显式写入且非 0。
 * 0 在网页里等同「留空自动」（`toDraft` 与 `applyTangentSpeeds` 都按此处理）。
 */
export function isManualBrakeZone(n: Pick<ControlNode, 'brakeZoneIn'>): boolean {
  return n.brakeZoneIn !== undefined && n.brakeZoneIn !== 0;
}

export interface BrakeZoneConfig {
  /** 制动减速度 (in/s²)，通常取自机器人 `Auto.SAFE_BRAKE_DECEL`。 */
  brakeDeceleration: number;
  /** 全局切线速度推算设置。 */
  speed: TangentSpeedSettings;
  /** 是否覆盖手动填写的制动区；缺省只重算留空/0 的自动制动区。 */
  overwriteManual?: boolean;
}

export interface BrakeZoneRecompute {
  /** 重算后的新数组；输入不被修改。 */
  points: ControlNode[];
  /** 自动制动区被写入新值的点数。 */
  updated: number;
  /** 因手动填写而保留、未改动的点数。 */
  kept: number;
  /** 估算失败或不足有效制动距离，保持自动（留空）的点数。 */
  skipped: number;
  /** 本次被清除的旧手动值（估算不出有效距离时）。 */
  cleared: number;
}

/** 估算单个点相对前一段的制动距离，不可估算时返回 undefined。 */
export function estimateBrakeZoneAt(
  points: readonly ControlNode[], index: number, config: BrakeZoneConfig,
): number | undefined {
  const node = points[index];
  const previous = index > 0 ? points[index - 1] : undefined;
  if (!node || !previous) return undefined;
  const length = new OrientedTrajectory2D(previous, node, 1).length;
  if (!Number.isFinite(length) || length < MIN_ESTIMATE_SEGMENT_IN) return undefined;
  const incoming = estimateStartSpeed(points.slice(0, index), config.speed);
  if (!incoming) return undefined;
  // 路径终点按停车处理（与节点编辑器的锁定端点一致）。
  const targetSpeed = index === points.length - 1 ? 0 : targetEndSpeed(node, config.speed);
  return estimateBrakeZone(length, incoming.speed, config.brakeDeceleration, node.maxSpeed, targetSpeed);
}

/** 与节点编辑器显示一致的两位小数。 */
function roundBrakeZone(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * 按机器配置重算一条路径的默认制动区。
 * 首个控制点没有来向路段，永不修改；留空/0 视为自动值，正数视为手动值。
 */
export function recomputeBrakeZones(points: readonly ControlNode[], config: BrakeZoneConfig): BrakeZoneRecompute {
  const overwriteManual = config.overwriteManual ?? false;
  let updated = 0;
  let kept = 0;
  let skipped = 0;
  let cleared = 0;
  const out = points.map((node, index) => {
    if (index === 0) return node;
    const manual = isManualBrakeZone(node);
    if (manual && !overwriteManual) { kept++; return node; }
    const estimate = estimateBrakeZoneAt(points, index, config);
    const next = estimate !== undefined && Number.isFinite(estimate) ? roundBrakeZone(estimate) : 0;
    if (next > 0) {
      if (node.brakeZoneIn === next) return node;
      updated++;
      return { ...node, brakeZoneIn: next };
    }
    skipped++;
    if (node.brakeZoneIn !== undefined) {
      cleared++;
      const copy = { ...node };
      delete copy.brakeZoneIn;
      return copy;
    }
    return node;
  });
  return { points: out, updated, kept, skipped, cleared };
}
