/**
 * 节点编辑表单的字段表。`satisfies Record<keyof ControlNode, …>`：给 ControlNode 加字段而不在此登记，编译不通过。
 */
import type { ControlNode } from '../core/node';

export type FieldKind = 'text' | 'number' | 'optNumber' | 'command' | 'params';
export interface FieldSpec {
  kind: FieldKind;
  /** 是否放进"高级"折叠区 */
  advanced?: boolean;
  step?: string;
}

export const NODE_FIELDS = {
  marker: { kind: 'text' },
  command: { kind: 'command' },
  commandParams: { kind: 'params' },
  heading: { kind: 'number', step: '1' },
  dHeading: { kind: 'number', step: '1' },
  duration: { kind: 'number', step: '0.1' },
  delayAfterArrive: { kind: 'number', step: '0.1' },
  x: { kind: 'number', step: '0.5' },
  dx: { kind: 'number', step: '1' },
  y: { kind: 'number', step: '0.5' },
  dy: { kind: 'number', step: '1' },
  maxPower: { kind: 'number', step: '0.05', advanced: true },
  maxSpeed: { kind: 'optNumber', step: '1', advanced: true },
  endSpeed: { kind: 'optNumber', step: '1', advanced: true },
  brakeZoneIn: { kind: 'number', step: '1', advanced: true },
  brakeForwardPower: { kind: 'optNumber', step: '0.05', advanced: true },
} as const satisfies Record<keyof ControlNode, FieldSpec>;

export type NodeFieldKey = keyof typeof NODE_FIELDS;

/** 与 Kotlin NODE_EDITOR_FIELD_ORDER + 高级字段一致的显示顺序。 */
export const NODE_FIELD_ORDER: readonly NodeFieldKey[] = [
  'marker', 'command', 'commandParams', 'heading', 'dHeading', 'duration', 'delayAfterArrive', 'x', 'dx', 'y', 'dy',
  'maxPower', 'maxSpeed', 'endSpeed', 'brakeZoneIn', 'brakeForwardPower',
];

/** 停车点预设：endSpeed = 0；制动区 ≤ 0 时置 12。 */
export const PARKING_BRAKE_ZONE = 12;
