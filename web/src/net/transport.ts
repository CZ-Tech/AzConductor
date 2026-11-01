/**
 * HTTP + SSE transport abstraction. Framework-free; only `fetch`, `AbortController` and
 * `TextDecoder` are used (all present in browsers and Node 24).
 */
import { isMixedContentCandidate } from './url';

// ---------------------------------------------------------------------------------------------
// Result / ApiError
// ---------------------------------------------------------------------------------------------

export interface Ok<T> { readonly ok: true; readonly value: T; readonly status: number }
export interface Err<E> { readonly ok: false; readonly error: E }
export type Result<T, E = ApiError> = Ok<T> | Err<E>;

export const ok = <T>(value: T, status = 200): Ok<T> => ({ ok: true, value, status });
export const err = <E>(error: E): Err<E> => ({ ok: false, error });

export interface HttpApiError {
  kind: 'http';
  status: number;
  /** Protocol error code (`revision_mismatch`, `already_connected`, …) when the body had one. */
  code: string | null;
  message: string;
  body: string;
  /** 409 session conflict: how long until the lease may free up. */
  retryAfterMs?: number;
  /** 412: the revision the robot actually has. */
  actual?: number;
  /** 409 session conflict: who holds the lease. */
  owner?: string;
}

export type ApiError =
  /** Could not reach the robot at all (DNS, refused, offline, CORS, mixed content…). */
  | { kind: 'unreachable'; message: string; mixedContentSuspected: boolean }
  | { kind: 'timeout'; message: string }
  | { kind: 'aborted'; message: string }
  | HttpApiError
  /** Response arrived but could not be decoded. */
  | { kind: 'parse'; message: string }
  /** Authenticated call attempted without an open session (nothing was sent). */
  | { kind: 'no_session'; message: string }
  /** Route failed contract validation locally (nothing was sent). */
  | { kind: 'contract'; message: string; errors: string[] };

export type ApiErrorKind = ApiError['kind'];

export function isHttpError(e: ApiError, status?: number): e is HttpApiError {
  return e.kind === 'http' && (status === undefined || e.status === status);
}

/** Human-readable one-liner for toasts. */
export function describeApiError(e: ApiError): string {
  switch (e.kind) {
    case 'unreachable':
      return e.mixedContentSuspected
        ? `${e.message}（https 页面无法访问 http 机器人地址，可能被浏览器拦截）`
        : e.message;
    case 'http':
      return e.code ? `HTTP ${e.status} ${e.code}${e.message && e.message !== e.code ? `: ${e.message}` : ''}` : `HTTP ${e.status}${e.message ? `: ${e.message}` : ''}`;
    default:
      return e.message;
  }
}

// ---------------------------------------------------------------------------------------------
// Transport interface
// ---------------------------------------------------------------------------------------------

export interface TransportRequest {
  method: string;
  url: string;
  body?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Fire-and-forget during page unload. */
  keepalive?: boolean;
}

export interface TransportResponse {
  status: number;
  /** Header names lower-cased. */
  headers: Record<string, string>;
  text: string;
}

export interface SseMessage {
  /** `message` when the stream gave no `event:` field. */
  event: string;
  data: string;
  /** Last event id seen on the stream (per SSE spec it persists across events). */
  id?: string;
}

export interface EventStream extends AsyncIterable<SseMessage> {
  /** Abort the underlying connection. The iterator then ends without throwing. Idempotent. */
  close(): void;
}

export interface OpenEventsOptions {
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export type TransportFailureKind = 'unreachable' | 'timeout' | 'aborted' | 'http';

/** Thrown by transports; `api.ts` converts it to an {@link ApiError}. */
export class TransportError extends Error {
  readonly kind: TransportFailureKind;
  readonly status: number | undefined;
  readonly body: string | undefined;
  readonly mixedContentSuspected: boolean;

  constructor(
    kind: TransportFailureKind,
    message: string,
    extra: { status?: number; body?: string; mixedContentSuspected?: boolean } = {},
  ) {
    super(message);
    this.name = 'TransportError';
    this.kind = kind;
    this.status = extra.status;
    this.body = extra.body;
    this.mixedContentSuspected = extra.mixedContentSuspected ?? false;
  }
}

export interface Transport {
  /** Resolves for ANY HTTP status; rejects with {@link TransportError} on network failure/timeout/abort. */
  request(req: TransportRequest): Promise<TransportResponse>;
  /**
   * Opens an SSE stream. Resolves once the server answered 200 (headers received); rejects with
   * {@link TransportError} (`http` kind carries status/body for 401 etc.).
   */
  openEvents(url: string, options?: OpenEventsOptions): Promise<EventStream>;
}

// ---------------------------------------------------------------------------------------------
// SSE parser
// ---------------------------------------------------------------------------------------------

/**
 * Incremental `text/event-stream` parser (WHATWG HTML §9.2.6): CR / LF / CRLF line ends (also when
 * split across chunks), comment lines, multi-line `data:`, `event:`, `id:`; `retry:` is ignored.
 * An event still unterminated at end of stream is discarded, as browsers do.
 */
export class SseParser {
  private buf = '';
  private data: string[] = [];
  private event = '';
  private lastId: string | undefined;
  private started = false;

  /** Feed decoded text; returns the messages completed by it. */
  push(chunk: string): SseMessage[] {
    this.buf += chunk;
    if (!this.started && this.buf.length > 0) {
      this.started = true;
      if (this.buf.charCodeAt(0) === 0xfeff) this.buf = this.buf.slice(1);
    }
    const out: SseMessage[] = [];
    const b = this.buf;
    let start = 0;
    for (let i = 0; i < b.length; i++) {
      const c = b.charCodeAt(i);
      if (c !== 10 && c !== 13) continue;
      if (c === 13 && i === b.length - 1) break; // might be the first half of CRLF — wait for more
      const line = b.slice(start, i);
      if (c === 13 && b.charCodeAt(i + 1) === 10) i++;
      start = i + 1;
      this.line(line, out);
    }
    this.buf = b.slice(start);
    return out;
  }

  private line(line: string, out: SseMessage[]): void {
    if (line === '') {
      if (this.data.length > 0) {
        const msg: SseMessage = { event: this.event === '' ? 'message' : this.event, data: this.data.join('\n') };
        if (this.lastId !== undefined) msg.id = this.lastId;
        out.push(msg);
      }
      this.data = [];
      this.event = '';
      return;
    }
    if (line.charCodeAt(0) === 0x3a) return; // comment
    const colon = line.indexOf(':');
    let field: string;
    let value: string;
    if (colon < 0) {
      field = line;
      value = '';
    } else {
      field = line.slice(0, colon);
      value = line.slice(colon + 1);
      if (value.charCodeAt(0) === 0x20) value = value.slice(1);
    }
    switch (field) {
      case 'event': this.event = value; break;
      case 'data': this.data.push(value); break;
      case 'id': if (!value.includes('\0')) this.lastId = value; break;
      default: break; // retry / unknown
    }
  }
}

// ---------------------------------------------------------------------------------------------
// FetchTransport
// ---------------------------------------------------------------------------------------------

export interface FetchTransportOptions {
  /** Per-request timeout (also bounds time-to-headers of the SSE connect). Default 8000. */
  timeoutMs?: number;
  /** Override for tests; defaults to the global `fetch` looked up lazily. */
  fetch?: typeof fetch;
  /** Page protocol for mixed-content detection; defaults to `globalThis.location?.protocol`. */
  pageProtocol?: () => string | undefined;
}

export const DEFAULT_REQUEST_TIMEOUT_MS = 8000;

export class FetchTransport implements Transport {
  private readonly timeoutMs: number;
  private readonly fetchImpl: (() => typeof fetch) | undefined;
  private readonly pageProtocol: () => string | undefined;

  constructor(options: FetchTransportOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    const f = options.fetch;
    this.fetchImpl = f ? () => f : undefined;
    this.pageProtocol = options.pageProtocol ?? (() => (globalThis as { location?: { protocol?: string } }).location?.protocol);
  }

  private doFetch(): typeof fetch {
    return this.fetchImpl ? this.fetchImpl() : globalThis.fetch.bind(globalThis);
  }

  private classify(e: unknown, url: string, state: { timedOut: boolean; external: AbortSignal | undefined; closed?: boolean }): TransportError {
    if (e instanceof TransportError) return e;
    const name = (e as { name?: string } | null)?.name;
    if (name === 'AbortError' || name === 'TimeoutError' || state.timedOut || state.external?.aborted) {
      if (state.timedOut) return new TransportError('timeout', `Request timed out after ${this.timeoutMs} ms`);
      return new TransportError('aborted', 'Request aborted');
    }
    const cause = (e as { cause?: { code?: string; message?: string } } | null)?.cause;
    const detail = cause?.code ?? cause?.message ?? (e instanceof Error ? e.message : String(e));
    return new TransportError('unreachable', `Network request failed: ${detail}`, {
      mixedContentSuspected: isMixedContentCandidate(this.pageProtocol(), url),
    });
  }

  async request(req: TransportRequest): Promise<TransportResponse> {
    const controller = new AbortController();
    const state = { timedOut: false, external: req.signal };
    const timer = setTimeout(() => {
      state.timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    const onAbort = (): void => controller.abort();
    if (req.signal) {
      if (req.signal.aborted) {
        clearTimeout(timer);
        throw new TransportError('aborted', 'Request aborted');
      }
      req.signal.addEventListener('abort', onAbort, { once: true });
    }
    try {
      const init: RequestInit = { method: req.method, signal: controller.signal };
      if (req.headers) init.headers = req.headers;
      if (req.body !== undefined) init.body = req.body;
      if (req.keepalive) init.keepalive = true;
      const res = await this.doFetch()(req.url, init);
      const text = await res.text();
      const headers: Record<string, string> = {};
      res.headers.forEach((value, key) => {
        headers[key.toLowerCase()] = value;
      });
      return { status: res.status, headers, text };
    } catch (e) {
      throw this.classify(e, req.url, state);
    } finally {
      clearTimeout(timer);
      req.signal?.removeEventListener('abort', onAbort);
    }
  }

  async openEvents(url: string, options: OpenEventsOptions = {}): Promise<EventStream> {
    const controller = new AbortController();
    const state = { timedOut: false, external: options.signal };
    const timer = setTimeout(() => {
      state.timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    const onAbort = (): void => controller.abort();
    if (options.signal) {
      if (options.signal.aborted) {
        clearTimeout(timer);
        throw new TransportError('aborted', 'Request aborted');
      }
      options.signal.addEventListener('abort', onAbort, { once: true });
    }
    let res: Response;
    try {
      res = await this.doFetch()(url, {
        method: 'GET',
        headers: { Accept: 'text/event-stream', ...(options.headers ?? {}) },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.status !== 200) {
        const body = await res.text().catch(() => '');
        throw new TransportError('http', `HTTP ${res.status}`, { status: res.status, body });
      }
      if (!res.body) throw new TransportError('unreachable', 'Event stream has no body');
    } catch (e) {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      controller.abort();
      throw this.classify(e, url, state);
    }
    return new FetchEventStream(res.body, controller, options.signal, onAbort, (e) => this.classify(e, url, { timedOut: false, external: options.signal }));
  }
}

class FetchEventStream implements EventStream {
  private closed = false;
  private iterated = false;

  constructor(
    private readonly body: ReadableStream<Uint8Array>,
    private readonly controller: AbortController,
    private readonly external: AbortSignal | undefined,
    private readonly onExternalAbort: () => void,
    private readonly classify: (e: unknown) => TransportError,
  ) {}

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.external?.removeEventListener('abort', this.onExternalAbort);
    this.controller.abort();
  }

  async *[Symbol.asyncIterator](): AsyncIterator<SseMessage> {
    if (this.iterated) throw new Error('Event stream can only be iterated once');
    this.iterated = true;
    const reader = this.body.getReader();
    const decoder = new TextDecoder('utf-8');
    const parser = new SseParser();
    try {
      while (!this.closed) {
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try {
          chunk = await reader.read();
        } catch (e) {
          if (this.closed || this.external?.aborted) return;
          throw this.classify(e);
        }
        if (chunk.done) return;
        for (const msg of parser.push(decoder.decode(chunk.value, { stream: true }))) {
          if (this.closed) return;
          yield msg;
        }
      }
    } finally {
      this.close();
      reader.cancel().catch(() => undefined);
    }
  }
}
