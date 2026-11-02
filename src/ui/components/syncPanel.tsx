import { syncController } from '../../state/sync';
import { connState, isOwnerTab } from '../../state/session';
import { settings } from '../../state/settings';
import { askConfirm, showDialog, toast } from './dialogs';
import { RouteCore } from '../../core/route';
import { S } from '../strings';
import type { Resolution, SyncConflict } from '../../net/sync';
import type { ControlNode } from '../../core/node';

const REASON: Record<SyncConflict['reason'], string> = {
  FIRST_SYNC_DIFFERENT: '首次同步：电脑端和机器上都有同名路径，且内容不同',
  BOTH_CHANGED: '电脑端和机器上都修改过这条路径',
  LOCAL_DELETED_REMOTE_CHANGED: '电脑端已删除这条路径，但机器上的版本之后又被修改过',
};

function summary(nodes: ControlNode[] | null): string {
  if (!nodes) return '（无）';
  const t = nodes.length > 1 ? new RouteCore(nodes).totalTime : 0;
  return `${nodes.length} 个点 · ${t.toFixed(2)}s`;
}

export function SyncPanel() {
  const ctl = syncController();
  const st = connState.value;
  const status = ctl.status.value;
  const conflicts = ctl.conflicts.value;
  const rep = ctl.lastResult.value;
  const addr = settings.value.robotAddress.trim();

  if (!addr) return <div class="sync-panel" data-status="off"><span class="dot" />{S.connection.noAddress}（在顶栏设置）</div>;
  if (st.kind !== 'connected') {
    return (
      <div class="sync-panel" data-status="off">
        <span class="dot" />
        <span>未连接机器人，路径仅保存在本地；连接后自动同步。</span>
      </div>
    );
  }
  const label = status === 'syncing' ? S.routes.syncing : status === 'conflict' ? S.routes.conflict(conflicts.length)
    : status === 'error' ? S.routes.syncError : S.routes.synced;
  return (
    <div class="sync-panel" data-status={status}>
      <span class="dot" />
      <span>{label}{rep && rep.pushed.length + rep.pulled.length > 0 ? `（↑${rep.pushed.length} ↓${rep.pulled.length}）` : ''}</span>
      {status === 'error' && rep?.failures[0] && <span class="muted" title={rep.failures.join('\n')}>{rep.failures[0]}</span>}
      <span class="spacer" />
      {conflicts.length > 0 && <button class="primary" onClick={() => void openConflicts()}>{S.routes.resolve}</button>}
      <button onClick={() => void ctl.syncNow()} disabled={status === 'syncing' || !isOwnerTab.value}>{S.routes.syncNow}</button>
    </div>
  );
}

async function openConflicts(): Promise<void> {
  await showDialog<null>(S.routes.resolve, (close) => <ConflictList onClose={() => close(null)} />);
}

function ConflictList({ onClose }: { onClose: () => void }) {
  const ctl = syncController();
  const list = ctl.conflicts.value;
  const act = async (c: SyncConflict, r: Resolution) => {
    if (r === 'keepLocal' && c.reason === 'LOCAL_DELETED_REMOTE_CHANGED') {
      const ok = await askConfirm({ title: '删除机器上的路径', message: `确定删除机器上的「${c.routeName}」吗？`, danger: true, okText: S.common.delete });
      if (!ok) return;
    }
    const res = await ctl.resolve(c.id, r);
    if (!res.ok) toast(res.message, 'error');
    else if (ctl.conflicts.value.length === 0) onClose();
  };
  return (
    <div>
      <div class="dlg-body">
        {list.length === 0 && <p class="muted">没有冲突</p>}
        {list.map((c) => (
          <section key={c.id} class="conflict">
            <h3>{c.routeName}</h3>
            <p class="muted">{REASON[c.reason]}</p>
            <p class="mono">电脑端：{summary(c.local)}<br />机器上：{summary(c.remote)}</p>
            <div class="chips">
              <button onClick={() => void act(c, 'keepLocal')}>{c.reason === 'LOCAL_DELETED_REMOTE_CHANGED' ? '确认删除（机器上也删）' : '以电脑端为准（覆盖机器）'}</button>
              <button onClick={() => void act(c, 'keepRemote')}>{c.reason === 'LOCAL_DELETED_REMOTE_CHANGED' ? '恢复机器上的版本' : '以机器为准（覆盖电脑端）'}</button>
              {c.reason !== 'LOCAL_DELETED_REMOTE_CHANGED' && <button onClick={() => void act(c, 'keepBoth')}>两者都保留</button>}
            </div>
          </section>
        ))}
      </div>
      <div class="dlg-foot"><button class="primary" onClick={onClose}>{S.common.close}</button></div>
    </div>
  );
}
