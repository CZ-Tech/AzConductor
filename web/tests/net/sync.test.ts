import { describe, expect, it } from 'vitest';
import type { ControlNode } from '../../src/core/node';
import { canonicalRoute, decodeRobotRoute, encodeRobotRoute, fingerprint } from '../../src/core/wire';
import { MemoryKV } from '../../src/storage/kv';
import { DocStore } from '../../src/state/docStore';
import {
  InMemoryBaselineStore,
  InMemoryTombstoneStore,
  KvBaselineStore,
  KvTombstoneStore,
} from '../../src/net/baselines';
import type { RobotRoutePayload, RouteManifest, RouteWriteResponse } from '../../src/net/models';
import {
  SyncController,
  SyncEngine,
  MemoryLocalRoutes,
  docStoreLocalRoutes,
  type SyncApi,
} from '../../src/net/sync';
import { err, ok, type ApiError, type Result } from '../../src/net/transport';
import { escapeKeyPart } from '../../src/net/url';
import { pt } from '../core/_util';

const ROBOT_KEY = 'http://192.168.43.1:8888';
const J1 = [pt(1)];
const J2 = [pt(2)];
const J3 = [pt(3)];

const canon = (nodes: readonly ControlNode[] | null | undefined): string | null =>
  nodes ? canonicalRoute(nodes) : null;

// ---------------------------------------------------------------------------------------------
// Fake robot with real If-Match / revision semantics
// ---------------------------------------------------------------------------------------------

interface Stored { body: string; revision: number }
interface RequestLog { method: string; name: string; ifMatch?: string }

const httpErr = (status: number, code: string, extra: Partial<ApiError> = {}): Result<never> =>
  err({ kind: 'http', status, code, message: code, body: '', ...extra } as ApiError);

class FakeRobot implements SyncApi {
  readonly routes = new Map<string, Stored>();
  readonly requests: RequestLog[] = [];
  beforeNextPut: (() => void) | null = null;
  beforeNextDelete: (() => void) | null = null;
  listFails = false;
  inflight = 0;
  maxInflight = 0;
  listCalls = 0;
  private changeRevision = 0;

  seed(name: string, nodes: readonly ControlNode[], revision: number): void {
    this.routes.set(name, { body: JSON.stringify(encodeRobotRoute(nodes)), revision });
  }
  seedRaw(name: string, body: string, revision: number): void {
    this.routes.set(name, { body, revision });
  }
  /** A robot-side edit: new body, revision + 1. */
  mutate(name: string, nodes: readonly ControlNode[]): void {
    const cur = this.routes.get(name);
    this.routes.set(name, { body: JSON.stringify(encodeRobotRoute(nodes)), revision: (cur?.revision ?? 0) + 1 });
  }
  removeRemote(name: string): void { this.routes.delete(name); }
  body(name: string): string | null {
    const s = this.routes.get(name);
    return s ? canonicalRoute(decodeRobotRoute(JSON.parse(s.body))) : null;
  }
  revision(name: string): number | undefined { return this.routes.get(name)?.revision; }

  async listRoutes(): Promise<Result<RouteManifest>> {
    this.listCalls++;
    this.inflight++;
    this.maxInflight = Math.max(this.maxInflight, this.inflight);
    try {
      await Promise.resolve();
      await Promise.resolve();
      if (this.listFails) return err({ kind: 'unreachable', message: 'down', mixedContentSuspected: false });
      return ok({
        routes: [...this.routes].map(([name, s]) => ({ name, revision: s.revision })),
        changeRevision: this.changeRevision,
      });
    } finally {
      this.inflight--;
    }
  }

  async getRoute(name: string): Promise<Result<RobotRoutePayload>> {
    const s = this.routes.get(name);
    if (!s) return httpErr(404, 'route_not_found');
    return ok({ name, revision: s.revision, json: s.body });
  }

  async putRoute(name: string, nodes: readonly ControlNode[], expectedRevision: number): Promise<Result<RouteWriteResponse>> {
    const hook = this.beforeNextPut;
    this.beforeNextPut = null;
    hook?.();
    this.requests.push({ method: 'PUT', name, ifMatch: String(expectedRevision) });
    const actual = this.routes.get(name)?.revision ?? 0;
    if (actual !== expectedRevision) return httpErr(412, 'revision_mismatch', { actual });
    const revision = actual + 1;
    this.routes.set(name, { body: JSON.stringify(encodeRobotRoute(nodes)), revision });
    this.changeRevision++;
    return ok({ name, revision });
  }

  async deleteRoute(name: string, expectedRevision: number): Promise<Result<void>> {
    const hook = this.beforeNextDelete;
    this.beforeNextDelete = null;
    hook?.();
    this.requests.push({ method: 'DELETE', name, ifMatch: String(expectedRevision) });
    const s = this.routes.get(name);
    if (!s) return httpErr(404, 'route_not_found');
    if (s.revision !== expectedRevision) return httpErr(412, 'revision_mismatch', { actual: s.revision });
    this.routes.delete(name);
    this.changeRevision++;
    return ok(undefined, 204);
  }
}

function fixture(localRoutes: Record<string, ControlNode[]> = {}) {
  const server = new FakeRobot();
  const local = new MemoryLocalRoutes(localRoutes);
  const baselines = new InMemoryBaselineStore();
  const tombstones = new InMemoryTombstoneStore();
  const engine = new SyncEngine({ robotKey: ROBOT_KEY, api: server, local, baselines, tombstones });
  const controller = () => new SyncController({ local, baselines, tombstones, target: { robotKey: ROBOT_KEY, api: server } });
  return { server, local, baselines, tombstones, engine, controller };
}

/** Local user deletion exactly as the app does it: remove from the store + record the tombstone. */
function deleteLocally(f: ReturnType<typeof fixture>, name: string): void {
  f.local.delete(name);
  f.engine.recordLocalDelete(name);
}

// ---------------------------------------------------------------------------------------------
// Port of RouteSyncEngineTest
// ---------------------------------------------------------------------------------------------

describe('SyncEngine (port of RouteSyncEngineTest)', () => {
  it('local-only route is created on robot and baseline is recorded', async () => {
    const f = fixture({ Auto: J1 });
    const report = await f.engine.syncOnce();
    expect(report.pushed).toEqual(['Auto']);
    expect(report.conflicts).toEqual([]);
    expect(f.server.body('Auto')).toBe(canon(J1));
    expect(f.server.revision('Auto')).toBe(1);
    expect(f.server.requests.at(-1)).toMatchObject({ method: 'PUT', ifMatch: '0' });
    expect(f.baselines.get(ROBOT_KEY, 'Auto')).not.toBeNull();
  });

  it('remote-only route is pulled locally', async () => {
    const f = fixture();
    f.server.seed('Auto', J1, 3);
    const report = await f.engine.syncOnce();
    expect(report.pulled).toEqual(['Auto']);
    expect(canon(f.local.get('Auto'))).toBe(canon(J1));
    expect(f.baselines.get(ROBOT_KEY, 'Auto')?.remoteRevision).toBe(3);
  });

  it('first sync with identical bodies only establishes a baseline', async () => {
    const f = fixture({ Auto: J1 });
    f.server.seed('Auto', J1, 4);
    const report = await f.engine.syncOnce();
    expect(report.pushed).toEqual([]);
    expect(report.pulled).toEqual([]);
    expect(report.conflicts).toEqual([]);
    expect(f.baselines.get(ROBOT_KEY, 'Auto')?.remoteRevision).toBe(4);
  });

  it('first sync with different bodies yields a conflict and overwrites neither side', async () => {
    const f = fixture({ Auto: J1 });
    f.server.seed('Auto', J2, 2);
    const report = await f.engine.syncOnce();
    expect(report.conflicts).toHaveLength(1);
    const c = report.conflicts[0]!;
    expect(c.reason).toBe('FIRST_SYNC_DIFFERENT');
    expect(canon(c.local)).toBe(canon(J1));
    expect(canon(c.remote)).toBe(canon(J2));
    expect(c.remoteRevision).toBe(2);
    expect(canon(f.local.get('Auto'))).toBe(canon(J1));
    expect(f.server.body('Auto')).toBe(canon(J2));
    expect(f.baselines.get(ROBOT_KEY, 'Auto')).toBeNull();
  });

  it('local-only change after baseline pushes with the revision precondition', async () => {
    const f = fixture({ Auto: J1 });
    f.server.seed('Auto', J1, 1);
    await f.engine.syncOnce();
    f.local.set('Auto', J2);
    const report = await f.engine.syncOnce();
    expect(report.pushed).toEqual(['Auto']);
    expect(f.server.body('Auto')).toBe(canon(J2));
    expect(f.server.revision('Auto')).toBe(2);
    expect(f.server.requests.filter((r) => r.method === 'PUT').at(-1)?.ifMatch).toBe('1');
  });

  it('remote-only change after baseline pulls locally', async () => {
    const f = fixture({ Auto: J1 });
    f.server.seed('Auto', J1, 1);
    await f.engine.syncOnce();
    f.server.mutate('Auto', J2);
    const report = await f.engine.syncOnce();
    expect(report.pulled).toEqual(['Auto']);
    expect(canon(f.local.get('Auto'))).toBe(canon(J2));
    expect(f.baselines.get(ROBOT_KEY, 'Auto')?.remoteRevision).toBe(2);
  });

  it('both sides changed after baseline produces a conflict', async () => {
    const f = fixture({ Auto: J1 });
    f.server.seed('Auto', J1, 1);
    await f.engine.syncOnce();
    f.local.set('Auto', J2);
    f.server.mutate('Auto', J3);
    const report = await f.engine.syncOnce();
    expect(report.conflicts).toHaveLength(1);
    const c = report.conflicts[0]!;
    expect(c.reason).toBe('BOTH_CHANGED');
    expect(canon(c.local)).toBe(canon(J2));
    expect(canon(c.remote)).toBe(canon(J3));
    expect(canon(f.local.get('Auto'))).toBe(canon(J2));
    expect(f.server.body('Auto')).toBe(canon(J3));
  });

  it('local absence WITHOUT a tombstone does not imply deletion; the robot copy is pulled', async () => {
    const f = fixture({ Auto: J1 });
    f.server.seed('Auto', J1, 1);
    await f.engine.syncOnce();
    f.local.delete('Auto'); // no tombstone recorded
    const report = await f.engine.syncOnce();
    expect(report.pulled).toEqual(['Auto']);
    expect(report.conflicts).toEqual([]);
    expect(canon(f.local.get('Auto'))).toBe(canon(J1));
    expect(f.server.routes.has('Auto')).toBe(true);
  });

  it('remote absence does not imply deletion; the route is re-created on the robot', async () => {
    const f = fixture({ Auto: J1 });
    f.server.seed('Auto', J1, 1);
    await f.engine.syncOnce();
    f.server.removeRemote('Auto');
    const report = await f.engine.syncOnce();
    expect(report.pushed).toEqual(['Auto']);
    expect(report.conflicts).toEqual([]);
    expect(canon(f.local.get('Auto'))).toBe(canon(J1));
    expect(f.server.body('Auto')).toBe(canon(J1));
  });

  it('local absence (no tombstone) with changed remote pulls the changed copy', async () => {
    const f = fixture({ Auto: J1 });
    f.server.seed('Auto', J1, 1);
    await f.engine.syncOnce();
    f.local.delete('Auto');
    f.server.mutate('Auto', J2);
    const report = await f.engine.syncOnce();
    expect(report.pulled).toEqual(['Auto']);
    expect(report.conflicts).toEqual([]);
    expect(canon(f.local.get('Auto'))).toBe(canon(J2));
    expect(f.server.routes.has('Auto')).toBe(true);
  });

  it('different route names never conflict, even with old baselines', async () => {
    const f = fixture({ 'Local Auto': J1 });
    f.server.seed('Robot Auto', J2, 7);
    f.baselines.put(ROBOT_KEY, { routeName: 'Local Auto', localFingerprint: fingerprint(canonicalRoute(J1)), remoteRevision: 3 });
    f.baselines.put(ROBOT_KEY, { routeName: 'Robot Auto', localFingerprint: fingerprint(canonicalRoute(J3)), remoteRevision: 6 });
    const report = await f.engine.syncOnce();
    expect(report.conflicts).toEqual([]);
    expect(report.pushed).toEqual(['Local Auto']);
    expect(report.pulled).toEqual(['Robot Auto']);
    expect(f.server.body('Local Auto')).toBe(canon(J1));
    expect(canon(f.local.get('Robot Auto'))).toBe(canon(J2));
  });

  it('a revision race during PUT becomes a BOTH_CHANGED conflict instead of an overwrite', async () => {
    const f = fixture({ Auto: J1 });
    f.server.seed('Auto', J1, 1);
    await f.engine.syncOnce();
    f.local.set('Auto', J2);
    f.server.beforeNextPut = () => f.server.mutate('Auto', J3);
    const report = await f.engine.syncOnce();
    expect(report.conflicts).toHaveLength(1);
    const c = report.conflicts[0]!;
    expect(c.reason).toBe('BOTH_CHANGED');
    expect(canon(c.local)).toBe(canon(J2));
    expect(canon(c.remote)).toBe(canon(J3));
    expect(c.remoteRevision).toBe(2);
    expect(f.server.body('Auto')).toBe(canon(J3));
  });

  it('resolve keepLocal uses the conflict revision and updates the baseline', async () => {
    const f = fixture({ Auto: J1 });
    f.server.seed('Auto', J2, 7);
    const c = (await f.engine.syncOnce()).conflicts[0]!;
    const result = await f.engine.resolve(c, 'keepLocal');
    expect(result.ok).toBe(true);
    expect(f.server.body('Auto')).toBe(canon(J1));
    expect(f.server.revision('Auto')).toBe(8);
    expect(f.baselines.get(ROBOT_KEY, 'Auto')?.remoteRevision).toBe(8);
    expect(f.server.requests.at(-1)?.ifMatch).toBe('7');
  });

  it('resolve keepRemote replaces local and updates the baseline', async () => {
    const f = fixture({ Auto: J1 });
    f.server.seed('Auto', J2, 5);
    const c = (await f.engine.syncOnce()).conflicts[0]!;
    const result = await f.engine.resolve(c, 'keepRemote');
    expect(result.ok).toBe(true);
    expect(canon(f.local.get('Auto'))).toBe(canon(J2));
    expect(f.baselines.get(ROBOT_KEY, 'Auto')?.remoteRevision).toBe(5);
    // and the next pass is a no-op
    const next = await f.engine.syncOnce();
    expect([next.pushed, next.pulled, next.conflicts, next.failures]).toEqual([[], [], [], []]);
  });

  it('resolve keepLocal with a stale revision fails and leaves the robot untouched', async () => {
    const f = fixture({ Auto: J1 });
    f.server.seed('Auto', J2, 5);
    const c = (await f.engine.syncOnce()).conflicts[0]!;
    f.server.mutate('Auto', J3); // revision 6
    const result = await f.engine.resolve(c, 'keepLocal');
    expect(result.ok).toBe(false);
    expect(f.server.body('Auto')).toBe(canon(J3));
  });

  it('resolve keepBoth renames the local copy, takes the robot body, and the rename syncs up', async () => {
    const f = fixture({ Auto: J1 });
    f.server.seed('Auto', J2, 2);
    const c = (await f.engine.syncOnce()).conflicts[0]!;
    const result = await f.engine.resolve(c, 'keepBoth');
    expect(result).toEqual({ ok: true, renamedTo: 'Auto(电脑端)' });
    expect(canon(f.local.get('Auto'))).toBe(canon(J2));
    expect(canon(f.local.get('Auto(电脑端)'))).toBe(canon(J1));
    const next = await f.engine.syncOnce();
    expect(next.pushed).toEqual(['Auto(电脑端)']);
    expect(f.server.body('Auto(电脑端)')).toBe(canon(J1));
  });

  it('keepBoth picks a free name when the first candidate is taken', async () => {
    const f = fixture({ Auto: J1, 'Auto(电脑端)': J3 });
    f.server.seed('Auto', J2, 2);
    f.server.seed('Auto(电脑端)', J3, 1);
    f.baselines.put(ROBOT_KEY, { routeName: 'Auto(电脑端)', localFingerprint: fingerprint(canonicalRoute(J3)), remoteRevision: 1 });
    const c = (await f.engine.syncOnce()).conflicts[0]!;
    const result = await f.engine.resolve(c, 'keepBoth');
    expect(result).toEqual({ ok: true, renamedTo: 'Auto(电脑端2)' });
  });

  it('aborts with a failure when the manifest cannot be fetched', async () => {
    const f = fixture({ Auto: J1 });
    f.server.listFails = true;
    const report = await f.engine.syncOnce();
    expect(report.aborted).toBe(true);
    expect(report.failures).toHaveLength(1);
    expect(f.server.routes.size).toBe(0);
  });
});

describe('structural comparison', () => {
  it('differently formatted but equivalent robot bodies are not a conflict', async () => {
    const f = fixture({ Auto: J1 });
    const frames = encodeRobotRoute(J1) as Record<string, unknown>[];
    // pretty-printed, reversed key order
    const reordered = frames.map((fr) => Object.fromEntries(Object.entries(fr).reverse()));
    f.server.seedRaw('Auto', JSON.stringify(reordered, null, 4), 9);
    const report = await f.engine.syncOnce();
    expect(report.conflicts).toEqual([]);
    expect(report.pulled).toEqual([]);
    expect(f.baselines.get(ROBOT_KEY, 'Auto')?.remoteRevision).toBe(9);
  });

  it('a wait frame equals delayAfterArrive on the previous node', async () => {
    const withDelay: ControlNode[] = [{ ...pt(1), delayAfterArrive: 1.5 }];
    const f = fixture({ Auto: withDelay });
    const frames = encodeRobotRoute([pt(1)]) as unknown[];
    f.server.seedRaw('Auto', JSON.stringify([...frames, { wait: 1.5 }]), 2);
    const report = await f.engine.syncOnce();
    expect(report.conflicts).toEqual([]);
    expect(f.baselines.get(ROBOT_KEY, 'Auto')?.remoteRevision).toBe(2);
  });

  it('remote bumped its revision with identical content: converges without pull or conflict', async () => {
    const f = fixture({ Auto: J1 });
    f.server.seed('Auto', J1, 1);
    await f.engine.syncOnce();
    f.server.mutate('Auto', J1); // revision 2, same body
    const report = await f.engine.syncOnce();
    expect(report.pulled).toEqual([]);
    expect(report.conflicts).toEqual([]);
    expect(f.baselines.get(ROBOT_KEY, 'Auto')?.remoteRevision).toBe(2);
  });

  it('an undecodable robot body is a failure, never a destructive conflict', async () => {
    const f = fixture({ Auto: J1 });
    f.server.seedRaw('Auto', 'not json', 2);
    const report = await f.engine.syncOnce();
    expect(report.conflicts).toEqual([]);
    expect(report.failures).toHaveLength(1);
    expect(canon(f.local.get('Auto'))).toBe(canon(J1));
  });
});

// ---------------------------------------------------------------------------------------------
// Tombstones
// ---------------------------------------------------------------------------------------------

describe('delete tombstones', () => {
  async function synced() {
    const f = fixture({ Auto: J1 });
    f.server.seed('Auto', J1, 1);
    await f.engine.syncOnce();
    return f;
  }

  it('recordLocalDelete stores the baseline revision; without a baseline nothing is stored', async () => {
    const f = await synced();
    expect(f.engine.recordLocalDelete('Auto')).toBe(true);
    expect(f.tombstones.get(ROBOT_KEY, 'Auto')).toBe(1);
    expect(f.engine.recordLocalDelete('Never synced')).toBe(false);
    expect(f.tombstones.get(ROBOT_KEY, 'Never synced')).toBeNull();
  });

  it('deleted locally + robot unchanged: robot copy is deleted with If-Match, tombstone cleared, not re-downloaded', async () => {
    const f = await synced();
    deleteLocally(f, 'Auto');
    const report = await f.engine.syncOnce();
    expect(report.deletedRemote).toEqual(['Auto']);
    expect(report.pulled).toEqual([]);
    expect(report.conflicts).toEqual([]);
    expect(f.server.routes.has('Auto')).toBe(false);
    expect(f.local.get('Auto')).toBeUndefined();
    expect(f.server.requests.at(-1)).toEqual({ method: 'DELETE', name: 'Auto', ifMatch: '1' });
    expect(f.tombstones.get(ROBOT_KEY, 'Auto')).toBeNull();
    expect(f.baselines.get(ROBOT_KEY, 'Auto')).toBeNull();
    // stays gone
    const again = await f.engine.syncOnce();
    expect(again.pulled).toEqual([]);
    expect(f.local.list()).toEqual([]);
  });

  it('deleted locally + robot changed since: LOCAL_DELETED_REMOTE_CHANGED, nothing is touched', async () => {
    const f = await synced();
    deleteLocally(f, 'Auto');
    f.server.mutate('Auto', J2);
    const report = await f.engine.syncOnce();
    expect(report.conflicts).toHaveLength(1);
    const c = report.conflicts[0]!;
    expect(c.reason).toBe('LOCAL_DELETED_REMOTE_CHANGED');
    expect(c.local).toBeNull();
    expect(canon(c.remote)).toBe(canon(J2));
    expect(c.remoteRevision).toBe(2);
    expect(f.server.routes.has('Auto')).toBe(true);
    expect(f.local.get('Auto')).toBeUndefined();
    expect(f.tombstones.get(ROBOT_KEY, 'Auto')).toBe(1);
    expect(f.server.requests.some((r) => r.method === 'DELETE')).toBe(false);
  });

  it('conflict resolution keepRemote downloads the route and clears the tombstone', async () => {
    const f = await synced();
    deleteLocally(f, 'Auto');
    f.server.mutate('Auto', J2);
    const c = (await f.engine.syncOnce()).conflicts[0]!;
    expect((await f.engine.resolve(c, 'keepRemote')).ok).toBe(true);
    expect(canon(f.local.get('Auto'))).toBe(canon(J2));
    expect(f.tombstones.get(ROBOT_KEY, 'Auto')).toBeNull();
    expect(f.baselines.get(ROBOT_KEY, 'Auto')?.remoteRevision).toBe(2);
    const next = await f.engine.syncOnce();
    expect([next.pushed, next.pulled, next.deletedRemote, next.conflicts]).toEqual([[], [], [], []]);
  });

  it('keepBoth on a local-deleted conflict behaves like keepRemote', async () => {
    const f = await synced();
    deleteLocally(f, 'Auto');
    f.server.mutate('Auto', J2);
    const c = (await f.engine.syncOnce()).conflicts[0]!;
    expect((await f.engine.resolve(c, 'keepBoth')).ok).toBe(true);
    expect(canon(f.local.get('Auto'))).toBe(canon(J2));
  });

  it('conflict resolution keepLocal deletes the robot copy with If-Match and clears state', async () => {
    const f = await synced();
    deleteLocally(f, 'Auto');
    f.server.mutate('Auto', J2);
    const c = (await f.engine.syncOnce()).conflicts[0]!;
    expect((await f.engine.resolve(c, 'keepLocal')).ok).toBe(true);
    expect(f.server.routes.has('Auto')).toBe(false);
    expect(f.server.requests.at(-1)).toEqual({ method: 'DELETE', name: 'Auto', ifMatch: '2' });
    expect(f.tombstones.get(ROBOT_KEY, 'Auto')).toBeNull();
    expect(f.baselines.get(ROBOT_KEY, 'Auto')).toBeNull();
  });

  it('keepLocal on a local-deleted conflict fails (412) if the robot changed again, keeping the tombstone', async () => {
    const f = await synced();
    deleteLocally(f, 'Auto');
    f.server.mutate('Auto', J2);
    const c = (await f.engine.syncOnce()).conflicts[0]!;
    f.server.mutate('Auto', J3); // revision 3
    const result = await f.engine.resolve(c, 'keepLocal');
    expect(result.ok).toBe(false);
    expect(f.server.routes.has('Auto')).toBe(true);
    expect(f.tombstones.get(ROBOT_KEY, 'Auto')).toBe(1);
  });

  it('a revision race during DELETE becomes a conflict, not a data loss', async () => {
    const f = await synced();
    deleteLocally(f, 'Auto');
    f.server.beforeNextDelete = () => f.server.mutate('Auto', J3);
    const report = await f.engine.syncOnce();
    expect(report.deletedRemote).toEqual([]);
    expect(report.conflicts).toHaveLength(1);
    expect(report.conflicts[0]!.reason).toBe('LOCAL_DELETED_REMOTE_CHANGED');
    expect(canon(report.conflicts[0]!.remote)).toBe(canon(J3));
    expect(f.server.routes.has('Auto')).toBe(true);
  });

  it('re-creating the route locally voids the tombstone and syncs normally', async () => {
    const f = await synced();
    deleteLocally(f, 'Auto');
    f.local.set('Auto', J2); // user makes a new route with the same name
    const report = await f.engine.syncOnce();
    expect(f.tombstones.get(ROBOT_KEY, 'Auto')).toBeNull();
    expect(report.deletedRemote).toEqual([]);
    expect(report.pushed).toEqual(['Auto']);
    expect(f.server.body('Auto')).toBe(canon(J2));
  });

  it('undoing the deletion (route back, unchanged) is a no-op and clears the tombstone', async () => {
    const f = await synced();
    deleteLocally(f, 'Auto');
    f.local.set('Auto', J1);
    const report = await f.engine.syncOnce();
    expect([report.pushed, report.pulled, report.deletedRemote, report.conflicts]).toEqual([[], [], [], []]);
    expect(f.tombstones.get(ROBOT_KEY, 'Auto')).toBeNull();
    expect(f.server.routes.has('Auto')).toBe(true);
  });

  it('stale tombstone with the route gone on both sides is cleaned up', async () => {
    const f = await synced();
    deleteLocally(f, 'Auto');
    f.server.removeRemote('Auto');
    const report = await f.engine.syncOnce();
    expect(report.failures).toEqual([]);
    expect(report.conflicts).toEqual([]);
    expect(f.tombstones.get(ROBOT_KEY, 'Auto')).toBeNull();
  });

  it('robot already deleted the route (404 on DELETE) counts as success', async () => {
    const f = await synced();
    deleteLocally(f, 'Auto');
    f.server.beforeNextDelete = () => f.server.removeRemote('Auto');
    const report = await f.engine.syncOnce();
    expect(report.deletedRemote).toEqual(['Auto']);
    expect(f.tombstones.get(ROBOT_KEY, 'Auto')).toBeNull();
  });

  it('a rename is delete-old (tombstone) + create-new', async () => {
    const f = await synced();
    f.local.delete('Auto');
    f.engine.recordLocalDelete('Auto');
    f.local.set('Auto2', J1);
    const report = await f.engine.syncOnce();
    expect(report.deletedRemote).toEqual(['Auto']);
    expect(report.pushed).toEqual(['Auto2']);
    expect([...f.server.routes.keys()]).toEqual(['Auto2']);
  });
});

// ---------------------------------------------------------------------------------------------
// SyncController
// ---------------------------------------------------------------------------------------------

describe('SyncController', () => {
  it('starts idle, syncs, and publishes lastResult', async () => {
    const f = fixture({ Auto: J1 });
    const c = f.controller();
    expect(c.status.value).toBe('idle');
    expect(c.lastResult.value).toBeNull();
    const report = await c.syncNow();
    expect(report?.pushed).toEqual(['Auto']);
    expect(c.lastResult.value?.pushed).toEqual(['Auto']);
    expect(c.status.value).toBe('idle');
  });

  it('status goes syncing -> idle', async () => {
    const f = fixture({ Auto: J1 });
    const c = f.controller();
    const seen: string[] = [];
    const unsub = c.status.subscribe((s) => seen.push(s));
    await c.syncNow();
    unsub();
    expect(seen).toEqual(['idle', 'syncing', 'idle']);
  });

  it('syncNow without a target resolves to null', async () => {
    const f = fixture();
    const c = new SyncController({ local: f.local, baselines: f.baselines, tombstones: f.tombstones });
    expect(await c.syncNow()).toBeNull();
    expect(c.status.value).toBe('idle');
  });

  it('manifest failure sets status error and keeps previous conflicts', async () => {
    const f = fixture({ Auto: J1 });
    f.server.seed('Auto', J2, 1);
    const c = f.controller();
    await c.syncNow();
    expect(c.status.value).toBe('conflict');
    f.server.listFails = true;
    await c.syncNow();
    expect(c.status.value).toBe('error');
    expect(c.conflicts.value).toHaveLength(1);
    expect(c.lastResult.value?.aborted).toBe(true);
    f.server.listFails = false;
    await c.syncNow();
    expect(c.status.value).toBe('conflict');
  });

  it('never runs two passes concurrently and coalesces queued passes', async () => {
    const f = fixture({ Auto: J1 });
    const c = f.controller();
    const a = c.syncNow();
    const b = c.syncNow();
    const d = c.onLocalChange();
    c.onRoutesEvent(5);
    expect(await a).toBe(await b);
    expect(f.server.listCalls).toBe(1);
    // a trigger arriving while a pass is in flight queues exactly one follow-up
    const e = c.syncNow();
    await Promise.resolve();
    const g = c.syncNow();
    const h = c.syncNow();
    await Promise.all([e, g, h]);
    expect(f.server.maxInflight).toBe(1);
    expect(f.server.listCalls).toBe(3);
    void d;
  });

  it('onRoutesEvent(0) does not trigger a sync', async () => {
    const f = fixture({ Auto: J1 });
    const c = f.controller();
    c.onRoutesEvent(0);
    await c.syncNow();
    expect(f.server.listCalls).toBe(1);
  });

  it('collects conflicts and resolves them one by one', async () => {
    const f = fixture({ A: J1, B: J1 });
    f.server.seed('A', J2, 1);
    f.server.seed('B', J2, 4);
    const c = f.controller();
    await c.syncNow();
    expect(c.status.value).toBe('conflict');
    expect(c.conflicts.value.map((x) => x.id)).toEqual(['A', 'B']);

    expect(await c.resolve('A', 'keepLocal')).toEqual({ ok: true });
    expect(c.conflicts.value.map((x) => x.id)).toEqual(['B']);
    expect(c.status.value).toBe('conflict');
    expect(f.server.body('A')).toBe(canon(J1));

    expect(await c.resolve('B', 'keepRemote')).toEqual({ ok: true });
    expect(c.conflicts.value).toEqual([]);
    expect(c.status.value).toBe('idle');
    expect(canon(f.local.get('B'))).toBe(canon(J2));
  });

  it('resolve of an unknown id fails without side effects', async () => {
    const f = fixture();
    const c = f.controller();
    const r = await c.resolve('nope', 'keepLocal');
    expect(r.ok).toBe(false);
  });

  it('failed resolve (stale revision) re-syncs and yields a fresh conflict', async () => {
    const f = fixture({ Auto: J1 });
    f.server.seed('Auto', J2, 5);
    const c = f.controller();
    await c.syncNow();
    f.server.mutate('Auto', J3);
    const r = await c.resolve('Auto', 'keepLocal');
    expect(r.ok).toBe(false);
    expect(c.conflicts.value).toHaveLength(1);
    expect(c.conflicts.value[0]!.remoteRevision).toBe(6);
    expect(canon(c.conflicts.value[0]!.remote)).toBe(canon(J3));
    expect(c.status.value).toBe('conflict');
  });

  it('keepBoth pushes the renamed copy right away', async () => {
    const f = fixture({ Auto: J1 });
    f.server.seed('Auto', J2, 2);
    const c = f.controller();
    await c.syncNow();
    const r = await c.resolve('Auto', 'keepBoth');
    expect(r).toEqual({ ok: true, renamedTo: 'Auto(电脑端)' });
    expect(f.server.body('Auto(电脑端)')).toBe(canon(J1));
    expect(c.conflicts.value).toEqual([]);
    expect(c.status.value).toBe('idle');
  });

  it('local delete flow: onLocalDelete records the tombstone and the next pass deletes the robot copy', async () => {
    const f = fixture({ Auto: J1 });
    const c = f.controller();
    await c.syncNow();
    f.local.delete('Auto');
    c.onLocalDelete('Auto');
    await c.syncNow();
    expect(f.server.routes.has('Auto')).toBe(false);
    expect(f.local.get('Auto')).toBeUndefined();
    expect(c.lastResult.value?.deletedRemote).toEqual(['Auto']);
    expect(c.status.value).toBe('idle');
  });

  it('local-deleted/remote-changed surfaces as a controller conflict and resolves', async () => {
    const f = fixture({ Auto: J1 });
    const c = f.controller();
    await c.syncNow();
    f.local.delete('Auto');
    c.onLocalDelete('Auto');
    f.server.mutate('Auto', J2);
    await c.syncNow();
    expect(c.status.value).toBe('conflict');
    expect(c.conflicts.value[0]?.reason).toBe('LOCAL_DELETED_REMOTE_CHANGED');
    expect((await c.resolve('Auto', 'keepRemote')).ok).toBe(true);
    expect(canon(f.local.get('Auto'))).toBe(canon(J2));
    expect(c.status.value).toBe('idle');
  });

  it('pullRemoteOnly overwrites the local copy and updates the baseline', async () => {
    const f = fixture({ Auto: J1 });
    const c = f.controller();
    await c.syncNow();
    f.server.mutate('Auto', J2);
    expect((await c.pullRemoteOnly('Auto')).ok).toBe(true);
    expect(canon(f.local.get('Auto'))).toBe(canon(J2));
    expect(f.baselines.get(ROBOT_KEY, 'Auto')?.remoteRevision).toBe(2);
    expect((await c.pullRemoteOnly('Missing')).ok).toBe(false);
  });

  it('setTarget(null) / onDisconnected clears state; stale in-flight results are discarded', async () => {
    const f = fixture({ Auto: J1 });
    f.server.seed('Auto', J2, 1);
    const c = f.controller();
    await c.syncNow();
    expect(c.conflicts.value).toHaveLength(1);
    c.onDisconnected();
    expect(c.conflicts.value).toEqual([]);
    expect(c.status.value).toBe('idle');
    expect(c.hasTarget).toBe(false);

    c.setTarget({ robotKey: ROBOT_KEY, api: f.server });
    const p = c.syncNow();
    c.onDisconnected();
    await p;
    expect(c.conflicts.value).toEqual([]);
    expect(c.lastResult.value).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// Stores & DocStore adapter
// ---------------------------------------------------------------------------------------------

describe('KV-backed stores', () => {
  it('baseline uses the Kotlin key/value format', () => {
    const kv = new MemoryKV();
    const s = new KvBaselineStore(kv);
    s.put(ROBOT_KEY, { routeName: 'My Route/1', localFingerprint: 'abc123', remoteRevision: 12 });
    const key = `v2_sync_baseline:${escapeKeyPart(ROBOT_KEY)}:${escapeKeyPart('My Route/1')}`;
    expect(kv.get(key)).toBe('12\nabc123');
    expect(s.get(ROBOT_KEY, 'My Route/1')).toEqual({ routeName: 'My Route/1', localFingerprint: 'abc123', remoteRevision: 12 });
    s.remove(ROBOT_KEY, 'My Route/1');
    expect(s.get(ROBOT_KEY, 'My Route/1')).toBeNull();
    expect(kv.keys()).toEqual([]);
  });

  it('baseline rejects malformed values and clearRobot only touches that robot', () => {
    const kv = new MemoryKV();
    const s = new KvBaselineStore(kv);
    const key = `v2_sync_baseline:${escapeKeyPart(ROBOT_KEY)}:${escapeKeyPart('x')}`;
    for (const bad of ['', 'nonumber\nfp', '5\n', '\nfp', 'justonething', '-1\nfp']) {
      kv.set(key, bad);
      expect(s.get(ROBOT_KEY, 'x')).toBeNull();
    }
    s.put(ROBOT_KEY, { routeName: 'a', localFingerprint: 'f', remoteRevision: 1 });
    s.put('http://other:8888', { routeName: 'a', localFingerprint: 'f', remoteRevision: 1 });
    s.clearRobot(ROBOT_KEY);
    expect(s.get(ROBOT_KEY, 'a')).toBeNull();
    expect(s.get('http://other:8888', 'a')).not.toBeNull();
  });

  it('tombstone stores the revision under az.tombstone:<robot>:<route>', () => {
    const kv = new MemoryKV();
    const t = new KvTombstoneStore(kv);
    t.put(ROBOT_KEY, '路径 A', 7);
    expect(kv.get(`az.tombstone:${escapeKeyPart(ROBOT_KEY)}:${escapeKeyPart('路径 A')}`)).toBe('7');
    expect(t.get(ROBOT_KEY, '路径 A')).toBe(7);
    expect(t.list(ROBOT_KEY)).toEqual(['路径 A']);
    t.put('http://other:8888', 'z', 1);
    t.clearRobot(ROBOT_KEY);
    expect(t.get(ROBOT_KEY, '路径 A')).toBeNull();
    expect(t.list('http://other:8888')).toEqual(['z']);
    t.remove('http://other:8888', 'z');
    expect(kv.keys()).toEqual([]);
  });

  it('in-memory stores behave the same', () => {
    const b = new InMemoryBaselineStore();
    b.put('r', { routeName: 'a', localFingerprint: 'f', remoteRevision: 1 });
    b.put('r2', { routeName: 'a', localFingerprint: 'f', remoteRevision: 2 });
    b.clearRobot('r');
    expect(b.get('r', 'a')).toBeNull();
    expect(b.get('r2', 'a')?.remoteRevision).toBe(2);
    const t = new InMemoryTombstoneStore();
    t.put('r', 'a', 3);
    t.put('r', 'b:c', 4);
    expect(t.list('r').sort()).toEqual(['a', 'b:c']);
    t.clearRobot('r');
    expect(t.list('r')).toEqual([]);
  });
});

describe('docStoreLocalRoutes', () => {
  it('reads and writes silently, and DocStore delete events can drive tombstones', async () => {
    const store = new DocStore({ kv: new MemoryKV(), setTimer: () => null, clearTimer: () => undefined });
    const local = docStoreLocalRoutes(store);
    const server = new FakeRobot();
    const baselines = new InMemoryBaselineStore();
    const tombstones = new InMemoryTombstoneStore();
    const controller = new SyncController({ local, baselines, tombstones, target: { robotKey: ROBOT_KEY, api: server } });
    let changes = 0;
    store.onLocalChange(() => changes++);
    store.onRouteDeleted((n) => controller.onLocalDelete(n));

    const name = store.createRoute('Auto', [pt(1)]);
    expect(changes).toBe(1);
    await controller.syncNow();
    expect(server.routes.has(name)).toBe(true);

    server.seed('FromRobot', J2, 1);
    await controller.syncNow();
    expect(canon(local.get('FromRobot'))).toBe(canon(J2));
    expect(changes).toBe(1); // pulls are silent

    store.deleteRoute(name);
    await controller.syncNow();
    expect(server.routes.has(name)).toBe(false);
    expect(local.list().map((r) => r.name)).toEqual(['FromRobot']);
  });
});
