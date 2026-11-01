/**
 * Network V2 mock robot — a Node `http` server that reproduces the wire behaviour of the real
 * robot (Shared/.../common/network: RobotApiRouter, HttpExchange, SessionLease, RobotEventStream,
 * OpModeLifecycleService) closely enough to develop the web client against it and to run
 * contract tests with the real `FetchTransport`.
 *
 * Node-only (uses `node:http`); never import it from browser code.
 *
 *   const robot = new MockRobotServer({ poseHz: 20 });
 *   await robot.start();               // port 0 → ephemeral
 *   robot.seedRoute('Auto', framesJson);
 *   … talk to robot.url …
 *   await robot.stop();
 *
 * Differences from the real robot, on purpose: the mock listens on loopback by default, a route
 * PUT body is stored verbatim (the real router does not validate it either), and opmode actions
 * take effect synchronously (the real backend publishes the new phase a moment later).
 */
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { makeNode, type ControlNode } from '../core/node';
import { RouteCore } from '../core/route';
import { decodeRobotRoute, encodeRobotRoute } from '../core/wire';

// ---------------------------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------------------------

export type MockOpModePhase = 'STOPPED' | 'INIT' | 'RUNNING';
export type MockExecutionState = 'NOT_READY' | 'IDLE' | 'RUNNING';

export interface MockRouteEntry { name: string; json: string; revision: number }
/** `route` binds the op mode to a stored route: START then plays that route's pose track. */
export interface MockOpMode { name: string; group: string; route: string | null }
export interface MockCommand { name: string; paramNames: string[]; paramTypes: string[] }
export interface MockOpModeSnapshot {
  revision: number;
  controllerAvailable: boolean;
  phase: MockOpModePhase;
  activeName: string | null;
}
export interface MockExecutionSnapshot {
  state: MockExecutionState;
  requestId: number;
  subject: string | null;
  revision: number;
}
export interface MockRuntimeSnapshot {
  seq: number;
  tNanos: number;
  opModeActive: boolean;
  opModeName: string | null;
  x: number;
  y: number;
  heading: number;
}

export interface MockRobotOptions {
  /** Bind address. Default `127.0.0.1`. */
  host?: string;
  /** Pose frames per second pushed on the event stream (and simulation tick rate). Default 60. */
  poseHz?: number;
  /** Session lease length. Default 10000 (the real robot uses 10000 and rejects < 1000). */
  sessionTimeoutMs?: number;
  /** Heartbeat period of the event stream. Default 1000. */
  heartbeatMs?: number;
  /** Fixed length (ms) of a simulated run, overriding the route-derived one. */
  runDurationMs?: number;
  /** Real seconds of simulation per route second. Default 0.25. */
  runTimeScale?: number;
  /** Bounds of the route-derived run length. Defaults 1500 / 6000 ms. */
  minRunMs?: number;
  maxRunMs?: number;
  /** Execution state at boot. Default `IDLE` (the real robot boots `NOT_READY`). */
  initialExecutionState?: MockExecutionState;
  /** Request log sink (one line per request). Default: silent. */
  log?: (line: string) => void;
}

export interface RecordedRequest {
  method: string;
  /** Raw request target, e.g. `/api/v2/events?session=abc`. */
  target: string;
  /** Absolute URL as the client addressed it (`http://<Host>/<target>`). */
  url: string;
  /** Decoded path. */
  path: string;
  query: Record<string, string>;
  /** Header names lower-cased. */
  headers: Record<string, string>;
  body: string;
  /** Filled in once the response was sent (SSE streams: 200 when opened). */
  status: number | null;
}

// ---------------------------------------------------------------------------------------------
// Constants copied from the robot
// ---------------------------------------------------------------------------------------------

const PREFIX = '/api/v2';
const MAX_BODY_BYTES = 2 * 1024 * 1024;

/** HttpExchange.BROWSER_ACCESS_HEADERS (+ Vary). */
const BROWSER_ACCESS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Az-Session, If-Match, Last-Event-ID',
  'Access-Control-Expose-Headers': 'ETag, X-Route-Revision',
  'Access-Control-Allow-Private-Network': 'true',
  'Access-Control-Max-Age': '600',
  'Cross-Origin-Resource-Policy': 'cross-origin',
  Vary: 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers, Access-Control-Request-Private-Network',
};

const JSON_TYPE = 'application/json; charset=utf-8';

class BadRequest extends Error {}

/** `JsonUtil.number`: `%.6f`, `null` for NaN/Infinity. */
function jsonNumber(v: number): string {
  return Number.isFinite(v) ? v.toFixed(6) : 'null';
}
const jsonString = (v: string | null): string => (v === null ? 'null' : JSON.stringify(v));

/** `java.net.URLDecoder.decode(.., "UTF-8")`: `+` → space, `%XX` as UTF-8 bytes, throws on bad escapes. */
function javaUrlDecode(value: string): string {
  if (!value.includes('%') && !value.includes('+')) return value;
  const bytes: number[] = [];
  const enc = new TextEncoder();
  for (let i = 0; i < value.length; i++) {
    const c = value[i] as string;
    if (c === '+') {
      bytes.push(0x20);
    } else if (c === '%') {
      const hex = value.slice(i + 1, i + 3);
      if (!/^[0-9a-fA-F]{2}$/.test(hex)) throw new BadRequest('Invalid URL encoding');
      bytes.push(parseInt(hex, 16));
      i += 2;
    } else {
      for (const b of enc.encode(c)) bytes.push(b);
    }
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(Uint8Array.from(bytes));
}

function parseQuery(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (raw === '') return out;
  for (const pair of raw.split('&')) {
    if (pair === '') continue;
    const eq = pair.indexOf('=');
    const key = eq >= 0 ? pair.slice(0, eq) : pair;
    const val = eq >= 0 ? pair.slice(eq + 1) : '';
    out[javaUrlDecode(key)] = javaUrlDecode(val);
  }
  return out;
}

/** `Long.parseLong` after trimming and unquoting, `null` when absent/unparsable (→ 428). */
function parseIfMatch(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === '') return null;
  let t = raw.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) t = t.slice(1, -1);
  return /^[+-]?\d+$/.test(t) ? Number(t) : null;
}

const nowMs = (): number => performance.now();

// ---------------------------------------------------------------------------------------------
// Session lease (SessionLease.java)
// ---------------------------------------------------------------------------------------------

class SessionLease {
  token: string | null = null;
  owner: string | null = null;
  private lastTouch = 0;

  constructor(readonly timeoutMs: number) {}

  private expireIfNeeded(now: number): void {
    if (this.token !== null && now - this.lastTouch > this.timeoutMs) this.clear();
  }
  private clear(): void {
    this.token = null;
    this.owner = null;
    this.lastTouch = 0;
  }
  private remaining(now: number): number {
    return this.token === null ? 0 : Math.max(0, Math.round(this.timeoutMs - (now - this.lastTouch)));
  }

  open(requestedOwner: string): { acquired: true; token: string; expiresInMs: number } | { acquired: false; expiresInMs: number } {
    const now = nowMs();
    this.expireIfNeeded(now);
    if (this.token !== null) return { acquired: false, expiresInMs: this.remaining(now) };
    this.token = randomBytes(24).toString('hex');
    this.owner = requestedOwner;
    this.lastTouch = now;
    return { acquired: true, token: this.token, expiresInMs: this.timeoutMs };
  }
  validate(candidate: string | null): boolean {
    this.expireIfNeeded(nowMs());
    return this.token !== null && this.token === candidate;
  }
  touch(candidate: string | null): boolean {
    const now = nowMs();
    this.expireIfNeeded(now);
    if (this.token === null || this.token !== candidate) return false;
    this.lastTouch = now;
    return true;
  }
  close(candidate: string | null): boolean {
    if (this.token === null || this.token !== candidate) return false;
    this.clear();
    return true;
  }
  revoke(): void { this.clear(); }
  isOwned(): boolean {
    this.expireIfNeeded(nowMs());
    return this.token !== null;
  }
  currentOwner(): string | null {
    this.expireIfNeeded(nowMs());
    return this.owner;
  }
}

// ---------------------------------------------------------------------------------------------
// Request / reply helpers
// ---------------------------------------------------------------------------------------------

interface Ctx {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: string;
  record: RecordedRequest;
  req: http.IncomingMessage;
  res: http.ServerResponse;
  /** `X-Az-Session` header, else `?session=`. */
  token: string | null;
}

interface StreamClient {
  res: http.ServerResponse;
  token: string;
  timer: ReturnType<typeof setInterval> | null;
  lastPoseSeq: number;
  lastExecutionRevision: number;
  lastRouteRevision: number;
  lastCommandRevision: number;
  lastOpModeRevision: number;
  runtimeSent: boolean;
  lastOpModeActive: boolean;
  lastOpModeName: string | null;
  lastHeartbeat: number;
  closed: boolean;
}

interface ActiveRun {
  timer: ReturnType<typeof setInterval>;
  startedAt: number;
  durationMs: number;
  core: RouteCore | null;
  opModeName: string;
}

// ---------------------------------------------------------------------------------------------
// MockRobotServer
// ---------------------------------------------------------------------------------------------

export class MockRobotServer {
  // ---- observability (public, for assertions) ----------------------------------------------
  /** Every request received, oldest first. */
  readonly requests: RecordedRequest[] = [];
  /** Raw targets of all `GET /events` requests that were accepted (200). */
  readonly openedEventTargets: string[] = [];

  // ---- fault injection ----------------------------------------------------------------------
  /** Runs (once) before a route PUT is evaluated — simulate a concurrent writer. */
  beforeNextPut: (() => void) | null = null;
  /** The next N requests get their socket destroyed without a response (client sees "unreachable"). */
  dropNextRequests = 0;
  /** Extra latency (ms) added before every non-SSE response. */
  responseDelayMs = 0;

  // ---- state --------------------------------------------------------------------------------
  private readonly routeMap = new Map<string, MockRouteEntry>();
  private routeChangeRevision = 1;
  private opModeList: MockOpMode[] = [
    { name: 'Auto A', group: 'Auto', route: null },
    { name: 'Auto B', group: 'Auto', route: null },
  ];
  private opSnap: MockOpModeSnapshot = { revision: 1, controllerAvailable: true, phase: 'STOPPED', activeName: null };
  private execSnap: MockExecutionSnapshot;
  private commandList: MockCommand[] = [];
  private commandRevision = 1;
  private runtime: MockRuntimeSnapshot = { seq: 0, tNanos: 0, opModeActive: false, opModeName: null, x: 0, y: 0, heading: 0 };
  private lastRequestId = 0;
  private run: ActiveRun | null = null;
  private streamsMuted = false;

  // ---- infrastructure -----------------------------------------------------------------------
  private readonly opts: {
    host: string; poseHz: number; sessionTimeoutMs: number; heartbeatMs: number;
    runTimeScale: number; minRunMs: number; maxRunMs: number;
    initialExecutionState: MockExecutionState;
    log: ((line: string) => void) | undefined;
    runDurationMs: number | undefined;
  };
  private lease: SessionLease;
  private server: http.Server | null = null;
  private listenPort = 0;
  private readonly sockets = new Set<Socket>();
  private readonly streams = new Set<StreamClient>();

  constructor(options: MockRobotOptions = {}) {
    this.opts = {
      host: options.host ?? '127.0.0.1',
      poseHz: options.poseHz ?? 60,
      sessionTimeoutMs: options.sessionTimeoutMs ?? 10_000,
      heartbeatMs: options.heartbeatMs ?? 1000,
      runTimeScale: options.runTimeScale ?? 0.25,
      minRunMs: options.minRunMs ?? 1500,
      maxRunMs: options.maxRunMs ?? 6000,
      initialExecutionState: options.initialExecutionState ?? 'IDLE',
      log: options.log,
      runDurationMs: options.runDurationMs,
    };
    if (!(this.opts.poseHz > 0)) throw new RangeError('poseHz must be > 0');
    this.lease = new SessionLease(this.opts.sessionTimeoutMs);
    this.execSnap = { state: this.opts.initialExecutionState, requestId: 0, subject: null, revision: 1 };
  }

  // ===========================================================================================
  // Lifecycle
  // ===========================================================================================

  /** Listen on `port` (0 = ephemeral). Resolves with the bound port. */
  async start(port = 0): Promise<number> {
    if (this.server) throw new Error('MockRobotServer already started');
    const server = http.createServer((req, res) => this.onRequest(req, res));
    server.on('connection', (socket) => {
      socket.setNoDelay(true);
      this.sockets.add(socket);
      socket.on('close', () => this.sockets.delete(socket));
    });
    server.on('clientError', (_e, socket) => {
      if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    });
    await new Promise<void>((resolve, reject) => {
      const onError = (e: Error): void => reject(e);
      server.once('error', onError);
      server.listen(port, this.opts.host, () => {
        server.off('error', onError);
        resolve();
      });
    });
    this.server = server;
    this.listenPort = (server.address() as AddressInfo).port;
    return this.listenPort;
  }

  /**
   * Shut down like a robot reboot: sockets and event streams are closed, a running simulation is
   * aborted and the session lease is lost. Routes, op modes, commands and revisions persist.
   */
  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (this.opSnap.phase !== 'STOPPED' || this.run) this.finishRun(); // a reboot forgets the run
    for (const s of [...this.streams]) this.closeStream(s);
    this.lease.revoke();
    this.streamsMuted = false;
    if (!server) return;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
      for (const s of this.sockets) s.destroy();
    });
  }

  /** `stop()` then `start()` on the same port. */
  async restart(): Promise<number> {
    const port = this.listenPort;
    await this.stop();
    return this.start(port);
  }

  get isRunning(): boolean { return this.server !== null; }
  get port(): number { return this.listenPort; }
  /** Base URL clients should use (`http://127.0.0.1:<port>`). */
  get url(): string {
    const host = this.opts.host === '0.0.0.0' || this.opts.host === '::' ? '127.0.0.1' : this.opts.host;
    return `http://${host.includes(':') ? `[${host}]` : host}:${this.listenPort}`;
  }
  get poseHz(): number { return this.opts.poseHz; }

  // ===========================================================================================
  // State helpers — routes
  // ===========================================================================================

  /** Insert/overwrite a route without bumping its revision logic: it gets exactly `revision`. */
  seedRoute(name: string, route: string | readonly ControlNode[] | readonly unknown[], revision = 1): void {
    this.routeMap.set(name, { name, json: routeToJson(route), revision });
    this.routeChangeRevision++;
  }

  /** Simulate another computer writing the route: revision +1 (or 1 if new), change revision +1. */
  mutateRemoteRoute(name: string, route: string | readonly ControlNode[] | readonly unknown[]): MockRouteEntry {
    const cur = this.routeMap.get(name);
    const entry: MockRouteEntry = { name, json: routeToJson(route), revision: cur ? cur.revision + 1 : 1 };
    this.routeMap.set(name, entry);
    this.routeChangeRevision++;
    return entry;
  }

  /** Simulate another computer deleting the route. Returns whether it existed. */
  deleteRemoteRoute(name: string): boolean {
    const existed = this.routeMap.delete(name);
    if (existed) this.routeChangeRevision++;
    return existed;
  }

  getRoute(name: string): MockRouteEntry | undefined {
    const e = this.routeMap.get(name);
    return e ? { ...e } : undefined;
  }
  hasRoute(name: string): boolean { return this.routeMap.has(name); }
  get routeNames(): string[] { return [...this.routeMap.keys()]; }
  /** Live read-only view (name → entry). */
  get routes(): ReadonlyMap<string, Readonly<MockRouteEntry>> { return this.routeMap; }
  get routesChangeRevision(): number { return this.routeChangeRevision; }
  clearRoutes(): void {
    if (this.routeMap.size === 0) return;
    this.routeMap.clear();
    this.routeChangeRevision++;
  }

  // ===========================================================================================
  // State helpers — op modes
  // ===========================================================================================

  get opModes(): readonly MockOpMode[] { return this.opModeList; }

  /** Replace the autonomous list. Strings are plain unbound op modes in group `Auto`. */
  setOpModes(list: ReadonlyArray<string | { name: string; group?: string; route?: string | null }>): void {
    this.opModeList = list.map((o) => (typeof o === 'string'
      ? { name: o, group: 'Auto', route: null }
      : { name: o.name, group: o.group ?? 'Auto', route: o.route ?? null }));
  }

  addOpMode(name: string, options: { group?: string; route?: string | null } = {}): void {
    this.opModeList = [
      ...this.opModeList.filter((o) => o.name !== name),
      { name, group: options.group ?? 'Auto', route: options.route ?? null },
    ];
  }

  /** Bind (or with `null` unbind) an op mode to a route. Throws if the op mode does not exist. */
  bindOpModeToRoute(opModeName: string, routeName: string | null): void {
    const op = this.opModeList.find((o) => o.name === opModeName);
    if (!op) throw new Error(`unknown op mode '${opModeName}'`);
    op.route = routeName;
  }

  get opModeState(): Readonly<MockOpModeSnapshot> { return { ...this.opSnap }; }
  get opModeRevision(): number { return this.opSnap.revision; }

  /** Bump the op mode revision without changing state (makes outstanding `expectedRevision`s stale). */
  bumpOpModeRevision(): number {
    this.opSnap = { ...this.opSnap, revision: this.opSnap.revision + 1 };
    return this.opSnap.revision;
  }

  /** Attach/detach the FTC controller backend: unavailable ⇒ list 503, actions 503, phase STOPPED. */
  setControllerAvailable(available: boolean): void {
    if (!available) this.finishRun();
    this.publishOpMode(available, this.opSnap.phase, this.opSnap.activeName);
  }

  // ===========================================================================================
  // State helpers — execution, commands, runtime/pose
  // ===========================================================================================

  get execution(): Readonly<MockExecutionSnapshot> { return { ...this.execSnap }; }

  /** Publish an execution snapshot (revision +1), like `ExecutionStateStore.publish`. */
  publishExecution(state: MockExecutionState, requestId = this.execSnap.requestId, subject: string | null = null): void {
    this.execSnap = { state, requestId, subject, revision: this.execSnap.revision + 1 };
  }

  get commands(): readonly MockCommand[] { return this.commandList; }

  /** Replace the command catalog (revision +1, announced on the stream as `commands`). */
  setCommands(list: readonly MockCommand[]): void {
    this.commandList = list.map((c) => ({ name: c.name, paramNames: [...c.paramNames], paramTypes: [...c.paramTypes] }));
    this.commandRevision++;
  }
  get commandsRevision(): number { return this.commandRevision; }

  get runtimeState(): Readonly<MockRuntimeSnapshot> { return { ...this.runtime }; }

  /** Publish a pose (sequence +1). The stream pushes it on its next frame. */
  publishPose(x: number, y: number, heading: number): void {
    this.runtime = { ...this.runtime, seq: this.runtime.seq + 1, tNanos: Number(process.hrtime.bigint()), x, y, heading };
  }

  /** `RobotRuntimeStore.publish`: runtime flags + pose in one sequence step; pose defaults to the last one. */
  publishRuntime(opModeActive: boolean, opModeName: string | null, pose?: { x: number; y: number; heading: number }): void {
    this.runtime = {
      seq: this.runtime.seq + 1,
      tNanos: Number(process.hrtime.bigint()),
      opModeActive,
      opModeName,
      x: pose?.x ?? this.runtime.x,
      y: pose?.y ?? this.runtime.y,
      heading: pose?.heading ?? this.runtime.heading,
    };
  }

  // ===========================================================================================
  // State helpers — session, streams
  // ===========================================================================================

  get sessionToken(): string | null { return this.lease.validate(this.lease.token) ? this.lease.token : null; }
  get sessionOwner(): string | null { return this.lease.currentOwner(); }
  get sessionOwned(): boolean { return this.lease.isOwned(); }
  get sessionTimeoutMs(): number { return this.opts.sessionTimeoutMs; }
  /** Administrative revoke: next request with the old token gets 401, its stream ends. */
  revokeSession(): void { this.lease.revoke(); }

  get eventStreamCount(): number { return this.streams.size; }

  /** Destroy all event-stream connections abruptly (network drop); the lease stays. */
  dropEventStreams(): void {
    for (const s of [...this.streams]) {
      s.res.socket?.destroy();
      this.closeStream(s);
    }
  }

  /** Keep streams connected but stop writing frames (a stalled link, for watchdog tests). */
  muteEventStreams(muted = true): void { this.streamsMuted = muted; }

  /** Write a raw frame to every open stream (e.g. malformed payloads). */
  emitRaw(event: string, data: string, id: string | number = 0): void {
    for (const s of this.streams) writeEvent(s, event, id, data);
  }

  /** Forget recorded requests. */
  clearRequests(): void {
    this.requests.length = 0;
    this.openedEventTargets.length = 0;
  }

  /** Requests whose decoded path equals `path` (optionally for one method). */
  requestsTo(path: string, method?: string): RecordedRequest[] {
    return this.requests.filter((r) => r.path === path && (method === undefined || r.method === method));
  }

  // ===========================================================================================
  // HTTP plumbing
  // ===========================================================================================

  private onRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (this.dropNextRequests > 0) {
      this.dropNextRequests--;
      req.socket.destroy();
      return;
    }

    const declared = Number(req.headers['content-length'] ?? 0);
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      req.resume();
      this.sendJson(res, 400, '{"error":"bad_request","message":"Request body too large"}');
      return;
    }

    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('error', () => undefined);
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      void this.dispatch(req, res, body);
    });
  }

  private async dispatch(req: http.IncomingMessage, res: http.ServerResponse, body: string): Promise<void> {
    const method = (req.method ?? 'GET').toUpperCase();
    const target = req.url ?? '/';
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (v !== undefined) headers[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : v;
    }
    const q = target.indexOf('?');
    const record: RecordedRequest = {
      method, target, url: `http://${headers['host'] ?? 'localhost'}${target}`,
      path: target.split('?')[0] ?? target, query: {}, headers, body, status: null,
    };
    this.requests.push(record);
    this.opts.log?.(`${method} ${target}`);

    try {
      let path: string;
      let query: Record<string, string>;
      try {
        path = javaUrlDecode(q >= 0 ? target.slice(0, q) : target);
        query = parseQuery(q >= 0 ? target.slice(q + 1) : '');
      } catch (e) {
        if (e instanceof BadRequest) {
          this.sendJson(res, 400, `{"error":"bad_request","message":${JSON.stringify(e.message)}}`, record);
          return;
        }
        throw e;
      }
      record.path = path;
      record.query = query;

      if (this.responseDelayMs > 0 && method !== 'OPTIONS') await sleep(this.responseDelayMs);

      if (method === 'OPTIONS') {
        this.sendEmpty(res, 204, record);
        return;
      }

      const hdrToken = headers['x-az-session'];
      const ctx: Ctx = {
        method, path, query, headers, body, record, req, res,
        token: hdrToken !== undefined && hdrToken !== '' ? hdrToken : (query['session'] ?? null),
      };
      this.route(ctx);
      if (!res.headersSent && !res.writableEnded) {
        this.sendJson(res, 500, '{"error":"handler_did_not_respond"}', record);
      }
    } catch (e) {
      this.opts.log?.(`handler failed: ${e instanceof Error ? e.message : String(e)}`);
      if (!res.headersSent) this.sendJson(res, 500, '{"error":"internal_error"}', record);
      else res.destroy();
    }
  }

  private sendJson(res: http.ServerResponse, status: number, body: string, record?: RecordedRequest, extra: Record<string, string> = {}): void {
    this.sendRaw(res, status, JSON_TYPE, body, record, extra);
  }

  private sendEmpty(res: http.ServerResponse, status: number, record?: RecordedRequest): void {
    this.sendRaw(res, status, null, '', record, {});
  }

  private sendRaw(res: http.ServerResponse, status: number, contentType: string | null, body: string, record: RecordedRequest | undefined, extra: Record<string, string>): void {
    if (record) record.status = status;
    const buf = Buffer.from(body, 'utf8');
    const headers: Record<string, string | number> = {};
    if (contentType !== null) headers['Content-Type'] = contentType;
    Object.assign(headers, extra, BROWSER_ACCESS_HEADERS, {
      'Cache-Control': 'no-store',
      'Content-Length': buf.length,
      Connection: 'close',
    });
    res.writeHead(status, headers);
    res.end(buf);
  }

  // ===========================================================================================
  // Router (RobotApiRouter.handle)
  // ===========================================================================================

  private route(ctx: Ctx): void {
    const { method, path, res, record } = ctx;
    const json = (status: number, body: string, extra?: Record<string, string>): void => this.sendJson(res, status, body, record, extra);
    const methodNotAllowed = (): void => json(405, '{"error":"method_not_allowed"}');

    if (method === 'GET' && path === `${PREFIX}/health`) {
      json(200, `{"status":"ok","protocol":2,"sessionOwned":${this.lease.isOwned()}}`);
      return;
    }
    if (path === `${PREFIX}/session`) {
      this.handleSession(ctx);
      return;
    }

    if (!this.lease.validate(ctx.token)) {
      json(401, '{"error":"invalid_session"}');
      return;
    }
    this.lease.touch(ctx.token);

    if (method === 'GET' && path === `${PREFIX}/events`) {
      this.serveEvents(ctx);
      return;
    }

    if (path === `${PREFIX}/opmodes`) {
      if (method !== 'GET') return methodNotAllowed();
      if (!this.opSnap.controllerAvailable) return json(503, '{"error":"controller_unavailable"}');
      const items = this.opModeList.map((o) => `{"name":${JSON.stringify(o.name)},"group":${JSON.stringify(o.group)}}`).join(',');
      return json(200, `{"opModes":[${items}]}`);
    }
    if (path === `${PREFIX}/opmode`) {
      if (method !== 'GET') return methodNotAllowed();
      return json(200, opModeJson(this.opSnap));
    }
    for (const action of ['init', 'start', 'stop'] as const) {
      if (path === `${PREFIX}/opmode/${action}`) {
        if (method !== 'POST') return methodNotAllowed();
        return this.handleOpModeAction(ctx, action);
      }
    }

    if (path === `${PREFIX}/routes`) {
      if (method !== 'GET') return methodNotAllowed();
      const items = [...this.routeMap.values()].map((r) => `{"name":${JSON.stringify(r.name)},"revision":${r.revision}}`).join(',');
      return json(200, `{"routes":[${items}],"changeRevision":${this.routeChangeRevision}}`);
    }
    if (path.startsWith(`${PREFIX}/routes/`)) {
      return this.handleRoute(ctx, path.slice(`${PREFIX}/routes/`.length));
    }

    if (path === `${PREFIX}/execution`) {
      if (method !== 'GET') return methodNotAllowed();
      return json(200, executionJson(this.execSnap));
    }
    if (path === `${PREFIX}/commands`) {
      if (method !== 'GET') return methodNotAllowed();
      return json(200, this.commandsJson());
    }
    if (method === 'GET' && path === `${PREFIX}/runtime`) {
      return json(200, `{"runtime":${runtimeJson(this.runtime)},"pose":${poseJson(this.runtime)}}`);
    }

    json(404, '{"error":"not_found"}');
  }

  private handleSession(ctx: Ctx): void {
    const { method, res, record } = ctx;
    if (method === 'POST') {
      let owner = 'AzConductor';
      if (ctx.body.length > 0) {
        const parsed = parseObject(ctx.body); // throws → 500, like `new JSONObject(..)`
        owner = optString(parsed, 'client', owner);
      }
      const result = this.lease.open(owner);
      if (!result.acquired) {
        this.sendJson(res, 409, `{"error":"already_connected","owner":${jsonString(this.lease.currentOwner() ?? '')},"retryAfterMs":${result.expiresInMs}}`, record);
        return;
      }
      this.sendJson(res, 201, `{"token":"${result.token}","expiresInMs":${result.expiresInMs}}`, record);
      return;
    }
    if (method === 'DELETE') {
      if (!this.lease.close(ctx.token)) {
        this.sendJson(res, 401, '{"error":"invalid_session"}', record);
        return;
      }
      // Streams of the closed lease end on their next frame; end them right away.
      for (const s of [...this.streams]) if (s.token === ctx.token) this.closeStream(s);
      this.sendEmpty(res, 204, record);
      return;
    }
    this.sendJson(res, 405, '{"error":"method_not_allowed"}', record);
  }

  private handleRoute(ctx: Ctx, name: string): void {
    const { method, res, record } = ctx;
    const json = (status: number, body: string): void => this.sendJson(res, status, body, record);
    if (name === '') return json(400, '{"error":"empty_route_name"}');

    if (method === 'GET') {
      const entry = this.routeMap.get(name);
      if (!entry) return json(404, '{"error":"route_not_found"}');
      this.sendRaw(res, 200, JSON_TYPE, entry.json, record, {
        ETag: `"${entry.revision}"`,
        'X-Route-Revision': String(entry.revision),
      });
      return;
    }

    if (method === 'PUT') {
      const expected = parseIfMatch(ctx.headers['if-match']);
      if (expected === null) return json(428, '{"error":"if_match_required"}');
      const hook = this.beforeNextPut;
      if (hook) {
        this.beforeNextPut = null;
        hook();
      }
      const current = this.routeMap.get(name);
      const actual = current ? current.revision : 0;
      if (expected !== actual) return json(412, `{"error":"revision_mismatch","actual":${actual}}`);
      const entry: MockRouteEntry = { name, json: ctx.body, revision: actual + 1 };
      this.routeMap.set(name, entry);
      this.routeChangeRevision++;
      return json(expected === 0 ? 201 : 200, `{"name":${JSON.stringify(name)},"revision":${entry.revision}}`);
    }

    if (method === 'DELETE') {
      const expected = parseIfMatch(ctx.headers['if-match']);
      if (expected === null) return json(428, '{"error":"if_match_required"}');
      const current = this.routeMap.get(name);
      if (!current) return json(404, '{"error":"route_not_found"}');
      if (current.revision !== expected) return json(412, `{"error":"revision_mismatch","actual":${current.revision}}`);
      this.routeMap.delete(name);
      this.routeChangeRevision++;
      this.sendEmpty(res, 204, record);
      return;
    }

    json(405, '{"error":"method_not_allowed"}');
  }

  // ===========================================================================================
  // Op mode lifecycle (OpModeLifecycleService + a simulated backend)
  // ===========================================================================================

  private handleOpModeAction(ctx: Ctx, action: 'init' | 'start' | 'stop'): void {
    const { res, record } = ctx;
    const body = parseObject(ctx.body); // invalid JSON → 500 internal_error (real: JSONException)
    const name = optString(body, 'name', '');
    if (name === '') return this.sendJson(res, 400, '{"error":"missing_opmode_name"}', record);
    if (!Object.prototype.hasOwnProperty.call(body, 'expectedRevision')) {
      return this.sendJson(res, 428, '{"error":"expected_revision_required"}', record);
    }
    const expected = optLong(body, 'expectedRevision');

    const rejected = (code: string, message: string): void => {
      const status = code === 'controller_unavailable' ? 503 : code === 'opmode_not_found' ? 404 : 409;
      this.sendJson(res, status, `{"error":${JSON.stringify(code)},"message":${JSON.stringify(message)},"opMode":${opModeJson(this.opSnap)}}`, record);
    };

    if (expected !== this.opSnap.revision) {
      return rejected('state_changed', 'Robot OpMode state changed before the request was applied');
    }
    if (!this.opSnap.controllerAvailable) {
      return rejected('controller_unavailable', 'FTC OpMode controller is unavailable');
    }
    const op = this.opModeList.find((o) => o.name === name);
    if (!op) return rejected('opmode_not_found', `Unknown OpMode '${name}'`);

    switch (action) {
      case 'init':
        if (this.opSnap.phase !== 'STOPPED') return rejected('opmode_not_stopped', 'An OpMode is already active');
        this.doInit(op);
        break;
      case 'start':
        if (this.opSnap.phase !== 'INIT' || this.opSnap.activeName !== name) {
          return rejected('opmode_not_initialized', `OpMode '${name}' is not initialised`);
        }
        this.doStart(op);
        break;
      case 'stop':
        if (this.opSnap.phase !== 'STOPPED') {
          if (this.opSnap.activeName !== name) return rejected('opmode_mismatch', `Active OpMode is '${this.opSnap.activeName ?? ''}'`);
          this.doStop();
        } // else: idempotent
        break;
    }
    this.sendJson(res, 202, `{"accepted":true,"action":"${action}","name":${JSON.stringify(name)}}`, record);
  }

  /** `OpModeLifecycleService.publish`: revision only moves when something changed. */
  private publishOpMode(available: boolean, phase: MockOpModePhase, activeName: string | null): void {
    const old = this.opSnap;
    if (old.controllerAvailable === available && old.phase === phase && old.activeName === activeName) return;
    this.opSnap = { revision: old.revision + 1, controllerAvailable: available, phase, activeName };
  }

  private routeCoreFor(op: MockOpMode): RouteCore | null {
    if (op.route === null) return null;
    const entry = this.routeMap.get(op.route);
    if (!entry) return null;
    try {
      const nodes = decodeRobotRoute(JSON.parse(entry.json));
      return nodes.length > 0 ? new RouteCore(nodes) : null;
    } catch {
      return null;
    }
  }

  private doInit(op: MockOpMode): void {
    const core = this.routeCoreFor(op);
    const start = core?.pointAt(0) ?? null;
    this.publishOpMode(true, 'INIT', op.name);
    this.publishRuntime(true, op.name, start ? { x: start.x, y: start.y, heading: start.heading } : undefined);
  }

  private doStart(op: MockOpMode): void {
    const core = this.routeCoreFor(op);
    this.publishOpMode(true, 'RUNNING', op.name);
    this.publishRuntime(true, op.name);
    this.publishExecution('RUNNING', ++this.lastRequestId, core ? op.route : null);

    const total = core?.totalTime ?? 0;
    const derived = Math.min(this.opts.maxRunMs, Math.max(this.opts.minRunMs, total * 1000 * this.opts.runTimeScale));
    const durationMs = this.opts.runDurationMs ?? derived;
    const period = Math.max(1, Math.round(1000 / this.opts.poseHz));
    const startedAt = nowMs();
    const timer = setInterval(() => this.stepRun(), period);
    timer.unref?.();
    this.run = { timer, startedAt, durationMs, core, opModeName: op.name };
  }

  private stepRun(): void {
    const run = this.run;
    if (!run) return;
    const f = run.durationMs <= 0 ? 1 : Math.min(1, (nowMs() - run.startedAt) / run.durationMs);
    if (run.core) {
      const p = run.core.pointAt(f * run.core.totalTime);
      if (p) this.publishPose(p.x, p.y, p.heading);
    }
    if (f >= 1) this.finishRun();
  }

  /** Natural end of the route: back to STOPPED / IDLE, pose stays at the end. */
  private finishRun(): void {
    this.endRun();
    this.publishOpMode(this.opSnap.controllerAvailable, 'STOPPED', null);
    if (this.runtime.opModeActive) this.publishRuntime(false, null);
    if (this.execSnap.state === 'RUNNING') this.publishExecution('IDLE', this.lastRequestId, null);
  }

  private doStop(): void {
    this.finishRun();
  }

  /** Cancel the simulation timer without publishing anything. */
  private endRun(): void {
    if (this.run) {
      clearInterval(this.run.timer);
      this.run = null;
    }
  }

  /** True while a simulated run is playing. */
  get running(): boolean { return this.run !== null; }

  // ===========================================================================================
  // SSE (RobotEventStream.serve)
  // ===========================================================================================

  private serveEvents(ctx: Ctx): void {
    const { res, record } = ctx;
    const token = ctx.token as string; // validated by the router
    record.status = 200;
    this.openedEventTargets.push(record.target);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      ...BROWSER_ACCESS_HEADERS,
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();

    const client: StreamClient = {
      res, token, timer: null,
      lastPoseSeq: -1, lastExecutionRevision: -1, lastRouteRevision: -1,
      lastCommandRevision: -1, lastOpModeRevision: -1,
      runtimeSent: false, lastOpModeActive: false, lastOpModeName: null,
      lastHeartbeat: Number.NEGATIVE_INFINITY, closed: false,
    };
    this.streams.add(client);
    // NB: not `req.on('close')` — since Node 16 that fires once the request body was consumed.
    res.on('close', () => this.closeStream(client));

    writeEvent(client, 'hello', 0,
      `{"protocol":2,"poseHz":${this.opts.poseHz},"sessionTimeoutMs":${this.opts.sessionTimeoutMs}}`);
    this.tickStream(client);
    if (client.closed) return;
    const period = Math.max(1, Math.round(1000 / this.opts.poseHz));
    client.timer = setInterval(() => this.tickStream(client), period);
  }

  private tickStream(c: StreamClient): void {
    if (c.closed) return;
    if (!this.lease.touch(c.token)) {
      this.closeStream(c);
      return;
    }
    if (this.streamsMuted) return;

    const rt = this.runtime;
    if (rt.seq !== c.lastPoseSeq) {
      writeEvent(c, 'pose', rt.seq, poseJson(rt));
      c.lastPoseSeq = rt.seq;
    }
    if (!c.runtimeSent || rt.opModeActive !== c.lastOpModeActive || rt.opModeName !== c.lastOpModeName) {
      writeEvent(c, 'runtime', rt.seq, runtimeJson(rt));
      c.runtimeSent = true;
      c.lastOpModeActive = rt.opModeActive;
      c.lastOpModeName = rt.opModeName;
    }
    const ex = this.execSnap;
    if (ex.revision !== c.lastExecutionRevision) {
      writeEvent(c, 'execution', ex.revision, executionJson(ex));
      c.lastExecutionRevision = ex.revision;
    }
    const op = this.opSnap;
    if (op.revision !== c.lastOpModeRevision) {
      writeEvent(c, 'opmode', op.revision, opModeJson(op));
      c.lastOpModeRevision = op.revision;
    }
    if (this.routeChangeRevision !== c.lastRouteRevision) {
      writeEvent(c, 'routes', this.routeChangeRevision, `{"revision":${this.routeChangeRevision}}`);
      c.lastRouteRevision = this.routeChangeRevision;
    }
    if (this.commandRevision !== c.lastCommandRevision) {
      writeEvent(c, 'commands', this.commandRevision, `{"revision":${this.commandRevision}}`);
      c.lastCommandRevision = this.commandRevision;
    }
    const now = nowMs();
    if (now - c.lastHeartbeat >= this.opts.heartbeatMs) {
      const t = Date.now();
      writeEvent(c, 'heartbeat', t, `{"t":${t}}`);
      c.lastHeartbeat = now;
    }
  }

  private closeStream(c: StreamClient): void {
    if (c.closed) return;
    c.closed = true;
    if (c.timer !== null) clearInterval(c.timer);
    this.streams.delete(c);
    if (!c.res.writableEnded && !c.res.destroyed) c.res.end();
  }

  private commandsJson(): string {
    const items = this.commandList.map((c) =>
      `{"name":${JSON.stringify(c.name)},"paramNames":${JSON.stringify(c.paramNames)},"paramTypes":${JSON.stringify(c.paramTypes)}}`).join(',');
    return `{"revision":${this.commandRevision},"commands":[${items}]}`;
  }
}

// ---------------------------------------------------------------------------------------------
// JSON fragments & parsing helpers
// ---------------------------------------------------------------------------------------------

function opModeJson(s: MockOpModeSnapshot): string {
  return `{"revision":${s.revision},"controllerAvailable":${s.controllerAvailable},"phase":"${s.phase}","activeName":${jsonString(s.activeName)}}`;
}
function executionJson(s: MockExecutionSnapshot): string {
  return `{"state":"${s.state}","requestId":${s.requestId},"subject":${jsonString(s.subject)},"revision":${s.revision}}`;
}
function poseJson(r: MockRuntimeSnapshot): string {
  return `{"seq":${r.seq},"tNanos":${r.tNanos},"x":${jsonNumber(r.x)},"y":${jsonNumber(r.y)},"heading":${jsonNumber(r.heading)}}`;
}
function runtimeJson(r: MockRuntimeSnapshot): string {
  return `{"seq":${r.seq},"opModeActive":${r.opModeActive},"opModeName":${jsonString(r.opModeName)}}`;
}

function writeEvent(c: StreamClient, event: string, id: string | number, data: string): void {
  if (c.closed || c.res.destroyed || c.res.writableEnded) return;
  c.res.write(`event: ${event}\nid: ${id}\ndata: ${data}\n\n`);
}

function parseObject(text: string): Record<string, unknown> {
  const v: unknown = JSON.parse(text);
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error('JSONObject expected');
  return v as Record<string, unknown>;
}
function optString(o: Record<string, unknown>, key: string, fallback: string): string {
  const v = o[key];
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return fallback;
}
/** `optLong(key, Long.MIN_VALUE)` — numbers and numeric strings, else MIN. */
function optLong(o: Record<string, unknown>, key: string): number {
  const v = o[key];
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === 'string' && /^\s*[+-]?\d+(\.\d+)?\s*$/.test(v)) return Math.trunc(Number(v));
  return Number.NEGATIVE_INFINITY;
}

function routeToJson(route: string | readonly ControlNode[] | readonly unknown[]): string {
  if (typeof route === 'string') return route;
  const first = route[0];
  // ControlNode[] (no `wait` frames yet) → wire format; already-encoded frames pass through.
  const isNodes = first !== undefined && typeof first === 'object' && first !== null && 'commandParams' in first;
  return JSON.stringify(isNodes ? encodeRobotRoute(route as readonly ControlNode[]) : route);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------------------------
// Sample data (used by the CLI and handy in dev)
// ---------------------------------------------------------------------------------------------

function node(x: number, y: number, extra: Partial<ControlNode> = {}): ControlNode {
  return makeNode({ x, y, ...extra });
}

/** A few valid routes, route-bound and unbound op modes, and a command catalog. */
export function seedSampleRobot(robot: MockRobotServer): void {
  robot.seedRoute('Red Near', [
    node(-60, 36, { heading: 0, duration: 0 }),
    node(-36, 36, { dx: 40, heading: 45, duration: 2, delayAfterArrive: 0.5, marker: 'shoot' }),
    node(-12, 12, { dx: 30, dy: -20, heading: 90, duration: 2.5 }),
    node(-12, -24, { dy: -30, heading: 135, duration: 2, command: 'intakeOn' }),
  ]);
  robot.seedRoute('Blue Far', [
    node(60, -36, { heading: 180, duration: 0 }),
    node(36, -36, { dx: -40, heading: 135, duration: 2, marker: 'shoot' }),
    node(12, -12, { dx: -30, dy: 20, heading: 90, duration: 2.5 }),
  ]);
  robot.seedRoute('蓝 路径(A)', [
    node(0, 0, { duration: 0 }),
    node(24, 24, { dx: 30, dy: 30, heading: 90, duration: 3 }),
  ]);

  robot.setOpModes([
    { name: 'Auto Red Near', group: 'Auto', route: 'Red Near' },
    { name: 'Auto Blue Far', group: 'Auto', route: 'Blue Far' },
    { name: 'Auto Path A', group: 'Auto', route: '蓝 路径(A)' },
    { name: 'Auto Park', group: 'Auto', route: null },
  ]);

  robot.setCommands([
    { name: 'intakeOn', paramNames: [], paramTypes: [] },
    { name: 'intakeOff', paramNames: [], paramTypes: [] },
    { name: 'shoot', paramNames: ['count', 'power'], paramTypes: ['int', 'double'] },
    { name: 'setLift', paramNames: ['height'], paramTypes: ['double'] },
  ]);
}
