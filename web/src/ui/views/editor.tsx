import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { docStore } from '../../state/docStore';
import type { ControlNode } from '../../core/node';
import { RouteCore } from '../../core/route';
import { validateNodes } from '../../core/contract';
import { exportRouteJson, exportRobotWireJson } from '../../core/archive';
import {
  appendedNode, clampToField, headingFromPointer, logicalToScreen, nodeAtLogical,
  velocityFromHandleLogical, velocityHandleScreen,
} from '../../core/field';
import { SPEED_PRESETS, advance, speedLabel } from '../../core/playback';
import { FieldSvg, PathCurve, RobotGlyph, pointerToLogical } from '../components/field';
import { askConfirm, toast } from '../components/dialogs';
import { showNodeEditor } from '../components/nodeEditor';
import { showExportDialog, showImportDialog } from '../components/ioDialogs';
import { commandByName } from '../../state/robotData';
import { settings, updateSettings } from '../../state/settings';
import { navigate } from '../router';
import { S } from '../strings';

type Drag =
  | { kind: 'node' | 'handle' | 'head'; index: number; sx: number; sy: number; moved: boolean; pid: number; press: number | null }
  | { kind: 'bg'; sx: number; sy: number; moved: boolean; pid: number; press: null };

const DRAG_THRESHOLD_PX = 4;
const LONG_PRESS_MS = 500;
const fmt = (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '—');

function hasMissingParams(points: readonly ControlNode[]): boolean {
  return points.some((p) => {
    if (!p.command) return false;
    const d = commandByName(p.command);
    const need = d ? d.paramNames.length : p.commandParams.length;
    return p.commandParams.length < need || p.commandParams.some((v) => v.trim() === '');
  });
}

export function EditorView({ name }: { name: string }) {
  const store = docStore();
  const route = store.routes.value.find((r) => r.name === name);
  const points = route?.points ?? [];

  const [sel, setSel] = useState<number | null>(null);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [ghost, setGhost] = useState(true);
  const [sideOpen, setSideOpen] = useState(true);
  const [sideLeft, setSideLeft] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const live = useRef({ name, points });
  live.current = { name, points };

  const core = useMemo(() => new RouteCore(points), [points]);
  const total = core.totalTime;
  const issues = useMemo(() => validateNodes(points), [points]);
  const ghostPose = ghost ? core.pointAt(t) : null;

  // 选中索引越界修正
  useEffect(() => {
    if (sel !== null && sel >= points.length) setSel(points.length ? points.length - 1 : null);
  }, [points.length, sel]);

  // 播放循环（真实 dt）
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    let cur = t >= total ? 0 : t;
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const s = advance(cur, dt, speed, total);
      cur = s.t;
      setT(cur);
      if (s.finished) { setPlaying(false); return; }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, speed, total]);

  // 离开时落盘
  useEffect(() => () => store.flush(), [store]);

  const setPoints = (next: ControlNode[]) => store.setPoints(live.current.name, next);
  const patchNode = (i: number, patch: Partial<ControlNode>) => {
    const cur = live.current.points;
    const n = cur[i];
    if (!n) return;
    setPoints(cur.map((p, k) => (k === i ? { ...p, ...patch } : p)));
  };

  const addAt = (x: number, y: number) => {
    const next = [...live.current.points, nodeAtLogical(round(x), round(y))];
    setPoints(next);
    setSel(next.length - 1);
  };
  const addAfter = (i: number) => {
    const cur = live.current.points;
    const base = cur[i];
    const n = appendedNode(base);
    const next = [...cur];
    next.splice(i + 1, 0, n);
    setPoints(next);
    setSel(i + 1);
  };
  const removeAt = (i: number) => {
    const cur = live.current.points;
    if (i < 0 || i >= cur.length) return;
    setPoints(cur.filter((_, k) => k !== i));
    setSel(null);
  };
  const editAt = async (i: number) => {
    const n = live.current.points[i];
    if (!n) return;
    const r = await showNodeEditor(n, i, true);
    if (!r) return;
    if (r.kind === 'delete') removeAt(i);
    else patchNode(i, r.node);
  };

  // ---------- 指针交互 ----------
  const clearPress = () => {
    const d = dragRef.current;
    if (d && d.press !== null) { clearTimeout(d.press); d.press = null; }
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const target = (e.target as Element).closest<SVGElement>('[data-kind]');
    const kind = target?.dataset['kind'] as 'node' | 'handle' | 'head' | undefined;
    const svg = svgRef.current;
    if (!svg) return;
    svg.setPointerCapture(e.pointerId);
    const base = { sx: e.clientX, sy: e.clientY, moved: false, pid: e.pointerId };
    if (kind && target) {
      const index = Number(target.dataset['i']);
      if (kind === 'node') setSel(index);
      let press: number | null = null;
      if (kind === 'node') {
        press = window.setTimeout(() => {
          const d = dragRef.current;
          if (d && !d.moved) { dragRef.current = null; void editAt(index); }
        }, LONG_PRESS_MS);
      }
      dragRef.current = { kind, index, ...base, press };
    } else {
      dragRef.current = { kind: 'bg', ...base, press: null };
    }
    e.preventDefault();
  };

  const onPointerMove = (e: PointerEvent) => {
    const d = dragRef.current;
    const svg = svgRef.current;
    if (!d || !svg || d.pid !== e.pointerId) return;
    if (!d.moved) {
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < DRAG_THRESHOLD_PX) return;
      d.moved = true;
      clearPress();
      if (d.kind !== 'bg') store.beginGesture();
    }
    if (d.kind === 'bg') return;
    const L = pointerToLogical(svg, e.clientX, e.clientY);
    if (!L) return;
    const node = live.current.points[d.index];
    if (!node) return;
    if (d.kind === 'node') {
      const c = clampToField(L.x, L.y);
      patchNode(d.index, { x: round(c.x), y: round(c.y) });
    } else if (d.kind === 'handle') {
      const v = velocityFromHandleLogical(node, L.x, L.y);
      patchNode(d.index, { dx: round(v.dx), dy: round(v.dy) });
    } else {
      const c = logicalToScreen(node.x, node.y);
      const p = logicalToScreen(L.x, L.y);
      patchNode(d.index, { heading: round(headingFromPointer(c.sx, c.sy, p.sx, p.sy)) });
    }
  };

  const finishDrag = (e: PointerEvent, cancelled: boolean) => {
    const d = dragRef.current;
    const svg = svgRef.current;
    if (!d || d.pid !== e.pointerId) return;
    clearPress();
    dragRef.current = null;
    try { svg?.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (d.moved) {
      if (d.kind !== 'bg') store.endGesture();
      return;
    }
    if (cancelled) return;
    if (d.kind === 'bg' && svg) {
      const L = pointerToLogical(svg, e.clientX, e.clientY);
      if (L) addAt(L.x, L.y);
    }
  };

  const onContextMenu = (e: MouseEvent) => {
    const target = (e.target as Element).closest<SVGElement>('[data-kind="node"]');
    e.preventDefault();
    if (target) {
      const i = Number(target.dataset['i']);
      dragRef.current = null;
      setSel(i);
      void editAt(i);
    }
  };

  const onDblClick = (e: MouseEvent) => {
    const target = (e.target as Element).closest<SVGElement>('[data-kind="node"]');
    if (target) void editAt(Number(target.dataset['i']));
  };

  // ---------- 键盘 ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      if (document.querySelector('dialog[open]')) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) store.redo(); else store.undo(); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); store.redo(); return; }
      if (e.key === ' ') { e.preventDefault(); setPlaying((p) => !p); return; }
      if (e.key === 'Escape') { setSel(null); return; }
      const i = sel;
      if (i === null) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeAt(i); return; }
      const step = e.shiftKey ? 0.1 : 1;
      const n = live.current.points[i];
      if (!n) return;
      // 屏幕：右 = +y，下 = +x
      const moves: Record<string, [number, number]> = {
        ArrowUp: [-step, 0], ArrowDown: [step, 0], ArrowLeft: [0, -step], ArrowRight: [0, step],
      };
      const m = moves[e.key];
      if (m) {
        e.preventDefault();
        const c = clampToField(n.x + m[0], n.y + m[1]);
        patchNode(i, { x: round(c.x), y: round(c.y) });
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, store]);

  // ---------- 工具栏动作 ----------
  const back = async () => {
    if (hasMissingParams(live.current.points)) {
      const ok = await askConfirm({ title: S.editor.leaveTitle, message: S.editor.leaveMessage, okText: S.editor.leave });
      if (!ok) return;
    }
    store.flush();
    navigate({ name: 'routes' });
  };
  const doImport = async () => {
    const r = await showImportDialog({ single: true, defaultName: name });
    const first = r?.[0];
    if (!first) return;
    if (live.current.points.length > 1) {
      const ok = await askConfirm({ title: S.editor.importReplaceTitle, message: '当前路径的控制点将被替换（可用撤销恢复）。' });
      if (!ok) return;
    }
    setPoints(first.points);
    setSel(null);
    setT(0);
    toast(S.io.imported(1), 'ok');
  };

  if (!route) {
    return (
      <div class="empty">
        <p>{S.editor.notFound(name)}</p>
        <a href="#/">{S.editor.toRoutes}</a>
      </div>
    );
  }

  const selNode = sel !== null ? points[sel] : undefined;
  const headNode = selNode && !playing ? selNode : undefined;
  const mapKey = settings.value.fieldMap;

  return (
    <div class={`editor${sideLeft ? ' side-left' : ''}${sideOpen ? '' : ' side-closed'}`}>
      <div class="toolbar ed-toolbar">
        <button onClick={() => void back()} aria-label={S.common.back}>← {S.common.back}</button>
        <h1 class="ed-title" title={name}>{name}</h1>
        <span class="spacer" />
        <button class="icon" disabled={!store.canUndo.value} onClick={() => store.undo()} title={`${S.common.undo} (Ctrl+Z)`} aria-label={S.common.undo}>↶</button>
        <button class="icon" disabled={!store.canRedo.value} onClick={() => store.redo()} title={`${S.common.redo} (Ctrl+Y)`} aria-label={S.common.redo}>↷</button>
        <button onClick={() => void doImport()}>{S.editor.importJson}</button>
        <button onClick={() => void showExportDialog(S.io.exportTitle, exportRouteJson(points), `${name}.json`)}>{S.editor.exportJson}</button>
        <button onClick={() => void showExportDialog(S.editor.exportRobot, exportRobotWireJson(points, true), `${name}.robot.json`)}>{S.editor.exportRobot}</button>
        <select aria-label={S.settings.fieldMap} value={mapKey} onChange={(e) => updateSettings({ fieldMap: (e.target as HTMLSelectElement).value === '26' ? '26' : '27' })}>
          <option value="26">{S.settings.map26}</option>
          <option value="27">{S.settings.map27}</option>
        </select>
        <button class="icon" onClick={() => setSideLeft(!sideLeft)} title={S.editor.swapSides} aria-label={S.editor.swapSides}>⇄</button>
        <button class="icon" onClick={() => setSideOpen(!sideOpen)} title={sideOpen ? S.editor.collapse : S.editor.expand} aria-label={sideOpen ? S.editor.collapse : S.editor.expand} aria-expanded={sideOpen}>{sideOpen ? '⟩' : '⟨'}</button>
      </div>

      <div class="ed-main">
        <div class="ed-field">
          <FieldSvg
            svgRef={svgRef}
            label={S.editor.hint}
            onPointerDown={onPointerDown as never}
            onPointerMove={onPointerMove as never}
            onPointerUp={((e: PointerEvent) => finishDrag(e, false)) as never}
            onPointerCancel={((e: PointerEvent) => finishDrag(e, true)) as never}
          >
            <g onContextMenu={onContextMenu as never} onDblClick={onDblClick as never}>
              <rect x={-72} y={-72} width={144} height={144} fill="transparent" />
              <PathCurve nodes={points} color="#e5e5e5" width={1.6} />
              <PathCurve nodes={points} color="#6b7280" width={0.8} />
              {headNode && <RobotGlyph x={headNode.x} y={headNode.y} heading={headNode.heading} opacity={0.9} />}
              {ghostPose && <RobotGlyph x={ghostPose.x} y={ghostPose.y} heading={ghostPose.heading} fill="rgba(234,179,8,.25)" stroke="#ca8a04" opacity={0.95} />}
              {headNode && <HeadHandle node={headNode} index={sel as number} />}
              {selNode && sel !== null && <VelocityHandle node={selNode} index={sel} />}
              {points.map((n, i) => <NodeDot key={i} node={n} index={i} total={points.length} selected={i === sel} />)}
            </g>
          </FieldSvg>
          <div class="ed-hint">{S.editor.hint}</div>
        </div>

        <aside class="ed-side" aria-label={S.editor.nodeList} hidden={!sideOpen}>
          <div class="side-head">
            <strong>{S.editor.nodeList}</strong>
            <span class="muted">{S.editor.totalTime(total)}</span>
            <label class="check"><input type="checkbox" checked={ghost} onChange={(e) => setGhost((e.target as HTMLInputElement).checked)} /> {S.editor.ghost}</label>
          </div>
          {issues.length > 0 && (
            <div class="banner warn" role="status">
              {S.editor.invalid}
              <ul>{issues.slice(0, 4).map((i, k) => <li key={k}>{i.index !== undefined ? `${S.editor.node(i.index + 1)}：` : ''}{i.message}</li>)}</ul>
            </div>
          )}
          {points.length === 0 && <p class="muted">{S.editor.noNodes}</p>}
          <ol class="node-list">
            {points.map((n, i) => (
              <li key={i} class={i === sel ? 'sel' : ''}>
                <button class="node-sum" onClick={() => setSel(i)} aria-pressed={i === sel}>
                  <b>{S.editor.node(i + 1)}</b>
                  <span>x={fmt(n.x)} y={fmt(n.y)} h={fmt(n.heading, 1)}° d={fmt(n.duration, 1)}s</span>
                  {(n.command || n.marker) && <em>{n.command || n.marker}</em>}
                </button>
                <div class="node-actions">
                  <button class="icon" onClick={() => void editAt(i)} title={S.editor.edit} aria-label={S.editor.edit}>✎</button>
                  <button class="icon" onClick={() => addAfter(i)} title={S.editor.addAfter} aria-label={S.editor.addAfter}>＋</button>
                  <button class="icon danger" onClick={() => removeAt(i)} title={S.editor.remove} aria-label={S.editor.remove}>✕</button>
                </div>
              </li>
            ))}
          </ol>
          <button class="add-last" onClick={() => { const next = [...points, appendedNode(points[points.length - 1])]; setPoints(next); setSel(next.length - 1); }}>＋ {S.common.add}</button>
        </aside>
      </div>

      <div class="timeline" role="group" aria-label="时间线">
        <button class="primary" onClick={() => { if (!playing && t >= total) setT(0); setPlaying(!playing); }} disabled={total <= 0} aria-label={playing ? S.editor.pause : S.editor.play}>
          {playing ? '⏸' : t >= total && total > 0 ? '↻' : '▶'}
        </button>
        <input class="scrub" type="range" min={0} max={total || 1} step={0.01} value={Math.min(t, total)} disabled={total <= 0}
          aria-label="时间" onInput={(e) => { setPlaying(false); setT(Number((e.target as HTMLInputElement).value)); }} />
        <span class="mono time">{fmt(t)} / {fmt(total)}s</span>
        <select aria-label={S.editor.speed} value={speed} onChange={(e) => setSpeed(Number((e.target as HTMLSelectElement).value))}>
          {SPEED_PRESETS.map((s) => <option key={s} value={s}>{speedLabel(s)}</option>)}
        </select>
      </div>
    </div>
  );
}

const round = (v: number) => Math.round(v * 100) / 100;

function NodeDot(p: { node: ControlNode; index: number; total: number; selected: boolean }) {
  const c = logicalToScreen(p.node.x, p.node.y);
  const first = p.index === 0;
  const last = p.index === p.total - 1 && p.total > 1;
  const fill = p.selected ? 'var(--accent)' : first ? '#16a34a' : last ? '#dc2626' : '#2563eb';
  return (
    <g data-kind="node" data-i={p.index} class="node-dot" transform={`translate(${c.sx} ${c.sy})`} role="button" tabIndex={-1} aria-label={S.editor.node(p.index + 1)}>
      <circle r={5} fill="transparent" />
      <circle r={2.6} fill={fill} stroke="#111" stroke-width={0.5} />
      {(p.node.command || p.node.marker) && <rect x={-1} y={-1} width={2} height={2} fill="#111" transform="rotate(45) translate(0 -4.5)" />}
      <text y={-4} text-anchor="middle" font-size={3.6} fill="#111" stroke="#fff" stroke-width={0.7} paint-order="stroke" pointer-events="none">{p.index + 1}</text>
    </g>
  );
}

function VelocityHandle({ node, index }: { node: ControlNode; index: number }) {
  const c = logicalToScreen(node.x, node.y);
  const h = velocityHandleScreen(node);
  return (
    <g>
      <line x1={c.sx} y1={c.sy} x2={h.sx} y2={h.sy} stroke="#f97316" stroke-width={0.7} pointer-events="none" />
      <circle data-kind="handle" data-i={index} class="handle" cx={h.sx} cy={h.sy} r={2.4} fill="#f97316" stroke="#111" stroke-width={0.4} />
    </g>
  );
}

function HeadHandle({ node, index }: { node: ControlNode; index: number }) {
  const c = logicalToScreen(node.x, node.y);
  // 车头圆点位置（与 RobotGlyph 一致）：距离 9，朝向 90 − heading
  const rad = ((90 - node.heading) * Math.PI) / 180;
  const cx = c.sx + 9 * Math.cos(rad);
  const cy = c.sy + 9 * Math.sin(rad);
  return <circle data-kind="head" data-i={index} class="handle head" cx={cx} cy={cy} r={2.6} fill="#2563eb" stroke="#fff" stroke-width={0.5} />;
}
