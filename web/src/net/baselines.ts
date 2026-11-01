/**
 * Durable sync bookkeeping (port of ConfigRouteSyncBaselineStore.kt + new delete tombstones).
 *
 * - Baseline  = last common version of a route: robot revision + fingerprint of the local content.
 * - Tombstone = "the user deleted this route locally"; stores the robot revision that was current
 *   at deletion time so the sync can tell "robot unchanged since" from "robot changed since".
 *
 * Both are advisory local state; robot-side If-Match revision preconditions remain the
 * authoritative protection against stale overwrites.
 */
import type { KV } from '../storage/kv';
import { escapeKeyPart } from './url';

export interface RouteSyncBaseline {
  routeName: string;
  /** `fingerprint(canonicalRoute(nodes))` of the local content at the last common point. */
  localFingerprint: string;
  remoteRevision: number;
}

export interface BaselineStore {
  get(robotKey: string, routeName: string): RouteSyncBaseline | null;
  put(robotKey: string, baseline: RouteSyncBaseline): void;
  remove(robotKey: string, routeName: string): void;
  clearRobot(robotKey: string): void;
}

export interface TombstoneStore {
  /** Robot revision recorded when the route was deleted locally, or `null` if no tombstone. */
  get(robotKey: string, routeName: string): number | null;
  put(robotKey: string, routeName: string, remoteRevision: number): void;
  remove(robotKey: string, routeName: string): void;
  /** Route names that have a tombstone for this robot. */
  list(robotKey: string): string[];
  clearRobot(robotKey: string): void;
}

export const BASELINE_KEY_PREFIX = 'v2_sync_baseline:';
export const TOMBSTONE_KEY_PREFIX = 'az.tombstone:';

const robotPrefix = (prefix: string, robotKey: string): string => `${prefix}${escapeKeyPart(robotKey)}:`;
const fullKey = (prefix: string, robotKey: string, routeName: string): string =>
  robotPrefix(prefix, robotKey) + escapeKeyPart(routeName);

function decodeKeyPart(part: string): string | null {
  try {
    return decodeURIComponent(part);
  } catch {
    return null;
  }
}

// ---- baselines ----------------------------------------------------------------------------------

/** Value format `"<revision>\n<fingerprint>"`, identical to the Kotlin store. */
export class KvBaselineStore implements BaselineStore {
  constructor(private readonly kv: KV) {}

  get(robotKey: string, routeName: string): RouteSyncBaseline | null {
    const raw = this.kv.get(fullKey(BASELINE_KEY_PREFIX, robotKey, routeName));
    if (raw === null) return null;
    const split = raw.indexOf('\n');
    if (split <= 0) return null;
    const revText = raw.slice(0, split);
    if (!/^\d+$/.test(revText)) return null;
    const localFingerprint = raw.slice(split + 1);
    if (localFingerprint === '') return null;
    return { routeName, localFingerprint, remoteRevision: Number(revText) };
  }

  put(robotKey: string, baseline: RouteSyncBaseline): void {
    this.kv.set(
      fullKey(BASELINE_KEY_PREFIX, robotKey, baseline.routeName),
      `${baseline.remoteRevision}\n${baseline.localFingerprint}`,
    );
  }

  remove(robotKey: string, routeName: string): void {
    this.kv.remove(fullKey(BASELINE_KEY_PREFIX, robotKey, routeName));
  }

  clearRobot(robotKey: string): void {
    const prefix = robotPrefix(BASELINE_KEY_PREFIX, robotKey);
    for (const k of this.kv.keys()) if (k.startsWith(prefix)) this.kv.remove(k);
  }
}

export class InMemoryBaselineStore implements BaselineStore {
  private readonly values = new Map<string, RouteSyncBaseline>();

  get(robotKey: string, routeName: string): RouteSyncBaseline | null {
    const v = this.values.get(fullKey(BASELINE_KEY_PREFIX, robotKey, routeName));
    return v ? { ...v } : null;
  }
  put(robotKey: string, baseline: RouteSyncBaseline): void {
    this.values.set(fullKey(BASELINE_KEY_PREFIX, robotKey, baseline.routeName), { ...baseline });
  }
  remove(robotKey: string, routeName: string): void {
    this.values.delete(fullKey(BASELINE_KEY_PREFIX, robotKey, routeName));
  }
  clearRobot(robotKey: string): void {
    const prefix = robotPrefix(BASELINE_KEY_PREFIX, robotKey);
    for (const k of [...this.values.keys()]) if (k.startsWith(prefix)) this.values.delete(k);
  }
}

// ---- tombstones ---------------------------------------------------------------------------------

/** Key `az.tombstone:<robotKey>:<route>` (both parts key-escaped); value = remote revision. */
export class KvTombstoneStore implements TombstoneStore {
  constructor(private readonly kv: KV) {}

  get(robotKey: string, routeName: string): number | null {
    const raw = this.kv.get(fullKey(TOMBSTONE_KEY_PREFIX, robotKey, routeName));
    if (raw === null || !/^\d+$/.test(raw.trim())) return null;
    return Number(raw.trim());
  }
  put(robotKey: string, routeName: string, remoteRevision: number): void {
    this.kv.set(fullKey(TOMBSTONE_KEY_PREFIX, robotKey, routeName), String(remoteRevision));
  }
  remove(robotKey: string, routeName: string): void {
    this.kv.remove(fullKey(TOMBSTONE_KEY_PREFIX, robotKey, routeName));
  }
  list(robotKey: string): string[] {
    const prefix = robotPrefix(TOMBSTONE_KEY_PREFIX, robotKey);
    const out: string[] = [];
    for (const k of this.kv.keys()) {
      if (!k.startsWith(prefix)) continue;
      const name = decodeKeyPart(k.slice(prefix.length));
      if (name !== null) out.push(name);
    }
    return out;
  }
  clearRobot(robotKey: string): void {
    const prefix = robotPrefix(TOMBSTONE_KEY_PREFIX, robotKey);
    for (const k of this.kv.keys()) if (k.startsWith(prefix)) this.kv.remove(k);
  }
}

export class InMemoryTombstoneStore implements TombstoneStore {
  private readonly values = new Map<string, number>();

  get(robotKey: string, routeName: string): number | null {
    return this.values.get(fullKey(TOMBSTONE_KEY_PREFIX, robotKey, routeName)) ?? null;
  }
  put(robotKey: string, routeName: string, remoteRevision: number): void {
    this.values.set(fullKey(TOMBSTONE_KEY_PREFIX, robotKey, routeName), remoteRevision);
  }
  remove(robotKey: string, routeName: string): void {
    this.values.delete(fullKey(TOMBSTONE_KEY_PREFIX, robotKey, routeName));
  }
  list(robotKey: string): string[] {
    const prefix = robotPrefix(TOMBSTONE_KEY_PREFIX, robotKey);
    const out: string[] = [];
    for (const k of this.values.keys()) {
      if (!k.startsWith(prefix)) continue;
      const name = decodeKeyPart(k.slice(prefix.length));
      if (name !== null) out.push(name);
    }
    return out;
  }
  clearRobot(robotKey: string): void {
    const prefix = robotPrefix(TOMBSTONE_KEY_PREFIX, robotKey);
    for (const k of [...this.values.keys()]) if (k.startsWith(prefix)) this.values.delete(k);
  }
}
