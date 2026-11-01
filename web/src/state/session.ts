/**
 * 应用级机器人会话：持有 RobotConnection，并把状态/事件转成 signals 供界面使用。
 * 多标签页用 Web Locks 选出唯一持有连接的标签页（其余只读，可手动接管）。
 */
import { signal, effect } from '@preact/signals';
import {
  RobotConnection,
  type ConnectionData,
  type ConnectionState,
} from '../net/connection';
import type { PoseEvent } from '../net/models';
import { normalizeRobotUrl } from '../net/url';
import { settings } from './settings';

export const connState = signal<ConnectionState>({ kind: 'idle' });
/** 除 pose 外的事件数据快照（每个事件触发一次更新）。 */
export const connData = signal<ConnectionData | null>(null);
/** 最新位姿（60Hz 事件合并到每帧一次写入）。 */
export const pose = signal<PoseEvent | null>(null);
/** 是否由本标签页持有机器人连接。 */
export const isOwnerTab = signal(true);
/** 地址不合法时的提示。 */
export const addressError = signal<string | null>(null);

let connection: RobotConnection | null = null;
let unsub: (() => void) | null = null;
let pendingPose: PoseEvent | null = null;
let raf = 0;
let started = false;
let releaseLock: (() => void) | null = null;

export function getConnection(): RobotConnection | null {
  return connection;
}

/** 订阅连接事件（路由事件等），连接对象被重建时自动重新订阅。 */
type Listener = Parameters<RobotConnection['subscribe']>[0];
const extraListeners = new Set<Listener>();
export function onConnectionEvent(fn: Listener): () => void {
  extraListeners.add(fn);
  return () => extraListeners.delete(fn);
}

function flushPose() {
  raf = 0;
  if (pendingPose) { pose.value = pendingPose; pendingPose = null; }
}

function schedulePose(p: PoseEvent) {
  pendingPose = p;
  if (raf) return;
  raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(flushPose) : (setTimeout(flushPose, 16) as unknown as number);
}

async function rebuild(address: string): Promise<void> {
  unsub?.();
  unsub = null;
  if (connection) await connection.close();
  connection = null;
  pose.value = null;
  connData.value = null;
  connState.value = { kind: 'idle' };

  const url = normalizeRobotUrl(address);
  if (!url) {
    addressError.value = address.trim() ? '机器人地址无效' : null;
    return;
  }
  addressError.value = null;
  const c = new RobotConnection({ baseUrl: url });
  connection = c;
  unsub = c.subscribe((e) => {
    if (e.type === 'state') {
      connState.value = e.state;
      if (e.state.kind !== 'connected') pose.value = e.state.kind === 'idle' ? null : pose.value;
    } else if (e.type === 'pose') {
      schedulePose(e.data);
    } else {
      connData.value = { ...c.data };
    }
    extraListeners.forEach((fn) => fn(e));
  });
  if (isOwnerTab.value) void c.connect();
}

/** 手动（重新）连接。 */
export async function reconnect(): Promise<void> {
  if (connection) { await connection.connect(); return; }
  await rebuild(settings.value.robotAddress);
}

export async function disconnect(): Promise<void> {
  if (connection) await connection.close();
}

/** 其他标签页持有连接时，强制接管。 */
export async function takeOver(): Promise<void> {
  if (!('locks' in navigator)) return;
  releaseLock?.();
  releaseLock = null;
  await acquireLock(true);
  await reconnect();
}

function acquireLock(steal: boolean): Promise<boolean> {
  return new Promise((resolve) => {
    if (!('locks' in navigator)) { isOwnerTab.value = true; resolve(true); return; }
    const opts: LockOptions = steal ? { steal: true } : { ifAvailable: true };
    void navigator.locks.request('az-robot-owner', opts, (lock) => {
      if (!lock) { isOwnerTab.value = false; resolve(false); return undefined; }
      isOwnerTab.value = true;
      resolve(true);
      return new Promise<void>((release) => { releaseLock = () => release(); });
    }).catch(() => {
      // 被 steal 时 request 会 reject
      isOwnerTab.value = false;
    });
  });
}

/** 应用启动时调用一次。返回停止函数。 */
export function startSession(): () => void {
  if (started) return () => undefined;
  started = true;
  let lastAddr: string | null = null;
  let stopEffect: (() => void) | null = null;
  void acquireLock(false).then(() => {
    stopEffect = effect(() => {
      const addr = settings.value.robotAddress;
      if (addr === lastAddr) return;
      lastAddr = addr;
      void rebuild(addr);
    });
  });
  const onHide = () => { void connection?.close(); };
  addEventListener('pagehide', onHide);
  return () => {
    stopEffect?.();
    removeEventListener('pagehide', onHide);
    unsub?.();
    void connection?.close();
    connection = null;
    started = false;
  };
}
