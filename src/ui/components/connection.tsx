/** 连接状态胶囊与设置对话框（顶栏、编辑器、同步条、运行页共用）。 */
import { useState } from 'preact/hooks';
import { showDialog } from './dialogs';
import { connState, isOwnerTab, reconnect, disconnect, takeOver, addressError } from '../../state/session';
import { settings, updateSettings } from '../../state/settings';
import { describeApiError } from '../../net/transport';
import { isMixedContentCandidate, normalizeRobotUrl } from '../../net/url';
import { S } from '../strings';

function stateLabel(): string {
  const st = connState.value;
  if (!settings.value.robotAddress.trim()) return S.connection.noAddress;
  if (!isOwnerTab.value) return S.connection.otherTab;
  return S.connection[st.kind];
}

function ConnectionForm({ onClose }: { onClose: () => void }) {
  const [addr, setAddr] = useState(settings.value.robotAddress);
  const st = connState.value;
  const apply = () => { updateSettings({ robotAddress: addr.trim() }); };
  const normalized = normalizeRobotUrl(addr);
  const mixed = normalized && typeof location !== 'undefined' && isMixedContentCandidate(location.protocol, normalized);
  const errDetail = st.kind === 'failed' ? (st.error ? describeApiError(st.error) : st.reason)
    : st.kind === 'rejected' ? `机器人已被 ${st.owner ?? '另一台电脑'} 占用，将自动重试` : null;
  const mixedErr = st.kind === 'failed' && st.error?.kind === 'unreachable' && st.error.mixedContentSuspected;
  return (
    <form onSubmit={(e) => { e.preventDefault(); apply(); void reconnect(); }}>
      <div class="dlg-body settings-form">
        <div>
          <label for="set-addr">{S.settings.robotAddress}</label>
          <input id="set-addr" type="text" value={addr} placeholder="192.168.43.1" onInput={(e) => setAddr((e.target as HTMLInputElement).value)} aria-describedby="set-addr-hint" />
          <div id="set-addr-hint" class="hint">{S.settings.robotAddressHint}</div>
          {addr.trim() && !normalized && <div class="field-error" role="alert">{addressError.value ?? '机器人地址无效'}</div>}
          {normalized && <div class="hint mono">→ {normalized}</div>}
        </div>
        <div>
          <label for="set-map">{S.settings.fieldMap}</label>
          <select id="set-map" value={settings.value.fieldMap} onChange={(e) => updateSettings({ fieldMap: (e.target as HTMLSelectElement).value === '26' ? '26' : '27' })}>
            <option value="26">{S.settings.map26}</option>
            <option value="27">{S.settings.map27}</option>
          </select>
        </div>
        <div class="chips"><span class={`chip${st.kind === 'connected' ? ' on' : ''}`}>{stateLabel()}</span></div>
        {errDetail && <div class="banner bad" role="alert">{errDetail}</div>}
        {(mixed || mixedErr) && <div class="banner warn">{S.connection.mixedContent}</div>}
        {!isOwnerTab.value && <div class="banner warn">{S.connection.otherTab} <button type="button" onClick={() => void takeOver()}>{S.connection.takeOver}</button></div>}
      </div>
      <div class="dlg-foot">
        {st.kind !== 'idle' && <button type="button" onClick={() => void disconnect()}>{S.connection.disconnect}</button>}
        <span class="spacer" />
        <button type="button" onClick={onClose}>{S.common.close}</button>
        <button type="submit" class="primary" disabled={!normalized}>{S.connection.reconnect}</button>
      </div>
    </form>
  );
}

export function openConnectionDialog() {
  void showDialog<null>(S.settings.title, (close) => <ConnectionForm onClose={() => close(null)} />);
}

export function ConnButton() {
  const kind = !isOwnerTab.value ? 'rejected' : connState.value.kind;
  const label = stateLabel();
  return (
    <button class="conn" data-state={kind} onClick={openConnectionDialog} aria-label={`${S.settings.title}：${label}`} title={label}>
      <i /><span class="conn-label">{label}</span>
    </button>
  );
}
