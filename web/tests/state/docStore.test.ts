import { describe, expect, it, vi } from 'vitest';
import { makeNode, type ControlNode } from '../../src/core/node';
import { firstNode } from '../../src/core/field';
import {
  DEFAULT_ROBOT_NAME,
  ROUTES_STORAGE_KEY,
  serializeRoutesDoc,
  type RoutesDoc,
} from '../../src/core/archive';
import {
  BACKUP_KEY,
  DocStore,
  HISTORY_LIMIT,
  SAVE_DEBOUNCE_MS,
  routesOf,
  uniqueName,
} from '../../src/state/docStore';
import { MemoryKV } from '../../src/storage/kv';

// ---------- 测试工具 ----------

/** 可记录写入、可模拟写失败的 KV。 */
class SpyKV extends MemoryKV {
  sets: Array<[string, string]> = [];
  failing = false;
  override set(key: string, value: string): boolean {
    this.sets.push([key, value]);
    if (this.failing) return false;
    return super.set(key, value);
  }
}

/** 注入式计时器：只在 runAll() 时触发。 */
class FakeTimers {
  private next = 1;
  readonly pending = new Map<number, { fn: () => void; ms: number }>();
  readonly cleared: number[] = [];
  readonly setTimer = (fn: () => void, ms: number): unknown => {
    const id = this.next++;
    this.pending.set(id, { fn, ms });
    return id;
  };
  readonly clearTimer = (h: unknown): void => {
    this.cleared.push(h as number);
    this.pending.delete(h as number);
  };
  get size(): number {
    return this.pending.size;
  }
  runAll(): void {
    const items = [...this.pending.values()];
    this.pending.clear();
    for (const i of items) i.fn();
  }
}

function setup(opts: { kv?: SpyKV; debounceMs?: number } = {}) {
  const kv = opts.kv ?? new SpyKV();
  const timers = new FakeTimers();
  const store = new DocStore({
    kv,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    ...(opts.debounceMs !== undefined ? { debounceMs: opts.debounceMs } : {}),
  });
  return { kv, timers, store };
}

const pts = (...xs: number[]): ControlNode[] => xs.map((x) => makeNode({ x, y: 0, dx: 20, dy: 0 }));
const names = (s: DocStore): string[] => s.routes.value.map((r) => r.name);
const docOf = (...routes: Array<[string, ControlNode[]]>): RoutesDoc => [
  { robotName: DEFAULT_ROBOT_NAME, routes: routes.map(([name, points]) => ({ name, points })) },
];

describe('uniqueName', () => {
  it('不冲突原样返回，冲突追加 " 2", " 3" …', () => {
    expect(uniqueName('a', [])).toBe('a');
    expect(uniqueName('a', ['b'])).toBe('a');
    expect(uniqueName('a', ['a'])).toBe('a 2');
    expect(uniqueName('a', ['a', 'a 2'])).toBe('a 3');
    expect(uniqueName('a', new Set(['a', 'a 3']))).toBe('a 2');
  });
});

describe('初始化与加载', () => {
  it('空存储：一个空的 default 机器人，无历史', () => {
    const { store } = setup();
    expect(store.doc.value).toEqual([{ robotName: 'default', routes: [] }]);
    expect(store.routes.value).toEqual([]);
    expect(store.canUndo.value).toBe(false);
    expect(store.canRedo.value).toBe(false);
    expect(store.saveError.value).toBeNull();
  });

  it('从 robot_routes 加载已有文档', () => {
    const kv = new SpyKV();
    const doc = docOf(['A', pts(0, 10)], ['B', pts(5)]);
    kv.set(ROUTES_STORAGE_KEY, serializeRoutesDoc(doc));
    kv.sets.length = 0;
    const { store } = setup({ kv });
    expect(store.doc.value).toStrictEqual(doc);
    expect(names(store)).toEqual(['A', 'B']);
    expect(store.getRoute('B')?.points).toHaveLength(1);
    expect(store.getRoute('nope')).toBeUndefined();
    expect(kv.sets).toEqual([]); // 加载不写盘
  });

  it('损坏 / 空数组存储回退为空文档', () => {
    for (const raw of ['{oops', '[]', '   ', '[1]']) {
      const kv = new SpyKV();
      kv.set(ROUTES_STORAGE_KEY, raw);
      const { store } = setup({ kv });
      expect(store.doc.value).toEqual([{ robotName: 'default', routes: [] }]);
    }
  });

  it('当前机器人固定为 "default"，不存在则取第一个；写入不影响其他机器人', () => {
    const kv = new SpyKV();
    const other = { robotName: 'other', routes: [{ name: 'X', points: pts(1) }] };
    const def = { robotName: 'default', routes: [{ name: 'D', points: pts(2) }] };
    kv.set(ROUTES_STORAGE_KEY, serializeRoutesDoc([other, def]));
    const { store } = setup({ kv });
    expect(names(store)).toEqual(['D']);
    store.createRoute('N');
    expect(store.doc.value[0]).toStrictEqual(other);
    expect(store.doc.value[1]!.routes.map((r) => r.name)).toEqual(['D', 'N']);

    const kv2 = new SpyKV();
    kv2.set(ROUTES_STORAGE_KEY, serializeRoutesDoc([other]));
    const s2 = setup({ kv: kv2 }).store;
    expect(names(s2)).toEqual(['X']);
    s2.createRoute('Y');
    expect(s2.doc.value).toHaveLength(1);
    expect(s2.doc.value[0]!.robotName).toBe('other');
    expect(routesOf(s2.doc.value).map((r) => r.name)).toEqual(['X', 'Y']);
  });
});

describe('createRoute', () => {
  it('默认名 "新路径"，空白名回退默认名，名称 trim', () => {
    const { store } = setup();
    expect(store.createRoute()).toBe('新路径');
    expect(store.createRoute('   ')).toBe('新路径 2');
    expect(store.createRoute('  X  ')).toBe('X');
    expect(names(store)).toEqual(['新路径', '新路径 2', 'X']);
  });

  it('名称唯一：冲突追加序号', () => {
    const { store } = setup();
    expect(store.createRoute('A')).toBe('A');
    expect(store.createRoute('A')).toBe('A 2');
    expect(store.createRoute('A')).toBe('A 3');
    expect(new Set(names(store)).size).toBe(3);
  });

  it('默认带一个首点；可传入自定义点', () => {
    const { store } = setup();
    store.createRoute('A');
    expect(store.getRoute('A')!.points).toEqual([firstNode()]);
    const custom = pts(1, 2);
    store.createRoute('B', custom);
    expect(store.getRoute('B')!.points).toBe(custom);
  });

  it('可撤销', () => {
    const { store } = setup();
    store.createRoute('A');
    expect(store.canUndo.value).toBe(true);
    store.undo();
    expect(names(store)).toEqual([]);
  });
});

describe('renameRoute', () => {
  it('成功改名并保持位置；通知 onRouteDeleted(旧名)', () => {
    const { store } = setup();
    store.createRoute('A');
    store.createRoute('B');
    const del = vi.fn();
    store.onRouteDeleted(del);
    expect(store.renameRoute('A', '  C ')).toEqual({ ok: true });
    expect(names(store)).toEqual(['C', 'B']);
    expect(del).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledWith('A');
  });

  it('错误：空名 / 重名 / 不存在；失败不产生历史、不通知', () => {
    const { store } = setup();
    store.createRoute('A');
    store.createRoute('B');
    store.clearHistory();
    const del = vi.fn();
    const changed = vi.fn();
    store.onRouteDeleted(del);
    store.onLocalChange(changed);
    expect(store.renameRoute('A', '  ')).toEqual({ ok: false, error: '名称不能为空' });
    expect(store.renameRoute('A', 'B')).toEqual({ ok: false, error: '已存在同名路径' });
    expect(store.renameRoute('Z', 'Q')).toEqual({ ok: false, error: '路径不存在' });
    expect(names(store)).toEqual(['A', 'B']);
    expect(store.canUndo.value).toBe(false);
    expect(del).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
  });

  it('改成原名视为成功但无任何变更', () => {
    const { store } = setup();
    store.createRoute('A');
    store.clearHistory();
    const changed = vi.fn();
    const del = vi.fn();
    store.onLocalChange(changed);
    store.onRouteDeleted(del);
    expect(store.renameRoute('A', 'A')).toEqual({ ok: true });
    expect(store.renameRoute('A', ' A ')).toEqual({ ok: true });
    expect(store.canUndo.value).toBe(false);
    expect(changed).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  it('可撤销', () => {
    const { store } = setup();
    store.createRoute('A');
    store.renameRoute('A', 'B');
    store.undo();
    expect(names(store)).toEqual(['A']);
  });
});

describe('duplicateRoute', () => {
  it('命名为 "<名> 副本"，冲突追加序号，插入在源路径之后', () => {
    const { store } = setup();
    store.createRoute('A');
    store.createRoute('B');
    expect(store.duplicateRoute('A')).toBe('A 副本');
    expect(store.duplicateRoute('A')).toBe('A 副本 2');
    expect(names(store)).toEqual(['A', 'A 副本 2', 'A 副本', 'B']);
  });

  it('深拷贝点（修改副本的 commandParams 不影响原路径）', () => {
    const { store } = setup();
    store.createRoute('A', [makeNode({ x: 1, y: 2, commandParams: ['p'], marker: 'm', maxSpeed: 3 })]);
    const copy = store.duplicateRoute('A')!;
    const a = store.getRoute('A')!.points[0]!;
    const c = store.getRoute(copy)!.points[0]!;
    expect(c).toStrictEqual(a);
    expect(c).not.toBe(a);
    expect(c.commandParams).not.toBe(a.commandParams);
  });

  it('不存在返回 null 且不产生历史', () => {
    const { store } = setup();
    expect(store.duplicateRoute('nope')).toBeNull();
    expect(store.canUndo.value).toBe(false);
  });
});

describe('deleteRoute', () => {
  it('删除并通知 onRouteDeleted；不存在返回 false', () => {
    const { store } = setup();
    store.createRoute('A');
    store.createRoute('B');
    const del = vi.fn();
    store.onRouteDeleted(del);
    expect(store.deleteRoute('A')).toBe(true);
    expect(names(store)).toEqual(['B']);
    expect(del).toHaveBeenCalledExactlyOnceWith('A');
    expect(store.deleteRoute('A')).toBe(false);
    expect(del).toHaveBeenCalledTimes(1);
  });

  it('可撤销恢复（位置与内容不变）', () => {
    const { store } = setup();
    store.createRoute('A', pts(1));
    store.createRoute('B', pts(2));
    store.createRoute('C', pts(3));
    store.deleteRoute('B');
    store.undo();
    expect(names(store)).toEqual(['A', 'B', 'C']);
    expect(store.getRoute('B')!.points[0]!.x).toBe(2);
  });

  it('取消订阅后不再通知', () => {
    const { store } = setup();
    store.createRoute('A');
    store.createRoute('B');
    const del = vi.fn();
    const off = store.onRouteDeleted(del);
    off();
    store.deleteRoute('A');
    store.renameRoute('B', 'C');
    expect(del).not.toHaveBeenCalled();
  });
});

describe('moveRoute', () => {
  const abc = () => {
    const s = setup().store;
    ['A', 'B', 'C', 'D'].forEach((n) => s.createRoute(n));
    s.clearHistory();
    return s;
  };

  it('前移 / 后移', () => {
    const s = abc();
    s.moveRoute(0, 2);
    expect(names(s)).toEqual(['B', 'C', 'A', 'D']);
    s.moveRoute(3, 0);
    expect(names(s)).toEqual(['D', 'B', 'C', 'A']);
  });

  it('越界 / 同位置为空操作，不产生历史', () => {
    const s = abc();
    s.moveRoute(1, 1);
    s.moveRoute(-1, 2);
    s.moveRoute(2, -1);
    s.moveRoute(4, 0);
    s.moveRoute(0, 4);
    expect(names(s)).toEqual(['A', 'B', 'C', 'D']);
    expect(s.canUndo.value).toBe(false);
  });

  it('可撤销', () => {
    const s = abc();
    s.moveRoute(0, 3);
    s.undo();
    expect(names(s)).toEqual(['A', 'B', 'C', 'D']);
  });
});

describe('importRoutes', () => {
  it('同名自动改名并返回最终名称；导入内的重名也被区分', () => {
    const { store } = setup();
    store.createRoute('A');
    const added = store.importRoutes([
      { name: 'A', points: pts(1) },
      { name: 'A', points: pts(2) },
      { name: 'B', points: pts(3) },
      { name: 'B', points: pts(4) },
    ]);
    expect(added).toEqual(['A 2', 'A 3', 'B', 'B 2']);
    expect(names(store)).toEqual(['A', 'A 2', 'A 3', 'B', 'B 2']);
    expect(store.getRoute('A 3')!.points[0]!.x).toBe(2);
    expect(store.getRoute('B 2')!.points[0]!.x).toBe(4);
  });

  it('一次导入 = 一步撤销；空导入返回 []', () => {
    const { store } = setup();
    store.importRoutes([{ name: 'X', points: [] }, { name: 'Y', points: [] }]);
    store.undo();
    expect(names(store)).toEqual([]);
    expect(store.importRoutes([])).toEqual([]);
  });
});

describe('setPoints / replaceRoutes', () => {
  it('setPoints 替换点；相同引用或不存在的路径为空操作', () => {
    const { store } = setup();
    store.createRoute('A', pts(1));
    store.clearHistory();
    const same = store.getRoute('A')!.points;
    store.setPoints('A', same);
    store.setPoints('nope', pts(9));
    expect(store.canUndo.value).toBe(false);
    const next = pts(5, 6);
    store.setPoints('A', next);
    expect(store.getRoute('A')!.points).toBe(next);
    expect(store.canUndo.value).toBe(true);
  });

  it('replaceRoutes 整体替换且可撤销；silent 不触发 onLocalChange', () => {
    const { store } = setup();
    store.createRoute('A');
    const changed = vi.fn();
    store.onLocalChange(changed);
    store.replaceRoutes([{ name: 'S', points: pts(1) }], { silent: true });
    expect(names(store)).toEqual(['S']);
    expect(changed).not.toHaveBeenCalled();
    store.replaceRoutes([{ name: 'T', points: pts(1) }]);
    expect(changed).toHaveBeenCalledTimes(1);
    store.undo();
    expect(names(store)).toEqual(['S']);
    store.undo();
    expect(names(store)).toEqual(['A']);
  });

  it('silent 回写仍会安排保存', () => {
    const { store, timers } = setup();
    store.replaceRoutes([{ name: 'S', points: [] }], { silent: true });
    expect(timers.size).toBe(1);
  });
});

describe('撤销 / 重做', () => {
  it('空栈返回 false', () => {
    const { store } = setup();
    expect(store.undo()).toBe(false);
    expect(store.redo()).toBe(false);
  });

  it('undo / redo 往返与 canUndo / canRedo 信号', () => {
    const { store } = setup();
    store.createRoute('A');
    store.createRoute('B');
    expect(store.canUndo.value).toBe(true);
    expect(store.canRedo.value).toBe(false);
    expect(store.undo()).toBe(true);
    expect(names(store)).toEqual(['A']);
    expect(store.canRedo.value).toBe(true);
    expect(store.undo()).toBe(true);
    expect(names(store)).toEqual([]);
    expect(store.canUndo.value).toBe(false);
    expect(store.redo()).toBe(true);
    expect(store.redo()).toBe(true);
    expect(names(store)).toEqual(['A', 'B']);
    expect(store.canRedo.value).toBe(false);
    expect(store.redo()).toBe(false);
  });

  it('新编辑清空重做栈', () => {
    const { store } = setup();
    store.createRoute('A');
    store.createRoute('B');
    store.undo();
    expect(store.canRedo.value).toBe(true);
    store.createRoute('C');
    expect(store.canRedo.value).toBe(false);
    expect(store.redo()).toBe(false);
    expect(names(store)).toEqual(['A', 'C']);
  });

  it('undo / redo 之后会安排保存并落盘', () => {
    const { store, timers, kv } = setup();
    store.createRoute('A');
    timers.runAll();
    kv.sets.length = 0;
    store.undo();
    expect(timers.size).toBe(1);
    timers.runAll();
    expect(kv.get(ROUTES_STORAGE_KEY)).toBe(serializeRoutesDoc([{ robotName: 'default', routes: [] }]));
    store.redo();
    timers.runAll();
    expect(JSON.parse(kv.get(ROUTES_STORAGE_KEY)!)[0].routes.map((r: { name: string }) => r.name)).toEqual(['A']);
  });

  it('clearHistory 清空两个栈', () => {
    const { store } = setup();
    store.createRoute('A');
    store.createRoute('B');
    store.undo();
    store.clearHistory();
    expect(store.canUndo.value).toBe(false);
    expect(store.canRedo.value).toBe(false);
    expect(store.undo()).toBe(false);
    expect(names(store)).toEqual(['A']);
  });

  it(`历史上限 ${HISTORY_LIMIT}：最旧的快照被丢弃`, () => {
    expect(HISTORY_LIMIT).toBe(200);
    const { store } = setup();
    for (let i = 0; i < 250; i++) store.createRoute(`R${i}`);
    expect(store.routes.value).toHaveLength(250);
    let undone = 0;
    while (store.undo()) undone++;
    expect(undone).toBe(200);
    expect(store.routes.value).toHaveLength(50);
    expect(store.canUndo.value).toBe(false);
    expect(store.canRedo.value).toBe(true);
  });

  it('恰好 200 步时全部可撤销', () => {
    const { store } = setup();
    for (let i = 0; i < 200; i++) store.createRoute(`R${i}`);
    let undone = 0;
    while (store.undo()) undone++;
    expect(undone).toBe(200);
    expect(store.routes.value).toHaveLength(0);
  });
});

describe('手势合并 beginGesture / endGesture', () => {
  const withRoute = () => {
    const ctx = setup();
    ctx.store.createRoute('A', pts(0));
    ctx.store.clearHistory();
    return ctx;
  };

  it('手势内多次修改只产生一步撤销，回到手势前的状态', () => {
    const { store } = withRoute();
    const original = store.getRoute('A')!.points;
    store.beginGesture();
    for (let i = 1; i <= 10; i++) store.setPoints('A', pts(i));
    expect(store.getRoute('A')!.points[0]!.x).toBe(10);
    expect(store.canUndo.value).toBe(false); // 手势结束前不入栈
    store.endGesture();
    expect(store.canUndo.value).toBe(true);
    expect(store.undo()).toBe(true);
    expect(store.getRoute('A')!.points).toBe(original);
    expect(store.undo()).toBe(false);
    expect(store.redo()).toBe(true);
    expect(store.getRoute('A')!.points[0]!.x).toBe(10);
  });

  it('无变化的手势不产生历史', () => {
    const { store } = withRoute();
    store.beginGesture();
    store.endGesture();
    expect(store.canUndo.value).toBe(false);
    store.endGesture(); // 没有 begin 的 end 也安全
    expect(store.canUndo.value).toBe(false);
  });

  it('重复 beginGesture 被忽略，基准仍是第一次的状态', () => {
    const { store } = withRoute();
    const original = store.getRoute('A')!.points;
    store.beginGesture();
    store.setPoints('A', pts(1));
    store.beginGesture();
    store.setPoints('A', pts(2));
    store.endGesture();
    store.undo();
    expect(store.getRoute('A')!.points).toBe(original);
    expect(store.canUndo.value).toBe(false);
  });

  it('手势内每次提交仍通知 onLocalChange 并安排保存', () => {
    const { store, timers } = withRoute();
    const changed = vi.fn();
    store.onLocalChange(changed);
    store.beginGesture();
    store.setPoints('A', pts(1));
    store.setPoints('A', pts(2));
    expect(changed).toHaveBeenCalledTimes(2);
    expect(timers.size).toBe(1);
    store.endGesture();
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it('手势结束时清空重做栈', () => {
    const { store } = setup();
    store.createRoute('A', pts(0));
    store.createRoute('B');
    store.undo();
    expect(store.canRedo.value).toBe(true);
    store.beginGesture();
    store.setPoints('A', pts(5));
    store.endGesture();
    expect(store.canRedo.value).toBe(false);
  });

  it('手势后可再次开始新的手势（各自独立一步）', () => {
    const { store } = withRoute();
    store.beginGesture();
    store.setPoints('A', pts(1));
    store.endGesture();
    store.beginGesture();
    store.setPoints('A', pts(2));
    store.endGesture();
    store.undo();
    expect(store.getRoute('A')!.points[0]!.x).toBe(1);
    store.undo();
    expect(store.getRoute('A')!.points[0]!.x).toBe(0);
  });
});

describe('防抖保存', () => {
  it('提交后只安排一个计时器（默认 300ms），到期才写盘', () => {
    expect(SAVE_DEBOUNCE_MS).toBe(300);
    const { store, timers, kv } = setup();
    store.createRoute('A');
    expect(timers.size).toBe(1);
    expect([...timers.pending.values()][0]!.ms).toBe(300);
    expect(kv.get(ROUTES_STORAGE_KEY)).toBeNull();
    timers.runAll();
    expect(kv.get(ROUTES_STORAGE_KEY)).toBe(serializeRoutesDoc(store.doc.value));
  });

  it('自定义防抖间隔', () => {
    const { store, timers } = setup({ debounceMs: 50 });
    store.createRoute('A');
    expect([...timers.pending.values()][0]!.ms).toBe(50);
  });

  it('连续提交会取消前一个计时器，只写一次', () => {
    const { store, timers, kv } = setup();
    store.createRoute('A');
    store.createRoute('B');
    store.createRoute('C');
    expect(timers.size).toBe(1);
    expect(timers.cleared).toHaveLength(2);
    timers.runAll();
    expect(kv.sets.filter(([k]) => k === ROUTES_STORAGE_KEY)).toHaveLength(1);
    const saved = JSON.parse(kv.get(ROUTES_STORAGE_KEY)!) as Array<{ routes: Array<{ name: string }> }>;
    expect(saved[0]!.routes.map((r) => r.name)).toEqual(['A', 'B', 'C']);
  });

  it('写入格式 = [{robotName, routes:[{name, points}]}]，可选字段缺省则省略', () => {
    const { store, timers, kv } = setup();
    store.createRoute('A', [makeNode({ x: 1, y: 2, delayAfterArrive: 1.5 })]);
    timers.runAll();
    const text = kv.get(ROUTES_STORAGE_KEY)!;
    const parsed = JSON.parse(text) as Array<{ robotName: string; routes: Array<{ name: string; points: Array<Record<string, unknown>> }> }>;
    expect(parsed[0]!.robotName).toBe('default');
    expect(parsed[0]!.routes[0]!.name).toBe('A');
    expect(parsed[0]!.routes[0]!.points[0]!['delayAfterArrive']).toBe(1.5);
    expect(text).not.toContain('null');
    expect(text).not.toContain('endSpeed');
  });

  it('备份：覆盖前把旧内容写入 robot_routes.bak；首次写入（旧值为空）不产生备份', () => {
    expect(BACKUP_KEY).toBe('robot_routes.bak');
    const { store, timers, kv } = setup();
    store.createRoute('A');
    timers.runAll();
    expect(kv.get(BACKUP_KEY)).toBeNull();
    const first = kv.get(ROUTES_STORAGE_KEY)!;
    store.createRoute('B');
    timers.runAll();
    expect(kv.get(BACKUP_KEY)).toBe(first);
    const second = kv.get(ROUTES_STORAGE_KEY)!;
    expect(second).not.toBe(first);
    store.createRoute('C');
    timers.runAll();
    expect(kv.get(BACKUP_KEY)).toBe(second);
  });

  it('加载自旧数据后的第一次保存会把旧数据备份', () => {
    const kv = new SpyKV();
    const old = serializeRoutesDoc(docOf(['Old', pts(1)]));
    kv.set(ROUTES_STORAGE_KEY, old);
    const { store, timers } = setup({ kv });
    store.createRoute('New');
    timers.runAll();
    expect(kv.get(BACKUP_KEY)).toBe(old);
    expect(kv.get(ROUTES_STORAGE_KEY)).not.toBe(old);
  });

  it('存储中的内容已等于将写入内容时不写备份', () => {
    const { store, timers, kv } = setup();
    // 先算出 createRoute('X') 之后的文本，在 store 不知情时预置到存储
    const probe = setup().store;
    probe.createRoute('X');
    kv.set(ROUTES_STORAGE_KEY, serializeRoutesDoc(probe.doc.value));
    store.createRoute('X');
    timers.runAll();
    expect(kv.get(BACKUP_KEY)).toBeNull();
  });

  it('flush() 立即写盘并取消待定计时器', () => {
    const { store, timers, kv } = setup();
    store.createRoute('A');
    store.flush();
    expect(timers.size).toBe(0);
    expect(kv.get(ROUTES_STORAGE_KEY)).toBe(serializeRoutesDoc(store.doc.value));
  });

  it('未变更时 flush() 不写盘；内容回到已写入状态时也不重复写', () => {
    const { store, kv } = setup();
    store.flush();
    expect(kv.sets).toEqual([]);
    store.createRoute('A');
    store.flush();
    const n = kv.sets.length;
    store.flush();
    expect(kv.sets).toHaveLength(n);
    // 新增再删除 → 文本与已写入相同
    store.createRoute('B');
    store.deleteRoute('B');
    store.flush();
    expect(kv.sets).toHaveLength(n);
  });

  it('保存成功不改变 saveError（保持 null）', () => {
    const { store, timers } = setup();
    store.createRoute('A');
    timers.runAll();
    expect(store.saveError.value).toBeNull();
  });
});

describe('saveError（kv.set 返回 false）', () => {
  it('写入失败设置错误信息，保留 dirty；恢复后 flush 重试成功并清除错误', () => {
    const kv = new SpyKV();
    const { store, timers } = setup({ kv });
    kv.failing = true;
    store.createRoute('A');
    timers.runAll();
    expect(store.saveError.value).toBe('无法写入本地存储（空间不足或被禁用）。请导出备份。');
    expect(kv.get(ROUTES_STORAGE_KEY)).toBeNull();

    kv.failing = false;
    store.flush();
    expect(store.saveError.value).toBeNull();
    expect(kv.get(ROUTES_STORAGE_KEY)).toBe(serializeRoutesDoc(store.doc.value));
  });

  it('失败后再次编辑并保存也会重试', () => {
    const kv = new SpyKV();
    const { store, timers } = setup({ kv });
    kv.failing = true;
    store.createRoute('A');
    timers.runAll();
    expect(store.saveError.value).not.toBeNull();
    kv.failing = false;
    store.createRoute('B');
    timers.runAll();
    expect(store.saveError.value).toBeNull();
    const saved = JSON.parse(kv.get(ROUTES_STORAGE_KEY)!) as Array<{ routes: Array<{ name: string }> }>;
    expect(saved[0]!.routes.map((r) => r.name)).toEqual(['A', 'B']);
  });

  it('失败后文档仍保持在内存中', () => {
    const kv = new SpyKV();
    kv.failing = true;
    const { store } = setup({ kv });
    store.createRoute('A');
    store.flush();
    expect(names(store)).toEqual(['A']);
    expect(store.saveError.value).toContain('无法写入本地存储');
  });
});

describe('reloadFromStorage', () => {
  it('外部写入后重载：更新文档、清空历史、不触发 onLocalChange，返回 true', () => {
    const { store, kv } = setup();
    store.createRoute('Mine');
    store.flush();
    expect(store.canUndo.value).toBe(true);
    const changed = vi.fn();
    store.onLocalChange(changed);

    const external = docOf(['Ext', pts(7)]);
    kv.set(ROUTES_STORAGE_KEY, serializeRoutesDoc(external));
    expect(store.reloadFromStorage()).toBe(true);
    expect(store.doc.value).toStrictEqual(external);
    expect(store.canUndo.value).toBe(false);
    expect(store.canRedo.value).toBe(false);
    expect(changed).not.toHaveBeenCalled();
  });

  it('自己刚写入的内容 / 无变化时返回 false', () => {
    const { store } = setup();
    store.createRoute('A');
    store.flush();
    expect(store.reloadFromStorage()).toBe(false);
    expect(store.canUndo.value).toBe(true); // 历史保留
    expect(setup().store.reloadFromStorage()).toBe(false);
  });

  it('文本不同但内容等价时不替换文档、不清历史', () => {
    const { store, kv } = setup();
    store.createRoute('A');
    store.flush();
    const before = store.doc.value;
    kv.set(ROUTES_STORAGE_KEY, serializeRoutesDoc(store.doc.value, true)); // 缩进不同
    expect(store.reloadFromStorage()).toBe(false);
    expect(store.doc.value).toBe(before);
    expect(store.canUndo.value).toBe(true);
  });

  it('存储被清空 / 损坏后重载为空文档', () => {
    const { store, kv } = setup();
    store.createRoute('A');
    store.flush();
    kv.remove(ROUTES_STORAGE_KEY);
    expect(store.reloadFromStorage()).toBe(true);
    expect(store.doc.value).toEqual([{ robotName: 'default', routes: [] }]);
    kv.set(ROUTES_STORAGE_KEY, serializeRoutesDoc(docOf(['B', []])));
    expect(store.reloadFromStorage()).toBe(true);
    kv.set(ROUTES_STORAGE_KEY, '{oops');
    expect(store.reloadFromStorage()).toBe(true);
    expect(names(store)).toEqual([]);
  });

  it('手势进行中延后重载，手势结束后生效', () => {
    const { store, kv } = setup();
    store.createRoute('A', pts(0));
    store.flush();
    store.beginGesture();
    kv.set(ROUTES_STORAGE_KEY, serializeRoutesDoc(docOf(['Ext', pts(1)])));
    expect(store.reloadFromStorage()).toBe(false);
    expect(names(store)).toEqual(['A']);
    store.endGesture();
    expect(store.reloadFromStorage()).toBe(true);
    expect(names(store)).toEqual(['Ext']);
  });

  it('两个标签页共享存储：A 保存后 B 重载得到相同内容', () => {
    const kv = new SpyKV();
    const a = setup({ kv }).store;
    const b = setup({ kv }).store;
    a.createRoute('Shared', pts(1, 2));
    a.flush();
    expect(b.reloadFromStorage()).toBe(true);
    expect(b.doc.value).toStrictEqual(a.doc.value);
    // B 随后保存的是它看到的内容，A 重载应无变化
    expect(a.reloadFromStorage()).toBe(false);
  });
});

describe('监听器', () => {
  it('onLocalChange：每次本地编辑触发，参数为新文档；取消订阅后不再触发', () => {
    const { store } = setup();
    const seen: RoutesDoc[] = [];
    const off = store.onLocalChange((d) => seen.push(d));
    store.createRoute('A');
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(store.doc.value);
    store.renameRoute('A', 'B');
    store.duplicateRoute('B');
    store.moveRoute(0, 1);
    store.importRoutes([{ name: 'Z', points: [] }]);
    store.setPoints('Z', pts(1));
    store.deleteRoute('Z');
    expect(seen).toHaveLength(7);
    off();
    store.createRoute('Q');
    expect(seen).toHaveLength(7);
  });

  it('onLocalChange 在 undo / redo 时同样触发（携带恢复后的文档）', () => {
    const { store } = setup();
    store.createRoute('A');
    const seen: RoutesDoc[] = [];
    store.onLocalChange((d) => seen.push(d));
    store.undo();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(store.doc.value);
    expect(routesOf(seen[0]!)).toEqual([]);
    store.redo();
    expect(seen).toHaveLength(2);
    expect(routesOf(seen[1]!).map((r) => r.name)).toEqual(['A']);
    // 空栈 undo / redo 不触发
    store.redo();
    expect(seen).toHaveLength(2);
  });

  it('多个监听器都会被调用', () => {
    const { store } = setup();
    const a = vi.fn();
    const b = vi.fn();
    store.onLocalChange(a);
    store.onLocalChange(b);
    store.createRoute('A');
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('undo 创建的路径不会触发 onRouteDeleted（只有显式删除 / 改名才通知）', () => {
    const { store } = setup();
    store.createRoute('A');
    const del = vi.fn();
    store.onRouteDeleted(del);
    store.undo();
    expect(del).not.toHaveBeenCalled();
  });
});

describe('读取 API', () => {
  it('routes 是随文档变化的 computed；names() 与之一致', () => {
    const { store } = setup();
    expect(store.routes.value).toEqual([]);
    store.createRoute('A');
    store.createRoute('B');
    expect(store.names()).toEqual(['A', 'B']);
    expect(store.routes.value.map((r) => r.name)).toEqual(['A', 'B']);
    expect(routesOf([])).toEqual([]);
  });
});
