/** 同步接线：把 DocStore、机器人连接事件与 SyncController 串起来。 */
import { KvBaselineStore, KvTombstoneStore } from '../net/baselines';
import { SyncController, docStoreLocalRoutes, robotSyncApi } from '../net/sync';
import { kv } from '../storage/kv';
import { docStore } from './docStore';
import { getConnection, onConnectionEvent } from './session';

let ctl: SyncController | null = null;

export function syncController(): SyncController {
  return (ctl ??= new SyncController({
    local: docStoreLocalRoutes(docStore()),
    baselines: new KvBaselineStore(kv),
    tombstones: new KvTombstoneStore(kv),
  }));
}

const LOCAL_CHANGE_DEBOUNCE_MS = 600;
let started = false;

export function startSync(): void {
  if (started) return;
  started = true;
  const c = syncController();
  const store = docStore();

  onConnectionEvent((e) => {
    if (e.type === 'state') {
      if (e.state.kind === 'connected') {
        const conn = getConnection();
        if (!conn) return;
        c.setTarget({ robotKey: conn.baseUrl, api: robotSyncApi(conn.api) });
        c.onConnected();
      } else if (e.previous.kind === 'connected') {
        c.onDisconnected();
      }
    } else if (e.type === 'routes') {
      c.onRoutesEvent(e.data.revision);
    }
  });

  let timer: ReturnType<typeof setTimeout> | null = null;
  store.onLocalChange(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; c.onLocalChange(); }, LOCAL_CHANGE_DEBOUNCE_MS);
  });
  store.onRouteDeleted((name) => c.onLocalDelete(name));
}
