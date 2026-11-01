/** 场地 SVG：viewBox 即逻辑坐标（-72..72），屏幕 sx = 逻辑 y，sy = 逻辑 x。 */
import type { ComponentChildren, Ref } from 'preact';
import type { ControlNode } from '../../core/node';
import { svgPathD, type Vec2 } from '../../core/route';
import {
  FIELD_VIEWBOX, FIELD_HALF, ROBOT_WIDTH, ROBOT_HEIGHT, ROBOT_HEAD_DOT,
  logicalToScreen, robotScreenRotation, screenToLogical, headDotOffsetScreen,
} from '../../core/field';
import { settings } from '../../state/settings';

const BASE = import.meta.env.BASE_URL;
export const fieldImage = (map: string): string => `${BASE}field/FTC_MAP${map}.png`;

/** 把指针事件换算为逻辑坐标。 */
export function pointerToLogical(svg: SVGSVGElement, clientX: number, clientY: number): Vec2 | null {
  const m = svg.getScreenCTM();
  if (!m) return null;
  const pt = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
  return screenToLogical(pt.x, pt.y);
}

type PointerHandler = (e: PointerEvent) => void;
const noop: PointerHandler = () => undefined;

export interface FieldSvgProps {
  svgRef: Ref<SVGSVGElement>;
  children?: ComponentChildren;
  onPointerDown?: PointerHandler;
  onPointerMove?: PointerHandler;
  onPointerUp?: PointerHandler;
  onPointerCancel?: PointerHandler;
  label?: string;
}

export function FieldSvg(p: FieldSvgProps) {
  const map = settings.value.fieldMap;
  return (
    <svg
      ref={p.svgRef}
      class="field-svg"
      viewBox={FIELD_VIEWBOX}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={p.label ?? '场地'}
      onPointerDown={(p.onPointerDown ?? noop) as never}
      onPointerMove={(p.onPointerMove ?? noop) as never}
      onPointerUp={(p.onPointerUp ?? noop) as never}
      onPointerCancel={(p.onPointerCancel ?? noop) as never}
    >
      <image href={fieldImage(map)} x={-FIELD_HALF} y={-FIELD_HALF} width={144} height={144} preserveAspectRatio="none" />
      <rect x={-FIELD_HALF} y={-FIELD_HALF} width={144} height={144} fill="none" stroke="rgba(0,0,0,.35)" stroke-width={0.3} />
      {p.children}
    </svg>
  );
}

/** 路径曲线（精确三次 Bézier）。 */
export function PathCurve(p: { nodes: readonly ControlNode[]; color?: string; width?: number; dashed?: boolean }) {
  const d = svgPathD(p.nodes);
  if (!d) return null;
  return (
    <path
      d={d}
      fill="none"
      stroke={p.color ?? '#9a9a9a'}
      stroke-width={p.width ?? 0.9}
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-dasharray={p.dashed ? '2 2' : undefined}
      pointer-events="none"
    />
  );
}

export interface RobotGlyphProps {
  x: number;
  y: number;
  heading: number;
  fill?: string;
  stroke?: string;
  opacity?: number;
  /** 车头圆点可拖拽（编辑朝向） */
  onHeadPointerDown?: PointerHandler;
}

/** 机器人：18×18 圆角方块 + 车头圆点，朝向 = 90 − heading。 */
export function RobotGlyph(p: RobotGlyphProps) {
  const c = logicalToScreen(p.x, p.y);
  const rot = robotScreenRotation(p.heading);
  const head = headDotOffsetScreen(p.heading);
  return (
    <g opacity={p.opacity ?? 1}>
      <g transform={`translate(${c.sx} ${c.sy}) rotate(${rot})`} pointer-events="none">
        <rect x={-ROBOT_WIDTH / 2} y={-ROBOT_HEIGHT / 2} width={ROBOT_WIDTH} height={ROBOT_HEIGHT} rx={2}
          fill={p.fill ?? 'rgba(37,99,235,.25)'} stroke={p.stroke ?? '#2563eb'} stroke-width={0.5} />
      </g>
      <circle
        class={p.onHeadPointerDown ? 'handle head' : undefined}
        cx={c.sx + head.sx} cy={c.sy + head.sy} r={ROBOT_HEAD_DOT * (p.onHeadPointerDown ? 1.4 : 0.5)}
        fill={p.stroke ?? '#2563eb'}
        onPointerDown={p.onHeadPointerDown as never}
        pointer-events={p.onHeadPointerDown ? 'all' : 'none'}
      />
    </g>
  );
}
