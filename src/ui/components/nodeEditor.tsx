/** 节点属性编辑对话框（由字段表驱动）。 */
import { useMemo, useState } from 'preact/hooks';
import type { ControlNode } from '../../core/node';
import { validateNodes } from '../../core/contract';
import { commandCatalog } from '../../state/robotData';
import { NODE_FIELDS, NODE_FIELD_ORDER, NODE_MAIN_SECTIONS, PARKING_BRAKE_ZONE, type FieldSection, type FieldSpec, type NodeFieldKey } from '../nodeFields';
import { showDialog } from './dialogs';
import { IconChevron, IconClose, IconPlus } from './icons';
import { S } from '../strings';

export type NodeEditResult = { kind: 'save'; node: ControlNode } | { kind: 'delete' };

export function showNodeEditor(node: ControlNode, index: number, canDelete: boolean): Promise<NodeEditResult | null> {
  return showDialog<NodeEditResult>(`${S.node.title} · ${S.editor.node(index + 1)}`, (close) => (
    <NodeForm node={node} canDelete={canDelete} onDone={close} />
  ));
}

type Draft = Record<Exclude<NodeFieldKey, 'commandParams'>, string> & { commandParams: string[] };

function toDraft(n: ControlNode): Draft {
  const s = (v: number | undefined) => (v === undefined ? '' : String(v));
  return {
    marker: n.marker, command: n.command, commandParams: [...n.commandParams],
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
    if (v.trim() === '' || !Number.isFinite(x)) { errors[k] = '格式错误：请输入数字'; return 0; }
    return x;
  };
  const opt = (k: NodeFieldKey, v: string): number | undefined => (v.trim() === '' ? undefined : num(k, v));
  const node: ControlNode = {
    x: num('x', d.x), dx: num('dx', d.dx), y: num('y', d.y), dy: num('dy', d.dy),
    heading: num('heading', d.heading), dHeading: num('dHeading', d.dHeading),
    duration: num('duration', d.duration),
    marker: d.marker, command: d.command.trim(), commandParams: d.command.trim() ? [...d.commandParams] : [],
    delayAfterArrive: num('delayAfterArrive', d.delayAfterArrive),
    maxPower: num('maxPower', d.maxPower),
    brakeZoneIn: num('brakeZoneIn', d.brakeZoneIn),
  };
  const ms = opt('maxSpeed', d.maxSpeed); if (ms !== undefined) node.maxSpeed = ms;
  const es = opt('endSpeed', d.endSpeed); if (es !== undefined) node.endSpeed = es;
  const bf = opt('brakeForwardPower', d.brakeForwardPower); if (bf !== undefined) node.brakeForwardPower = bf;
  if (Object.keys(errors).length) return { errors };
  return { node };
}

function NodeForm(p: { node: ControlNode; canDelete: boolean; onDone: (r: NodeEditResult | null) => void }) {
  const [d, setD] = useState<Draft>(() => toDraft(p.node));
  const [errors, setErrors] = useState<Partial<Record<NodeFieldKey, string>>>({});
  const [showAdv, setShowAdv] = useState(() => {
    const n = p.node;
    return n.maxPower !== 1 || n.maxSpeed !== undefined || n.endSpeed !== undefined || n.brakeZoneIn !== 0 || n.brakeForwardPower !== undefined;
  });
  const catalog = commandCatalog.value;
  const desc = useMemo(() => catalog?.commands.find((c) => c.name === d.command), [catalog, d.command]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => { setD((o) => ({ ...o, [k]: v })); setErrors((e) => { const n = { ...e }; delete n[k]; return n; }); };

  const setCommand = (name: string) => {
    const dsc = catalog?.commands.find((c) => c.name === name);
    setD((o) => {
      let params = o.commandParams;
      if (dsc) params = Array.from({ length: dsc.paramNames.length }, (_, i) => o.commandParams[i] ?? '');
      return { ...o, command: name, commandParams: params };
    });
  };

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
    // 参数未填写：与 Kotlin 一致，允许保存（离开编辑器时再提示）
    p.onDone({ kind: 'save', node: r.node });
  };

  const parking = () => setD((o) => ({
    ...o, endSpeed: '0', brakeZoneIn: (Number(o.brakeZoneIn) || 0) <= 0 ? String(PARKING_BRAKE_ZONE) : o.brakeZoneIn,
  }));
  const passing = () => setD((o) => ({ ...o, endSpeed: '', brakeZoneIn: '0', brakeForwardPower: '' }));

  const hintOf = (k: NodeFieldKey): string => S.node.fields[k][2];

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
      case 'command':
        return (
          <div class="nf" key={k}>{label}
            <input id={id} type="text" list="nf-commands" value={d.command} placeholder={S.node.selectCommand}
              onInput={(e) => setCommand((e.target as HTMLInputElement).value)} />
            <datalist id="nf-commands">{catalog?.commands.map((c) => <option key={c.name} value={c.name} />)}</datalist>
            {catalog && d.command && !desc && <div class="hint">{S.node.noMatch}</div>}
            {errEl}</div>
        );
      case 'params':
        return (
          <div class="nf wide" key={k}>
            <label class="nf-label"><span>{zh}</span></label>
            {d.commandParams.map((v, i) => (
              <div class="param-row" key={i}>
                <input type="text" aria-label={S.node.paramN(i + 1)} value={v}
                  placeholder={desc ? `${desc.paramNames[i] ?? S.node.paramN(i + 1)} (${desc.paramTypes[i] ?? ''})` : S.node.paramN(i + 1)}
                  onInput={(e) => { const arr = [...d.commandParams]; arr[i] = (e.target as HTMLInputElement).value; set('commandParams', arr); }} />
                {!desc && <button type="button" class="icon ghost" aria-label={S.node.removeParam} title={S.node.removeParam} onClick={() => set('commandParams', d.commandParams.filter((_, j) => j !== i))}><IconClose /></button>}
              </div>
            ))}
            {!desc && <button type="button" class="ghost" onClick={() => set('commandParams', [...d.commandParams, ''])}><IconPlus />{S.node.addParam}</button>}
          </div>
        );
      default:
        return (
          <div class="nf" key={k}>{label}
            <input id={id} type="number" inputMode="decimal" step="any" value={d[k as Exclude<NodeFieldKey, 'commandParams'>]}
              aria-invalid={err ? 'true' : undefined}
              onInput={(e) => set(k as Exclude<NodeFieldKey, 'commandParams'>, (e.target as HTMLInputElement).value)} />
            {hintOf(k) && !err && <div class="hint">{hintOf(k)}</div>}{errEl}</div>
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
