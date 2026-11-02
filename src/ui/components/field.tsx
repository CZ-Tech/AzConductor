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

/** 只读缩略图：真实场地 + 路径 + 起终点（路径卡片、冲突对比）。 */
export function RoutePreview({ nodes }: { nodes: readonly ControlNode[] }) {
  const first = nodes[0];
  const last = nodes.length > 1 ? nodes[nodes.length - 1] : undefined;
  return (
    <svg class="preview" viewBox={FIELD_VIEWBOX} aria-hidden="true">
      <image href={fieldImage(settings.value.fieldMap)} x={-FIELD_HALF} y={-FIELD_HALF} width={144} height={144} preserveAspectRatio="none" />
      <PathCurve nodes={nodes} color="var(--f-casing)" width={4.4} />
      <PathCurve nodes={nodes} color="var(--f-path)" width={2.4} />
      {first && <circle cx={first.y} cy={first.x} r={4} fill="var(--f-start)" stroke="var(--f-casing)" stroke-width={1.4} />}
      {last && <circle cx={last.y} cy={last.x} r={4} fill="var(--f-end)" stroke="var(--f-casing)" stroke-width={1.4} />}
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
      stroke={p.color ?? 'var(--f-path)'}
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
          fill={p.fill ?? 'var(--f-robot-fill)'} stroke={p.stroke ?? 'var(--f-path)'} stroke-width={0.5} />
      </g>
      <circle
        class={p.onHeadPointerDown ? 'handle head' : undefined}
        cx={c.sx + head.sx} cy={c.sy + head.sy} r={ROBOT_HEAD_DOT * (p.onHeadPointerDown ? 1.4 : 0.5)}
        fill={p.stroke ?? 'var(--f-path)'}
        onPointerDown={p.onHeadPointerDown as never}
        pointer-events={p.onHeadPointerDown ? 'all' : 'none'}
      />
    </g>
  );
}
