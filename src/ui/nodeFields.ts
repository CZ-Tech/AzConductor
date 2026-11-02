/**
 * 节点编辑表单的字段表。`satisfies Record<keyof ControlNode, …>`：给 ControlNode 加字段而不在此登记，编译不通过。
 */
import type { ControlNode } from '../core/node';

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
  brakeZoneIn: { kind: 'number', section: 'advanced', step: '1' },
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

/** 停车点预设：endSpeed = 0；制动区 ≤ 0 时置 12。 */
export const PARKING_BRAKE_ZONE = 12;
