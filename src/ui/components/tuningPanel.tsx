import { useEffect, useState } from 'preact/hooks';
import { connData, connState, getConnection } from '../../state/session';
import type { TuningField, TuningSnapshot, TuningValue } from '../../net/models';
import { describeApiError } from '../../net/transport';
import { toast } from './dialogs';

/**
 * Dynamically rendered firmware fields: nothing here is persisted by AzConductor.
 * The server is authoritative and directly updates annotated Java static fields.
 */
export function TuningPanel() {
  const connected = connState.value.kind === 'connected';
  const revisionEvent = connData.value?.tuningRevision ?? 0;
  const [snapshot, setSnapshot] = useState<TuningSnapshot | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!connected) { setSnapshot(null); setDraft({}); return; }
    const c = getConnection();
    if (!c) return;
    let cancelled = false;
    void c.api.tuning().then((r) => {
      if (cancelled) return;
      if (r.ok) {
        setSnapshot(r.value);
        setDraft({});
        setMessage('');
      } else {
        setSnapshot(null);
        setMessage(r.error.kind === 'http' && r.error.status === 404
          ? '当前机器人固件不支持自动参数调节'
          : describeApiError(r.error));
      }
    });
    return () => { cancelled = true; };
  }, [connected, revisionEvent]);

  const parse = (field: TuningField, raw: string): TuningValue | null => {
    if (field.type === 'boolean') return raw === 'true';
    if (field.type === 'String' || field.type === 'enum') return raw;
    if (!raw.trim()) return null;
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    if ((field.type === 'int' || field.type === 'long') && !Number.isSafeInteger(n)) return null;
    return n;
  };

  const apply = async (reset: boolean) => {
    const c = getConnection();
    if (!c || !snapshot || busy) return;
    const values: Record<string, TuningValue> = {};
    if (!reset) {
      for (const field of snapshot.fields) {
        if (!(field.name in draft)) continue;
        const parsed = parse(field, draft[field.name] ?? '');
        if (parsed === null) {
          toast(`参数 ${field.name} 不是有效的 ${field.type} 值`, 'error');
          return;
        }
        values[field.name] = parsed;
      }
      if (Object.keys(values).length === 0) return;
    }
    setBusy(true);
    const r = reset
      ? await c.api.resetTuning(snapshot.revision)
      : await c.api.patchTuning(values, snapshot.revision);
    if (r.ok) {
      setSnapshot(r.value);
      setDraft({});
      toast(reset ? '已恢复固件默认参数' : '参数已写入机器人运行内存', 'info');
    } else {
      toast(describeApiError(r.error), 'error');
      // Refresh after conflicts or partial network failures; never blindly retry writes.
      const latest = await c.api.tuning();
      if (latest.ok) { setSnapshot(latest.value); setDraft({}); }
    }
    setBusy(false);
  };

  const groups = new Map<string, TuningField[]>();
  for (const field of snapshot?.fields ?? []) {
    const group = groups.get(field.group) ?? [];
    group.push(field);
    groups.set(field.group, group);
  }

  return (
    <section class="tuning-panel">
      <button type="button" class="tuning-toggle" aria-expanded={open}
        onClick={() => setOpen((v) => !v)}>自动驾驶参数 {open ? '▴' : '▾'}</button>
      {open && <div class="tuning-content">
        <p class="muted">点击“应用修改”后写入机器人运行内存，无需停止自动模式；不保存到路径文件或固件配置。重启机器人程序后恢复 Java 默认值。部分轨迹构造参数在下一路段生效。</p>
        {!connected && <div class="muted">连接机器人后可编辑参数</div>}
        {connected && message && <div class="banner">{message}</div>}
        {snapshot && [...groups].map(([group, fields]) => (
          <fieldset class="tuning-group" key={group} disabled={busy}>
            <legend>{group}</legend>
            {fields.map((field) => {
              const value = draft[field.name] ?? String(field.value);
              const changed = field.name in draft;
              return (
                <label class="tuning-field" key={field.name}>
                  <span class="tuning-field-name">{field.name}</span>
                  {field.type === 'boolean'
                    ? <input type="checkbox" checked={value === 'true'}
                        onChange={(e) => setDraft((d) => ({ ...d, [field.name]: String((e.currentTarget as HTMLInputElement).checked) }))}/>
                    : field.type === 'enum'
                      ? <select value={value} onChange={(e) => setDraft((d) => ({ ...d, [field.name]: (e.currentTarget as HTMLSelectElement).value }))}>
                          {(field.options ?? []).map((v) => <option value={v} key={v}>{v}</option>)}
                        </select>
                      : field.type === 'String'
                        ? <input type="text" list={undefined} value={value}
                            onInput={(e) => setDraft((d) => ({ ...d, [field.name]: e.currentTarget.value }))}/>
                        : <input type="number"
                            step={field.type === 'int' || field.type === 'long' ? '1' : 'any'}
                            value={value}
                            onInput={(e) => setDraft((d) => ({ ...d, [field.name]: e.currentTarget.value }))}/>}
                  <small class="muted">源码：{String(field.defaultValue)}{changed ? ' · 已编辑' : ''}</small>
                </label>
              );
            })}
          </fieldset>
        ))}
        {snapshot && <div class="tuning-actions">
          <button type="button" disabled={busy || Object.keys(draft).length === 0}
            onClick={() => void apply(false)}>应用修改</button>
          <button type="button" disabled={busy} onClick={() => void apply(true)}>恢复源码默认值</button>
        </div>}
      </div>}
    </section>
  );
}
