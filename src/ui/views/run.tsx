import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ControlNode } from '../../core/node';
import { decodeRobotRoute } from '../../core/wire';
import { RouteCore, pathError, polyline, type Vec2 } from '../../core/route';
import { logicalToScreen } from '../../core/field';
import { connData, connState, getConnection, pose } from '../../state/session';
import { opModes, refreshRobotData } from '../../state/robotData';
import { settings, updateSettings } from '../../state/settings';
import { FieldSvg, PathCurve, RobotGlyph } from '../components/field';
import { toast } from '../components/dialogs';
import { openConnectionDialog } from '../components/connection';
import { CommandPanel } from '../components/commandPanel';
import { IconPlay, IconStop, IconTerminal } from '../components/icons';
import { describeApiError, isHttpError } from '../../net/transport';
import { drawErrorChart, type ErrorSample } from '../chart';
import { S } from '../strings';

const SAMPLE_MS = 100;
const MAX_SAMPLES = 3000;

/** 参考路径：执行主题（execution.subject）优先，否则用手动选择。 */
function useReferenceRoute(name: string, revision: number) {
  const [nodes, setNodes] = useState<ControlNode[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setNodes(null);
    setError(null);
    const c = getConnection();
    if (!name || !c || connState.value.kind !== 'connected') return;
    void (async () => {
      const r = await c.api.getRoute(name);
      if (cancelled) return;
      if (!r.ok) { setError(describeApiError(r.error)); return; }
      try {
        setNodes(decodeRobotRoute(JSON.parse(r.value.json)));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [name, revision, connState.value.kind]);
  return { nodes, error };
}

export function RunView() {
  const st = connState.value;
  const data = connData.value;
  const opMode = data?.opMode ?? null;
  const exec = data?.execution ?? null;
  const connected = st.kind === 'connected';
  const phase = opMode?.phase ?? 'STOPPED';
  const p = pose.value;

  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [manualRoute, setManualRoute] = useState(settings.value.lastRunRoute);
  const [remoteNames, setRemoteNames] = useState<string[]>([]);
  // 宽屏默认展开；窄屏是盖在场地上的抽屉，默认收起（断点同 styles.css）
  const [cmdOpen, setCmdOpen] = useState(() => matchMedia('(min-width: 1101px)').matches);

  // 已 INIT/RUNNING 的 OpMode 自动成为所选项
  useEffect(() => { if (opMode?.activeName) setSelected(opMode.activeName); }, [opMode?.activeName]);
  useEffect(() => { if (connected) void refreshRobotData(); }, [connected]);

  const routeRevision = data?.routeRevision ?? 0;
  useEffect(() => {
    const c = getConnection();
    if (!connected || !c) { setRemoteNames([]); return; }
    let cancelled = false;
    void c.api.listRoutes().then((r) => { if (!cancelled && r.ok) setRemoteNames(r.value.routes.map((x) => x.name)); });
    return () => { cancelled = true; };
  }, [connected, routeRevision]);

  const subject = exec?.subject ?? null;
  const routeName = subject || manualRoute;
  const { nodes, error } = useReferenceRoute(routeName, routeRevision);
  const core = useMemo(() => (nodes ? new RouteCore(nodes) : null), [nodes]);
  const line = useMemo<Vec2[]>(() => (nodes && nodes.length > 0 ? polyline(nodes, Math.max(20, Math.ceil(720 / Math.max(1, nodes.length - 1)))) : []), [nodes]);

  // ---------- 误差采样 ----------
  const samples = useRef<ErrorSample[]>([]);
  const trail = useRef<string[]>([]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const lineRef = useRef(line);
  lineRef.current = line;
  const running = phase === 'RUNNING' || exec?.state === 'RUNNING';
  const startedAt = useRef(0);
  const [peak, setPeak] = useState<number | null>(null);
  useEffect(() => {
    if (!running) return;
    samples.current = [];
    trail.current = [];
    setPeak(null);
    startedAt.current = performance.now();
    const id = setInterval(() => {
      const cur = pose.peek();
      const l = lineRef.current;
      if (!cur) return;
      const s = logicalToScreen(cur.x, cur.y);
      trail.current.push(`${s.sx},${s.sy}`);
      if (trail.current.length > MAX_SAMPLES) trail.current.shift();
      if (l.length === 0) return;
      const e = pathError({ x: cur.x, y: cur.y }, l);
      if (!Number.isFinite(e)) return;
      samples.current.push({ t: (performance.now() - startedAt.current) / 1000, e });
      if (samples.current.length > MAX_SAMPLES) samples.current.shift();
      setPeak((v) => (v === null || e > v ? e : v));
      if (canvas.current) drawErrorChart(canvas.current, samples.current);
    }, SAMPLE_MS);
    return () => clearInterval(id);
  }, [running]);
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const redraw = () => drawErrorChart(c, samples.current);
    redraw();
    const ro = new ResizeObserver(redraw);
    ro.observe(c);
    const scheme = matchMedia('(prefers-color-scheme: dark)'); // Canvas 颜色不随 CSS 变量自动更新
    scheme.addEventListener('change', redraw);
    return () => { ro.disconnect(); scheme.removeEventListener('change', redraw); };
  }, []);

  // ---------- OpMode 控制 ----------
  const autoNames = opModes.value.map((o) => o.name);
  const selectedOk = autoNames.includes(selected);
  const activeOk = !!opMode?.activeName && autoNames.includes(opMode.activeName);
  const ctrl = connected && !!opMode?.controllerAvailable;
  const canInit = ctrl && phase === 'STOPPED' && selectedOk;
  const canStart = ctrl && phase === 'INIT' && activeOk && opMode?.activeName === selected;
  const canStop = ctrl && phase !== 'STOPPED' && activeOk;

  const act = async (kind: 'init' | 'start' | 'stop') => {
    const c = getConnection();
    if (!c || !opMode || busy) return;
    setBusy(true);
    try {
      const name = kind === 'init' ? selected : (opMode.activeName ?? selected);
      const api = c.api;
      const r = kind === 'init' ? await api.initOpMode(name, opMode.revision)
        : kind === 'start' ? await api.startOpMode(name, opMode.revision)
        : await api.stopOpMode(name, opMode.revision);
      if (!r.ok) {
        if (isHttpError(r.error, 409) || isHttpError(r.error, 412) || isHttpError(r.error, 428)) {
          toast(S.run.stateChanged, 'info');
          await api.opModeState();
        } else {
          toast(S.run.actionFailed(describeApiError(r.error)), 'error');
        }
      }
    } finally {
      setBusy(false);
    }
  };

  // ---------- 任务列表 ----------
  const tasks = useMemo(() => {
    if (!nodes || !core) return [];
    return nodes.map((n, i) => ({ n, i, t: i === 0 ? core.initialDelay : core.segmentEndTimes[i - 1] ?? 0 }))
      .filter((x) => x.n.command || x.n.marker);
  }, [nodes, core]);

  const hint = !connected ? null
    : phase === 'STOPPED' ? S.run.needInit
    : !routeName ? S.run.noRoute : null;

  const liveError = p && line.length > 0 ? pathError({ x: p.x, y: p.y }, line) : NaN;
  const num = (v: number | undefined, d: number) => (v !== undefined && Number.isFinite(v) ? v.toFixed(d) : '--');

  return (
    <div class="run">
      <div class="run-main">
        <CommandPanel open={cmdOpen} onClose={() => setCmdOpen(false)} />
        <div class="run-map">
          {!cmdOpen && <button type="button" class="cmd-toggle" aria-expanded="false" aria-controls="cmd-panel" onClick={() => setCmdOpen(true)}><IconTerminal />{S.commands.toggle}</button>}
          <FieldSvg svgRef={useRef<SVGSVGElement>(null)} label={S.run.map}>
            {nodes && <PathCurve nodes={nodes} color="var(--f-casing)" width={2.4} />}{nodes && <PathCurve nodes={nodes} color="var(--f-path)" width={1.1} />}
            {nodes && nodes.map((n, i) => {
              const c = logicalToScreen(n.x, n.y);
              const tagged = !!(n.command || n.marker);
              return (
                <g key={i} transform={`translate(${c.sx} ${c.sy})`} pointer-events="none">
                  <circle r={tagged ? 2.4 : 1.4} fill={tagged ? 'var(--f-command)' : 'var(--f-casing)'} stroke={tagged ? 'var(--f-casing)' : 'var(--f-path)'} stroke-width={0.6} />
                </g>
              );
            })}
            {trail.current.length > 1 && <polyline points={trail.current.join(' ')} fill="none" stroke="var(--f-live)" stroke-width={0.9} stroke-linejoin="round" stroke-linecap="round" pointer-events="none" />}
            {p && <RobotGlyph x={p.x} y={p.y} heading={p.heading} fill="var(--f-live-fill)" stroke="var(--f-live)" />}
          </FieldSvg>
        </div>
        <aside class="run-side" aria-label={S.run.title}>
          <div class="run-status" data-phase={phase} aria-live="polite">
            <i />
            <div class="run-status-text">
              <strong>{S.run.phase[phase] ?? phase}</strong>
              <span>{opMode?.activeName ?? S.run.noActive}</span>
            </div>
            {exec && <span class="chip">{S.run.execution[exec.state] ?? exec.state}</span>}
          </div>
          {!connected && <div class="banner">{st.kind === 'connecting' ? S.run.connecting : S.run.notConnected} <button class="link" onClick={openConnectionDialog}>{S.connection.settings}</button></div>}
          {connected && opMode && !opMode.controllerAvailable && <div class="banner warn">{S.run.controlUnavailable}</div>}
          <div class="run-op">
            <label for="run-op">{S.run.pickAuto}</label>
            <select id="run-op" value={selected} disabled={!ctrl} onChange={(e) => setSelected((e.target as HTMLSelectElement).value)}>
              <option value="">{autoNames.length ? S.run.pickAuto : S.run.noAuto}</option>
              {opModes.value.map((o) => <option key={o.name} value={o.name}>{o.group ? `${o.name}（${o.group}）` : o.name}</option>)}
            </select>
            {hint && <div class="hint">{hint}</div>}
          </div>
          <div class="run-ctl">
            <button class={canInit ? 'primary' : ''} disabled={!canInit || busy} onClick={() => void act('init')}>{S.run.init}</button>
            <button class={canStart ? 'primary' : ''} disabled={!canStart || busy} onClick={() => void act('start')}><IconPlay />{S.run.start}</button>
            <button class="stop" disabled={!canStop || busy} onClick={() => void act('stop')}><IconStop />{S.run.stop}</button>
          </div>
          <dl class="telemetry">
            <div><dt>{S.run.telemetry.x}</dt><dd>{num(p?.x, 2)}</dd></div>
            <div><dt>{S.run.telemetry.y}</dt><dd>{num(p?.y, 2)}</dd></div>
            <div><dt>{S.run.telemetry.heading}</dt><dd>{p ? `${num(p.heading, 1)}°` : '--'}</dd></div>
            <div><dt>{S.run.telemetry.error}</dt><dd>{num(liveError, 2)}</dd></div>
          </dl>
          <div class="run-chart">
            <div class="run-chart-head">
              <strong>{S.run.errorChart}</strong>
              {peak !== null && <span class="muted mono">{S.run.errorPeak(peak)}</span>}
            </div>
            <canvas ref={canvas} aria-label={S.run.errorChart} />
          </div>
          {connected && !subject && (
            <div class="run-route">
              <label for="run-route">{S.run.pickRoute}</label>
              <select id="run-route" value={manualRoute} onChange={(e) => { const v = (e.target as HTMLSelectElement).value; setManualRoute(v); updateSettings({ lastRunRoute: v }); }}>
                <option value="">—</option>
                {remoteNames.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          )}
          {subject && <div class="muted run-route">{S.run.referenceRoute(subject)}</div>}
          {error && <div class="banner bad">{error}</div>}
          <div class="run-tasks">
            <strong>{S.run.tasks}</strong>
            {tasks.length === 0 ? <div class="muted">{S.run.noTasks}</div> : (
              <ul class="task-list">
                {tasks.map((t) => (
                  <li key={t.i}>
                    <b>{S.editor.node(t.i + 1)}</b>
                    <span class="mono">{t.t.toFixed(1)}s</span>
                    <span>{t.n.command ? `${t.n.command}(${t.n.commandParams.join(', ')})` : ''}{t.n.marker ? ` [${t.n.marker}]` : ''}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
