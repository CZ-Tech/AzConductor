import { docStore } from '../../state/docStore';
import { RouteCore } from '../../core/route';
import { mirrorNodes } from '../../core/field';
import { exportArchiveJson, exportRouteJson } from '../../core/archive';
import { askConfirm, askText, toast } from '../components/dialogs';
import { importIntoStore, showExportDialog } from '../components/ioDialogs';
import { RoutePreview } from '../components/field';
import { SyncPanel } from '../components/syncPanel';
import { Menu, MenuItem, MenuSeparator } from '../components/menu';
import {
  IconArrowDown, IconArrowUp, IconCopy, IconExport, IconImport, IconMirror, IconMore, IconPencil, IconPlus, IconTrash,
} from '../components/icons';
import { navigate } from '../router';
import { S } from '../strings';
import type { RouteData } from '../../core/archive';

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
      <div class="page-head">
        <div class="page-title">
          <h1>{S.routes.title}</h1>
          {routes.length > 0 && <span class="muted">{S.routes.count(routes.length)}</span>}
        </div>
        <div class="page-actions">
          <button class="ghost" onClick={() => void importIntoStore(store)}><IconImport />{S.routes.import}</button>
          <button class="ghost" disabled={routes.length === 0} onClick={() => void showExportDialog(S.io.exportTitle, exportArchiveJson(routes), 'azconductor-routes.json')}><IconExport />{S.routes.exportAll}</button>
          <button class="primary" onClick={() => void create()}><IconPlus />{S.routes.newRoute}</button>
        </div>
      </div>
      <SyncPanel />
      {store.saveError.value && <div class="banner bad page-banner" role="alert">{store.saveError.value}</div>}
      {routes.length === 0 ? (
        <div class="empty">
          <h2>{S.routes.emptyTitle}</h2>
          <p>{S.routes.empty}</p>
          <button class="primary" onClick={() => void create()}><IconPlus />{S.routes.newRoute}</button>
        </div>
      ) : (
        <ul class="route-grid">
          {routes.map((r, i) => {
            const total = r.points.length > 1 ? new RouteCore(r.points).totalTime : 0;
            return (
              <li key={r.name} class="route-card">
                <a class="card-main" href={`#/edit/${encodeURIComponent(r.name)}`} title={S.routes.open}>
                  <RoutePreview nodes={r.points} />
                  <div class="card-title">{r.name}</div>
                  <div class="card-meta">{S.routes.points(r.points.length)} · {S.routes.duration(total)}</div>
                </a>
                <div class="card-menu">
                  <Menu label={S.common.more} icon={<IconMore />}>
                    <MenuItem icon={<IconPencil />} onSelect={() => void rename(r.name)}>{S.common.rename}</MenuItem>
                    <MenuItem icon={<IconCopy />} onSelect={() => store.duplicateRoute(r.name)}>{S.common.duplicate}</MenuItem>
                    <MenuItem icon={<IconMirror />} onSelect={() => void mirror(r)}>{S.routes.mirror}</MenuItem>
                    <MenuItem icon={<IconExport />} onSelect={() => void showExportDialog(S.io.exportTitle, exportRouteJson(r.points), `${r.name}.json`)}>{S.routes.export}</MenuItem>
                    <MenuSeparator />
                    <MenuItem icon={<IconArrowUp />} disabled={i === 0} onSelect={() => store.moveRoute(i, i - 1)}>{S.routes.moveUp}</MenuItem>
                    <MenuItem icon={<IconArrowDown />} disabled={i === routes.length - 1} onSelect={() => store.moveRoute(i, i + 1)}>{S.routes.moveDown}</MenuItem>
                    <MenuSeparator />
                    <MenuItem icon={<IconTrash />} danger onSelect={() => void remove(r.name)}>{S.common.delete}</MenuItem>
                  </Menu>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
