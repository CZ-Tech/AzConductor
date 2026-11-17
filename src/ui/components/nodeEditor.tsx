/** 节点属性编辑对话框（由字段表驱动）。 */
import { useEffect, useState } from 'preact/hooks';
import { OrientedTrajectory2D } from '../../core/spline';
import { connData, connState, getConnection } from '../../state/session';
import { cloneCommands, type ControlNode } from '../../core/node';
import { validateNodes } from '../../core/contract';
import { argsValid, resolveArgs } from '../../core/commandArgs';
import { NodeCommands, commandDraft, type CommandDraft } from './nodeCommands';
import { commandCatalog } from '../../state/robotData';
import { NODE_FIELDS, NODE_FIELD_ORDER, NODE_MAIN_SECTIONS, estimateBrakeZone, estimateStartSpeed, parkingBrakeZone, type FieldSection, type FieldSpec, type NodeFieldKey } from '../nodeFields';
import { showDialog } from './dialogs';
import { IconChevron } from './icons';
import { S } from '../strings';

export type NodeEditResult = { kind: 'save'; node: ControlNode } | { kind: 'delete' };

export function showNodeEditor(node: ControlNode, index: number, canDelete: boolean, preceding: readonly ControlNode[] = []): Promise<NodeEditResult | null> {
  return showDialog<NodeEditResult>(`${S.node.title} · ${S.editor.node(index + 1)}`, (close) => (
    <NodeForm node={node} preceding={preceding} canDelete={canDelete} onDone={close} />
  ));
}

export type Draft = Record<Exclude<NodeFieldKey, 'commands'>, string> & { commands: CommandDraft[] };

export function toDraft(n: ControlNode): Draft {
  const s = (v: number | undefined) => (v === undefined ? '' : String(v));
  return {
    marker: n.marker, commands: n.commands.map(commandDraft),
    heading: s(n.heading), dHeading: s(n.dHeading), duration: s(n.duration), delayAfterArrive: s(n.delayAfterArrive),
    x: s(n.x), dx: s(n.dx), y: s(n.y), dy: s(n.dy),
    maxPower: s(n.maxPower), maxSpeed: s(n.maxSpeed), endSpeed: s(n.endSpeed),
    brakeZoneIn: s(n.brakeZoneIn), brakeForwardPower: s(n.brakeForwardPower),
  };
}

/** 草稿 → 节点；格式错误按字段返回。 */
export function fromDraft(d: Draft): { node: ControlNode } | { errors: Partial<Record<NodeFieldKey, string>> } {
  const errors: Partial<Record<NodeFieldKey, string>> = {};
  const num = (k: NodeFieldKey, v: string): number => {
    const x = Number(v.trim());
    if (v.trim() === '' || !Number.isFinite(x)) { errors[k] = S.node.invalidNumber; return 0; }
    return x;
  };
  const opt = (k: NodeFieldKey, v: string): number | undefined => (v.trim() === '' ? undefined : num(k, v));
  if (d.commands.some((c) => !c.name.trim() && c.params.length > 0)) errors.commands = S.node.unnamedCommand;
  const node: ControlNode = {
    x: num('x', d.x), dx: num('dx', d.dx), y: num('y', d.y), dy: num('dy', d.dy),
    heading: num('heading', d.heading), dHeading: num('dHeading', d.dHeading),
    duration: num('duration', d.duration),
    marker: d.marker, commands: cloneCommands(d.commands.filter((c) => c.name.trim()).map((c) => ({ name: c.name.trim(), params: c.params }))),
    delayAfterArrive: num('delayAfterArrive', d.delayAfterArrive),
    maxPower: num('maxPower', d.maxPower),
  };
  const bz = opt('brakeZoneIn', d.brakeZoneIn); if (bz !== undefined) node.brakeZoneIn = bz;
  const ms = opt('maxSpeed', d.maxSpeed); if (ms !== undefined) node.maxSpeed = ms;
  const es = opt('endSpeed', d.endSpeed); if (es !== undefined) node.endSpeed = es;
  const bf = opt('brakeForwardPower', d.brakeForwardPower); if (bf !== undefined) node.brakeForwardPower = bf;
  if (Object.keys(errors).length) return { errors };
  return { node };
}

function NodeForm(p: { node: ControlNode; preceding: readonly ControlNode[]; canDelete: boolean; onDone: (r: NodeEditResult | null) => void }) {
  const [d, setD] = useState<Draft>(() => toDraft(p.node));
  const [decel, setDecel] = useState<{ value: number; live: boolean }>({ value: 30, live: false });
  const connected = connState.value.kind === 'connected';
  const tuningRevision = connData.value?.tuningRevision ?? 0;
  useEffect(() => {
    setDecel({ value: 30, live: false });
    if (!connected) return;
    const connection = getConnection();
    if (!connection) return;
    let cancelled = false;
    void connection.api.tuning().then((r) => {
      if (cancelled || !r.ok) return;
      const value = r.value.fields.find((f) => f.name === 'Auto.SAFE_BRAKE_DECEL')?.value;
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        setDecel({ value, live: true });
      }
    }).catch(() => { /* Offline/unsupported: keep the clearly labelled default. */ });
    return () => { cancelled = true; };
  }, [connected, tuningRevision]);
  const [errors, setErrors] = useState<Partial<Record<NodeFieldKey, string>>>({});
  const [showAdv, setShowAdv] = useState(() => {
    const n = p.node;
    return n.maxPower !== 1 || n.maxSpeed !== undefined || n.endSpeed !== undefined || n.brakeZoneIn !== undefined || n.brakeForwardPower !== undefined;
  });

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => { setD((o) => ({ ...o, [k]: v })); setErrors((e) => { const n = { ...e }; delete n[k]; return n; }); };

  const save = (e: Event) => {
    e.preventDefault();
    const r = fromDraft(d);
    if ('errors' in r) { setErrors(r.errors); return; }
    const issues = validateNodes([r.node]).filter((i) => i.field !== undefined);
    if (issues.length) {
      const m: Partial<Record<NodeFieldKey, string>> = {};
      for (const i of issues) if (i.field && i.field in NODE_FIELDS) m[i.field as NodeFieldKey] ??= i.message;
      if (Object.keys(m).length) { setErrors(m); if (m.maxPower || m.maxSpeed || m.endSpeed || m.brakeZoneIn || m.brakeForwardPower) setShowAdv(true); return; }
    }
    // 合法参数才规范化（新目录省略可选尾参，旧目录补默认值）；无效草稿原样保留。
    for (const command of r.node.commands) {
      const currentDesc = commandCatalog.value?.commands.find((c) => c.name === command.name);
      if (currentDesc && argsValid(currentDesc, command.params)) command.params = resolveArgs(currentDesc, command.params);
    }
    // 参数未填写或不符合当前签名：仍允许保存，离开编辑器时再提示。
    p.onDone({ kind: 'save', node: r.node });
  };

  const parking = () => setD((o) => ({
    ...o, endSpeed: '0', brakeZoneIn: parkingBrakeZone(o.brakeZoneIn),
  }));
  const passing = () => setD((o) => ({ ...o, endSpeed: '', brakeZoneIn: '', brakeForwardPower: '' }));

  const hintOf = (k: NodeFieldKey): string => S.node.fields[k][2];
  const geometry = [d.x, d.y, d.dx, d.dy];
  const numericGeometry = geometry.map((v) => Number(v));
  const previous = p.preceding.at(-1);
  const segmentLength = previous && geometry.every((v) => v.trim() !== '') && numericGeometry.every(Number.isFinite)
    ? new OrientedTrajectory2D(previous, {
        x: numericGeometry[0]!, y: numericGeometry[1]!, dx: numericGeometry[2]!, dy: numericGeometry[3]!,
      }, 1).length : undefined;
  const incoming = estimateStartSpeed(p.preceding, decel.value);
  const maxSpeed = d.maxSpeed.trim() ? Number(d.maxSpeed) : undefined;
  const targetSpeed = d.endSpeed.trim() ? Number(d.endSpeed) : undefined;
  const estimate = segmentLength !== undefined && segmentLength >= 0.05 && targetSpeed !== undefined && incoming
    ? estimateBrakeZone(segmentLength, incoming.speed, decel.value, maxSpeed, targetSpeed) : undefined;
  const brakePlaceholder = !d.endSpeed.trim() ? S.node.brakeNeedsEndSpeed
    : estimate === undefined ? S.node.brakeAuto : S.node.brakeEstimate(estimate.toFixed(2));
  const speedSource = { initial: '首点静止', explicit: '上一点目标值', estimated: '前序路段推算', delay: '等待后静止', 'heading-only': '纯转向后静止' } as const;
  const speedDescription = incoming ? `${incoming.speed.toFixed(2)} in/s（${speedSource[incoming.source]}）` : '无法推算';
  const brakeDetails = `模型预估：减速度 ${decel.value.toFixed(2)} in/s²（${decel.live ? '机器人当前值' : '离线默认值'}），加速度为其 105%；起点速度 ${speedDescription}。实际制动按实时速度计算，预估不保证安全。`;

  const renderField = (k: NodeFieldKey) => {
    const spec: FieldSpec = NODE_FIELDS[k];
    const id = `nf-${k}`;
    const err = errors[k];
    const [zh, code] = S.node.fields[k];
    const label = <label class="nf-label" for={id}><span>{zh}</span>{code && <code>{code}</code>}</label>;
    const errEl = err ? <div class="field-error" role="alert">{err}</div> : null;
    switch (spec.kind) {
      case 'text':
        return (
          <div class="nf" key={k}>{label}
            <input id={id} type="text" value={d.marker} onInput={(e) => set('marker', (e.target as HTMLInputElement).value)} />{errEl}</div>
        );
      case 'commands':
        return <div class="nf wide" key={k}>
          <div class="nf-label"><span>{zh}</span></div>
          <NodeCommands rows={d.commands} onRows={(rows) => set('commands', rows)} />{errEl}
        </div>;
      default:
        return (
          <div class="nf" key={k}>{label}
            <input id={id} type="number" inputMode="decimal" step="any" value={d[k as Exclude<NodeFieldKey, 'commands'>]}
              aria-invalid={err ? 'true' : undefined}
              placeholder={k === 'brakeZoneIn' ? brakePlaceholder : undefined}
              onInput={(e) => set(k as Exclude<NodeFieldKey, 'commands'>, (e.target as HTMLInputElement).value)} />
            {hintOf(k) && !err && <div class="hint">{hintOf(k)}</div>}
            {k === 'brakeZoneIn' && !err && !d.brakeZoneIn.trim() && <div class="hint">{estimate !== undefined ? `${brakePlaceholder}；` : ''}{brakeDetails}</div>}{errEl}</div>
        );
    }
  };

  const fieldsOf = (s: FieldSection) => NODE_FIELD_ORDER.filter((k) => (NODE_FIELDS[k] as FieldSpec).section === s);

  return (
    <form onSubmit={save} noValidate>
      <div class="dlg-body node-form">
        <div class="presets">
          <span class="muted">{S.node.presets}</span>
          <button type="button" onClick={parking} title={S.node.parkingHint}>{S.node.parking}</button>
          <button type="button" onClick={passing} title={S.node.passingHint}>{S.node.passing}</button>
        </div>
        {NODE_MAIN_SECTIONS.map((s) => (
          <fieldset class="nf-section" key={s}>
            <legend>{S.node.sections[s]}</legend>
            <div class="nf-grid" data-section={s}>{fieldsOf(s).map(renderField)}</div>
          </fieldset>
        ))}
        <button type="button" class="nf-toggle" aria-expanded={showAdv} onClick={() => setShowAdv(!showAdv)}><IconChevron />{S.node.sections.advanced}</button>
        {showAdv && <div class="nf-grid" data-section="advanced">{fieldsOf('advanced').map(renderField)}</div>}
      </div>
      <div class="dlg-foot">
        {p.canDelete && <button type="button" class="danger" onClick={() => p.onDone({ kind: 'delete' })}>{S.node.deleteNode}</button>}
        <span class="spacer" />
        <button type="button" onClick={() => p.onDone(null)}>{S.common.cancel}</button>
        <button type="submit" class="primary">{S.common.save}</button>
      </div>
    </form>
  );
}
