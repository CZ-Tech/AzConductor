/** 运行页左侧栏：手动试运行已连接机器人目录里的指令。 */
import { useRef, useState } from 'preact/hooks';
import { argError, argsValid, draftArgs, paramKind, resolveArgs, type ArgError } from '../../core/commandArgs';
import type { CommandDescriptor } from '../../net/models';
import type { ApiError } from '../../net/transport';
import { describeApiError, isHttpError } from '../../net/transport';
import { commandCatalog } from '../../state/robotData';
import { connData, connState, getConnection } from '../../state/session';
import { IconClose, IconPlay } from './icons';
import { S } from '../strings';

const MAX_LOG = 8;
/** 指令多到这个数量才显示筛选框 */
const FILTER_FROM = 7;

interface LogEntry { id: number; time: string; text: string; ok: boolean; detail: string }

function describeRunError(e: ApiError): string {
  // 请求可能已到达机器人：不能说成失败，否则用户重试会让指令执行两次
  if (e.kind === 'timeout' || e.kind === 'unreachable') return S.commands.unknownResult;
  // 路由层的 not_found 是端点不存在；未知指令是 command_not_found
  if (isHttpError(e, 404) && e.code === 'not_found') return S.commands.unsupported;
  if (e.kind === 'http' && e.code) {
    const known = S.commands.rejected[e.code];
    if (known) return known;
  }
  return describeApiError(e);
}

function ParamField(p: { id: string; name: string; type: string; value: string; fallback: string | null; error: ArgError | null; onInput: (v: string) => void }) {
  const kind = paramKind(p.type);
  const label = <label for={p.id}>{p.name}<span>{p.type}{p.fallback !== null && ` · ${S.commands.optional}`}</span></label>;
  if (kind === 'boolean') {
    return (
      <div class="cmd-param">{label}
        <select id={p.id} value={p.value} onChange={(e) => p.onInput((e.target as HTMLSelectElement).value)}>
          <option value="false">false</option>
          <option value="true">true</option>
        </select>
      </div>
    );
  }
  const msg = p.error ? S.commands.argErrors[p.error] : '';
  return (
    <div class="cmd-param">{label}
      <input id={p.id} type="text" inputMode={kind === 'integer' ? 'numeric' : kind === 'number' ? 'decimal' : 'text'} autocomplete="off"
        value={p.value} placeholder={p.fallback !== null ? S.commands.defaultValue(p.fallback) : undefined}
        aria-invalid={msg ? 'true' : undefined} onInput={(e) => p.onInput((e.target as HTMLInputElement).value)} />
      {msg && <div class="field-error">{msg}</div>}
    </div>
  );
}

function CommandItem(p: { cmd: CommandDescriptor; args: string[]; disabled: boolean; onArgs: (a: string[]) => void; onRun: () => void }) {
  const { cmd, args } = p;
  const canRun = !p.disabled && argsValid(cmd, args);
  return (
    <li class="cmd-item">
      <form onSubmit={(e) => { e.preventDefault(); if (canRun) p.onRun(); }}>
        <div class="cmd-head">
          <code>{cmd.name}</code>
          <button type="submit" class="cmd-run" disabled={!canRun} aria-label={S.commands.runNamed(cmd.name)}><IconPlay />{S.commands.run}</button>
        </div>
        {cmd.paramNames.length > 0 && (
          <div class="cmd-params">
            {cmd.paramNames.map((name, i) => (
              <ParamField key={name} id={`cmd-${cmd.name}-${i}`} name={name} type={cmd.paramTypes[i] ?? 'String'} value={args[i] ?? ''}
                fallback={cmd.paramDefaults[i] ?? null} error={argError(cmd, i, args[i])}
                onInput={(v) => p.onArgs(args.map((a, k) => (k === i ? v : a)))} />
            ))}
          </div>
        )}
      </form>
    </li>
  );
}

export function CommandPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const st = connState.value;
  const data = connData.value;
  const opMode = data?.opMode ?? null;
  const catalog = commandCatalog.value;
  const connected = st.kind === 'connected';

  const [drafts, setDrafts] = useState<Record<string, string[]>>({});
  const [filter, setFilter] = useState('');
  const [log, setLog] = useState<LogEntry[]>([]);
  const [sending, setSending] = useState(false);
  // 状态更新要等下一次渲染，这个 ref 才能挡住连点
  const inFlight = useRef(false);
  const nextLogId = useRef(1);

  const blocked = !connected ? S.commands.notConnected
    : opMode && !opMode.controllerAvailable ? S.commands.controlUnavailable
    : data?.execution?.state === 'RUNNING' ? S.commands.routeRunning
    : !opMode || opMode.phase === 'STOPPED' ? S.commands.needOpMode
    : opMode.phase === 'INIT' ? S.commands.needStart
    : null;

  const run = async (cmd: CommandDescriptor, draft: string[]) => {
    const c = getConnection();
    if (!c || !opMode || inFlight.current) return;
    // 补全后的完整参数表：留空的用默认值，数字去掉首尾空格，长度恒等于参数个数
    const args = resolveArgs(cmd, draft);
    inFlight.current = true;
    setSending(true);
    const r = await c.api.runCommand(cmd.name, args, opMode.revision);
    inFlight.current = false;
    setSending(false);
    const accepted = r.ok && r.value.accepted;
    const entry: LogEntry = {
      id: nextLogId.current++,
      time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
      text: args.length ? `${cmd.name}(${args.join(', ')})` : cmd.name,
      ok: accepted,
      detail: r.ok ? (accepted ? S.commands.accepted : S.commands.notAccepted) : describeRunError(r.error),
    };
    setLog((l) => [entry, ...l].slice(0, MAX_LOG));
  };

  const commands = catalog?.commands ?? [];
  const q = filter.trim().toLowerCase();
  const shown = q ? commands.filter((c) => c.name.toLowerCase().includes(q)) : commands;

  return (
    <aside id="cmd-panel" class="cmd-panel" aria-label={S.commands.title} hidden={!open}>
      <div class="side-head">
        <strong>{S.commands.title}</strong>
        {commands.length > 0 && <span class="chip">{commands.length}</span>}
        <span class="spacer" />
        <button type="button" class="icon ghost" onClick={onClose} aria-label={S.commands.collapse} title={S.commands.collapse}><IconClose /></button>
      </div>
      <div class="cmd-body">
        <div class={`banner${blocked ? '' : ' warn'}`} role="status">{blocked ?? S.commands.safety}</div>
        {commands.length >= FILTER_FROM && (
          <input type="text" class="cmd-filter" aria-label={S.commands.filter} placeholder={S.commands.filter} value={filter}
            onInput={(e) => setFilter((e.target as HTMLInputElement).value)} />
        )}
        {connected && !catalog && <p class="muted cmd-note">{S.commands.loading}</p>}
        {connected && catalog && commands.length === 0 && <p class="muted cmd-note">{S.commands.empty}</p>}
        {commands.length > 0 && shown.length === 0 && <p class="muted cmd-note">{S.commands.noMatch}</p>}
        {shown.length > 0 && (
          <ul class="cmd-list">
            {shown.map((cmd) => {
              const args = draftArgs(cmd, drafts[cmd.name]);
              return (
                <CommandItem key={cmd.name} cmd={cmd} args={args} disabled={blocked !== null || sending}
                  onArgs={(a) => setDrafts((d) => ({ ...d, [cmd.name]: a }))} onRun={() => void run(cmd, args)} />
              );
            })}
          </ul>
        )}
        {log.length > 0 && (
          <section class="cmd-log" aria-label={S.commands.log}>
            <strong>{S.commands.log}</strong>
            <ol aria-live="polite">
              {log.map((e) => (
                <li key={e.id} data-ok={e.ok}>
                  <span class="mono">{e.time}</span>
                  <code>{e.text}</code>
                  <em>{e.detail}</em>
                </li>
              ))}
            </ol>
          </section>
        )}
      </div>
    </aside>
  );
}
