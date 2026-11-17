/** 运行页左侧栏：手动试运行已连接机器人目录里的指令。 */
import { useRef, useState } from 'preact/hooks';
import { argsValid, commandVariants, draftArgs, resolveArgs } from '../../core/commandArgs';
import type { CommandDescriptor } from '../../net/models';
import type { ApiError } from '../../net/transport';
import { describeApiError, isHttpError } from '../../net/transport';
import { commandCatalog } from '../../state/robotData';
import { connData, connState, getConnection } from '../../state/session';
import { IconClose, IconPlay } from './icons';
import { CommandArguments } from './commandArguments';
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

function CommandItem(p: { cmd: CommandDescriptor; hidden: boolean; disabled: boolean; onRun: (args: string[]) => void }) {
  const { cmd } = p;
  const variants = commandVariants(cmd);
  const [variantIndex, setVariantIndex] = useState(0);
  const [args, setArgs] = useState(() => draftArgs(variants[0] ?? cmd));
  const variant = variants[variantIndex];
  const canRun = !p.hidden && !p.disabled && variant !== undefined && argsValid(variant, args);
  const selectVariant = (index: number) => {
    const next = variants[index];
    if (!next) return;
    setVariantIndex(index);
    setArgs(draftArgs(next));
  };
  return (
    <li class="cmd-item" hidden={p.hidden}>
      <form onSubmit={(e) => {
        e.preventDefault();
        if (canRun && variant && argsValid(variant, args)) p.onRun(resolveArgs(variant, args));
      }}>
        <div class="cmd-head">
          <code>{cmd.name}</code>
          <button type="submit" class="cmd-run" disabled={!canRun} aria-label={S.commands.runNamed(cmd.name)}><IconPlay />{S.commands.run}</button>
        </div>
        <CommandArguments idPrefix={`cmd-${cmd.name}`} command={cmd} variantIndex={variantIndex} args={args}
          onVariant={selectVariant} onArgs={setArgs} />
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

  const run = async (cmd: CommandDescriptor, args: string[], catalogRevision: number) => {
    const c = getConnection();
    const liveData = connData.value;
    const liveOpMode = liveData?.opMode;
    const latestCatalog = commandCatalog.value;
    const latestCmd = latestCatalog?.commands.find((item) => item.name === cmd.name);
    // 子项已按所选签名 resolve；这里绝不再按最长签名补全。
    // 目录或连接状态在渲染后变化时，宁可拒绝这次点击，也不发送旧签名。
    if (!c || connState.value.kind !== 'connected' || !liveOpMode || liveOpMode.phase !== 'RUNNING'
      || !liveOpMode.controllerAvailable || liveData?.execution?.state === 'RUNNING' || inFlight.current
      || latestCatalog?.revision !== catalogRevision || !latestCmd || latestCmd !== cmd || !argsValid(latestCmd, args)) return;
    inFlight.current = true;
    setSending(true);
    const r = await c.api.runCommand(cmd.name, args, liveOpMode.revision);
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
        {commands.length > 0 && (
          <ul class="cmd-list">
            {commands.map((cmd) => (
              <CommandItem key={`${catalog?.revision}-${cmd.name}`} cmd={cmd} hidden={q !== '' && !cmd.name.toLowerCase().includes(q)}
                disabled={blocked !== null || sending} onRun={(args) => { if (catalog) void run(cmd, args, catalog.revision); }} />
            ))}
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
