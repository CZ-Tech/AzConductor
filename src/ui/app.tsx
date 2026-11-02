import { route, hrefFor } from './router';
import { RoutesView } from './views/routes';
import { EditorView } from './views/editor';
import { RunView } from './views/run';
import { pwaStatus } from './pwa';
import { DialogHost } from './components/dialogs';
import { ConnButton } from './components/connection';
import { BrandMark } from './components/icons';
import { S } from './strings';

function UpdateToast() {
  const st = pwaStatus.value;
  if (st === 'idle') return null;
  const dismiss = () => { pwaStatus.value = 'idle'; };
  return (
    <div class="toast-host pwa" role="status">
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

function AppBar({ current }: { current: 'routes' | 'run' }) {
  return (
    <header class="topbar">
      <span class="brand"><BrandMark /><span class="brand-name">{S.appName}</span></span>
      <nav aria-label="主导航">
        <a href={hrefFor({ name: 'routes' })} aria-current={current === 'routes' ? 'page' : undefined}>{S.nav.routes}</a>
        <a href={hrefFor({ name: 'run' })} aria-current={current === 'run' ? 'page' : undefined}>{S.nav.run}</a>
      </nav>
      <span class="spacer" />
      <ConnButton />
    </header>
  );
}

export function App() {
  const r = route.value;
  return (
    <div class="shell">
      {/* 编辑器自带合并后的单行顶栏，把高度留给场地 */}
      {r.name !== 'edit' && <AppBar current={r.name === 'run' ? 'run' : 'routes'} />}
      <main class="view">
        {r.name === 'routes' && <RoutesView />}
        {r.name === 'edit' && <EditorView name={r.route} />}
        {r.name === 'run' && <RunView />}
      </main>
      <UpdateToast />
      <DialogHost />
    </div>
  );
}
