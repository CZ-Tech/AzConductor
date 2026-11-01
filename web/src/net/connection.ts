/**
 * RobotConnection: session lease + SSE event stream + reconnect state machine.
 *
 *   idle ──connect()──▶ connecting ──▶ connected
 *                          │  ▲            │ stream ended / error / 3 s without any event
 *                          ▼  │            ▼
 *                  rejected{owner,retryAt}  failed{reason,retryAt}  ──(timer)──▶ connecting
 *
 * DOM-free: time comes from an injectable {@link Clock}/{@link Timers}; `pagehide` wiring is the
 * UI's job (call `void connection.close()`; the DELETE is sent with keepalive).
 */
import { RobotApiClient, SESSION_HEADER } from './api';
import {
  DecodeError,
  decodeHeartbeat,
  decodeHello,
  decodeExecution,
  decodeOpModeSnapshot,
  decodePose,
  decodeRevision,
  decodeRuntime,
  type ExecutionSnapshot,
  type HelloEvent,
  type OpModeSnapshot,
  type PoseEvent,
  type RuntimeEvent,
} from './models';
import { FetchTransport, describeApiError, type ApiError, type EventStream, type Result, type Transport, err, ok } from './transport';
import { TransportError } from './transport';

// ---------------------------------------------------------------------------------------------
// Time injection
// ---------------------------------------------------------------------------------------------

export interface Clock { now(): number }
export type TimerHandle = unknown;
export interface Timers {
  setTimeout(fn: () => void, ms: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
}

/** Looks up the globals lazily so fake timers installed after import are honoured. */
export const systemClock: Clock = { now: () => Date.now() };
export const systemTimers: Timers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
};

// ---------------------------------------------------------------------------------------------
// State & events
// ---------------------------------------------------------------------------------------------

export type ConnectionState =
  | { kind: 'idle' }
  | { kind: 'connecting'; attempt: number }
  | { kind: 'connected'; token: string }
  /** Another computer owns the robot (HTTP 409 already_connected). `retryAt` is epoch ms. */
  | { kind: 'rejected'; owner: string | null; retryAt: number }
  | { kind: 'failed'; reason: string; error: ApiError | null; retryAt: number };

export type ConnectionStateKind = ConnectionState['kind'];

/** Latest value of every event stream channel; reset when the connection is lost. */
export interface ConnectionData {
  hello: HelloEvent | null;
  pose: PoseEvent | null;
  runtime: RuntimeEvent | null;
  execution: ExecutionSnapshot | null;
  opMode: OpModeSnapshot | null;
  routeRevision: number;
  commandRevision: number;
  /** `t` of the last heartbeat event. */
  lastHeartbeat: number | null;
  /** Local clock time (ms) at which the last event of any kind arrived. */
  lastEventAt: number | null;
}

export type ConnectionEvent =
  | { type: 'state'; state: ConnectionState; previous: ConnectionState }
  | { type: 'hello'; data: HelloEvent }
  | { type: 'pose'; data: PoseEvent }
  | { type: 'runtime'; data: RuntimeEvent }
  | { type: 'execution'; data: ExecutionSnapshot }
  | { type: 'opmode'; data: OpModeSnapshot }
  | { type: 'routes'; data: { revision: number } }
  | { type: 'commands'; data: { revision: number } }
  | { type: 'heartbeat'; data: { t: number } };

export type ConnectionListener = (event: ConnectionEvent) => void;

export interface RobotConnectionOptions {
  /** Anything `normalizeRobotUrl` accepts. */
  baseUrl: string;
  transport?: Transport;
  /** Reported as the lease owner. Default `AzConductor`. */
  clientName?: string;
  clock?: Clock;
  timers?: Timers;
  /** Backoff after a failure: first delay, then doubling up to `maxMs`. Default 1000 → 10000. */
  backoff?: { minMs?: number; maxMs?: number };
  /** No event for this long ⇒ treat the stream as dead and reconnect. Default 3000. */
  watchdogMs?: number;
  /** Schedule retries automatically after failure/rejection. Default true. */
  autoRetry?: boolean;
}

const EMPTY_DATA: ConnectionData = {
  hello: null, pose: null, runtime: null, execution: null, opMode: null,
  routeRevision: 0, commandRevision: 0, lastHeartbeat: null, lastEventAt: null,
};

export const DEFAULT_BACKOFF_MIN_MS = 1000;
export const DEFAULT_BACKOFF_MAX_MS = 10_000;
export const DEFAULT_WATCHDOG_MS = 3000;
/** Used when a 409 carries no `retryAfterMs`: the robot's lease length. */
const DEFAULT_LEASE_MS = 10_000;

/** Exponential delay for the n-th consecutive failure (1-based): 1s, 2s, 4s, 8s, 10s, 10s… */
export function backoffDelay(failures: number, minMs = DEFAULT_BACKOFF_MIN_MS, maxMs = DEFAULT_BACKOFF_MAX_MS): number {
  const n = Math.max(1, failures);
  return Math.min(maxMs, minMs * 2 ** (n - 1));
}

export class RobotConnection {
  readonly api: RobotApiClient;

  private readonly transport: Transport;
  private readonly clientName: string;
  private readonly clock: Clock;
  private readonly timers: Timers;
  private readonly minMs: number;
  private readonly maxMs: number;
  private readonly watchdogMs: number;
  private readonly autoRetry: boolean;

  private stateValue: ConnectionState = { kind: 'idle' };
  private dataValue: ConnectionData = { ...EMPTY_DATA };
  private readonly listeners = new Set<ConnectionListener>();

  /** Bumped on every connect/close/teardown so stale async continuations bail out. */
  private generation = 0;
  private stream: EventStream | null = null;
  private abort: AbortController | null = null;
  private retryTimer: TimerHandle | null = null;
  private watchdogTimer: TimerHandle | null = null;
  private failures = 0;
  private attempt = 0;
  private wanted = false;
  private lastEventAt = 0;

  constructor(options: RobotConnectionOptions) {
    this.transport = options.transport ?? new FetchTransport();
    this.api = new RobotApiClient(options.baseUrl, { transport: this.transport });
    this.clientName = options.clientName ?? 'AzConductor';
    this.clock = options.clock ?? systemClock;
    this.timers = options.timers ?? systemTimers;
    this.minMs = options.backoff?.minMs ?? DEFAULT_BACKOFF_MIN_MS;
    this.maxMs = options.backoff?.maxMs ?? DEFAULT_BACKOFF_MAX_MS;
    this.watchdogMs = options.watchdogMs ?? DEFAULT_WATCHDOG_MS;
    this.autoRetry = options.autoRetry ?? true;
  }

  get state(): ConnectionState { return this.stateValue; }
  get data(): ConnectionData { return this.dataValue; }
  get baseUrl(): string { return this.api.baseUrl; }

  /** Subscribe to state changes and every stream event. Returns an unsubscribe function. */
  subscribe(listener: ConnectionListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** Convenience: state transitions only. */
  onState(listener: (state: ConnectionState, previous: ConnectionState) => void): () => void {
    return this.subscribe((e) => { if (e.type === 'state') listener(e.state, e.previous); });
  }

  // ---- lifecycle ----------------------------------------------------------------------------

  /**
   * Make one connection attempt now (cancelling any pending retry or live stream) and — with
   * `autoRetry` — keep reconnecting after failures until {@link close}.
   * Resolves when the attempt finished: `ok` once connected; otherwise the error that caused
   * `rejected`/`failed`.
   */
  async connect(): Promise<Result<void>> {
    this.wanted = true;
    this.cancelRetry();
    this.teardownStream();
    const gen = ++this.generation;
    return this.attemptConnect(gen);
  }

  /**
   * Stop reconnecting, drop the stream and release the lease with a best-effort `DELETE /session`.
   * The request is issued synchronously (keepalive) so `void connection.close()` is safe in `pagehide`.
   */
  async close(): Promise<void> {
    this.wanted = false;
    this.generation++;
    this.cancelRetry();
    this.teardownStream();
    let pending: Promise<unknown> | null = null;
    if (this.api.token !== null) {
      pending = this.api.closeSession({ keepalive: true }).catch(() => undefined);
    }
    this.clearData();
    this.setState({ kind: 'idle' });
    if (pending) await pending;
    this.api.clearToken();
  }

  /** Switch robot (state → idle, data cleared, old lease released best-effort). Call `connect()` after. */
  async setBaseUrl(baseUrl: string): Promise<void> {
    await this.close();
    this.api.setRobotUrl(baseUrl);
    this.failures = 0;
  }

  // ---- internals ----------------------------------------------------------------------------

  private async attemptConnect(gen: number): Promise<Result<void>> {
    this.attempt++;
    this.setState({ kind: 'connecting', attempt: this.attempt });

    // Reuse a still-valid lease for the stream first (avoids a 409 against ourselves).
    if (this.api.token !== null) {
      const reused = await this.openStream(gen);
      if (gen !== this.generation) return err({ kind: 'aborted', message: 'Superseded' });
      if (reused.ok) return reused;
      if (!(reused.error.kind === 'http' && reused.error.status === 401)) {
        return this.failed(gen, reused.error);
      }
      this.api.clearToken();
    }

    const opened = await this.api.openSession(this.clientName);
    if (gen !== this.generation) return err({ kind: 'aborted', message: 'Superseded' });
    if (!opened.ok) {
      const e = opened.error;
      if (e.kind === 'http' && e.status === 409 && e.code === 'already_connected') {
        const wait = Math.max(this.minMs, e.retryAfterMs ?? DEFAULT_LEASE_MS);
        const retryAt = this.clock.now() + wait;
        this.setState({ kind: 'rejected', owner: e.owner ?? (e.message || null), retryAt });
        this.scheduleRetry(gen, wait);
        return opened;
      }
      return this.failed(gen, e);
    }

    const streamed = await this.openStream(gen);
    if (gen !== this.generation) return err({ kind: 'aborted', message: 'Superseded' });
    if (!streamed.ok) {
      // The lease we just took is useless without a stream — give it back so retries don't 409.
      void this.api.closeSession().catch(() => undefined);
      return this.failed(gen, streamed.error);
    }
    return streamed;
  }

  private async openStream(gen: number): Promise<Result<void>> {
    const token = this.api.token;
    if (token === null) return err({ kind: 'no_session', message: 'No active robot session' });
    const abort = new AbortController();
    this.abort = abort;
    let stream: EventStream;
    try {
      stream = await this.transport.openEvents(this.api.eventsUrl(), {
        headers: { [SESSION_HEADER]: token },
        signal: abort.signal,
      });
    } catch (e) {
      if (this.abort === abort) this.abort = null;
      return err(toError(e));
    }
    if (gen !== this.generation) {
      stream.close();
      return err({ kind: 'aborted', message: 'Superseded' });
    }
    this.stream = stream;
    this.lastEventAt = this.clock.now();
    this.armWatchdog(gen);
    this.setState({ kind: 'connected', token });
    void this.pump(gen, stream);
    return ok(undefined, 200);
  }

  private async pump(gen: number, stream: EventStream): Promise<void> {
    try {
      for await (const msg of stream) {
        if (gen !== this.generation) return;
        this.lastEventAt = this.clock.now();
        if (this.failures !== 0 && msg.event === 'hello') this.failures = 0;
        this.handleMessage(gen, msg.event, msg.data);
        if (gen !== this.generation) return;
      }
    } catch (e) {
      if (gen !== this.generation) return;
      this.streamLost(gen, toError(e));
      return;
    }
    if (gen !== this.generation) return;
    this.streamLost(gen, { kind: 'unreachable', message: 'Event stream closed by robot', mixedContentSuspected: false });
  }

  private handleMessage(gen: number, event: string, text: string): void {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (e) {
      this.streamLost(gen, { kind: 'parse', message: `Invalid ${event} event: ${e instanceof Error ? e.message : 'decode failed'}` });
      return;
    }
    try {
      switch (event) {
        case 'hello': {
          const data = decodeHello(raw);
          this.dataValue = { ...this.dataValue, hello: data };
          this.emit({ type: 'hello', data });
          break;
        }
        case 'pose': {
          const data = decodePose(raw);
          this.dataValue = { ...this.dataValue, pose: data };
          this.emit({ type: 'pose', data });
          break;
        }
        case 'runtime': {
          const data = decodeRuntime(raw);
          this.dataValue = { ...this.dataValue, runtime: data };
          this.emit({ type: 'runtime', data });
          break;
        }
        case 'execution': {
          const data = decodeExecution(raw);
          this.dataValue = { ...this.dataValue, execution: data };
          this.emit({ type: 'execution', data });
          break;
        }
        case 'opmode': {
          const data = decodeOpModeSnapshot(raw);
          this.dataValue = { ...this.dataValue, opMode: data };
          this.emit({ type: 'opmode', data });
          break;
        }
        case 'routes': {
          const data = decodeRevision(raw);
          this.dataValue = { ...this.dataValue, routeRevision: data.revision };
          this.emit({ type: 'routes', data });
          break;
        }
        case 'commands': {
          const data = decodeRevision(raw);
          this.dataValue = { ...this.dataValue, commandRevision: data.revision };
          this.emit({ type: 'commands', data });
          break;
        }
        case 'heartbeat': {
          const data = decodeHeartbeat(raw);
          this.dataValue = { ...this.dataValue, lastHeartbeat: data.t };
          this.emit({ type: 'heartbeat', data });
          break;
        }
        default:
          break; // unknown events are ignored (forward compatible)
      }
      this.dataValue = { ...this.dataValue, lastEventAt: this.lastEventAt };
    } catch (e) {
      const why = e instanceof DecodeError ? e.message : e instanceof Error ? e.message : 'decode failed';
      this.streamLost(gen, { kind: 'parse', message: `Invalid ${event} event: ${why}` });
    }
  }

  /** Stream died (error, EOF, bad payload, watchdog): tear down and schedule a reconnect. */
  private streamLost(gen: number, error: ApiError): void {
    if (gen !== this.generation) return;
    this.generation++; // invalidate the pump / watchdog of this stream
    this.teardownStream();
    this.clearData();
    this.failed(this.generation, error);
  }

  private failed(gen: number, error: ApiError): Result<void> {
    if (gen === this.generation) {
      this.failures++;
      const wait = backoffDelay(this.failures, this.minMs, this.maxMs);
      this.setState({ kind: 'failed', reason: describeApiError(error), error, retryAt: this.clock.now() + wait });
      this.scheduleRetry(gen, wait);
    }
    return err(error);
  }

  private scheduleRetry(gen: number, delayMs: number): void {
    if (!this.autoRetry || !this.wanted) return;
    this.cancelRetry();
    this.retryTimer = this.timers.setTimeout(() => {
      this.retryTimer = null;
      if (!this.wanted || gen !== this.generation) return;
      const next = ++this.generation;
      void this.attemptConnect(next);
    }, delayMs);
  }

  private cancelRetry(): void {
    if (this.retryTimer !== null) {
      this.timers.clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private armWatchdog(gen: number): void {
    this.disarmWatchdog();
    const check = (): void => {
      this.watchdogTimer = null;
      if (gen !== this.generation) return;
      const idle = this.clock.now() - this.lastEventAt;
      if (idle >= this.watchdogMs) {
        this.streamLost(gen, { kind: 'timeout', message: `No event from robot for ${this.watchdogMs} ms` });
      } else {
        this.watchdogTimer = this.timers.setTimeout(check, this.watchdogMs - idle);
      }
    };
    this.watchdogTimer = this.timers.setTimeout(check, this.watchdogMs);
  }

  private disarmWatchdog(): void {
    if (this.watchdogTimer !== null) {
      this.timers.clearTimeout(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  private teardownStream(): void {
    this.disarmWatchdog();
    this.stream?.close();
    this.stream = null;
    this.abort?.abort();
    this.abort = null;
  }

  private clearData(): void {
    this.dataValue = { ...EMPTY_DATA };
  }

  private setState(next: ConnectionState): void {
    const previous = this.stateValue;
    this.stateValue = next;
    this.emit({ type: 'state', state: next, previous });
  }

  private emit(event: ConnectionEvent): void {
    for (const l of [...this.listeners]) {
      try {
        l(event);
      } catch {
        // a faulty subscriber must not break the stream
      }
    }
  }
}

function toError(e: unknown): ApiError {
  if (e instanceof TransportError) {
    switch (e.kind) {
      case 'timeout': return { kind: 'timeout', message: e.message };
      case 'aborted': return { kind: 'aborted', message: e.message };
      case 'unreachable': return { kind: 'unreachable', message: e.message, mixedContentSuspected: e.mixedContentSuspected };
      case 'http': {
        // reuse api's mapping for status/body
        return httpFromTransport(e);
      }
    }
  }
  return { kind: 'unreachable', message: e instanceof Error ? e.message : 'Event stream failed', mixedContentSuspected: false };
}

import { httpError } from './api';
function httpFromTransport(e: TransportError): ApiError {
  return httpError(e.status ?? 0, e.body ?? '');
}
