import { docStore } from '../../state/docStore';
import { RouteCore } from '../../core/route';
import { mirrorNodes, FIELD_VIEWBOX } from '../../core/field';
import { exportArchiveJson, exportRouteJson } from '../../core/archive';
import { askConfirm, askText, toast } from '../components/dialogs';
import { importIntoStore, showExportDialog } from '../components/ioDialogs';
import { PathCurve } from '../components/field';
import { SyncPanel } from '../components/syncPanel';
import { navigate } from '../router';
import { S } from '../strings';
import type { RouteData } from '../../core/archive';

function Preview({ route }: { route: RouteData }) {
  return (
    <svg class="preview" viewBox={FIELD_VIEWBOX} aria-hidden="true">
      <rect x={-72} y={-72} width={144} height={144} fill="var(--paper-2)" />
      <line x1={0} y1={-72} x2={0} y2={72} stroke="var(--line)" stroke-width={0.6} />
      <line x1={-72} y1={0} x2={72} y2={0} stroke="var(--line)" stroke-width={0.6} />
      <PathCurve nodes={route.points} color="var(--blue)" width={2} />
      {route.points[0] && <circle cx={route.points[0].y} cy={route.points[0].x} r={3} fill="var(--ok)" />}
    </svg>
  );
}

export function RoutesView() {
  const store = docStore();
  const routes = store.routes.value;

  const create = async () => {
    const n = await askText({ title: S.routes.newRouteTitle, label: S.routes.nameLabel, initial: '新路径' });
    if (n) navigate({ name: 'edit', route: store.createRoute(n) });
  };
  const rename = async (name: string) => {
    const n = await askText({ title: S.routes.renameTitle, label: S.routes.nameLabel, initial: name });
    if (!n) return;
    const r = store.renameRoute(name, n);
    if (!r.ok) toast(r.error, 'error');
  };
  const remove = async (name: string) => {
    const ok = await askConfirm({ title: S.routes.deleteTitle, message: S.routes.deleteMessage(name), danger: true, okText: S.common.delete });
    if (!ok) return;
    store.deleteRoute(name);
  };
  const mirror = async (r: RouteData) => {
    const ok = await askConfirm({ title: S.routes.mirrorTitle, message: S.routes.mirrorMessage(r.name) });
    if (!ok) return;
    const n = await askText({ title: S.routes.mirrorTitle, label: S.routes.nameLabel, initial: `${r.name}${S.routes.mirrorSuffix}` });
    if (n) store.createRoute(n, mirrorNodes(r.points));
  };

  return (
    <div class="routes-view">
      <div class="toolbar">
        <h1>{S.routes.title}</h1>
        <span class="spacer" />
        <button onClick={() => void importIntoStore(store)}>{S.routes.import}</button>
        <button disabled={routes.length === 0} onClick={() => void showExportDialog(S.io.exportTitle, exportArchiveJson(routes), 'azconductor-routes.json')}>{S.routes.exportAll}</button>
        <button class="primary" onClick={() => void create()}>＋ {S.routes.newRoute}</button>
      </div>
      <SyncPanel />
      {store.saveError.value && <div class="banner bad" role="alert">{store.saveError.value}</div>}
      {routes.length === 0 ? (
        <p class="empty">{S.routes.empty}</p>
      ) : (
        <ul class="route-grid">
          {routes.map((r, i) => {
            const total = r.points.length > 1 ? new RouteCore(r.points).totalTime : 0;
            return (
              <li key={r.name} class="route-card">
                <a class="card-main" href={`#/edit/${encodeURIComponent(r.name)}`} title={S.routes.open}>
                  <Preview route={r} />
                  <div class="card-title">{r.name}</div>
                  <div class="card-meta">{S.routes.points(r.points.length)} · {S.routes.duration(total)}</div>
                </a>
                <div class="card-actions" role="group" aria-label={r.name}>
                  <button class="icon" aria-label={S.routes.moveUp} title={S.routes.moveUp} disabled={i === 0} onClick={() => store.moveRoute(i, i - 1)}><svg class="arrow" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" /></svg></button>
                  <button class="icon" aria-label={S.routes.moveDown} title={S.routes.moveDown} disabled={i === routes.length - 1} onClick={() => store.moveRoute(i, i + 1)}><svg class="arrow" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3.5 8.5 8 13l4.5-4.5" /></svg></button>
                  <button onClick={() => void rename(r.name)}>{S.common.rename}</button>
                  <button onClick={() => store.duplicateRoute(r.name)}>{S.common.duplicate}</button>
                  <button onClick={() => void mirror(r)}>{S.routes.mirror}</button>
                  <button onClick={() => void showExportDialog(S.io.exportTitle, exportRouteJson(r.points), `${r.name}.json`)}>{S.routes.export}</button>
                  <button class="danger" onClick={() => void remove(r.name)}>{S.common.delete}</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
