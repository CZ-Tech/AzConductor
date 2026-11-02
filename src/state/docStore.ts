/**
 * 路径文档仓库：不可变文档 + 快照撤销栈 + 防抖自动保存 + 跨标签页重载。
 *
 * 文档形态沿用 localStorage `robot_routes` = [{robotName, routes:[{name, points}]}]。
 * 当前操作的机器人固定为 "default"（若文档里没有则取第一个）。
 */
import { signal, computed } from '@preact/signals';
import type { ControlNode } from '../core/node';
import {
  DEFAULT_ROBOT_NAME,
  ROUTES_STORAGE_KEY,
  parseRoutesDoc,
  serializeRoutesDoc,
  type RobotRoutes,
  type RouteData,
  type RoutesDoc,
} from '../core/archive';
import { firstNode } from '../core/field';
import { kv as defaultKv, type KV } from '../storage/kv';

export const BACKUP_KEY = 'robot_routes.bak';
export const HISTORY_LIMIT = 200;
export const SAVE_DEBOUNCE_MS = 300;

export type DocListener = (doc: RoutesDoc) => void;

export interface DocStoreOptions {
  kv?: KV;
  debounceMs?: number;
  /** 测试注入 */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
}

function currentIndex(doc: RoutesDoc): number {
  const i = doc.findIndex((r) => r.robotName === DEFAULT_ROBOT_NAME);
  return i >= 0 ? i : 0;
}

function emptyDoc(): RoutesDoc {
  return [{ robotName: DEFAULT_ROBOT_NAME, routes: [] }];
}

export function routesOf(doc: RoutesDoc): readonly RouteData[] {
  return doc[currentIndex(doc)]?.routes ?? [];
}

function withRoutes(doc: RoutesDoc, routes: RouteData[]): RoutesDoc {
  if (doc.length === 0) return [{ robotName: DEFAULT_ROBOT_NAME, routes }];
  const i = currentIndex(doc);
  return doc.map((r, k): RobotRoutes => (k === i ? { robotName: r.robotName, routes } : r));
}

/** 生成不与 existing 冲突的名称：base, base 2, base 3 … */
export function uniqueName(base: string, existing: Iterable<string>): string {
  const set = new Set(existing);
  if (!set.has(base)) return base;
  for (let i = 2; ; i++) {
    const n = `${base} ${i}`;
    if (!set.has(n)) return n;
  }
}

export class DocStore {
  readonly doc = signal<RoutesDoc>(emptyDoc());
  readonly routes = computed(() => routesOf(this.doc.value));
  readonly canUndo = signal(false);
  readonly canRedo = signal(false);
  /** 最近一次写盘失败（配额/不可用）。 */
  readonly saveError = signal<string | null>(null);

  private readonly kv: KV;
  private readonly debounceMs: number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (h: unknown) => void;
  private undoStack: RoutesDoc[] = [];
  private redoStack: RoutesDoc[] = [];
  private saveHandle: unknown = null;
  private dirty = false;
  private lastWritten: string | null = null;
  private gesture: { base: RoutesDoc; changed: boolean } | null = null;
  private readonly changeListeners = new Set<DocListener>();
  private readonly deleteListeners = new Set<(name: string) => void>();

  constructor(opts: DocStoreOptions = {}) {
    this.kv = opts.kv ?? defaultKv;
    this.debounceMs = opts.debounceMs ?? SAVE_DEBOUNCE_MS;
    this.setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    this.reloadFromStorage();
  }

  // ---------- 读取 ----------
  getRoute(name: string): RouteData | undefined {
    return this.routes.value.find((r) => r.name === name);
  }

  names(): string[] {
    return this.routes.value.map((r) => r.name);
  }

  // ---------- 变更监听 ----------
  /** 本地用户编辑引起的变更（不含从存储重载）。返回取消函数。 */
  onLocalChange(fn: DocListener): () => void {
    this.changeListeners.add(fn);
    return () => this.changeListeners.delete(fn);
  }

  /** 路径被本地删除（用于记录同步墓碑）。 */
  onRouteDeleted(fn: (name: string) => void): () => void {
    this.deleteListeners.add(fn);
    return () => this.deleteListeners.delete(fn);
  }

  // ---------- 路径级操作 ----------
  createRoute(name?: string, points?: ControlNode[]): string {
    const base = (name ?? '').trim() || '新路径';
    const finalName = uniqueName(base, this.names());
    this.commit((routes) => [...routes, { name: finalName, points: points ?? [firstNode()] }]);
    return finalName;
  }

  renameRoute(oldName: string, newName: string): { ok: true } | { ok: false; error: string } {
    const next = newName.trim();
    if (!next) return { ok: false, error: '名称不能为空' };
    if (next === oldName) return { ok: true };
    if (this.names().includes(next)) return { ok: false, error: '已存在同名路径' };
    if (!this.getRoute(oldName)) return { ok: false, error: '路径不存在' };
    this.commit((routes) => routes.map((r) => (r.name === oldName ? { ...r, name: next } : r)));
    // 重命名对机器人侧等价于"删除旧名 + 新建新名"
    this.deleteListeners.forEach((fn) => fn(oldName));
    return { ok: true };
  }

  duplicateRoute(name: string): string | null {
    const src = this.getRoute(name);
    if (!src) return null;
    const copy = uniqueName(`${name} 副本`, this.names());
    this.commit((routes) => {
      const i = routes.findIndex((r) => r.name === name);
      const out = [...routes];
      out.splice(i + 1, 0, { name: copy, points: src.points.map((p) => ({ ...p, commandParams: [...p.commandParams] })) });
      return out;
    });
    return copy;
  }

  deleteRoute(name: string): boolean {
    if (!this.getRoute(name)) return false;
    this.commit((routes) => routes.filter((r) => r.name !== name));
    this.deleteListeners.forEach((fn) => fn(name));
    return true;
  }

  moveRoute(from: number, to: number): void {
    const n = this.routes.value.length;
    if (from === to || from < 0 || to < 0 || from >= n || to >= n) return;
    this.commit((routes) => {
      const out = [...routes];
      const [m] = out.splice(from, 1);
      out.splice(to, 0, m!);
      return out;
    });
  }

  /** 导入路径：同名自动改名。返回最终名称列表。 */
  importRoutes(incoming: readonly RouteData[]): string[] {
    const added: string[] = [];
    this.commit((routes) => {
      const names = new Set(routes.map((r) => r.name));
      const out = [...routes];
      for (const r of incoming) {
        const n = uniqueName(r.name, names);
        names.add(n);
        added.push(n);
        out.push({ name: n, points: r.points });
      }
      return out;
    });
    return added;
  }

  /** 用于同步引擎回写：整体替换路径列表（可撤销），不触发 onLocalChange。 */
  replaceRoutes(routes: RouteData[], opts: { silent?: boolean } = {}): void {
    this.commit(() => routes, opts.silent ?? false);
  }

  // ---------- 点编辑 ----------
  setPoints(name: string, points: ControlNode[]): void {
    const cur = this.getRoute(name);
    if (!cur || cur.points === points) return;
    this.commit((routes) => routes.map((r) => (r.name === name ? { ...r, points } : r)));
  }

  // ---------- 手势（拖拽）合并 ----------
  beginGesture(): void {
    if (!this.gesture) this.gesture = { base: this.doc.value, changed: false };
  }

  endGesture(): void {
    const g = this.gesture;
    this.gesture = null;
    if (g?.changed) this.pushUndo(g.base);
  }

  // ---------- 撤销/重做 ----------
  undo(): boolean {
    const prev = this.undoStack.pop();
    if (!prev) return false;
    this.redoStack.push(this.doc.value);
    this.applyDoc(prev, true);
    this.syncFlags();
    this.notifyLocal();
    return true;
  }

  redo(): boolean {
    const next = this.redoStack.pop();
    if (!next) return false;
    this.undoStack.push(this.doc.value);
    this.applyDoc(next, true);
    this.syncFlags();
    this.notifyLocal();
    return true;
  }

  clearHistory(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.syncFlags();
  }

  // ---------- 持久化 ----------
  /** 立即写盘（pagehide / 切换页面时调用）。 */
  flush(): void {
    if (this.saveHandle !== null) {
      this.clearTimer(this.saveHandle);
      this.saveHandle = null;
    }
    if (!this.dirty) return;
    this.dirty = false;
    const text = serializeRoutesDoc(this.doc.value);
    if (text === this.lastWritten) return;
    const prev = this.kv.get(ROUTES_STORAGE_KEY);
    if (prev !== null && prev !== text) this.kv.set(BACKUP_KEY, prev);
    if (this.kv.set(ROUTES_STORAGE_KEY, text)) {
      this.lastWritten = text;
      this.saveError.value = null;
    } else {
      this.saveError.value = '无法写入本地存储（空间不足或被禁用）。请导出备份。';
      this.dirty = true;
    }
  }

  /** 从存储重载（跨标签页 storage 事件触发）；手势进行中延后。返回是否发生变化。 */
  reloadFromStorage(): boolean {
    if (this.gesture) return false;
    const raw = this.kv.get(ROUTES_STORAGE_KEY);
    if (raw === this.lastWritten && this.lastWritten !== null) return false;
    const parsed = parseRoutesDoc(raw);
    const next = parsed && parsed.length > 0 ? parsed : emptyDoc();
    this.lastWritten = raw;
    if (serializeRoutesDoc(next) === serializeRoutesDoc(this.doc.value)) return false;
    this.applyDoc(next);
    this.undoStack = [];
    this.redoStack = [];
    this.syncFlags();
    return true;
  }

  /** 绑定浏览器事件（storage / pagehide）。返回解绑函数。 */
  attachBrowser(): () => void {
    const onStorage = (e: StorageEvent) => {
      if (e.key === ROUTES_STORAGE_KEY) this.reloadFromStorage();
    };
    const onHide = () => this.flush();
    const onVis = () => { if (document.visibilityState === 'hidden') this.flush(); };
    addEventListener('storage', onStorage);
    addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      removeEventListener('storage', onStorage);
      removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onVis);
    };
  }

  // ---------- 内部 ----------
  private commit(mutate: (routes: readonly RouteData[]) => RouteData[], silent = false): void {
    const before = this.doc.value;
    const after = withRoutes(before, mutate(routesOf(before)));
    if (after === before) return;
    if (this.gesture) this.gesture.changed = true;
    else this.pushUndo(before);
    this.applyDoc(after);
    this.scheduleSave();
    if (!silent) this.changeListeners.forEach((fn) => fn(after));
  }

  private pushUndo(snapshot: RoutesDoc): void {
    this.undoStack.push(snapshot);
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack = [];
    this.syncFlags();
  }

  private applyDoc(doc: RoutesDoc, save = false): void {
    this.doc.value = doc;
    if (save) this.scheduleSave();
  }

  private notifyLocal(): void {
    const d = this.doc.value;
    this.changeListeners.forEach((fn) => fn(d));
  }

  private syncFlags(): void {
    this.canUndo.value = this.undoStack.length > 0;
    this.canRedo.value = this.redoStack.length > 0;
  }

  private scheduleSave(): void {
    this.dirty = true;
    if (this.saveHandle !== null) this.clearTimer(this.saveHandle);
    this.saveHandle = this.setTimer(() => {
      this.saveHandle = null;
      this.flush();
    }, this.debounceMs);
  }
}

let shared: DocStore | null = null;
/** 应用级单例（懒创建）。 */
export function docStore(): DocStore {
  return (shared ??= new DocStore());
}
