/**
 * Port of RobotConnectionTest.kt plus the state-machine behaviour of RobotConnection
 * (reconnect, watchdog, backoff) against the Node mock robot and the real FetchTransport.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_BACKOFF_MAX_MS,
  DEFAULT_BACKOFF_MIN_MS,
  DEFAULT_WATCHDOG_MS,
  RobotConnection,
  backoffDelay,
  type Clock,
  type ConnectionState,
  type Timers,
} from '../../src/net/connection';
import type { MockRobotServer } from '../../src/tools/mock-robot';
import { Cleanup, ROUTE_A, recordEvents, sleep, waitFor } from './_util';

const cleanup = new Cleanup();
afterEach(() => cleanup.run());

const FAST = { minMs: 50, maxMs: 200 } as const;

async function connected(robot: MockRobotServer, extra: Partial<ConstructorParameters<typeof RobotConnection>[0]> = {}): Promise<RobotConnection> {
  const conn = cleanup.connection({ baseUrl: robot.url, clientName: 'Desktop', backoff: FAST, ...extra });
  const res = await conn.connect();
  expect(res.ok, JSON.stringify(res)).toBe(true);
  return conn;
}

const kinds = (states: ConnectionState[]): string[] => states.map((s) => s.kind);

describe('connect', () => {
  it('creates a session and opens an authenticated event stream', async () => {
    const robot = await cleanup.mock();
    const conn = await connected(robot);

    expect(conn.state).toEqual({ kind: 'connected', token: robot.sessionToken });
    expect(robot.sessionOwner).toBe('Desktop');
    const stream = robot.requests.find((r) => r.path === '/api/v2/events');
    expect(stream?.headers['x-az-session']).toBe(robot.sessionToken);
    expect(stream?.headers['accept']).toBe('text/event-stream');
    expect(robot.eventStreamCount).toBe(1);

    await waitFor(() => conn.data.hello !== null, 'hello');
    expect(conn.data.hello).toEqual({ protocol: 2, poseHz: 30, sessionTimeoutMs: 10_000 });
  });

  it('walks idle → connecting → connected and reports each transition once', async () => {
    const robot = await cleanup.mock();
    const conn = cleanup.connection({ baseUrl: robot.url });
    const states: ConnectionState[] = [];
    conn.onState((s, prev) => {
      states.push(s);
      if (states.length === 1) expect(prev).toEqual({ kind: 'idle' });
    });
    expect(conn.state).toEqual({ kind: 'idle' });
    await conn.connect();
    expect(kinds(states)).toEqual(['connecting', 'connected']);
    expect(states[0]).toEqual({ kind: 'connecting', attempt: 1 });
    expect(conn.baseUrl).toBe(robot.url);
  });

  it('unsubscribe stops notifications; a throwing listener does not break the stream', async () => {
    const robot = await cleanup.mock();
    const conn = cleanup.connection({ baseUrl: robot.url });
    let calls = 0;
    const off = conn.subscribe(() => { calls++; });
    conn.subscribe(() => { throw new Error('faulty subscriber'); });
    await conn.connect();
    await waitFor(() => conn.data.hello !== null, 'hello despite faulty listener');
    off();
    const seen = calls;
    robot.publishPose(1, 2, 3);
    await waitFor(() => conn.data.pose?.seq === 1, 'pose');
    expect(calls).toBe(seen);
  });

  it('an unreachable robot yields a failed state with the error, not an exception', async () => {
    const robot = await cleanup.mock();
    const url = robot.url;
    await robot.stop();
    const conn = cleanup.connection({ baseUrl: url, autoRetry: false });
    const res = await conn.connect();
    expect(res.ok).toBe(false);
    expect(conn.state).toMatchObject({ kind: 'failed', error: { kind: 'unreachable' } });
    expect(conn.state.kind === 'failed' && conn.state.reason).toContain('Network request failed');
  });

  it('a robot that answers 5xx to the session request is a failed state', async () => {
    const robot = await cleanup.mock();
    const conn = cleanup.connection({ baseUrl: robot.url, autoRetry: false, clientName: 'x' });
    // Break the session request: a body that is not JSON is impossible from the client, so make the
    // robot's controller reject via 500 by sending an invalid body through a custom transport.
    const bad = cleanup.connection({
      baseUrl: robot.url,
      autoRetry: false,
      transport: {
        request: async () => ({ status: 500, headers: {}, text: '{"error":"internal_error"}' }),
        openEvents: () => Promise.reject(new Error('unused')),
      },
    });
    expect((await bad.connect()).ok).toBe(false);
    expect(bad.state).toMatchObject({ kind: 'failed', error: { kind: 'http', status: 500, code: 'internal_error' } });
    expect(conn.state.kind).toBe('idle');
  });
});

describe('SSE delivery', () => {
  it('SSE events update every connection data channel (raw frames)', async () => {
    const robot = await cleanup.mock({ heartbeatMs: 60_000 });
    const conn = await connected(robot);
    await waitFor(() => conn.data.lastHeartbeat !== null, 'initial burst');

    robot.emitRaw('pose', '{"seq":7,"tNanos":123,"x":1.25,"y":-2.5,"heading":90.0}', 7);
    robot.emitRaw('runtime', '{"seq":7,"opModeActive":true,"opModeName":"HttpAuto"}', 7);
    robot.emitRaw('execution', '{"state":"RUNNING","requestId":9,"subject":"Auto","revision":4}', 4);
    robot.emitRaw('opmode', '{"revision":8,"controllerAvailable":true,"phase":"INIT","activeName":"Auto A"}', 8);
    robot.emitRaw('routes', '{"revision":12}', 12);
    robot.emitRaw('commands', '{"revision":3}', 3);
    robot.emitRaw('heartbeat', '{"t":4567}', 4567);
    await waitFor(() => conn.data.lastHeartbeat === 4567, 'all frames');

    const d = conn.data;
    expect(d.pose).toEqual({ seq: 7, tNanos: 123, x: 1.25, y: -2.5, heading: 90 });
    expect(d.runtime).toEqual({ seq: 7, opModeActive: true, opModeName: 'HttpAuto' });
    expect(d.execution).toEqual({ state: 'RUNNING', requestId: 9, subject: 'Auto', revision: 4 });
    expect(d.opMode).toEqual({ revision: 8, controllerAvailable: true, phase: 'INIT', activeName: 'Auto A' });
    expect(d.routeRevision).toBe(12);
    expect(d.commandRevision).toBe(3);
    expect(d.lastEventAt).not.toBeNull();
    expect(conn.state.kind).toBe('connected');
  });

  it('real robot state changes arrive as events and as ConnectionEvents', async () => {
    const robot = await cleanup.mock();
    const conn = await connected(robot);
    const events = recordEvents(conn);
    await waitFor(() => conn.data.lastHeartbeat !== null, 'initial burst');

    robot.publishRuntime(true, 'Auto A', { x: 3.5, y: -1, heading: 45 });
    robot.publishExecution('RUNNING', 2, 'Route');
    robot.bumpOpModeRevision();
    robot.mutateRemoteRoute('R', ROUTE_A);
    robot.setCommands([{ name: 'c', paramNames: [], paramTypes: [] }]);
    await waitFor(() => conn.data.pose?.x === 3.5 && conn.data.execution?.subject === 'Route'
      && conn.data.routeRevision === robot.routesChangeRevision && conn.data.commandRevision === robot.commandsRevision
      && conn.data.opMode?.revision === 2 && conn.data.runtime?.opModeName === 'Auto A', 'all channels');

    expect(conn.data.pose).toMatchObject({ x: 3.5, y: -1, heading: 45 });
    const types = new Set(events.map((e) => e.type));
    for (const t of ['pose', 'runtime', 'execution', 'opmode', 'routes', 'commands', 'heartbeat']) expect(types.has(t as never), t).toBe(true);
    const routes = events.filter((e) => e.type === 'routes').at(-1);
    expect(routes && routes.type === 'routes' && routes.data.revision).toBeGreaterThan(1);
  });

  it('pose frames flow at roughly poseHz while a simulated run is playing', async () => {
    const robot = await cleanup.mock({ poseHz: 40, runDurationMs: 700 });
    robot.seedRoute('P', '[{"x":0,"y":0,"duration":0},{"x":30,"y":10,"duration":3,"heading":45}]');
    robot.setOpModes([{ name: 'Auto P', group: 'Auto', route: 'P' }]);
    const conn = await connected(robot);
    const poses: number[] = [];
    conn.subscribe((e) => { if (e.type === 'pose') poses.push(e.data.x); });
    await waitFor(() => conn.data.opMode !== null, 'opmode');

    const rev = (): number => conn.data.opMode?.revision ?? -1;
    expect((await conn.api.initOpMode('Auto P', rev())).ok).toBe(true);
    await waitFor(() => conn.data.opMode?.phase === 'INIT', 'INIT');
    expect((await conn.api.startOpMode('Auto P', rev())).ok).toBe(true);
    await waitFor(() => conn.data.execution?.state === 'RUNNING', 'RUNNING');
    expect(conn.data.execution?.subject).toBe('P');
    await waitFor(() => conn.data.opMode?.phase === 'STOPPED' && conn.data.execution?.state === 'IDLE', 'finished', 3000);

    expect(poses.length).toBeGreaterThan(10);
    expect(poses.length).toBeLessThan(40);
    expect(poses.at(-1)).toBeCloseTo(30, 3);
    expect(conn.data.runtime).toMatchObject({ opModeActive: false, opModeName: null });
  });

  it('unknown event names are ignored', async () => {
    const robot = await cleanup.mock({ heartbeatMs: 60_000 });
    const conn = await connected(robot);
    await waitFor(() => conn.data.lastHeartbeat !== null, 'burst');
    robot.emitRaw('from-the-future', '{"a":1}');
    robot.emitRaw('heartbeat', '{"t":1}');
    await waitFor(() => conn.data.lastHeartbeat === 1, 'later frame');
    expect(conn.state.kind).toBe('connected');
  });

  it('a malformed payload moves the connection to the failed state and closes the stream', async () => {
    const robot = await cleanup.mock({ heartbeatMs: 60_000 });
    const conn = await connected(robot, { autoRetry: false });
    await waitFor(() => conn.data.lastHeartbeat !== null, 'burst');

    robot.emitRaw('pose', '{not-json}');
    await waitFor(() => conn.state.kind === 'failed', 'failed state');

    expect(conn.state).toMatchObject({ kind: 'failed', error: { kind: 'parse' } });
    expect(conn.state.kind === 'failed' && conn.state.reason).toContain('Invalid pose event');
    expect(conn.data.pose).toBeNull();
    expect(conn.data.hello).toBeNull();
    await waitFor(() => robot.eventStreamCount === 0, 'stream closed by client');
  });

  it('a structurally wrong payload (valid JSON) fails the same way', async () => {
    const robot = await cleanup.mock({ heartbeatMs: 60_000 });
    const conn = await connected(robot, { autoRetry: false });
    await waitFor(() => conn.data.lastHeartbeat !== null, 'burst');
    robot.emitRaw('execution', '{"state":"EXPLODING"}');
    await waitFor(() => conn.state.kind === 'failed', 'failed state');
    expect(conn.state.kind === 'failed' && conn.state.reason).toContain('Invalid execution event');
  });

  it('a dropped event stream moves a connected connection to failed and clears runtime data', async () => {
    const robot = await cleanup.mock();
    const conn = await connected(robot, { autoRetry: false });
    robot.publishPose(1, 2, 3);
    await waitFor(() => conn.data.pose?.seq === 1, 'pose');

    robot.dropEventStreams();
    await waitFor(() => conn.state.kind === 'failed', 'failed state');

    expect(conn.state).toMatchObject({ kind: 'failed', error: { kind: 'unreachable' } });
    expect(conn.data.pose).toBeNull();
    expect(conn.data.runtime).toBeNull();
    expect(conn.data.routeRevision).toBe(0);
  });
});

describe('session conflict', () => {
  it('a second computer is rejected with owner and retry delay', async () => {
    const robot = await cleanup.mock();
    const first = cleanup.connection({ baseUrl: robot.url, clientName: 'Computer-A', autoRetry: false });
    const second = cleanup.connection({ baseUrl: robot.url, clientName: 'Computer-B', autoRetry: false });
    expect((await first.connect()).ok).toBe(true);

    const before = Date.now();
    const res = await second.connect();

    expect(res.ok).toBe(false);
    expect(!res.ok && res.error).toMatchObject({ kind: 'http', status: 409, code: 'already_connected' });
    expect(second.state.kind).toBe('rejected');
    if (second.state.kind !== 'rejected') throw new Error('unreachable');
    expect(second.state.owner).toBe('Computer-A');
    const wait = second.state.retryAt - before;
    expect(wait).toBeGreaterThan(8000);
    expect(wait).toBeLessThanOrEqual(10_500);
    expect(robot.sessionOwner).toBe('Computer-A');
    expect(first.state.kind).toBe('connected');
  });

  it('retries automatically and takes over once the first computer leaves', async () => {
    const robot = await cleanup.mock({ sessionTimeoutMs: 1000 });
    const first = cleanup.connection({ baseUrl: robot.url, clientName: 'A', backoff: FAST });
    const second = cleanup.connection({ baseUrl: robot.url, clientName: 'B', backoff: FAST });
    await first.connect();
    await second.connect();
    expect(second.state.kind).toBe('rejected');

    await first.close();
    expect(robot.sessionOwned).toBe(false);
    await waitFor(() => second.state.kind === 'connected', 'takeover after retry delay', 3500);
    expect(robot.sessionOwner).toBe('B');
    expect(robot.eventStreamCount).toBe(1);
  });

  it('uses retryAfterMs (not the backoff) for the rejection delay, floored at backoff.minMs', async () => {
    const robot = await cleanup.mock({ sessionTimeoutMs: 1000 });
    const owner = cleanup.connection({ baseUrl: robot.url, autoRetry: false });
    await owner.connect();
    const t = new ManualTimers();
    const clock = new ManualClock(1_000_000);
    const second = cleanup.connection({ baseUrl: robot.url, timers: t, clock, watchdogMs: 999_999, backoff: { minMs: 50, maxMs: 200 } });
    await second.connect();
    if (second.state.kind !== 'rejected') throw new Error(`state ${second.state.kind}`);
    const delay = second.state.retryAt - clock.now();
    expect(delay).toBeGreaterThan(500);
    expect(delay).toBeLessThanOrEqual(1000);
    expect(t.delays()).toContain(delay);
  });

  it('losing the lease while connected (revoked) re-opens a fresh session', async () => {
    const robot = await cleanup.mock();
    const conn = await connected(robot);
    const oldToken = robot.sessionToken;
    const events = recordEvents(conn);

    robot.revokeSession();
    await waitFor(() => conn.state.kind === 'connected' && conn.state.token !== oldToken, 'new session', 4000);

    expect(robot.sessionToken).toBe(conn.state.kind === 'connected' ? conn.state.token : null);
    expect(events.some((e) => e.type === 'state' && e.state.kind === 'failed')).toBe(true);
    expect(robot.eventStreamCount).toBe(1);
  });
});

describe('close / switch robot', () => {
  it('close() ends the stream, releases the lease and resets to idle', async () => {
    const robot = await cleanup.mock();
    const conn = await connected(robot);
    robot.publishPose(1, 2, 3);
    await waitFor(() => conn.data.pose !== null, 'pose');

    await conn.close();

    expect(conn.state).toEqual({ kind: 'idle' });
    expect(conn.api.token).toBeNull();
    expect(robot.sessionToken).toBeNull();
    await waitFor(() => robot.eventStreamCount === 0, 'stream closed');
    expect(conn.data.pose).toBeNull();
    expect(robot.requests.at(-1)).toMatchObject({ method: 'DELETE', path: '/api/v2/session', status: 204 });
    await conn.close(); // idempotent
    expect(conn.state.kind).toBe('idle');
  });

  it('close() stops auto-reconnect even while a retry is pending', async () => {
    const robot = await cleanup.mock();
    const url = robot.url;
    await robot.stop();
    const conn = cleanup.connection({ baseUrl: url, backoff: FAST });
    await conn.connect();
    expect(conn.state.kind).toBe('failed');
    await conn.close();
    await robot.start(robot.port);
    await sleep(300);
    expect(conn.state.kind).toBe('idle');
    expect(robot.sessionOwned).toBe(false);
  });

  it('can reconnect after close()', async () => {
    const robot = await cleanup.mock();
    const conn = await connected(robot);
    await conn.close();
    expect((await conn.connect()).ok).toBe(true);
    expect(conn.state.kind).toBe('connected');
    expect(robot.sessionOwner).toBe('Desktop');
  });

  it('connect() while connected supersedes the old stream and reuses the lease', async () => {
    const robot = await cleanup.mock();
    const conn = await connected(robot);
    const token = robot.sessionToken;
    expect((await conn.connect()).ok).toBe(true);
    expect(conn.state).toEqual({ kind: 'connected', token });
    await waitFor(() => robot.eventStreamCount === 1, 'old stream closed');
    expect(robot.openedEventTargets).toHaveLength(2);
    expect(robot.requestsTo('/api/v2/session', 'POST')).toHaveLength(1);
  });

  it('setBaseUrl closes the stream, clears runtime data and goes idle; connect() then targets the new robot', async () => {
    const a = await cleanup.mock();
    const b = await cleanup.mock();
    const conn = await connected(a);
    robot_publish(a);
    await waitFor(() => conn.data.pose !== null && conn.data.routeRevision > 0, 'data');

    await conn.setBaseUrl(b.url);

    expect(conn.state).toEqual({ kind: 'idle' });
    expect(conn.baseUrl).toBe(b.url);
    expect(conn.data.pose).toBeNull();
    expect(conn.data.runtime).toBeNull();
    expect(conn.data.routeRevision).toBe(0);
    expect(a.sessionToken).toBeNull();
    await waitFor(() => a.eventStreamCount === 0, 'old stream closed');

    expect((await conn.connect()).ok).toBe(true);
    expect(b.sessionOwner).toBe('Desktop');
    expect(a.sessionOwned).toBe(false);
  });
});

describe('reconnect', () => {
  it('reconnects with a fresh session after the robot restarts', async () => {
    const robot = await cleanup.mock();
    robot.seedRoute('Keep', ROUTE_A, 4);
    const conn = await connected(robot);
    const oldToken = robot.sessionToken;
    const events = recordEvents(conn);
    await waitFor(() => conn.data.hello !== null, 'hello');

    await robot.restart(); // new process: same port, lease lost, routes persist
    await waitFor(() => conn.state.kind === 'failed' || conn.state.kind === 'connecting', 'noticed the restart');
    await waitFor(() => conn.state.kind === 'connected', 'reconnected', 5000);

    expect(conn.state.kind === 'connected' && conn.state.token).toBe(robot.sessionToken);
    expect(robot.sessionToken).not.toBe(oldToken);
    expect(robot.sessionOwner).toBe('Desktop');
    await waitFor(() => conn.data.hello !== null && conn.data.routeRevision === robot.routesChangeRevision, 'fresh data after reconnect');
    // The stale token was tried first and answered 401 before a new session was opened.
    expect(robot.requests.some((r) => r.path === '/api/v2/events' && r.status === 401)).toBe(true);
    expect(robot.requestsTo('/api/v2/session', 'POST').length).toBe(2);
    expect(events.filter((e) => e.type === 'state' && e.state.kind === 'failed').length).toBeGreaterThanOrEqual(1);
    // The robot still has its data and the API works with the new token.
    const manifest = await conn.api.listRoutes();
    expect(manifest.ok && manifest.value.routes).toEqual([{ name: 'Keep', revision: 4 }]);
  });

  it('keeps retrying while the robot is down and connects once it returns', async () => {
    const robot = await cleanup.mock();
    const conn = await connected(robot);
    const port = robot.port;
    await robot.stop();
    await waitFor(() => conn.state.kind === 'failed', 'failed');
    await sleep(350); // several backoff rounds against a closed port
    expect(conn.state.kind).toBe('failed');

    await robot.start(port);
    await waitFor(() => conn.state.kind === 'connected', 'connected again', 5000);
    expect(robot.sessionOwner).toBe('Desktop');
  });

  it('the stream watchdog fails a silent stream and reconnects when frames resume', async () => {
    const robot = await cleanup.mock({ heartbeatMs: 50 });
    const conn = await connected(robot, { watchdogMs: 400 });
    await waitFor(() => conn.data.lastHeartbeat !== null, 'heartbeat');
    const states: ConnectionState[] = [];
    conn.onState((s) => states.push(s));

    robot.muteEventStreams();
    await waitFor(() => conn.state.kind === 'failed', 'watchdog failure', 3000);
    expect(conn.state).toMatchObject({ kind: 'failed', error: { kind: 'timeout' } });
    expect(conn.state.kind === 'failed' && conn.state.reason).toContain('No event from robot for 400 ms');
    expect(conn.data.hello).toBeNull();

    robot.muteEventStreams(false);
    await waitFor(() => conn.state.kind === 'connected', 'recovered', 4000);
    await waitFor(() => conn.data.lastHeartbeat !== null, 'frames flowing again');
    expect(kinds(states)).toContain('connecting');
  });

  it('events keep the watchdog quiet: a healthy idle connection survives several watchdog periods', async () => {
    const robot = await cleanup.mock({ heartbeatMs: 80 });
    const conn = await connected(robot, { watchdogMs: 300, autoRetry: false });
    const events = recordEvents(conn);
    await sleep(1000);
    expect(conn.state.kind).toBe('connected');
    expect(events.filter((e) => e.type === 'state')).toHaveLength(0);
    expect(events.filter((e) => e.type === 'heartbeat').length).toBeGreaterThan(5);
  });

  it('the lease stays alive through the event stream alone', async () => {
    const robot = await cleanup.mock({ sessionTimeoutMs: 400 });
    const conn = await connected(robot, { autoRetry: false });
    await sleep(1300);
    expect(conn.state.kind).toBe('connected');
    expect(robot.sessionOwned).toBe(true);
  });
});

describe('backoff & timers (deterministic)', () => {
  it('backoffDelay doubles from 1 s up to 10 s', () => {
    expect([1, 2, 3, 4, 5, 6, 0, -3].map((n) => backoffDelay(n))).toEqual([1000, 2000, 4000, 8000, 10_000, 10_000, 1000, 1000]);
    expect(backoffDelay(3, 100, 500)).toBe(400);
    expect(backoffDelay(4, 100, 500)).toBe(500);
    expect([DEFAULT_BACKOFF_MIN_MS, DEFAULT_BACKOFF_MAX_MS, DEFAULT_WATCHDOG_MS]).toEqual([1000, 10_000, 3000]);
  });

  it('schedules retries 1 s, 2 s, 4 s (capped), resets after a hello, and does not retry when disabled', async () => {
    const robot = await cleanup.mock();
    const port = robot.port;
    await robot.stop();
    const timers = new ManualTimers();
    const clock = new ManualClock(5_000);
    const conn = cleanup.connection({
      baseUrl: robot.url, timers, clock, watchdogMs: 999_999, backoff: { minMs: 1000, maxMs: 4000 },
    });
    const events = recordEvents(conn);
    const failedCount = (): number => events.filter((e) => e.type === 'state' && e.state.kind === 'failed').length;

    await conn.connect();
    expect(conn.state).toMatchObject({ kind: 'failed', retryAt: 6_000 });
    expect(timers.delays()).toEqual([1000]);

    timers.fire(1000);
    await waitFor(() => failedCount() === 2, 'second failure');
    expect(conn.state).toMatchObject({ kind: 'failed', retryAt: 7_000 });
    expect(timers.delays()).toEqual([2000]);

    clock.set(9_000);
    timers.fire(2000);
    await waitFor(() => failedCount() === 3, 'third failure');
    expect(conn.state).toMatchObject({ kind: 'failed', retryAt: 13_000 });
    expect(timers.delays()).toEqual([4000]);

    timers.fire(4000);
    await waitFor(() => failedCount() === 4, 'fourth failure');
    expect(timers.delays()).toEqual([4000]); // capped

    await robot.start(port);
    timers.fire(4000);
    await waitFor(() => conn.state.kind === 'connected', 'connected');
    await waitFor(() => conn.data.hello !== null, 'hello (resets the failure counter)');
    expect(timers.delays()).toEqual([999_999]); // only the watchdog is pending now

    robot.dropEventStreams();
    await waitFor(() => failedCount() === 5, 'failure after recovery');
    expect(timers.delays()).toEqual([1000]); // back to the first step, watchdog disarmed

    await conn.close();
    expect(timers.delays()).toEqual([]);

    const quiet = cleanup.connection({ baseUrl: 'http://127.0.0.1:1', timers, clock, autoRetry: false });
    await quiet.connect();
    expect(quiet.state.kind).toBe('failed');
    expect(timers.delays()).toEqual([]);
  });

  it('a manual connect() cancels a pending retry', async () => {
    const robot = await cleanup.mock();
    const port = robot.port;
    await robot.stop();
    const timers = new ManualTimers();
    const conn = cleanup.connection({ baseUrl: robot.url, timers, watchdogMs: 999_999 });
    await conn.connect();
    expect(timers.delays()).toEqual([1000]);
    await robot.start(port);
    expect((await conn.connect()).ok).toBe(true);
    expect(timers.delays()).toEqual([999_999]);
  });

  it('the watchdog uses the injected clock and timers', async () => {
    const robot = await cleanup.mock({ heartbeatMs: 60_000 });
    const timers = new ManualTimers();
    const clock = new ManualClock(0);
    const conn = cleanup.connection({ baseUrl: robot.url, timers, clock, watchdogMs: 3000, autoRetry: false });
    await conn.connect();
    await waitFor(() => conn.data.lastHeartbeat !== null, 'burst');
    expect(timers.delays()).toEqual([3000]);

    clock.set(1000); // 1 s without events: the check re-arms for the remainder
    timers.fire(3000);
    expect(conn.state.kind).toBe('connected');
    expect(timers.delays()).toEqual([2000]);

    clock.set(3000);
    timers.fire(2000);
    expect(conn.state).toMatchObject({ kind: 'failed', error: { kind: 'timeout' } });
  });
});

// ---------------------------------------------------------------------------------------------

function robot_publish(robot: MockRobotServer): void {
  robot.publishPose(1, 2, 3);
  robot.mutateRemoteRoute('Z', ROUTE_A);
}

class ManualClock implements Clock {
  constructor(private t: number) {}
  now(): number { return this.t; }
  set(t: number): void { this.t = t; }
}

class ManualTimers implements Timers {
  private next = 1;
  private readonly entries = new Map<number, { fn: () => void; ms: number }>();
  setTimeout(fn: () => void, ms: number): unknown {
    const id = this.next++;
    this.entries.set(id, { fn, ms });
    return id;
  }
  clearTimeout(handle: unknown): void { this.entries.delete(handle as number); }
  /** Delays of the timers that are currently pending (oldest first). */
  delays(): number[] { return [...this.entries.values()].map((e) => e.ms); }
  /** Run (and remove) the oldest pending timer with this delay. */
  fire(ms: number): void {
    const found = [...this.entries].find(([, e]) => e.ms === ms);
    if (!found) throw new Error(`no pending timer with delay ${ms}; have ${JSON.stringify(this.delays())}`);
    this.entries.delete(found[0]);
    found[1].fn();
  }
}
