/**
 * Wire-level tests of the mock robot itself (plain `fetch`, no client code), so that the contract
 * tests that build on it rest on verified behaviour. Mirrors RobotApiRouter / HttpExchange /
 * SessionLease / OpModeLifecycleService of the real robot.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { MockRobotServer } from '../../src/tools/mock-robot';
import { SseParser, type SseMessage } from '../../src/net/transport';
import { Cleanup, ROUTE_A, ROUTE_B, sleep, waitFor } from './_util';

const cleanup = new Cleanup();
afterEach(() => cleanup.run());

interface Reply { status: number; headers: Headers; text: string; json: () => any }

async function call(robot: MockRobotServer, method: string, path: string, init: { token?: string | null; body?: string; headers?: Record<string, string> } = {}): Promise<Reply> {
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  if (init.token) headers['X-Az-Session'] = init.token;
  const req: RequestInit = { method, headers };
  if (init.body !== undefined) req.body = init.body;
  const res = await fetch(robot.url + path, req);
  const text = await res.text();
  return { status: res.status, headers: res.headers, text, json: () => JSON.parse(text) };
}

async function login(robot: MockRobotServer, client = 'Tester'): Promise<string> {
  const r = await call(robot, 'POST', '/api/v2/session', { body: JSON.stringify({ client }) });
  expect(r.status).toBe(201);
  return r.json().token as string;
}

/** Open the SSE endpoint with plain fetch; returns a reader of parsed messages. */
async function openStream(robot: MockRobotServer, token: string, via: 'header' | 'query' = 'header') {
  const ac = new AbortController();
  const url = robot.url + '/api/v2/events' + (via === 'query' ? `?session=${token}` : '');
  const res = await fetch(url, { headers: via === 'header' ? { 'X-Az-Session': token } : {}, signal: ac.signal });
  const messages: SseMessage[] = [];
  const parser = new SseParser();
  const decoder = new TextDecoder();
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  let ended = false;
  void (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        messages.push(...parser.push(decoder.decode(value, { stream: true })));
      }
    } catch {
      // aborted
    }
    ended = true;
  })();
  return {
    res, messages, abort: () => ac.abort(),
    get ended() { return ended; },
    of: (event: string) => messages.filter((m) => m.event === event),
    last: (event: string) => messages.filter((m) => m.event === event).at(-1),
  };
}

describe('HTTP surface', () => {
  it('answers OPTIONS with 204 and the browser access headers, without a session', async () => {
    const robot = await cleanup.mock();
    const r = await call(robot, 'OPTIONS', '/api/v2/routes/anything');
    expect(r.status).toBe(204);
    expect(r.text).toBe('');
    expect(r.headers.get('access-control-allow-origin')).toBe('*');
    expect(r.headers.get('access-control-allow-private-network')).toBe('true');
    expect(r.headers.get('access-control-allow-methods')).toBe('GET, PUT, POST, DELETE, OPTIONS');
    expect(r.headers.get('access-control-allow-headers')).toBe('Content-Type, X-Az-Session, If-Match, Last-Event-ID');
    expect(r.headers.get('access-control-expose-headers')).toBe('ETag, X-Route-Revision');
    expect(r.headers.get('access-control-max-age')).toBe('600');
  });

  it('health is public and reports session ownership; CORS + no-store on every response', async () => {
    const robot = await cleanup.mock();
    let r = await call(robot, 'GET', '/api/v2/health');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.headers.get('access-control-allow-origin')).toBe('*');
    expect(r.json()).toEqual({ status: 'ok', protocol: 2, sessionOwned: false });
    await login(robot);
    r = await call(robot, 'GET', '/api/v2/health');
    expect(r.json().sessionOwned).toBe(true);
  });

  it('401 invalid_session before 404/405 when unauthenticated', async () => {
    const robot = await cleanup.mock();
    for (const [m, p] of [['GET', '/api/v2/routes'], ['GET', '/api/v2/nope'], ['POST', '/api/v2/health'], ['GET', '/other']] as const) {
      const r = await call(robot, m, p);
      expect(r.status, `${m} ${p}`).toBe(401);
      expect(r.json()).toEqual({ error: 'invalid_session' });
    }
    const bad = await call(robot, 'GET', '/api/v2/routes', { token: 'wrong' });
    expect(bad.status).toBe(401);
  });

  it('404 not_found and 405 method_not_allowed for authenticated callers', async () => {
    const robot = await cleanup.mock();
    const t = await login(robot);
    expect((await call(robot, 'GET', '/api/v2/nope', { token: t })).json()).toEqual({ error: 'not_found' });
    expect((await call(robot, 'POST', '/api/v2/runtime', { token: t })).status).toBe(404);
    for (const [m, p] of [['POST', '/api/v2/routes'], ['POST', '/api/v2/execution'], ['PUT', '/api/v2/commands'], ['POST', '/api/v2/opmodes'], ['PUT', '/api/v2/opmode'], ['GET', '/api/v2/opmode/init']] as const) {
      const r = await call(robot, m, p, { token: t });
      expect(r.status, `${m} ${p}`).toBe(405);
      expect(r.json()).toEqual({ error: 'method_not_allowed' });
    }
    expect((await call(robot, 'PUT', '/api/v2/session', { token: t })).status).toBe(405);
  });

  it('accepts the session token as ?session= as well as the header', async () => {
    const robot = await cleanup.mock();
    const t = await login(robot);
    expect((await call(robot, 'GET', `/api/v2/routes?session=${t}`)).status).toBe(200);
    expect((await call(robot, 'GET', '/api/v2/routes', { token: t })).status).toBe(200);
  });

  it('records requests for assertions', async () => {
    const robot = await cleanup.mock();
    await call(robot, 'GET', '/api/v2/health');
    const rec = robot.requests.at(-1);
    expect(rec).toMatchObject({ method: 'GET', path: '/api/v2/health', status: 200 });
    expect(rec?.url).toBe(`${robot.url}/api/v2/health`);
    expect(robot.requestsTo('/api/v2/health', 'GET')).toHaveLength(1);
    robot.clearRequests();
    expect(robot.requests).toHaveLength(0);
  });

  it('bad URL escapes give 400 bad_request; internal JSON errors give 500 internal_error', async () => {
    const robot = await cleanup.mock();
    const t = await login(robot);
    const bad = await call(robot, 'GET', '/api/v2/routes/%ZZ', { token: t });
    expect(bad.status).toBe(400);
    expect(bad.json().error).toBe('bad_request');
    const broken = await call(robot, 'POST', '/api/v2/opmode/init', { token: t, body: '{nope' });
    expect(broken.status).toBe(500);
    expect(broken.json()).toEqual({ error: 'internal_error' });
    const noSession = await call(robot, 'POST', '/api/v2/session', { body: 'nope' });
    expect(noSession.status).toBe(500);
  });

  it('rejects bodies above 2 MiB with 400', async () => {
    const robot = await cleanup.mock();
    const t = await login(robot);
    // The server answers early (400) while the client is still uploading; on some platforms the
    // socket is reset before the response is read. Either way the oversized body must be refused.
    const r = await call(robot, 'PUT', '/api/v2/routes/Big', { token: t, headers: { 'If-Match': '0' }, body: 'x'.repeat(2 * 1024 * 1024 + 1) })
      .catch((e: unknown) => ({ status: 0, error: e }));
    expect([400, 0]).toContain(r.status);
    expect(robot.hasRoute('Big')).toBe(false);
  });

  it('dropNextRequests destroys the socket without a response', async () => {
    const robot = await cleanup.mock();
    robot.dropNextRequests = 1;
    await expect(fetch(robot.url + '/api/v2/health')).rejects.toBeTruthy();
    expect((await call(robot, 'GET', '/api/v2/health')).status).toBe(200);
  });

  it('stop() makes the port unreachable; start(port) brings it back', async () => {
    const robot = await cleanup.mock();
    const port = robot.port;
    await robot.stop();
    expect(robot.isRunning).toBe(false);
    await expect(fetch(robot.url + '/api/v2/health')).rejects.toBeTruthy();
    await robot.start(port);
    expect((await call(robot, 'GET', '/api/v2/health')).status).toBe(200);
  });
});

describe('session lease', () => {
  it('POST /session: 201 with a 48-hex token and expiresInMs; owner defaults to AzConductor', async () => {
    const robot = await cleanup.mock();
    const r = await call(robot, 'POST', '/api/v2/session');
    expect(r.status).toBe(201);
    const body = r.json();
    expect(body.token).toMatch(/^[0-9a-f]{48}$/);
    expect(body.expiresInMs).toBe(10_000);
    expect(robot.sessionToken).toBe(body.token);
    expect(robot.sessionOwner).toBe('AzConductor');
  });

  it('second POST gets 409 already_connected with owner and retryAfterMs ≤ lease', async () => {
    const robot = await cleanup.mock();
    await login(robot, 'Computer-A');
    const r = await call(robot, 'POST', '/api/v2/session', { body: JSON.stringify({ client: 'Computer-B' }) });
    expect(r.status).toBe(409);
    const body = r.json();
    expect(body.error).toBe('already_connected');
    expect(body.owner).toBe('Computer-A');
    expect(body.retryAfterMs).toBeGreaterThan(9000);
    expect(body.retryAfterMs).toBeLessThanOrEqual(10_000);
  });

  it('DELETE /session: 204 with the right token (lease freed), 401 otherwise', async () => {
    const robot = await cleanup.mock();
    const t = await login(robot);
    expect((await call(robot, 'DELETE', '/api/v2/session')).status).toBe(401);
    expect((await call(robot, 'DELETE', '/api/v2/session', { token: 'nope' })).status).toBe(401);
    const r = await call(robot, 'DELETE', '/api/v2/session', { token: t });
    expect(r.status).toBe(204);
    expect(robot.sessionToken).toBeNull();
    expect((await call(robot, 'POST', '/api/v2/session')).status).toBe(201);
  });

  it('the lease expires without traffic and is kept alive by authenticated requests', async () => {
    const robot = await cleanup.mock({ sessionTimeoutMs: 400 });
    const t = await login(robot);
    for (let i = 0; i < 4; i++) {
      await sleep(150);
      expect((await call(robot, 'GET', '/api/v2/execution', { token: t })).status).toBe(200);
    }
    await sleep(550);
    expect((await call(robot, 'GET', '/api/v2/execution', { token: t })).status).toBe(401);
    expect(robot.sessionOwned).toBe(false);
    expect((await call(robot, 'POST', '/api/v2/session')).status).toBe(201);
  });

  it('SSE frames keep the lease alive; once the stream is gone the lease expires', async () => {
    const robot = await cleanup.mock({ sessionTimeoutMs: 400 });
    const t = await login(robot);
    const stream = await openStream(robot, t);
    await sleep(1000); // > 2 lease lengths
    expect(robot.sessionOwned).toBe(true);
    expect((await call(robot, 'POST', '/api/v2/session')).status).toBe(409);
    stream.abort();
    await waitFor(() => robot.eventStreamCount === 0, 'stream closed');
    await sleep(600);
    expect((await call(robot, 'POST', '/api/v2/session')).status).toBe(201);
  });

  it('revokeSession() ends the open stream and invalidates the token', async () => {
    const robot = await cleanup.mock();
    const t = await login(robot);
    const stream = await openStream(robot, t);
    await waitFor(() => stream.messages.length > 0, 'first frame');
    robot.revokeSession();
    await waitFor(() => stream.ended, 'stream end');
    expect((await call(robot, 'GET', '/api/v2/routes', { token: t })).status).toBe(401);
  });

  it('DELETE /session ends the owner’s stream', async () => {
    const robot = await cleanup.mock();
    const t = await login(robot);
    const stream = await openStream(robot, t);
    await waitFor(() => stream.messages.length > 0, 'first frame');
    expect((await call(robot, 'DELETE', '/api/v2/session', { token: t })).status).toBe(204);
    await waitFor(() => stream.ended, 'stream end');
  });
});

describe('routes', () => {
  it('manifest lists names, revisions and changeRevision', async () => {
    const robot = await cleanup.mock();
    const t = await login(robot);
    let r = await call(robot, 'GET', '/api/v2/routes', { token: t });
    expect(r.json()).toEqual({ routes: [], changeRevision: 1 });
    robot.seedRoute('A', ROUTE_A, 3);
    robot.seedRoute('蓝 路径', ROUTE_B);
    r = await call(robot, 'GET', '/api/v2/routes', { token: t });
    expect(r.json()).toEqual({
      routes: [{ name: 'A', revision: 3 }, { name: '蓝 路径', revision: 1 }],
      changeRevision: 3,
    });
  });

  it('GET returns the stored body verbatim with ETag and X-Route-Revision', async () => {
    const robot = await cleanup.mock();
    const t = await login(robot);
    robot.seedRoute('Auto', ROUTE_A, 7);
    const r = await call(robot, 'GET', '/api/v2/routes/Auto', { token: t });
    expect(r.status).toBe(200);
    expect(r.text).toBe(ROUTE_A);
    expect(r.headers.get('etag')).toBe('"7"');
    expect(r.headers.get('x-route-revision')).toBe('7');
    expect(r.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(r.headers.get('access-control-expose-headers')).toContain('X-Route-Revision');
    expect((await call(robot, 'GET', '/api/v2/routes/missing', { token: t })).json()).toEqual({ error: 'route_not_found' });
    expect((await call(robot, 'GET', '/api/v2/routes/', { token: t })).json()).toEqual({ error: 'empty_route_name' });
  });

  it('PUT: 428 without a usable If-Match, 201 for expected 0, 200 afterwards, 412 with actual on mismatch', async () => {
    const robot = await cleanup.mock();
    const t = await login(robot);
    const put = (name: string, ifMatch: string | null, body = ROUTE_A) =>
      call(robot, 'PUT', `/api/v2/routes/${encodeURIComponent(name)}`, { token: t, body, headers: ifMatch === null ? {} : { 'If-Match': ifMatch } });

    expect((await put('A', null)).status).toBe(428);
    expect((await put('A', null)).json()).toEqual({ error: 'if_match_required' });
    expect((await put('A', '')).status).toBe(428);
    expect((await put('A', 'abc')).status).toBe(428);
    expect(robot.hasRoute('A')).toBe(false);

    let r = await put('A', '0');
    expect(r.status).toBe(201);
    expect(r.json()).toEqual({ name: 'A', revision: 1 });

    r = await put('A', '"1"', ROUTE_B); // quoted ETag form is accepted
    expect(r.status).toBe(200);
    expect(r.json()).toEqual({ name: 'A', revision: 2 });
    expect(robot.getRoute('A')?.json).toBe(ROUTE_B);

    r = await put('A', '1');
    expect(r.status).toBe(412);
    expect(r.json()).toEqual({ error: 'revision_mismatch', actual: 2 });
    r = await put('A', '0'); // create-only on an existing route
    expect(r.status).toBe(412);
    expect(r.json().actual).toBe(2);
    r = await put('Fresh', '5'); // update of a missing route
    expect(r.status).toBe(412);
    expect(r.json().actual).toBe(0);
    expect(robot.getRoute('A')?.revision).toBe(2);
  });

  it('PUT bumps changeRevision only when it writes; decoded names round-trip', async () => {
    const robot = await cleanup.mock();
    const t = await login(robot);
    const before = robot.routesChangeRevision;
    await call(robot, 'PUT', '/api/v2/routes/x', { token: t, body: ROUTE_A, headers: { 'If-Match': '9' } });
    expect(robot.routesChangeRevision).toBe(before);
    const name = '蓝 路径(A)';
    const enc = '%E8%93%9D%20%E8%B7%AF%E5%BE%84%28A%29';
    const r = await call(robot, 'PUT', `/api/v2/routes/${enc}`, { token: t, body: ROUTE_A, headers: { 'If-Match': '0' } });
    expect(r.json()).toEqual({ name, revision: 1 });
    expect(robot.hasRoute(name)).toBe(true);
    expect(robot.routesChangeRevision).toBe(before + 1);
  });

  it('beforeNextPut simulates a concurrent writer', async () => {
    const robot = await cleanup.mock();
    const t = await login(robot);
    robot.seedRoute('R', ROUTE_A, 1);
    robot.beforeNextPut = () => { robot.mutateRemoteRoute('R', ROUTE_B); };
    const r = await call(robot, 'PUT', '/api/v2/routes/R', { token: t, body: '[{"x":9,"y":9}]', headers: { 'If-Match': '1' } });
    expect(r.status).toBe(412);
    expect(r.json().actual).toBe(2);
    expect(robot.beforeNextPut).toBeNull();
  });

  it('DELETE: 428 → 404 → 412 → 204 in the real router order', async () => {
    const robot = await cleanup.mock();
    const t = await login(robot);
    const del = (name: string, ifMatch: string | null) =>
      call(robot, 'DELETE', `/api/v2/routes/${name}`, { token: t, headers: ifMatch === null ? {} : { 'If-Match': ifMatch } });
    robot.seedRoute('R', ROUTE_A, 4);
    expect((await del('R', null)).status).toBe(428);
    expect((await del('ghost', '1')).json()).toEqual({ error: 'route_not_found' });
    expect((await del('ghost', null)).status).toBe(428); // header check precedes lookup
    const stale = await del('R', '3');
    expect(stale.status).toBe(412);
    expect(stale.json()).toEqual({ error: 'revision_mismatch', actual: 4 });
    const before = robot.routesChangeRevision;
    const ok = await del('R', '4');
    expect(ok.status).toBe(204);
    expect(ok.text).toBe('');
    expect(robot.hasRoute('R')).toBe(false);
    expect(robot.routesChangeRevision).toBe(before + 1);
  });

  it('mutateRemoteRoute / deleteRemoteRoute behave like another computer', async () => {
    const robot = await cleanup.mock();
    expect(robot.mutateRemoteRoute('N', ROUTE_A).revision).toBe(1);
    expect(robot.mutateRemoteRoute('N', ROUTE_B).revision).toBe(2);
    const rev = robot.routesChangeRevision;
    expect(robot.deleteRemoteRoute('N')).toBe(true);
    expect(robot.deleteRemoteRoute('N')).toBe(false);
    expect(robot.routesChangeRevision).toBe(rev + 1);
  });

  it('seedRoute accepts node arrays (encoded to the wire format)', async () => {
    const robot = await cleanup.mock();
    const t = await login(robot);
    robot.seedRoute('FromNodes', [{ x: 1, dx: 0, y: 2, dy: 0, heading: 0, dHeading: 0, duration: 1, marker: '', command: '', commandParams: [], delayAfterArrive: 0, maxPower: 1, brakeZoneIn: 0 }]);
    const r = await call(robot, 'GET', '/api/v2/routes/FromNodes', { token: t });
    expect(JSON.parse(r.text)).toEqual([expect.objectContaining({ x: 1, y: 2, maxPower: 1 })]);
  });
});

describe('state endpoints', () => {
  it('execution, commands and runtime snapshots', async () => {
    const robot = await cleanup.mock();
    const t = await login(robot);
    expect((await call(robot, 'GET', '/api/v2/execution', { token: t })).json()).toEqual({ state: 'IDLE', requestId: 0, subject: null, revision: 1 });
    expect((await call(robot, 'GET', '/api/v2/commands', { token: t })).json()).toEqual({ revision: 1, commands: [] });

    robot.publishExecution('RUNNING', 4, 'Auto "Q"');
    robot.setCommands([{ name: 'shoot', paramNames: ['n'], paramTypes: ['int'] }]);
    robot.publishRuntime(true, 'HttpAuto', { x: 1.5, y: -2, heading: 90 });
    expect((await call(robot, 'GET', '/api/v2/execution', { token: t })).json()).toEqual({ state: 'RUNNING', requestId: 4, subject: 'Auto "Q"', revision: 2 });
    expect((await call(robot, 'GET', '/api/v2/commands', { token: t })).json())
      .toEqual({ revision: 2, commands: [{ name: 'shoot', paramNames: ['n'], paramTypes: ['int'] }] });

    const rt = (await call(robot, 'GET', '/api/v2/runtime', { token: t })).text;
    expect(rt).toContain('"x":1.500000'); // JsonUtil.number → %.6f
    const parsed = JSON.parse(rt);
    expect(parsed.runtime).toEqual({ seq: 1, opModeActive: true, opModeName: 'HttpAuto' });
    expect(parsed.pose).toMatchObject({ seq: 1, x: 1.5, y: -2, heading: 90 });
    expect(parsed.pose.tNanos).toBeGreaterThan(0);
  });

  it('initialExecutionState option', async () => {
    const robot = await cleanup.mock({ initialExecutionState: 'NOT_READY' });
    expect(robot.execution.state).toBe('NOT_READY');
  });
});

describe('op mode lifecycle', () => {
  const act = (robot: MockRobotServer, t: string, action: string, body: unknown) =>
    call(robot, 'POST', `/api/v2/opmode/${action}`, { token: t, body: JSON.stringify(body) });

  it('lists autonomous op modes (name + group only)', async () => {
    const robot = await cleanup.mock();
    const t = await login(robot);
    robot.setOpModes([{ name: 'Auto A', group: 'Auto', route: 'R' }, 'Plain']);
    const r = await call(robot, 'GET', '/api/v2/opmodes', { token: t });
    expect(r.json()).toEqual({ opModes: [{ name: 'Auto A', group: 'Auto' }, { name: 'Plain', group: 'Auto' }] });
  });

  it('init → start → stop with revision guard and 202 replies', async () => {
    const robot = await cleanup.mock({ runDurationMs: 60_000 });
    const t = await login(robot);
    expect((await call(robot, 'GET', '/api/v2/opmode', { token: t })).json())
      .toEqual({ revision: 1, controllerAvailable: true, phase: 'STOPPED', activeName: null });

    let r = await act(robot, t, 'init', { name: 'Auto A', expectedRevision: 1 });
    expect(r.status).toBe(202);
    expect(r.json()).toEqual({ accepted: true, action: 'init', name: 'Auto A' });
    let snap = (await call(robot, 'GET', '/api/v2/opmode', { token: t })).json();
    expect(snap).toEqual({ revision: 2, controllerAvailable: true, phase: 'INIT', activeName: 'Auto A' });

    r = await act(robot, t, 'start', { name: 'Auto A', expectedRevision: 2 });
    expect(r.status).toBe(202);
    snap = (await call(robot, 'GET', '/api/v2/opmode', { token: t })).json();
    expect(snap).toMatchObject({ revision: 3, phase: 'RUNNING', activeName: 'Auto A' });

    r = await act(robot, t, 'stop', { name: 'Auto A', expectedRevision: 3 });
    expect(r.status).toBe(202);
    snap = (await call(robot, 'GET', '/api/v2/opmode', { token: t })).json();
    expect(snap).toMatchObject({ revision: 4, phase: 'STOPPED', activeName: null });

    // idempotent stop on a stopped robot: accepted, revision unchanged
    r = await act(robot, t, 'stop', { name: 'Auto A', expectedRevision: 4 });
    expect(r.status).toBe(202);
    expect(robot.opModeRevision).toBe(4);
  });

  it('rejects with the real error codes and attaches the current opMode snapshot', async () => {
    const robot = await cleanup.mock({ runDurationMs: 60_000 });
    const t = await login(robot);

    let r = await act(robot, t, 'init', { name: 'Auto A', expectedRevision: 99 });
    expect(r.status).toBe(409);
    expect(r.json()).toMatchObject({ error: 'state_changed', opMode: { revision: 1, phase: 'STOPPED' } });
    expect(typeof r.json().message).toBe('string');

    r = await act(robot, t, 'init', { name: 'Nope', expectedRevision: 1 });
    expect(r.status).toBe(404);
    expect(r.json().error).toBe('opmode_not_found');

    r = await act(robot, t, 'start', { name: 'Auto A', expectedRevision: 1 });
    expect(r.status).toBe(409);
    expect(r.json().error).toBe('opmode_not_initialized');

    await act(robot, t, 'init', { name: 'Auto A', expectedRevision: 1 });
    r = await act(robot, t, 'init', { name: 'Auto B', expectedRevision: 2 });
    expect(r.status).toBe(409);
    expect(r.json().error).toBe('opmode_not_stopped');
    r = await act(robot, t, 'start', { name: 'Auto B', expectedRevision: 2 });
    expect(r.json().error).toBe('opmode_not_initialized');
    r = await act(robot, t, 'stop', { name: 'Auto B', expectedRevision: 2 });
    expect(r.status).toBe(409);
    expect(r.json().error).toBe('opmode_mismatch');
  });

  it('400 missing_opmode_name, 428 expected_revision_required', async () => {
    const robot = await cleanup.mock();
    const t = await login(robot);
    let r = await act(robot, t, 'init', { expectedRevision: 1 });
    expect(r.status).toBe(400);
    expect(r.json()).toEqual({ error: 'missing_opmode_name' });
    r = await act(robot, t, 'init', { name: '', expectedRevision: 1 });
    expect(r.status).toBe(400);
    r = await act(robot, t, 'init', { name: 'Auto A' });
    expect(r.status).toBe(428);
    expect(r.json()).toEqual({ error: 'expected_revision_required' });
    r = await act(robot, t, 'init', { name: 'Auto A', expectedRevision: 'x' });
    expect(r.json().error).toBe('state_changed');
  });

  it('503 controller_unavailable for list and actions when the controller is detached', async () => {
    const robot = await cleanup.mock();
    const t = await login(robot);
    robot.setControllerAvailable(false);
    const list = await call(robot, 'GET', '/api/v2/opmodes', { token: t });
    expect(list.status).toBe(503);
    expect(list.json()).toEqual({ error: 'controller_unavailable' });
    const r = await act(robot, t, 'init', { name: 'Auto A', expectedRevision: robot.opModeRevision });
    expect(r.status).toBe(503);
    expect(r.json().error).toBe('controller_unavailable');
    expect((await call(robot, 'GET', '/api/v2/opmode', { token: t })).json().controllerAvailable).toBe(false);
    robot.setControllerAvailable(true);
    expect((await call(robot, 'GET', '/api/v2/opmodes', { token: t })).status).toBe(200);
  });

  it('bumpOpModeRevision makes an outstanding revision stale', async () => {
    const robot = await cleanup.mock();
    const t = await login(robot);
    const stale = robot.opModeRevision;
    robot.bumpOpModeRevision();
    const r = await act(robot, t, 'init', { name: 'Auto A', expectedRevision: stale });
    expect(r.status).toBe(409);
    expect(r.json().error).toBe('state_changed');
  });
});

describe('event stream', () => {
  it('sends hello then one frame of every kind; ids follow the real scheme', async () => {
    const robot = await cleanup.mock({ poseHz: 50 });
    robot.seedRoute('R', ROUTE_A);
    robot.setCommands([{ name: 'c', paramNames: [], paramTypes: [] }]);
    const t = await login(robot);
    const s = await openStream(robot, t);
    expect(s.res.status).toBe(200);
    expect(s.res.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    expect(s.res.headers.get('cache-control')).toBe('no-cache, no-transform');
    expect(s.res.headers.get('access-control-allow-origin')).toBe('*');

    await waitFor(() => s.of('heartbeat').length >= 1, 'first heartbeat');
    const names = s.messages.map((m) => m.event);
    expect(names.slice(0, 7)).toEqual(['hello', 'pose', 'runtime', 'execution', 'opmode', 'routes', 'commands']);
    expect(JSON.parse(s.messages[0]?.data ?? '')).toEqual({ protocol: 2, poseHz: 50, sessionTimeoutMs: 10_000 });
    expect(s.messages[0]?.id).toBe('0');
    expect(JSON.parse(s.last('routes')?.data ?? '')).toEqual({ revision: robot.routesChangeRevision });
    expect(JSON.parse(s.last('commands')?.data ?? '')).toEqual({ revision: 2 });
    expect(JSON.parse(s.last('opmode')?.data ?? '')).toMatchObject({ phase: 'STOPPED', controllerAvailable: true });
    expect(JSON.parse(s.last('execution')?.data ?? '')).toMatchObject({ state: 'IDLE' });
    expect(JSON.parse(s.last('runtime')?.data ?? '')).toEqual({ seq: 0, opModeActive: false, opModeName: null });
    s.abort();
  });

  it('authenticates via header or ?session=, rejects bad tokens with 401', async () => {
    const robot = await cleanup.mock();
    const t = await login(robot);
    const viaQuery = await openStream(robot, t, 'query');
    await waitFor(() => viaQuery.of('hello').length === 1, 'hello via query');
    viaQuery.abort();
    expect(robot.openedEventTargets.at(-1)).toBe(`/api/v2/events?session=${t}`);
    const bad = await call(robot, 'GET', '/api/v2/events', { token: 'nope' });
    expect(bad.status).toBe(401);
    expect(robot.eventStreamCount).toBeLessThanOrEqual(1);
  });

  it('streams only changes: pose when its sequence moves, others on revision change', async () => {
    const robot = await cleanup.mock({ poseHz: 50, heartbeatMs: 60_000 });
    const t = await login(robot);
    const s = await openStream(robot, t);
    await waitFor(() => s.of('heartbeat').length === 1, 'initial burst');
    const count = (e: string) => s.of(e).length;
    const base = { pose: count('pose'), exec: count('execution'), op: count('opmode') };
    await sleep(150);
    expect(count('pose')).toBe(base.pose);

    robot.publishPose(1.25, -2.5, 90);
    await waitFor(() => count('pose') === base.pose + 1, 'pose frame');
    expect(JSON.parse(s.last('pose')?.data ?? '')).toMatchObject({ seq: 1, x: 1.25, y: -2.5, heading: 90 });
    expect(s.last('pose')?.data).toContain('"x":1.250000');
    expect(s.last('pose')?.id).toBe('1');

    robot.publishExecution('RUNNING', 9, 'Auto');
    robot.publishRuntime(true, 'HttpAuto');
    robot.bumpOpModeRevision();
    robot.mutateRemoteRoute('Z', ROUTE_A);
    robot.setCommands([]);
    await waitFor(() => count('execution') === base.exec + 1 && s.last('commands')?.data === '{"revision":2}' && s.last('runtime')?.data.includes('HttpAuto'), 'state frames');
    expect(count('opmode')).toBe(base.op + 1);
    expect(JSON.parse(s.last('execution')?.data ?? '')).toEqual({ state: 'RUNNING', requestId: 9, subject: 'Auto', revision: 2 });
    expect(JSON.parse(s.last('routes')?.data ?? '').revision).toBe(robot.routesChangeRevision);
    s.abort();
  });

  it('poseHz paces pose publishing (frames at most poseHz per second)', async () => {
    const robot = await cleanup.mock({ poseHz: 10, heartbeatMs: 60_000 });
    const t = await login(robot);
    const s = await openStream(robot, t);
    await waitFor(() => s.of('heartbeat').length === 1, 'burst');
    const start = s.of('pose').length;
    // Publish far faster than poseHz for ~0.5 s: only the latest value per tick goes out.
    const publisher = setInterval(() => robot.publishPose(Math.random(), 0, 0), 2);
    await sleep(520);
    clearInterval(publisher);
    const got = s.of('pose').length - start;
    expect(got).toBeGreaterThanOrEqual(3);
    expect(got).toBeLessThanOrEqual(7);
    s.abort();
  });

  it('heartbeats at heartbeatMs', async () => {
    const robot = await cleanup.mock({ poseHz: 50, heartbeatMs: 100 });
    const t = await login(robot);
    const s = await openStream(robot, t);
    await waitFor(() => s.of('heartbeat').length >= 4, 'four heartbeats', 2500);
    const t0 = JSON.parse(s.of('heartbeat')[0]?.data ?? '').t as number;
    expect(Math.abs(t0 - Date.now())).toBeLessThan(5000);
    s.abort();
  });

  it('muteEventStreams keeps the socket open but silent; emitRaw injects frames; dropEventStreams cuts', async () => {
    const robot = await cleanup.mock({ poseHz: 50, heartbeatMs: 50 });
    const t = await login(robot);
    const s = await openStream(robot, t);
    await waitFor(() => s.of('heartbeat').length >= 1, 'heartbeat');
    robot.muteEventStreams();
    await sleep(80);
    const n = s.messages.length;
    await sleep(250);
    expect(s.messages.length).toBe(n);
    robot.emitRaw('pose', '{not-json}', 5);
    await waitFor(() => s.messages.length === n + 1, 'raw frame');
    expect(s.last('pose')).toMatchObject({ data: '{not-json}', id: '5' });
    robot.muteEventStreams(false);
    await waitFor(() => s.messages.length > n + 1, 'frames resume');
    expect(robot.eventStreamCount).toBe(1);
    robot.dropEventStreams();
    await waitFor(() => s.ended, 'stream cut');
    expect(robot.eventStreamCount).toBe(0);
  });
});

describe('simulated run', () => {
  it('INIT → START moves the pose along the bound route, then returns to STOPPED/IDLE', async () => {
    const robot = await cleanup.mock({ poseHz: 50, runDurationMs: 600, heartbeatMs: 60_000 });
    robot.seedRoute('Path', [
      { x: 0, dx: 0, y: 0, dy: 0, heading: 0, dHeading: 0, duration: 0, marker: '', command: '', commandParams: [], delayAfterArrive: 0, maxPower: 1, brakeZoneIn: 0 },
      { x: 48, dx: 0, y: 24, dy: 0, heading: 90, dHeading: 0, duration: 4, marker: '', command: '', commandParams: [], delayAfterArrive: 0, maxPower: 1, brakeZoneIn: 0 },
    ]);
    robot.setOpModes([{ name: 'Auto Path', group: 'Auto', route: 'Path' }, 'Plain']);
    const t = await login(robot);
    const s = await openStream(robot, t);
    await waitFor(() => s.of('opmode').length === 1, 'initial opmode');

    expect((await call(robot, 'POST', '/api/v2/opmode/init', { token: t, body: JSON.stringify({ name: 'Auto Path', expectedRevision: 1 }) })).status).toBe(202);
    await waitFor(() => JSON.parse(s.last('opmode')?.data ?? '{}').phase === 'INIT', 'INIT');
    expect(robot.runtimeState).toMatchObject({ opModeActive: true, opModeName: 'Auto Path', x: 0, y: 0 });
    expect(robot.execution.state).toBe('IDLE');

    expect((await call(robot, 'POST', '/api/v2/opmode/start', { token: t, body: JSON.stringify({ name: 'Auto Path', expectedRevision: 2 }) })).status).toBe(202);
    await waitFor(() => JSON.parse(s.last('opmode')?.data ?? '{}').phase === 'RUNNING', 'RUNNING');
    expect(robot.running).toBe(true);
    await waitFor(() => JSON.parse(s.last('execution')?.data ?? '{}').state === 'RUNNING', 'execution RUNNING');
    expect(JSON.parse(s.last('execution')?.data ?? '{}')).toMatchObject({ state: 'RUNNING', requestId: 1, subject: 'Path' });
    expect(JSON.parse(s.last('runtime')?.data ?? '{}')).toEqual(expect.objectContaining({ opModeActive: true, opModeName: 'Auto Path' }));

    await waitFor(() => JSON.parse(s.last('opmode')?.data ?? '{}').phase === 'STOPPED', 'natural end', 3000);
    await waitFor(() => JSON.parse(s.last('execution')?.data ?? '{}').state === 'IDLE', 'execution IDLE');
    expect(JSON.parse(s.last('execution')?.data ?? '{}')).toMatchObject({ state: 'IDLE', subject: null, requestId: 1 });
    expect(JSON.parse(s.last('runtime')?.data ?? '{}')).toEqual(expect.objectContaining({ opModeActive: false, opModeName: null }));
    expect(robot.running).toBe(false);

    // The pose track starts at the route start, ends at its end, and is monotonic in x here.
    const xs = s.of('pose').map((m) => JSON.parse(m.data).x as number);
    expect(xs.length).toBeGreaterThan(8);
    expect(xs[0]).toBeCloseTo(0, 5);
    expect(xs.at(-1)).toBeCloseTo(48, 3);
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThanOrEqual((xs[i - 1] as number) - 1e-6);
    expect(JSON.parse(s.of('pose').at(-1)?.data ?? '{}').heading).toBeCloseTo(90, 3);
    s.abort();
  });

  it('STOP aborts the run: pose freezes, execution returns to IDLE', async () => {
    const robot = await cleanup.mock({ poseHz: 50, runDurationMs: 60_000 });
    robot.seedRoute('Path', [
      { x: 0, dx: 0, y: 0, dy: 0, heading: 0, dHeading: 0, duration: 0, marker: '', command: '', commandParams: [], delayAfterArrive: 0, maxPower: 1, brakeZoneIn: 0 },
      { x: 100, dx: 0, y: 0, dy: 0, heading: 0, dHeading: 0, duration: 4, marker: '', command: '', commandParams: [], delayAfterArrive: 0, maxPower: 1, brakeZoneIn: 0 },
    ]);
    robot.setOpModes([{ name: 'Auto Path', group: 'Auto', route: 'Path' }]);
    const t = await login(robot);
    const post = (action: string, body: unknown) => call(robot, 'POST', `/api/v2/opmode/${action}`, { token: t, body: JSON.stringify(body) });
    await post('init', { name: 'Auto Path', expectedRevision: 1 });
    await post('start', { name: 'Auto Path', expectedRevision: 2 });
    await sleep(250);
    expect(robot.execution).toMatchObject({ state: 'RUNNING', subject: 'Path' });
    const r = await post('stop', { name: 'Auto Path', expectedRevision: 3 });
    expect(r.status).toBe(202);
    expect(robot.opModeState).toMatchObject({ phase: 'STOPPED', activeName: null });
    expect(robot.execution).toMatchObject({ state: 'IDLE', subject: null });
    expect(robot.running).toBe(false);
    const frozen = robot.runtimeState;
    expect(frozen.x).toBeGreaterThan(0);
    expect(frozen.x).toBeLessThan(100);
    await sleep(150);
    expect(robot.runtimeState.x).toBe(frozen.x);
  });

  it('unbound op mode runs without moving; a bound-but-missing route also degrades gracefully', async () => {
    const robot = await cleanup.mock({ poseHz: 50, runDurationMs: 200 });
    robot.setOpModes([{ name: 'Park', group: 'Auto', route: null }, { name: 'Ghost', group: 'Auto', route: 'missing' }]);
    const t = await login(robot);
    const post = (action: string, name: string) => call(robot, 'POST', `/api/v2/opmode/${action}`, { token: t, body: JSON.stringify({ name, expectedRevision: robot.opModeRevision }) });
    for (const name of ['Park', 'Ghost']) {
      expect((await post('init', name)).status).toBe(202);
      expect((await post('start', name)).status).toBe(202);
      expect(robot.execution).toMatchObject({ state: 'RUNNING', subject: null });
      await waitFor(() => robot.opModeState.phase === 'STOPPED', `${name} finished`, 2000);
      expect(robot.execution.state).toBe('IDLE');
      expect(robot.runtimeState).toMatchObject({ x: 0, y: 0 });
    }
  });

  it('run length scales with the route duration within [minRunMs, maxRunMs]', async () => {
    const mk = (duration: number) => [
      { x: 0, dx: 0, y: 0, dy: 0, heading: 0, dHeading: 0, duration: 0, marker: '', command: '', commandParams: [], delayAfterArrive: 0, maxPower: 1, brakeZoneIn: 0 },
      { x: 10, dx: 0, y: 0, dy: 0, heading: 0, dHeading: 0, duration, marker: '', command: '', commandParams: [], delayAfterArrive: 0, maxPower: 1, brakeZoneIn: 0 },
    ];
    const durationFor = async (routeSeconds: number): Promise<number> => {
      const robot = await cleanup.mock({ poseHz: 50, runTimeScale: 0.1, minRunMs: 200, maxRunMs: 700 });
      robot.seedRoute('P', mk(routeSeconds));
      robot.setOpModes([{ name: 'A', group: 'Auto', route: 'P' }]);
      const t = await login(robot);
      const post = (action: string) => call(robot, 'POST', `/api/v2/opmode/${action}`, { token: t, body: JSON.stringify({ name: 'A', expectedRevision: robot.opModeRevision }) });
      await post('init');
      await post('start');
      const started = Date.now();
      await waitFor(() => robot.opModeState.phase === 'STOPPED', 'finished', 3000);
      return Date.now() - started;
    };
    const short = await durationFor(1); // 0.1 s → clamped to 200 ms
    const medium = await durationFor(5); // 0.5 s
    const long = await durationFor(60); // 6 s → clamped to 700 ms
    expect(short).toBeGreaterThanOrEqual(180);
    expect(short).toBeLessThan(450);
    expect(medium).toBeGreaterThan(short + 100);
    expect(long).toBeGreaterThanOrEqual(650);
    expect(long).toBeLessThan(1200);
    expect(long).toBeGreaterThan(medium);
  });

  it('stop() (reboot) aborts a running simulation but keeps routes', async () => {
    const robot = await cleanup.mock({ runDurationMs: 60_000 });
    robot.seedRoute('R', ROUTE_A);
    const t = await login(robot);
    const post = (action: string) => call(robot, 'POST', `/api/v2/opmode/${action}`, { token: t, body: JSON.stringify({ name: 'Auto A', expectedRevision: robot.opModeRevision }) });
    await post('init');
    await post('start');
    expect(robot.running).toBe(true);
    await robot.restart();
    expect(robot.running).toBe(false);
    expect(robot.opModeState.phase).toBe('STOPPED');
    expect(robot.execution.state).toBe('IDLE');
    expect(robot.hasRoute('R')).toBe(true);
    expect(robot.sessionOwned).toBe(false);
  });
});
