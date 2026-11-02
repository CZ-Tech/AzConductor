/** Network V2 REST client (port of RobotApiClient.kt). One method per Kotlin method. */
import type { ControlNode } from '../core/node';
import { encodeRobotRoute } from '../core/wire';
import { validateRobotFrames } from '../core/contract';
import {
  DecodeError,
  decodeCommandCatalog,
  decodeCommandRun,
  decodeErrorBody,
  decodeExecution,
  decodeHealth,
  decodeOpModeAction,
  decodeOpModeList,
  decodeOpModeSnapshot,
  decodeRouteManifest,
  decodeRouteWrite,
  decodeRuntimeSnapshot,
  decodeSessionOpen,
  type CommandCatalog,
  type CommandRunResponse,
  type ExecutionSnapshot,
  type HealthInfo,
  type OpModeActionResponse,
  type OpModeList,
  type OpModeSnapshot,
  type RobotRoutePayload,
  type RouteManifest,
  type RouteWriteResponse,
  type RuntimeSnapshot,
  type SessionOpenResponse,
} from './models';
import {
  FetchTransport,
  TransportError,
  err,
  ok,
  type ApiError,
  type HttpApiError,
  type Result,
  type Transport,
  type TransportResponse,
} from './transport';
import { normalizeRobotUrl, pathSegment } from './url';

export interface RobotApiClientOptions {
  transport?: Transport;
}

interface SendOptions {
  body?: string;
  authenticated?: boolean;
  headers?: Record<string, string>;
  keepalive?: boolean;
  signal?: AbortSignal;
}

export const SESSION_HEADER = 'X-Az-Session';

/** Map a transport failure (or any thrown value) to an {@link ApiError}. */
export function toApiError(e: unknown): ApiError {
  if (e instanceof TransportError) {
    switch (e.kind) {
      case 'timeout': return { kind: 'timeout', message: e.message };
      case 'aborted': return { kind: 'aborted', message: e.message };
      case 'unreachable': return { kind: 'unreachable', message: e.message, mixedContentSuspected: e.mixedContentSuspected };
      case 'http': return httpError(e.status ?? 0, e.body ?? '');
    }
  }
  return { kind: 'unreachable', message: e instanceof Error ? e.message : 'Network request failed', mixedContentSuspected: false };
}

export function httpError(status: number, body: string): HttpApiError {
  const parsed = decodeErrorBody(body);
  const e: HttpApiError = {
    kind: 'http',
    status,
    code: parsed.error ?? null,
    message: parsed.message ?? parsed.owner ?? '',
    body,
  };
  if (parsed.retryAfterMs !== undefined) e.retryAfterMs = parsed.retryAfterMs;
  if (parsed.actual !== undefined) e.actual = parsed.actual;
  if (parsed.owner !== undefined) e.owner = parsed.owner;
  return e;
}

function parseEtag(value: string | undefined): number | null {
  if (value === undefined) return null;
  let t = value.trim();
  if (t.startsWith('W/')) t = t.slice(2);
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) t = t.slice(1, -1);
  return /^\d+$/.test(t) ? Number(t) : null;
}

function assertRevision(n: number): void {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(`revision must be a non-negative integer, got ${n}`);
}

export class RobotApiClient {
  private base: string;
  private sessionToken: string | null = null;
  readonly transport: Transport;

  /** @param robotUrl anything accepted by {@link normalizeRobotUrl}. */
  constructor(robotUrl: string, options: RobotApiClientOptions = {}) {
    const base = normalizeRobotUrl(robotUrl);
    if (base === null) throw new RangeError(`Invalid robot address: '${robotUrl}'`);
    this.base = base;
    this.transport = options.transport ?? new FetchTransport();
  }

  get baseUrl(): string { return this.base; }
  get token(): string | null { return this.sessionToken; }

  /** Point the client at another robot; drops the session token (like Kotlin updateRobotIp). */
  setRobotUrl(robotUrl: string): void {
    const base = normalizeRobotUrl(robotUrl);
    if (base === null) throw new RangeError(`Invalid robot address: '${robotUrl}'`);
    this.base = base;
    this.sessionToken = null;
  }

  /** Forget the token without telling the robot (e.g. the robot said 401). */
  clearToken(): void { this.sessionToken = null; }

  // ---- session ------------------------------------------------------------------------------

  async openSession(clientName: string): Promise<Result<SessionOpenResponse>> {
    const r = await this.decode(
      await this.send('POST', '/api/v2/session', { body: JSON.stringify({ client: clientName }), authenticated: false }),
      decodeSessionOpen,
    );
    if (r.ok) this.sessionToken = r.value.token;
    return r;
  }

  /**
   * DELETE /session. The token is cleared on success and on 401 (the lease is gone anyway).
   * `keepalive` lets the request survive page unload.
   */
  async closeSession(options: { keepalive?: boolean } = {}): Promise<Result<void>> {
    const so: SendOptions = {};
    if (options.keepalive) so.keepalive = true;
    const r = await this.send('DELETE', '/api/v2/session', so);
    if (r.ok) {
      this.sessionToken = null;
      return ok(undefined, r.status);
    }
    if (r.error.kind === 'http' && r.error.status === 401) this.sessionToken = null;
    return r;
  }

  async health(): Promise<Result<HealthInfo>> {
    return this.decode(await this.send('GET', '/api/v2/health', { authenticated: false }), decodeHealth);
  }

  // ---- routes -------------------------------------------------------------------------------

  async listRoutes(): Promise<Result<RouteManifest>> {
    return this.decode(await this.send('GET', '/api/v2/routes'), decodeRouteManifest);
  }

  /** Revision comes from `X-Route-Revision`, falling back to the `ETag`. `json` is the raw body. */
  async getRoute(name: string): Promise<Result<RobotRoutePayload>> {
    const r = await this.send('GET', '/api/v2/routes/' + pathSegment(name));
    if (!r.ok) return r;
    const hdr = r.value.headers['x-route-revision'];
    const fromHeader = hdr !== undefined && /^\d+$/.test(hdr.trim()) ? Number(hdr.trim()) : null;
    const revision = fromHeader ?? parseEtag(r.value.headers['etag']);
    if (revision === null) return err({ kind: 'parse', message: 'Route response missing revision header' });
    return ok({ name, revision, json: r.value.text }, r.status);
  }

  /**
   * PUT with `If-Match: <expectedRevision>` (0 = create). The route JSON is parsed and checked with
   * `validateRobotFrames` first; on failure nothing is sent and a `contract` error is returned.
   */
  async putRoute(name: string, routeJson: string, expectedRevision: number): Promise<Result<RouteWriteResponse>> {
    assertRevision(expectedRevision);
    let frames: unknown;
    try {
      frames = JSON.parse(routeJson);
    } catch {
      frames = undefined;
    }
    const errors = validateRobotFrames(frames);
    if (errors.length > 0) {
      return err({ kind: 'contract', message: '路径契约校验失败：' + errors.slice(0, 4).join('；'), errors });
    }
    return this.decode(
      await this.send('PUT', '/api/v2/routes/' + pathSegment(name), {
        body: routeJson,
        headers: { 'If-Match': String(expectedRevision) },
      }),
      decodeRouteWrite,
    );
  }

  /** Convenience: encode nodes to the robot wire format, then {@link putRoute}. */
  putRouteNodes(name: string, nodes: readonly ControlNode[], expectedRevision: number): Promise<Result<RouteWriteResponse>> {
    return this.putRoute(name, JSON.stringify(encodeRobotRoute(nodes)), expectedRevision);
  }

  async deleteRoute(name: string, expectedRevision: number): Promise<Result<void>> {
    assertRevision(expectedRevision);
    const r = await this.send('DELETE', '/api/v2/routes/' + pathSegment(name), {
      headers: { 'If-Match': String(expectedRevision) },
    });
    return r.ok ? ok(undefined, r.status) : r;
  }

  // ---- state --------------------------------------------------------------------------------

  async executionState(): Promise<Result<ExecutionSnapshot>> {
    return this.decode(await this.send('GET', '/api/v2/execution'), decodeExecution);
  }

  async commandCatalog(): Promise<Result<CommandCatalog>> {
    return this.decode(await this.send('GET', '/api/v2/commands'), decodeCommandCatalog);
  }

  /**
   * `POST /api/v2/commands/run` — queue one catalog command on the robot.
   *
   * Implemented by the firmware (RobotApiRouter.handleCommandRun); older firmware answers 404
   * `not_found`. `args` are strings in parameter order and must be complete — callers fill
   * defaults first (`resolveArgs`). `expectedRevision` is the OpMode revision, as in the op mode
   * actions; 202 means queued, not finished (and a later command on the same subsystem replaces
   * it). Only accepted while an OpMode that attached a dispatcher is RUNNING. Never retry this
   * call: a lost response may still have run the command.
   */
  async runCommand(name: string, args: readonly string[], expectedRevision: number): Promise<Result<CommandRunResponse>> {
    assertRevision(expectedRevision);
    return this.decode(
      await this.send('POST', '/api/v2/commands/run', { body: JSON.stringify({ name, args, expectedRevision }) }),
      decodeCommandRun,
    );
  }

  /** `GET /api/v2/runtime` — latest runtime + pose snapshot (not in the Kotlin client). */
  async runtimeSnapshot(): Promise<Result<RuntimeSnapshot>> {
    return this.decode(await this.send('GET', '/api/v2/runtime'), decodeRuntimeSnapshot);
  }

  // ---- op modes -----------------------------------------------------------------------------

  async listOpModes(): Promise<Result<OpModeList>> {
    return this.decode(await this.send('GET', '/api/v2/opmodes'), decodeOpModeList);
  }

  async opModeState(): Promise<Result<OpModeSnapshot>> {
    return this.decode(await this.send('GET', '/api/v2/opmode'), decodeOpModeSnapshot);
  }

  initOpMode(name: string, expectedRevision: number): Promise<Result<OpModeActionResponse>> {
    return this.opModeAction('init', name, expectedRevision);
  }
  startOpMode(name: string, expectedRevision: number): Promise<Result<OpModeActionResponse>> {
    return this.opModeAction('start', name, expectedRevision);
  }
  stopOpMode(name: string, expectedRevision: number): Promise<Result<OpModeActionResponse>> {
    return this.opModeAction('stop', name, expectedRevision);
  }

  private async opModeAction(action: 'init' | 'start' | 'stop', name: string, expectedRevision: number): Promise<Result<OpModeActionResponse>> {
    assertRevision(expectedRevision);
    return this.decode(
      await this.send('POST', '/api/v2/opmode/' + action, { body: JSON.stringify({ name, expectedRevision }) }),
      decodeOpModeAction,
    );
  }

  // ---- events -------------------------------------------------------------------------------

  /** Plain SSE endpoint; authenticate with the {@link SESSION_HEADER} header. */
  eventsUrl(): string { return this.base + '/api/v2/events'; }

  /** SSE endpoint with `?session=` (Kotlin `eventUrl()`); `null` without a session. */
  eventUrl(): string | null {
    return this.sessionToken === null ? null : `${this.base}/api/v2/events?session=${pathSegment(this.sessionToken)}`;
  }

  // ---- plumbing -----------------------------------------------------------------------------

  private async send(method: string, path: string, options: SendOptions = {}): Promise<Result<TransportResponse>> {
    const headers: Record<string, string> = {};
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (options.authenticated !== false) {
      if (this.sessionToken === null) return err({ kind: 'no_session', message: 'No active robot session' });
      headers[SESSION_HEADER] = this.sessionToken;
    }
    Object.assign(headers, options.headers);

    let response: TransportResponse;
    try {
      const req: Parameters<Transport['request']>[0] = { method, url: this.base + path, headers };
      if (options.body !== undefined) req.body = options.body;
      if (options.keepalive) req.keepalive = true;
      if (options.signal) req.signal = options.signal;
      response = await this.transport.request(req);
    } catch (e) {
      return err(toApiError(e));
    }
    if (response.status >= 200 && response.status <= 299) return ok(response, response.status);
    return err(httpError(response.status, response.text));
  }

  private decode<T>(result: Result<TransportResponse>, decoder: (raw: unknown) => T): Result<T> {
    if (!result.ok) return result;
    try {
      return ok(decoder(JSON.parse(result.value.text)), result.status);
    } catch (e) {
      const why = e instanceof DecodeError || e instanceof SyntaxError ? e.message : 'decode failed';
      return err({ kind: 'parse', message: 'Invalid robot response: ' + why });
    }
  }
}
