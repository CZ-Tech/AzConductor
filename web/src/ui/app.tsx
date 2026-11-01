import { route, hrefFor } from './router';
import { RoutesView } from './views/routes';
import { EditorView } from './views/editor';
import { RunView } from './views/run';
import { pwaStatus } from './pwa';
import { S } from './strings';

function Toasts() {
  const st = pwaStatus.value;
  if (st === 'idle') return null;
  const dismiss = () => { pwaStatus.value = 'idle'; };
  return (
    <div class="toast-host" role="status">
      <div class="toast">
        <span>{st === 'needRefresh' ? S.update.ready : S.update.offlineReady}</span>
        {st === 'needRefresh' && (
          <button onClick={() => (globalThis as { __azUpdateSW?: (r?: boolean) => void }).__azUpdateSW?.(true)}>{S.update.reload}</button>
        )}
        <button onClick={dismiss}>{st === 'needRefresh' ? S.update.later : S.common.close}</button>
      </div>
    </div>
  );
}

export function App() {
  const r = route.value;
  const current = r.name === 'run' ? 'run' : 'routes';
  return (
    <div class="shell">
      <header class="topbar">
        <span class="brand">{S.appName}</span>
        <nav aria-label="主导航">
          <a href={hrefFor({ name: 'routes' })} aria-current={current === 'routes' ? 'page' : undefined}>{S.nav.routes}</a>
          <a href={hrefFor({ name: 'run' })} aria-current={current === 'run' ? 'page' : undefined}>{S.nav.run}</a>
        </nav>
        <span class="spacer" />
        <span class="conn" data-state="idle"><i />{S.connection.idle}</span>
      </header>
      <main class="view">
        {r.name === 'routes' && <RoutesView />}
        {r.name === 'edit' && <EditorView name={r.route} />}
        {r.name === 'run' && <RunView />}
      </main>
      <Toasts />
    </div>
  );
}