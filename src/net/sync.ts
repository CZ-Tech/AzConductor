/**
 * Route synchroniser (port of RouteSyncEngine.kt / SyncManager.kt) — UI-free.
 *
 * Model: per route we remember a *baseline* (robot revision + fingerprint of the local content at
 * the last common point). Comparing local content against the baseline fingerprint detects local
 * edits; comparing the manifest revision against the baseline revision detects robot edits.
 * Route bodies are ALWAYS compared as parsed structure (`canonicalRoute`), never as raw text.
 *
 * Differences from the Kotlin version:
 *  - delete tombstones (see {@link TombstoneStore}): a local deletion is propagated to the robot
 *    if the robot copy is unchanged since, otherwise reported as LOCAL_DELETED_REMOTE_CHANGED;
 *  - equal content on both sides converges silently instead of raising a conflict;
 *  - if the robot body cannot be fetched/decoded, the route is reported as a failure (never a
 *    "remote missing" conflict whose resolution would delete the local copy).
 */
import { signal } from '@preact/signals';
import type { ControlNode } from '../core/node';
import type { RouteData } from '../core/archive';
import { canonicalRoute, decodeRobotRoute, fingerprint } from '../core/wire';
import type { DocStore } from '../state/docStore';
import type { BaselineStore, TombstoneStore } from './baselines';
import type { RobotRoutePayload, RouteManifest, RouteManifestEntry, RouteWriteResponse } from './models';
import { describeApiError, isHttpError, type ApiError, type Result } from './transport';

// =============================================================================================
// Abstractions
// =============================================================================================

/** Robot side. `RobotApiClient` satisfies it via {@link robotSyncApi} (only `putRoute` differs). */
export interface SyncApi {
  listRoutes(): Promise<Result<RouteManifest>>;
  getRoute(name: string): Promise<Result<RobotRoutePayload>>;
  /** Create (`expectedRevision` 0) or replace a route; sent with `If-Match: <expectedRevision>`. */
  putRoute(name: string, nodes: readonly ControlNode[], expectedRevision: number): Promise<Result<RouteWriteResponse>>;
  deleteRoute(name: string, expectedRevision: number): Promise<Result<void>>;
}

/** The members of `RobotApiClient` the adapter needs (kept structural so tests can fake it). */
export interface RobotRouteClient {
  listRoutes(): Promise<Result<RouteManifest>>;
  getRoute(name: string): Promise<Result<RobotRoutePayload>>;
  putRouteNodes(name: string, nodes: readonly ControlNode[], expectedRevision: number): Promise<Result<RouteWriteResponse>>;
  deleteRoute(name: string, expectedRevision: number): Promise<Result<void>>;
}

export function robotSyncApi(client: RobotRouteClient): SyncApi {
  return {
    listRoutes: () => client.listRoutes(),
    getRoute: (name) => client.getRoute(name),
    putRoute: (name, nodes, rev) => client.putRouteNodes(name, nodes, rev),
    deleteRoute: (name, rev) => client.deleteRoute(name, rev),
  };
}

export interface LocalRouteEntry {
  name: string;
  points: ControlNode[];
}

/** Local side. Writes must NOT be reported as user edits (no `onLocalChange` feedback loop). */
export interface LocalRoutes {
  list(): LocalRouteEntry[];
  get(name: string): ControlNode[] | undefined;
  /** Create or replace. */
  set(name: string, points: ControlNode[]): void;
  delete(name: string): void;
}

/** {@link LocalRoutes} over the app's `DocStore` (silent, undoable writes). */
export function docStoreLocalRoutes(store: DocStore): LocalRoutes {
  return {
    list: () => store.routes.value.map((r) => ({ name: r.name, points: r.points })),
    get: (name) => store.getRoute(name)?.points,
    set(name, points) {
      const cur = store.routes.value;
      const next: RouteData[] = cur.some((r) => r.name === name)
        ? cur.map((r) => (r.name === name ? { name, points } : r))
        : [...cur, { name, points }];
      store.replaceRoutes(next, { silent: true });
    },
    delete(name) {
      store.replaceRoutes(store.routes.value.filter((r) => r.name !== name), { silent: true });
    },
  };
}

/** In-memory {@link LocalRoutes} (tests / headless use). */
export class MemoryLocalRoutes implements LocalRoutes {
  private readonly routes = new Map<string, ControlNode[]>();
  constructor(initial: Record<string, ControlNode[]> = {}) {
    for (const [k, v] of Object.entries(initial)) this.routes.set(k, v);
  }
  list(): LocalRouteEntry[] { return [...this.routes].map(([name, points]) => ({ name, points })); }
  get(name: string): ControlNode[] | undefined { return this.routes.get(name); }
  set(name: string, points: ControlNode[]): void { this.routes.set(name, points); }
  delete(name: string): void { this.routes.delete(name); }
}

// =============================================================================================
// Types
// =============================================================================================

export type ConflictReason =
  /** No common baseline exists and local/remote bodies differ. */
  | 'FIRST_SYNC_DIFFERENT'
  /** Both sides changed since the last common baseline. */
  | 'BOTH_CHANGED'
  /** Deleted locally, but the robot copy changed since the deletion was recorded. */
  | 'LOCAL_DELETED_REMOTE_CHANGED';

export type Resolution = 'keepLocal' | 'keepRemote' | 'keepBoth';

export interface SyncConflict {
  /** Unique per route (equals `routeName`). */
  id: string;
  routeName: string;
  reason: ConflictReason;
  /** Local body at detection time; `null` when deleted locally. */
  local: ControlNode[] | null;
  /** Robot body at detection time; `null` only if it could not be established. */
  remote: ControlNode[] | null;
  remoteRevision: number | null;
}

export interface SyncReport {
  pushed: string[];
  pulled: string[];
  /** Routes deleted on the robot because they were deleted locally. */
  deletedRemote: string[];
  conflicts: SyncConflict[];
  failures: string[];
  /** The robot manifest could not be fetched; nothing was synchronised. */
  aborted: boolean;
}

export type ResolveResult =
  | { ok: true; renamedTo?: string }
  | { ok: false; message: string };

export interface SyncEngineOptions {
  robotKey: string;
  api: SyncApi;
  local: LocalRoutes;
  baselines: BaselineStore;
  tombstones: TombstoneStore;
}

const emptyReport = (): SyncReport => ({
  pushed: [], pulled: [], deletedRemote: [], conflicts: [], failures: [], aborted: false,
});

type Fetched =
  | { ok: true; nodes: ControlNode[]; canon: string; revision: number }
  | { ok: false; message: string };

const errMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// =============================================================================================
// Engine
// =============================================================================================

export class SyncEngine {
  constructor(private readonly o: SyncEngineOptions) {}

  get robotKey(): string { return this.o.robotKey; }

  /**
   * Record that the user deleted `name` locally (call from `DocStore.onRouteDeleted`). Uses the
   * baseline's robot revision; with no baseline the route was never in sync, so no tombstone is
   * written (a robot copy, if any, simply comes back on the next sync). Returns whether written.
   */
  recordLocalDelete(name: string): boolean {
    const b = this.o.baselines.get(this.o.robotKey, name);
    if (!b) return false;
    this.o.tombstones.put(this.o.robotKey, name, b.remoteRevision);
    return true;
  }

  async syncOnce(): Promise<SyncReport> {
    const { api, local, robotKey, tombstones } = this.o;
    const rep = emptyReport();

    const manifest = await this.guard(() => api.listRoutes());
    if (!manifest.ok) {
      rep.aborted = true;
      rep.failures.push(`Failed to fetch robot route manifest: ${manifest.message}`);
      return rep;
    }

    const remoteByName = new Map<string, RouteManifestEntry>(manifest.value.routes.map((r) => [r.name, r]));
    const localByName = new Map<string, LocalRouteEntry>(local.list().map((r) => [r.name, r]));
    const names = [...new Set([...remoteByName.keys(), ...localByName.keys(), ...tombstones.list(robotKey)])].sort();

    for (const name of names) {
      try {
        await this.syncName(name, localByName.get(name), remoteByName.get(name), rep);
      } catch (e) {
        rep.failures.push(`Failed to sync '${name}': ${errMessage(e)}`);
      }
    }
    return rep;
  }

  private async syncName(
    name: string,
    entry: LocalRouteEntry | undefined,
    meta: RouteManifestEntry | undefined,
    rep: SyncReport,
  ): Promise<void> {
    const { api, local, robotKey, baselines, tombstones } = this.o;
    let tomb = tombstones.get(robotKey, name);

    if (entry) {
      // The route exists locally (again): any earlier local deletion is void.
      if (tomb !== null) { tombstones.remove(robotKey, name); tomb = null; }

      const localCanon = canonicalRoute(entry.points);

      if (!meta) {
        // Absence on the robot is not a deletion; create it.
        const put = await this.guard(() => api.putRoute(name, entry.points, 0));
        if (put.ok) {
          rep.pushed.push(name);
          this.remember(name, localCanon, put.value.revision);
        } else {
          rep.failures.push(`Failed to create remote route '${name}': ${put.message}`);
        }
        return;
      }

      const baseline = baselines.get(robotKey, name);
      if (!baseline) {
        const remote = await this.fetchRemote(name);
        if (!remote.ok) {
          rep.failures.push(`Failed to establish initial baseline for '${name}': ${remote.message}`);
        } else if (remote.canon === localCanon) {
          this.remember(name, localCanon, remote.revision);
        } else {
          rep.conflicts.push(this.conflict(name, 'FIRST_SYNC_DIFFERENT', entry.points, remote.nodes, remote.revision));
        }
        return;
      }

      const localChanged = fingerprint(localCanon) !== baseline.localFingerprint;
      const remoteChanged = meta.revision !== baseline.remoteRevision;

      if (!localChanged && !remoteChanged) return;

      if (localChanged && !remoteChanged) {
        const put = await this.guard(() => api.putRoute(name, entry.points, meta.revision));
        if (put.ok) {
          rep.pushed.push(name);
          this.remember(name, localCanon, put.value.revision);
        } else if (isHttpError(put.error, 412)) {
          // Lost a race with a robot-side edit: report instead of overwriting.
          const remote = await this.fetchRemote(name);
          if (remote.ok) {
            rep.conflicts.push(this.conflict(name, 'BOTH_CHANGED', entry.points, remote.nodes, remote.revision));
          } else {
            rep.failures.push(`Failed to push '${name}' (revision changed): ${remote.message}`);
          }
        } else {
          rep.failures.push(`Failed to push '${name}': ${put.message}`);
        }
        return;
      }

      // The robot changed (and maybe we did too): look at the actual body.
      const remote = await this.fetchRemote(name);
      if (!remote.ok) {
        rep.failures.push(`Failed to pull changed route '${name}': ${remote.message}`);
        return;
      }
      if (remote.canon === localCanon) {
        this.remember(name, localCanon, remote.revision); // converged
      } else if (!localChanged) {
        local.set(name, remote.nodes);
        rep.pulled.push(name);
        this.remember(name, remote.canon, remote.revision);
      } else {
        rep.conflicts.push(this.conflict(name, 'BOTH_CHANGED', entry.points, remote.nodes, remote.revision));
      }
      return;
    }

    // ---- no local copy ----------------------------------------------------------------------
    if (!meta) {
      // Gone on both sides: a leftover tombstone has nothing left to delete.
      if (tomb !== null) tombstones.remove(robotKey, name);
      return;
    }

    if (tomb === null) {
      // No tombstone: this is just a robot-only route. Pull it.
      const remote = await this.fetchRemote(name);
      if (!remote.ok) {
        rep.failures.push(`Failed to pull new remote route '${name}': ${remote.message}`);
        return;
      }
      local.set(name, remote.nodes);
      rep.pulled.push(name);
      this.remember(name, remote.canon, remote.revision);
      return;
    }

    // Tombstone present.
    const tombRevision: number = tomb;
    if (meta.revision === tombRevision) {
      const del = await this.guard(() => api.deleteRoute(name, tombRevision));
      if (del.ok || (!del.ok && isHttpError(del.error, 404))) {
        rep.deletedRemote.push(name);
        tombstones.remove(robotKey, name);
        baselines.remove(robotKey, name);
        return;
      }
      if (!del.ok && !isHttpError(del.error, 412)) {
        rep.failures.push(`Failed to delete remote route '${name}': ${del.message}`);
        return;
      }
      // 412: the robot changed in the meantime — fall through to the conflict path.
    }
    const remote = await this.fetchRemote(name);
    if (!remote.ok) {
      rep.failures.push(`Failed to inspect remote route '${name}': ${remote.message}`);
      return;
    }
    rep.conflicts.push(this.conflict(name, 'LOCAL_DELETED_REMOTE_CHANGED', null, remote.nodes, remote.revision));
  }

  // ---- resolution -----------------------------------------------------------------------------

  async resolve(conflict: SyncConflict, resolution: Resolution): Promise<ResolveResult> {
    try {
      switch (resolution) {
        case 'keepLocal': return await this.keepLocal(conflict);
        case 'keepRemote': return this.keepRemote(conflict);
        case 'keepBoth': return await this.keepBoth(conflict);
      }
    } catch (e) {
      return { ok: false, message: errMessage(e) };
    }
  }

  private async keepLocal(c: SyncConflict): Promise<ResolveResult> {
    const { api, robotKey, baselines, tombstones } = this.o;
    if (c.local === null) {
      // Deleted locally: delete the robot copy, guarded by the revision the user saw.
      if (c.remoteRevision !== null) {
        const del = await this.guard(() => api.deleteRoute(c.routeName, c.remoteRevision as number));
        if (!del.ok && !isHttpError(del.error, 404)) {
          return { ok: false, message: `Failed to delete remote route '${c.routeName}': ${del.message}` };
        }
      }
      tombstones.remove(robotKey, c.routeName);
      baselines.remove(robotKey, c.routeName);
      return { ok: true };
    }
    const put = await this.guard(() => api.putRoute(c.routeName, c.local as ControlNode[], c.remoteRevision ?? 0));
    if (!put.ok) return { ok: false, message: `Failed to push '${c.routeName}': ${put.message}` };
    tombstones.remove(robotKey, c.routeName);
    this.remember(c.routeName, canonicalRoute(c.local), put.value.revision);
    return { ok: true };
  }

  private keepRemote(c: SyncConflict): ResolveResult {
    const { local, robotKey, baselines, tombstones } = this.o;
    tombstones.remove(robotKey, c.routeName);
    if (c.remote === null || c.remoteRevision === null) {
      local.delete(c.routeName);
      baselines.remove(robotKey, c.routeName);
      return { ok: true };
    }
    local.set(c.routeName, c.remote);
    this.remember(c.routeName, canonicalRoute(c.remote), c.remoteRevision);
    return { ok: true };
  }

  private async keepBoth(c: SyncConflict): Promise<ResolveResult> {
    if (c.local === null) return this.keepRemote(c);
    if (c.remote === null) return this.keepLocal(c);
    // Move the local version to a fresh name, then take the robot version under the original
    // name. The renamed copy is created on the robot by the next sync.
    const taken = new Set(this.o.local.list().map((r) => r.name));
    let renamed = `${c.routeName}(电脑端)`;
    for (let i = 2; taken.has(renamed); i++) renamed = `${c.routeName}(电脑端${i})`;
    this.o.local.set(renamed, c.local);
    const r = this.keepRemote(c);
    return r.ok ? { ok: true, renamedTo: renamed } : r;
  }

  /** Overwrite the local copy with the robot's current body (explicit user "download"). */
  async pullRemote(name: string): Promise<ResolveResult> {
    const remote = await this.fetchRemote(name);
    if (!remote.ok) return { ok: false, message: `Failed to pull '${name}': ${remote.message}` };
    this.o.local.set(name, remote.nodes);
    this.o.tombstones.remove(this.o.robotKey, name);
    this.remember(name, remote.canon, remote.revision);
    return { ok: true };
  }

  // ---- helpers --------------------------------------------------------------------------------

  private conflict(
    routeName: string,
    reason: ConflictReason,
    local: ControlNode[] | null,
    remote: ControlNode[] | null,
    remoteRevision: number | null,
  ): SyncConflict {
    return { id: routeName, routeName, reason, local, remote, remoteRevision };
  }

  private remember(name: string, canon: string, remoteRevision: number): void {
    this.o.baselines.put(this.o.robotKey, { routeName: name, localFingerprint: fingerprint(canon), remoteRevision });
  }

  private async fetchRemote(name: string): Promise<Fetched> {
    const r = await this.guard(() => this.o.api.getRoute(name));
    if (!r.ok) return r;
    try {
      const nodes = decodeRobotRoute(JSON.parse(r.value.json));
      return { ok: true, nodes, canon: canonicalRoute(nodes), revision: r.value.revision };
    } catch (e) {
      return { ok: false, message: `Invalid route body: ${errMessage(e)}` };
    }
  }

  /** Run an API call; flatten the Result error to a message and turn throws into failures. */
  private async guard<T>(call: () => Promise<Result<T>>): Promise<
    | { ok: true; value: T; status: number }
    | { ok: false; message: string; error: ApiError }
  > {
    try {
      const r = await call();
      return r.ok ? r : { ok: false, message: describeApiError(r.error), error: r.error };
    } catch (e) {
      return { ok: false, message: errMessage(e), error: { kind: 'unreachable', message: errMessage(e), mixedContentSuspected: false } };
    }
  }
}

// =============================================================================================
// Controller
// =============================================================================================

export type SyncStatus = 'idle' | 'syncing' | 'conflict' | 'error';

export interface SyncTarget {
  /** Normalised robot base URL (`normalizeRobotUrl`) — keys baselines and tombstones. */
  robotKey: string;
  api: SyncApi;
}

export interface SyncControllerOptions {
  local: LocalRoutes;
  baselines: BaselineStore;
  tombstones: TombstoneStore;
  target?: SyncTarget | null;
}

/**
 * Orchestrates {@link SyncEngine}: serialises every operation through one promise chain, exposes
 * reactive state, and offers trigger entry points. Debouncing/scheduling is the caller's job.
 */
export class SyncController {
  readonly status = signal<SyncStatus>('idle');
  readonly conflicts = signal<SyncConflict[]>([]);
  readonly lastResult = signal<SyncReport | null>(null);

  private engine: SyncEngine | null = null;
  private tail: Promise<unknown> = Promise.resolve();
  private queuedSync: Promise<SyncReport | null> | null = null;

  constructor(private readonly opts: SyncControllerOptions) {
    if (opts.target) this.setTarget(opts.target);
  }

  /** Point at another robot (or `null` when disconnected). Resets conflicts and results. */
  setTarget(target: SyncTarget | null): void {
    this.engine = target
      ? new SyncEngine({
          robotKey: target.robotKey,
          api: target.api,
          local: this.opts.local,
          baselines: this.opts.baselines,
          tombstones: this.opts.tombstones,
        })
      : null;
    this.conflicts.value = [];
    this.lastResult.value = null;
    this.status.value = 'idle';
  }

  get hasTarget(): boolean { return this.engine !== null; }

  // ---- triggers -------------------------------------------------------------------------------

  onConnected(): void { void this.syncNow(); }
  onDisconnected(): void { this.setTarget(null); }
  onRoutesEvent(revision: number): void { if (revision > 0) void this.syncNow(); }
  onLocalChange(): void { void this.syncNow(); }

  /** Route deleted locally: record the tombstone, then sync. */
  onLocalDelete(name: string): void {
    // Synchronous on purpose: an in-flight pass must see the tombstone before it can re-pull.
    this.engine?.recordLocalDelete(name);
    void this.syncNow();
  }

  // ---- operations -----------------------------------------------------------------------------

  /** Run a full sync pass. Concurrent calls made before a queued pass starts share it. */
  syncNow(): Promise<SyncReport | null> {
    if (this.queuedSync) return this.queuedSync;
    const p = this.enqueue(async () => {
      this.queuedSync = null;
      return this.runSync();
    });
    this.queuedSync = p;
    return p;
  }

  resolve(conflictId: string, resolution: Resolution): Promise<ResolveResult> {
    return this.enqueue(async (): Promise<ResolveResult> => {
      const engine = this.engine;
      const conflict = this.conflicts.value.find((c) => c.id === conflictId);
      if (!engine || !conflict) return { ok: false, message: 'Unknown conflict' };
      const result = await engine.resolve(conflict, resolution);
      if (result.ok) {
        this.conflicts.value = this.conflicts.value.filter((c) => c.id !== conflictId);
        this.refreshStatus();
        // keepBoth leaves a renamed local-only route that still has to reach the robot.
        if (resolution === 'keepBoth' && result.renamedTo !== undefined) await this.runSync();
      } else {
        await this.runSync(); // stale revision etc.: re-derive the conflict list
      }
      return result;
    });
  }

  /** Download one robot route over the local copy (explicit user action). */
  pullRemoteOnly(name: string): Promise<ResolveResult> {
    return this.enqueue(async (): Promise<ResolveResult> => {
      const engine = this.engine;
      if (!engine) return { ok: false, message: 'Not connected' };
      const result = await engine.pullRemote(name);
      if (result.ok) {
        this.conflicts.value = this.conflicts.value.filter((c) => c.routeName !== name);
        this.refreshStatus();
      }
      return result;
    });
  }

  // ---- internals ------------------------------------------------------------------------------

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.tail.then(fn);
    this.tail = p.catch(() => undefined);
    return p;
  }

  private refreshStatus(): void {
    const last = this.lastResult.value;
    this.status.value =
      last?.aborted ? 'error'
      : this.conflicts.value.length > 0 ? 'conflict'
      : last && last.failures.length > 0 ? 'error'
      : 'idle';
  }

  private async runSync(): Promise<SyncReport | null> {
    const engine = this.engine;
    if (!engine) return null;
    this.status.value = 'syncing';
    let report: SyncReport;
    try {
      report = await engine.syncOnce();
    } catch (e) {
      report = { ...emptyReport(), aborted: true, failures: [errMessage(e)] };
    }
    if (this.engine !== engine) return report; // target changed meanwhile: discard
    if (!report.aborted) this.conflicts.value = report.conflicts;
    this.lastResult.value = report;
    this.refreshStatus();
    return report;
  }
}
