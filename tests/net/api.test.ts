/**
 * Port of RobotApiClientContractTest.kt against the Node mock robot, using the real FetchTransport.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { RobotApiClient, SESSION_HEADER, httpError, toApiError } from '../../src/net/api';
import { FetchTransport, TransportError, describeApiError, isHttpError, type ApiError, type Result } from '../../src/net/transport';
import { MockRobotServer } from '../../src/tools/mock-robot';
import { makeNode } from '../../src/core/node';
import { Cleanup, ROUTE_A, ROUTE_B } from './_util';

const cleanup = new Cleanup();
afterEach(() => cleanup.run());

/** Narrow a Result to ok / specific error, failing the test with the actual value otherwise. */
function ok<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.error)}`);
  return r.value;
}
function fail<T>(r: Result<T>): ApiError {
  if (r.ok) throw new Error(`expected error, got ${JSON.stringify(r.value)}`);
  return r.error;
}
function httpFail<T>(r: Result<T>) {
  const e = fail(r);
  if (e.kind !== 'http') throw new Error(`expected http error, got ${JSON.stringify(e)}`);
  return e;
}

async function setup(): Promise<{ robot: MockRobotServer; client: RobotApiClient }> {
  const robot = await cleanup.mock({ runDurationMs: 60_000 });
  return { robot, client: new RobotApiClient(robot.url) };
}
async function connected(): Promise<{ robot: MockRobotServer; client: RobotApiClient }> {
  const s = await setup();
  ok(await s.client.openSession('TestDesktop'));
  return s;
}

describe('session', () => {
  it('opens a session on the exact v2 endpoint and stores the token', async () => {
    const { robot, client } = await setup();
    const res = await client.openSession('TestDesktop');
    expect(res.ok && res.status).toBe(201);
    const value = ok(res);
    expect(value.token).toBe(robot.sessionToken);
    expect(value.expiresInMs).toBe(10_000);
    expect(client.token).toBe(value.token);

    const [req] = robot.requests;
    expect(req?.method).toBe('POST');
    expect(req?.url).toBe(`${robot.url}/api/v2/session`);
    expect(req?.headers['x-az-session']).toBeUndefined();
    expect(req?.headers['content-type']).toBe('application/json');
    expect(JSON.parse(req?.body ?? '')).toEqual({ client: 'TestDesktop' });
    expect(robot.sessionOwner).toBe('TestDesktop');
  });

  it('authenticated requests carry the session header', async () => {
    const { robot, client } = await connected();
    ok(await client.listRoutes());
    const req = robot.requests.at(-1);
    expect(req?.method).toBe('GET');
    expect(req?.url).toBe(`${robot.url}/api/v2/routes`);
    expect(req?.headers[SESSION_HEADER.toLowerCase()]).toBe(client.token);
  });

  it('an unauthenticated robot call fails locally without a network request', async () => {
    const { robot, client } = await setup();
    const err = fail(await client.listRoutes());
    expect(err.kind).toBe('no_session');
    expect(err.message).toContain('No active robot session');
    expect(robot.requests).toHaveLength(0);
  });

  it('closeSession clears the token, frees the lease and blocks later authenticated calls', async () => {
    const { robot, client } = await connected();
    const res = await client.closeSession();
    expect(res.ok && res.status).toBe(204);
    expect(client.token).toBeNull();
    expect(robot.sessionToken).toBeNull();
    const count = robot.requests.length;
    expect(fail(await client.listRoutes()).kind).toBe('no_session');
    expect(robot.requests).toHaveLength(count);
  });

  it('closeSession with a revoked token reports 401 and still forgets the token', async () => {
    const { robot, client } = await connected();
    robot.revokeSession();
    expect(httpFail(await client.closeSession()).status).toBe(401);
    expect(client.token).toBeNull();
  });

  it('a session conflict preserves 409, already_connected, owner and retryAfterMs', async () => {
    const robot = await cleanup.mock();
    const first = new RobotApiClient(robot.url);
    const second = new RobotApiClient(robot.url);
    ok(await first.openSession('Computer-A'));

    const err = httpFail(await second.openSession('Computer-B'));
    expect(err.status).toBe(409);
    expect(err.code).toBe('already_connected');
    expect(err.message).toBe('Computer-A');
    expect(err.owner).toBe('Computer-A');
    expect(err.retryAfterMs).toBeGreaterThan(9000);
    expect(err.retryAfterMs).toBeLessThanOrEqual(10_000);
    expect(second.token).toBeNull();
    expect(describeApiError(err)).toContain('already_connected');
  });

  it('after the first client closes, the second can take over', async () => {
    const robot = await cleanup.mock();
    const a = new RobotApiClient(robot.url);
    const b = new RobotApiClient(robot.url);
    ok(await a.openSession('A'));
    expect(fail(await b.openSession('B')).kind).toBe('http');
    ok(await a.closeSession());
    ok(await b.openSession('B'));
    expect(robot.sessionOwner).toBe('B');
  });

  it('an expired lease surfaces as 401 invalid_session', async () => {
    const robot = await cleanup.mock({ sessionTimeoutMs: 300 });
    const client = new RobotApiClient(robot.url);
    ok(await client.openSession('T'));
    await new Promise((r) => setTimeout(r, 450));
    const err = httpFail(await client.listRoutes());
    expect(err.status).toBe(401);
    expect(err.code).toBe('invalid_session');
  });

  it('health needs no session and reports ownership', async () => {
    const { client } = await setup();
    expect(ok(await client.health())).toEqual({ status: 'ok', protocol: 2, sessionOwned: false });
    ok(await client.openSession('T'));
    expect(ok(await client.health()).sessionOwned).toBe(true);
  });

  it('setRobotUrl drops the token and retargets requests', async () => {
    const a = await cleanup.mock();
    const b = await cleanup.mock();
    const client = new RobotApiClient(a.url);
    ok(await client.openSession('T'));
    client.setRobotUrl(b.url);
    expect(client.token).toBeNull();
    expect(client.baseUrl).toBe(b.url);
    expect(ok(await client.health()).sessionOwned).toBe(false);
    expect(() => client.setRobotUrl('')).toThrow(RangeError);
    expect(() => new RobotApiClient('ftp://x')).toThrow(RangeError);
  });

  it('normalises the robot address given to the constructor', async () => {
    const robot = await cleanup.mock();
    const client = new RobotApiClient(`  ${robot.url.toUpperCase().replace('HTTP', 'http')}/ignored?x=1 `);
    expect(ok(await client.health()).status).toBe('ok');
    expect(client.baseUrl).toBe(robot.url);
  });
});

describe('routes', () => {
  it('route CRUD follows the revision and path-encoding contract', async () => {
    const { robot, client } = await connected();
    const name = '蓝 路径(A)';
    const body = '[{"x":1,"y":2}]';

    const created = await client.putRoute(name, body, 0);
    expect(created.ok && created.status).toBe(201);
    expect(ok(created).revision).toBe(1);
    expect(ok(created).name).toBe(name);

    const put = robot.requests.at(-1);
    expect(put?.url).toBe(`${robot.url}/api/v2/routes/%E8%93%9D%20%E8%B7%AF%E5%BE%84%28A%29`);
    expect(put?.headers['if-match']).toBe('0');
    expect(put?.body).toBe(body);

    const fetched = ok(await client.getRoute(name));
    expect(fetched).toEqual({ name, revision: 1, json: body });

    const updated = await client.putRoute(name, '[{"x":3,"y":0}]', 1);
    expect(updated.ok && updated.status).toBe(200);
    expect(ok(updated).revision).toBe(2);
    expect(robot.requests.at(-1)?.headers['if-match']).toBe('1');

    const deleted = await client.deleteRoute(name, 2);
    expect(deleted.ok && deleted.status).toBe(204);
    expect(robot.hasRoute(name)).toBe(false);
    expect(robot.requests.at(-1)?.headers['if-match']).toBe('2');
  });

  it('listRoutes returns names, revisions and changeRevision', async () => {
    const { robot, client } = await connected();
    robot.seedRoute('Alpha', ROUTE_A, 2);
    robot.seedRoute('Beta', ROUTE_B);
    expect(ok(await client.listRoutes())).toEqual({
      routes: [{ name: 'Alpha', revision: 2 }, { name: 'Beta', revision: 1 }],
      changeRevision: robot.routesChangeRevision,
    });
  });

  it('getRoute returns the body verbatim and takes the revision from X-Route-Revision', async () => {
    const { robot, client } = await connected();
    const raw = '[ {"x": 1 , "y":2} ]'; // odd whitespace must survive byte-for-byte
    robot.seedRoute('Odd', raw, 11);
    expect(ok(await client.getRoute('Odd'))).toEqual({ name: 'Odd', revision: 11, json: raw });
  });

  it('a stale revision maps to HTTP 412 revision_mismatch with the robot’s actual revision', async () => {
    const { robot, client } = await connected();
    robot.seedRoute('Auto', ROUTE_A, 5);
    const err = httpFail(await client.putRoute('Auto', '[{"x":1,"y":0}]', 4));
    expect(err.status).toBe(412);
    expect(err.code).toBe('revision_mismatch');
    expect(err.actual).toBe(5);
    expect(err.body).toContain('"actual":5');
    expect(robot.getRoute('Auto')?.revision).toBe(5);
  });

  it('create-only (expected 0) on an existing route is a 412', async () => {
    const { robot, client } = await connected();
    robot.seedRoute('Auto', ROUTE_A, 1);
    const err = httpFail(await client.putRoute('Auto', ROUTE_B, 0));
    expect(err.status).toBe(412);
    expect(err.actual).toBe(1);
  });

  it('a concurrent writer between read and write is detected', async () => {
    const { robot, client } = await connected();
    robot.seedRoute('Race', ROUTE_A, 1);
    const read = ok(await client.getRoute('Race'));
    robot.beforeNextPut = () => { robot.mutateRemoteRoute('Race', ROUTE_B); };
    const err = httpFail(await client.putRoute('Race', '[{"x":9,"y":9}]', read.revision));
    expect(err.status).toBe(412);
    expect(err.actual).toBe(2);
    expect(robot.getRoute('Race')?.json).toBe(ROUTE_B);
  });

  it('deleting with a stale revision is a 412; deleting a missing route is a 404', async () => {
    const { robot, client } = await connected();
    robot.seedRoute('R', ROUTE_A, 3);
    const stale = httpFail(await client.deleteRoute('R', 2));
    expect(stale.status).toBe(412);
    expect(stale.actual).toBe(3);
    expect(robot.hasRoute('R')).toBe(true);
    const missing = httpFail(await client.deleteRoute('ghost', 1));
    expect(missing.status).toBe(404);
    expect(missing.code).toBe('route_not_found');
  });

  it('a missing route maps to 404 route_not_found instead of a network failure', async () => {
    const { client } = await connected();
    const err = httpFail(await client.getRoute('missing'));
    expect(err.status).toBe(404);
    expect(err.code).toBe('route_not_found');
  });

  it('an invalid spline is rejected locally before any HTTP PUT', async () => {
    const { robot, client } = await connected();
    const before = robot.requests.length;
    const err = fail(await client.putRoute('Auto', '[{"x":1,"y":2,"endSpeed":0}]', 0));
    expect(err.kind).toBe('contract');
    expect(err.message).toContain('制动区');
    expect(robot.requests).toHaveLength(before);
    expect(fail(await client.putRoute('Auto', '[]', 0)).kind).toBe('contract');
    expect(fail(await client.putRoute('Auto', 'not json', 0)).kind).toBe('contract');
    expect(robot.requests).toHaveLength(before);
  });

  it('revisions must be non-negative integers', async () => {
    const { client } = await connected();
    await expect(client.putRoute('A', ROUTE_A, -1)).rejects.toThrow(RangeError);
    await expect(client.deleteRoute('A', 1.5)).rejects.toThrow(RangeError);
    await expect(client.initOpMode('A', Number.NaN)).rejects.toThrow(RangeError);
  });

  it('putRouteNodes encodes nodes to the robot wire format', async () => {
    const { robot, client } = await connected();
    const nodes = [makeNode({ x: 0, y: 0, duration: 0 }), makeNode({ x: 10, y: 5, dx: 3, duration: 2, delayAfterArrive: 0.5 })];
    ok(await client.putRouteNodes('N', nodes, 0));
    const frames = JSON.parse(robot.getRoute('N')?.json ?? '[]') as Array<Record<string, unknown>>;
    expect(frames).toHaveLength(3); // 2 points + 1 wait frame
    expect(frames[1]).toMatchObject({ x: 10, y: 5, dx: 3, duration: 2 });
    expect(frames[2]).toEqual({ wait: 0.5 });
  });

  it('percent-encodes tricky names so they round-trip', async () => {
    const { robot, client } = await connected();
    for (const name of ['a/b', 'q?x#y', '100%', 'plus+sign', 'emoji😀', 'with space']) {
      ok(await client.putRoute(name, ROUTE_A, 0));
      expect(robot.hasRoute(name), name).toBe(true);
      expect(ok(await client.getRoute(name)).json).toBe(ROUTE_A);
      ok(await client.deleteRoute(name, 1));
    }
  });
});

describe('robot state', () => {
  it('executionState / commandCatalog / runtimeSnapshot decode the robot payloads', async () => {
    const { robot, client } = await connected();
    expect(ok(await client.executionState())).toEqual({ state: 'IDLE', requestId: 0, subject: null, revision: 1 });
    expect(ok(await client.commandCatalog())).toEqual({ revision: 1, commands: [] });

    robot.publishExecution('RUNNING', 3, 'Auto');
    robot.setCommands([{ name: 'shoot', paramNames: ['n', 'p'], paramTypes: ['int', 'double'], paramDefaults: [null, '0.8'] }]);
    robot.publishRuntime(true, 'HttpAuto', { x: 1.25, y: -2.5, heading: 90 });
    expect(ok(await client.executionState())).toEqual({ state: 'RUNNING', requestId: 3, subject: 'Auto', revision: 2 });
    expect(ok(await client.commandCatalog())).toEqual({
      revision: 2, commands: [{ name: 'shoot', paramNames: ['n', 'p'], paramTypes: ['int', 'double'], paramDefaults: [null, '0.8'] }],
    });
    const snap = ok(await client.runtimeSnapshot());
    expect(snap.runtime).toEqual({ seq: 1, opModeActive: true, opModeName: 'HttpAuto' });
    expect(snap.pose).toMatchObject({ seq: 1, x: 1.25, y: -2.5, heading: 90 });
  });

  it('a non-JSON or incomplete 2xx body becomes a parse error, not a throw', async () => {
    let body = '<html>captive portal</html>';
    const client = new RobotApiClient('127.0.0.1', {
      transport: {
        request: async (req) => ({
          status: req.method === 'POST' ? 201 : 200,
          headers: {},
          text: req.method === 'POST' ? '{"token":"t","expiresInMs":10000}' : body,
        }),
        openEvents: () => Promise.reject(new Error('unused')),
      },
    });
    ok(await client.openSession('T'));
    expect(fail(await client.listRoutes())).toMatchObject({ kind: 'parse' });
    body = '{"routes":[{"name":"A"}]}'; // entry without revision
    expect(fail(await client.listRoutes()).kind).toBe('parse');
    body = '{"state":"EXPLODING"}';
    expect(fail(await client.executionState()).kind).toBe('parse');
    body = '{"routes":[{"name":"A","revision":2}]}';
    expect(ok(await client.listRoutes()).routes).toEqual([{ name: 'A', revision: 2 }]);
  });

  it('a route GET without any revision header is a parse error', async () => {
    const client = new RobotApiClient('127.0.0.1', {
      transport: {
        request: async (req) => (req.method === 'POST'
          ? { status: 201, headers: {}, text: '{"token":"t","expiresInMs":1}' }
          : { status: 200, headers: {}, text: '[]' }),
        openEvents: () => Promise.reject(new Error('unused')),
      },
    });
    ok(await client.openSession('T'));
    expect(fail(await client.getRoute('x')).kind).toBe('parse');
  });
});

describe('manual command run (POST /api/v2/commands/run)', () => {
  const shoot = { name: 'shoot', paramNames: ['count', 'power'], paramTypes: ['int', 'double'], paramDefaults: [null, '0.8'] };
  const spin = { name: 'shooter.spin', paramNames: ['rpm', 'reverse', 'label'], paramTypes: ['int', 'boolean', 'String'], paramDefaults: [null, 'true', ''] };

  /** Firmware shape: only the TeleOp-like `Remote` OpMode attaches the dispatcher; `Auto A` is a plain Autonomous. */
  async function running(start = true) {
    const s = await connected();
    s.robot.setOpModes([{ name: 'Remote', group: 'Test', route: null, commands: true }, 'Auto A']);
    s.robot.setCommands([shoot, spin, { name: 'intakeOn', paramNames: [], paramTypes: [] }]);
    ok(await s.client.initOpMode('Remote', s.robot.opModeRevision));
    if (start) ok(await s.client.startOpMode('Remote', s.robot.opModeRevision));
    return s;
  }
  const code = (e: ReturnType<typeof httpFail>) => [e.status, e.code];

  it('posts name, string args and the op mode revision, and is accepted with 202', async () => {
    const { robot, client } = await running();
    const res = await client.runCommand('shoot', ['3', '0.5'], robot.opModeRevision);
    expect(res.ok && res.status).toBe(202);
    expect(ok(res)).toEqual({ accepted: true, name: 'shoot' });
    const req = robot.requests.at(-1);
    expect(req?.url).toBe(`${robot.url}/api/v2/commands/run`);
    expect(req?.headers[SESSION_HEADER.toLowerCase()]).toBe(robot.sessionToken);
    expect(JSON.parse(req?.body ?? '')).toEqual({ name: 'shoot', args: ['3', '0.5'], expectedRevision: robot.opModeRevision });
    expect(robot.commandRuns).toEqual([{ name: 'shoot', args: ['3', '0.5'] }]);
    expect(robot.execution.state).toBe('IDLE');
  });

  it('a command OpMode keeps execution IDLE; the robot completes omitted trailing defaults itself', async () => {
    const { robot, client } = await running();
    ok(await client.runCommand('shoot', ['3'], robot.opModeRevision));
    ok(await client.runCommand('shooter.spin', ['900'], robot.opModeRevision));
    expect(robot.commandRuns).toEqual([
      { name: 'shoot', args: ['3', '0.8'] },
      { name: 'shooter.spin', args: ['900', 'true', ''] },
    ]);
  });

  it('is refused while STOPPED, while only INIT, and in an OpMode that does not take commands', async () => {
    const stopped = await connected();
    stopped.robot.setCommands([shoot]);
    expect(code(httpFail(await stopped.client.runCommand('shoot', ['3', '0.8'], stopped.robot.opModeRevision)))).toEqual([409, 'command_not_ready']);

    const init = await running(false);
    expect(code(httpFail(await init.client.runCommand('intakeOn', [], init.robot.opModeRevision)))).toEqual([409, 'command_not_ready']);

    const auto = await connected();
    auto.robot.setCommands([shoot]);
    ok(await auto.client.initOpMode('Auto A', auto.robot.opModeRevision));
    ok(await auto.client.startOpMode('Auto A', auto.robot.opModeRevision));
    expect(code(httpFail(await auto.client.runCommand('shoot', ['3', '0.8'], auto.robot.opModeRevision)))).toEqual([409, 'command_not_ready']);
    expect([stopped, init, auto].flatMap((s) => s.robot.commandRuns)).toEqual([]);
  });

  it('refuses to run while a route is executing', async () => {
    const { robot, client } = await running();
    robot.publishExecution('RUNNING', 1, 'Route A');
    expect(code(httpFail(await client.runCommand('intakeOn', [], robot.opModeRevision)))).toEqual([409, 'route_executing']);
    expect(robot.commandRuns).toEqual([]);
  });

  it('a stale revision is a 409 state_changed and sends exactly one request', async () => {
    const { robot, client } = await running();
    const stale = robot.opModeRevision;
    robot.bumpOpModeRevision();
    const before = robot.requests.length;
    const err = httpFail(await client.runCommand('intakeOn', [], stale));
    expect(code(err)).toEqual([409, 'state_changed']);
    expect(robot.requests).toHaveLength(before + 1);
    expect(robot.commandRuns).toEqual([]);
  });

  it('maps unknown commands and bad or incomplete arguments to 404 / 400 like the firmware', async () => {
    const { robot, client } = await running();
    const run = async (name: string, args: string[]) => code(httpFail(await client.runCommand(name, args, robot.opModeRevision)));
    expect(await run('nope', [])).toEqual([404, 'command_not_found']);
    expect(await run('shoot', ['1.5', '0.8'])).toEqual([400, 'invalid_command_args']); // int
    expect(await run('shoot', [])).toEqual([400, 'invalid_command_args']); // required count missing
    expect(await run('shoot', ['3', '0.8', 'x'])).toEqual([400, 'invalid_command_args']); // too many
    expect(await run('shoot', ['3000000000', '0.8'])).toEqual([400, 'invalid_command_args']); // beyond int
    expect(await run('shoot', [' 3', '0.8'])).toEqual([400, 'invalid_command_args']); // Integer.valueOf takes no spaces
    expect(await run('shooter.spin', ['9', 'maybe'])).toEqual([400, 'invalid_command_args']); // boolean
    expect(robot.commandRuns).toEqual([]);
  });

  it('rejects a bad revision locally without sending anything', async () => {
    const { robot, client } = await running();
    const before = robot.requests.length;
    await expect(client.runCommand('intakeOn', [], -1)).rejects.toThrow(RangeError);
    expect(robot.requests).toHaveLength(before);
  });
});

describe('op mode lifecycle', () => {
  it('uses revision-guarded v2 endpoints end to end', async () => {
    const { robot, client } = await connected();

    expect(ok(await client.listOpModes()).opModes.map((o) => o.name)).toEqual(['Auto A', 'Auto B']);
    const initial = ok(await client.opModeState());
    expect(initial).toEqual({ revision: 1, controllerAvailable: true, phase: 'STOPPED', activeName: null });

    const accepted = ok(await client.initOpMode('Auto A', initial.revision));
    expect(accepted).toEqual({ accepted: true, action: 'init', name: 'Auto A' });
    const initReq = robot.requests.at(-1);
    expect(initReq?.url).toBe(`${robot.url}/api/v2/opmode/init`);
    expect(JSON.parse(initReq?.body ?? '')).toEqual({ name: 'Auto A', expectedRevision: initial.revision });

    const initState = ok(await client.opModeState());
    expect(initState.phase).toBe('INIT');
    expect(initState.activeName).toBe('Auto A');

    ok(await client.startOpMode('Auto A', initState.revision));
    const running = ok(await client.opModeState());
    expect(running.phase).toBe('RUNNING');

    const stop = await client.stopOpMode('Auto A', running.revision);
    expect(stop.ok && stop.status).toBe(202);
    expect(ok(await client.opModeState()).phase).toBe('STOPPED');
  });

  it('a stale op mode revision stays a 409 state_changed and is not retried', async () => {
    const { robot, client } = await connected();
    const stale = robot.opModeRevision;
    robot.bumpOpModeRevision();
    const before = robot.requests.length;
    const err = httpFail(await client.initOpMode('Auto A', stale));
    expect(err.status).toBe(409);
    expect(err.code).toBe('state_changed');
    expect(robot.requests).toHaveLength(before + 1);
  });

  it('maps unknown op mode, wrong phase and detached controller to 404 / 409 / 503', async () => {
    const { robot, client } = await connected();
    let err = httpFail(await client.initOpMode('Nope', robot.opModeRevision));
    expect(err.status).toBe(404);
    expect(err.code).toBe('opmode_not_found');

    err = httpFail(await client.startOpMode('Auto A', robot.opModeRevision));
    expect(err.status).toBe(409);
    expect(err.code).toBe('opmode_not_initialized');

    ok(await client.initOpMode('Auto A', robot.opModeRevision));
    err = httpFail(await client.initOpMode('Auto B', robot.opModeRevision));
    expect(err.code).toBe('opmode_not_stopped');
    err = httpFail(await client.stopOpMode('Auto B', robot.opModeRevision));
    expect(err.code).toBe('opmode_mismatch');

    robot.setControllerAvailable(false);
    err = httpFail(await client.listOpModes());
    expect(err.status).toBe(503);
    expect(err.code).toBe('controller_unavailable');
    err = httpFail(await client.initOpMode('Auto A', robot.opModeRevision));
    expect(err.status).toBe(503);
  });

  it('a route-bound op mode drives execution state through the API', async () => {
    const robot = await cleanup.mock({ runDurationMs: 250, poseHz: 50 });
    robot.seedRoute('Path', '[{"x":0,"y":0,"duration":0},{"x":20,"y":0,"duration":2}]');
    robot.setOpModes([{ name: 'Auto Path', group: 'Auto', route: 'Path' }]);
    const client = new RobotApiClient(robot.url);
    ok(await client.openSession('T'));

    ok(await client.initOpMode('Auto Path', ok(await client.opModeState()).revision));
    ok(await client.startOpMode('Auto Path', ok(await client.opModeState()).revision));
    expect(ok(await client.executionState())).toMatchObject({ state: 'RUNNING', subject: 'Path', requestId: 1 });
    await new Promise((r) => setTimeout(r, 450));
    expect(ok(await client.executionState())).toMatchObject({ state: 'IDLE', subject: null });
    expect(ok(await client.opModeState()).phase).toBe('STOPPED');
    expect(ok(await client.runtimeSnapshot()).pose.x).toBeCloseTo(20, 3);
  });
});

describe('failures', () => {
  it('a transport exception maps to an unreachable error', async () => {
    const { robot, client } = await setup();
    robot.dropNextRequests = 1;
    const err = fail(await client.health());
    expect(err.kind).toBe('unreachable');
    expect(err.message).toContain('Network request failed');
    expect(describeApiError(err)).toBe(err.message);
  });

  it('an unreachable robot never throws out of the client', async () => {
    const robot = await cleanup.mock();
    const client = new RobotApiClient(robot.url);
    ok(await client.openSession('T'));
    const url = robot.url;
    await robot.stop();
    expect(client.baseUrl).toBe(url);
    expect(fail(await client.listRoutes()).kind).toBe('unreachable');
    expect(fail(await client.putRoute('A', ROUTE_A, 0)).kind).toBe('unreachable');
    expect(fail(await client.closeSession()).kind).toBe('unreachable');
    expect(client.token).not.toBeNull(); // failed DELETE keeps the token
  });

  it('a slow robot yields a timeout error', async () => {
    const robot = await cleanup.mock();
    const client = new RobotApiClient(robot.url, { transport: new FetchTransport({ timeoutMs: 120 }) });
    robot.responseDelayMs = 500;
    expect(fail(await client.health()).kind).toBe('timeout');
  });

  it('a revoked session yields 401 invalid_session on every authenticated call', async () => {
    const { robot, client } = await connected();
    robot.revokeSession();
    const calls: Array<() => Promise<Result<unknown>>> = [() => client.listRoutes(), () => client.executionState(), () => client.listOpModes(), () => client.getRoute('x')];
    for (const call of calls) {
      const err = httpFail(await call());
      expect(err.status).toBe(401);
      expect(err.code).toBe('invalid_session');
    }
    expect(client.token).not.toBeNull(); // the client does not guess; the connection layer clears it
    client.clearToken();
    expect(client.token).toBeNull();
  });

  it('event URLs', async () => {
    const { robot, client } = await setup();
    expect(client.eventUrl()).toBeNull();
    expect(client.eventsUrl()).toBe(`${robot.url}/api/v2/events`);
    ok(await client.openSession('T'));
    expect(client.eventUrl()).toBe(`${robot.url}/api/v2/events?session=${client.token}`);
  });

  it('toApiError / httpError helpers', () => {
    expect(toApiError(new TransportError('timeout', 'slow'))).toEqual({ kind: 'timeout', message: 'slow' });
    expect(toApiError(new TransportError('aborted', 'x')).kind).toBe('aborted');
    expect(toApiError(new TransportError('http', 'x', { status: 401, body: '{"error":"invalid_session"}' }))).toMatchObject({ kind: 'http', status: 401, code: 'invalid_session' });
    expect(toApiError(new Error('boom'))).toMatchObject({ kind: 'unreachable', message: 'boom' });
    const e = httpError(409, '{"error":"already_connected","owner":"X","retryAfterMs":1200}');
    expect(isHttpError(e, 409)).toBe(true);
    expect(isHttpError(e, 500)).toBe(false);
    expect(e).toMatchObject({ code: 'already_connected', owner: 'X', retryAfterMs: 1200, message: 'X' });
    expect(httpError(500, 'not json')).toMatchObject({ status: 500, code: null, message: '', body: 'not json' });
  });
});
