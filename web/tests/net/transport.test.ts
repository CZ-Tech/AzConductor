import { afterEach, describe, expect, it } from 'vitest';
import {
  FetchTransport,
  SseParser,
  TransportError,
  describeApiError,
  type SseMessage,
} from '../../src/net/transport';
import { Cleanup, sleep, waitFor } from './_util';

const cleanup = new Cleanup();
afterEach(() => cleanup.run());

describe('SseParser', () => {
  const parse = (...chunks: string[]): SseMessage[] => {
    const p = new SseParser();
    return chunks.flatMap((c) => p.push(c));
  };

  it('parses event/id/data frames as the robot writes them', () => {
    const msgs = parse('event: pose\nid: 7\ndata: {"seq":7}\n\nevent: hello\nid: 0\ndata: {}\n\n');
    expect(msgs).toEqual([
      { event: 'pose', data: '{"seq":7}', id: '7' },
      { event: 'hello', data: '{}', id: '0' },
    ]);
  });

  it('defaults the event name to "message" and joins multi-line data', () => {
    expect(parse('data: a\ndata: b\n\n')).toEqual([{ event: 'message', data: 'a\nb' }]);
  });

  it('handles CRLF and bare CR, also split across chunks', () => {
    expect(parse('event: x\r\ndata: 1\r\n\r\n')).toEqual([{ event: 'x', data: '1' }]);
    expect(parse('event: x\rdata: 1\r\r')).toEqual([{ event: 'x', data: '1' }]);
    expect(parse('event: x\r', '\ndata: 1\r', '\n\r', '\n')).toEqual([{ event: 'x', data: '1' }]);
    expect(parse('ev', 'ent: y\nda', 'ta: 2\n', '\n')).toEqual([{ event: 'y', data: '2' }]);
  });

  it('ignores comments, unknown fields and retry; strips one leading space only', () => {
    expect(parse(': keepalive\nretry: 5000\nfoo: bar\ndata:  two spaces\n\n')).toEqual([{ event: 'message', data: ' two spaces' }]);
    expect(parse('data\n\n')).toEqual([{ event: 'message', data: '' }]);
  });

  it('the last event id persists to later events; ids with NUL are ignored', () => {
    expect(parse('id: 1\ndata: a\n\ndata: b\n\n')).toEqual([
      { event: 'message', data: 'a', id: '1' },
      { event: 'message', data: 'b', id: '1' },
    ]);
    expect(parse('id: a\0b\ndata: x\n\n')).toEqual([{ event: 'message', data: 'x' }]);
  });

  it('drops frames without data, strips a BOM, discards an unterminated trailing frame', () => {
    expect(parse('event: noop\n\n')).toEqual([]);
    expect(parse('\uFEFFdata: ok\n\n')).toEqual([{ event: 'message', data: 'ok' }]);
    expect(parse('data: partial\n')).toEqual([]);
  });

  it('event name resets between frames', () => {
    expect(parse('event: a\ndata: 1\n\ndata: 2\n\n').map((m) => m.event)).toEqual(['a', 'message']);
  });
});

describe('FetchTransport.request', () => {
  it('resolves for any status with lower-cased headers and the raw text', async () => {
    const robot = await cleanup.mock();
    robot.seedRoute('R', '[{"x":1,"y":2}]', 3);
    const t = new FetchTransport();
    const login = await t.request({
      method: 'POST', url: `${robot.url}/api/v2/session`, body: '{"client":"T"}', headers: { 'Content-Type': 'application/json' },
    });
    expect(login.status).toBe(201);
    const token = JSON.parse(login.text).token as string;

    const ok = await t.request({ method: 'GET', url: `${robot.url}/api/v2/routes/R`, headers: { 'X-Az-Session': token } });
    expect(ok.status).toBe(200);
    expect(ok.text).toBe('[{"x":1,"y":2}]');
    expect(ok.headers['etag']).toBe('"3"');
    expect(ok.headers['x-route-revision']).toBe('3');

    const miss = await t.request({ method: 'GET', url: `${robot.url}/api/v2/routes/none`, headers: { 'X-Az-Session': token } });
    expect(miss.status).toBe(404);
    expect(JSON.parse(miss.text)).toEqual({ error: 'route_not_found' });

    const noAuth = await t.request({ method: 'GET', url: `${robot.url}/api/v2/routes` });
    expect(noAuth.status).toBe(401);
  });

  it('rejects with TransportError(unreachable) when nothing listens', async () => {
    const robot = await cleanup.mock();
    const url = robot.url;
    await robot.stop();
    const err = await new FetchTransport().request({ method: 'GET', url: `${url}/api/v2/health` }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TransportError);
    expect((err as TransportError).kind).toBe('unreachable');
    expect((err as TransportError).message).toContain('Network request failed');
  });

  it('rejects with unreachable when the server resets the connection', async () => {
    const robot = await cleanup.mock();
    robot.dropNextRequests = 1;
    const err = await new FetchTransport().request({ method: 'GET', url: `${robot.url}/api/v2/health` }).catch((e: unknown) => e);
    expect((err as TransportError).kind).toBe('unreachable');
  });

  it('times out slow responses', async () => {
    const robot = await cleanup.mock();
    robot.responseDelayMs = 600;
    const started = Date.now();
    const err = await new FetchTransport({ timeoutMs: 150 }).request({ method: 'GET', url: `${robot.url}/api/v2/health` }).catch((e: unknown) => e);
    expect((err as TransportError).kind).toBe('timeout');
    expect(Date.now() - started).toBeLessThan(550);
  });

  it('aborts via the caller’s signal, also when already aborted', async () => {
    const robot = await cleanup.mock();
    robot.responseDelayMs = 600;
    const t = new FetchTransport();
    const ac = new AbortController();
    const pending = t.request({ method: 'GET', url: `${robot.url}/api/v2/health`, signal: ac.signal }).catch((e: unknown) => e);
    await sleep(50);
    ac.abort();
    expect(((await pending) as TransportError).kind).toBe('aborted');
    const pre = await t.request({ method: 'GET', url: `${robot.url}/api/v2/health`, signal: ac.signal }).catch((e: unknown) => e);
    expect((pre as TransportError).kind).toBe('aborted');
  });

  it('flags mixed content when an https page calls a plain-http robot', async () => {
    const robot = await cleanup.mock();
    const url = robot.url.replace('127.0.0.1', '192.0.2.1'); // TEST-NET, never reachable
    const t = new FetchTransport({ timeoutMs: 300, pageProtocol: () => 'https:', fetch: () => Promise.reject(new TypeError('Failed to fetch')) });
    const err = (await t.request({ method: 'GET', url }).catch((e: unknown) => e)) as TransportError;
    expect(err.kind).toBe('unreachable');
    expect(err.mixedContentSuspected).toBe(true);
    expect(describeApiError({ kind: 'unreachable', message: err.message, mixedContentSuspected: true })).toContain('https');
  });
});

describe('FetchTransport.openEvents', () => {
  async function session(robotUrl: string): Promise<string> {
    const r = await new FetchTransport().request({ method: 'POST', url: `${robotUrl}/api/v2/session`, body: '{}' });
    return JSON.parse(r.text).token as string;
  }

  it('rejects with an http TransportError (status + body) when the session is invalid', async () => {
    const robot = await cleanup.mock();
    const err = (await new FetchTransport().openEvents(`${robot.url}/api/v2/events`, { headers: { 'X-Az-Session': 'bad' } }).catch((e: unknown) => e)) as TransportError;
    expect(err).toBeInstanceOf(TransportError);
    expect(err.kind).toBe('http');
    expect(err.status).toBe(401);
    expect(JSON.parse(err.body ?? '')).toEqual({ error: 'invalid_session' });
  });

  it('yields SSE messages and ends cleanly on close()', async () => {
    const robot = await cleanup.mock({ poseHz: 50 });
    const token = await session(robot.url);
    const stream = await new FetchTransport().openEvents(`${robot.url}/api/v2/events`, { headers: { 'X-Az-Session': token } });
    const seen: string[] = [];
    for await (const msg of stream) {
      seen.push(msg.event);
      if (msg.event === 'commands') stream.close();
    }
    expect(seen.slice(0, 3)).toEqual(['hello', 'pose', 'runtime']);
    expect(seen).toContain('commands');
    await waitFor(() => robot.eventStreamCount === 0, 'server noticed the close');
    stream.close(); // idempotent
  });

  it('can only be iterated once', async () => {
    const robot = await cleanup.mock();
    const token = await session(robot.url);
    const stream = await new FetchTransport().openEvents(`${robot.url}/api/v2/events?session=${token}`);
    const it1 = stream[Symbol.asyncIterator]();
    await it1.next();
    await expect(stream[Symbol.asyncIterator]().next()).rejects.toThrow(/only be iterated once/);
    stream.close();
  });

  it('an external abort ends the iteration without throwing', async () => {
    const robot = await cleanup.mock();
    const token = await session(robot.url);
    const ac = new AbortController();
    const stream = await new FetchTransport().openEvents(`${robot.url}/api/v2/events`, { headers: { 'X-Az-Session': token }, signal: ac.signal });
    let n = 0;
    for await (const _ of stream) {
      if (++n === 2) ac.abort();
    }
    expect(n).toBeGreaterThanOrEqual(2);
  });

  it('a pre-aborted signal rejects with aborted', async () => {
    const robot = await cleanup.mock();
    const ac = new AbortController();
    ac.abort();
    const err = (await new FetchTransport().openEvents(`${robot.url}/api/v2/events`, { signal: ac.signal }).catch((e: unknown) => e)) as TransportError;
    expect(err.kind).toBe('aborted');
  });

  it('a dropped connection ends or errors the iterator (never hangs)', async () => {
    const robot = await cleanup.mock({ poseHz: 50 });
    const token = await session(robot.url);
    const stream = await new FetchTransport().openEvents(`${robot.url}/api/v2/events`, { headers: { 'X-Az-Session': token } });
    const outcome = (async () => {
      try {
        for await (const _ of stream) { /* drain */ }
        return 'ended';
      } catch (e) {
        return e instanceof TransportError ? e.kind : 'other';
      }
    })();
    await sleep(100);
    robot.dropEventStreams();
    expect(['ended', 'unreachable']).toContain(await outcome);
  });

  it('times out when the server never answers the connect', async () => {
    const robot = await cleanup.mock();
    const token = await session(robot.url);
    robot.responseDelayMs = 500; // applies to all requests, including the stream request
    const err = (await new FetchTransport({ timeoutMs: 120 }).openEvents(`${robot.url}/api/v2/events`, { headers: { 'X-Az-Session': token } }).catch((e: unknown) => e)) as TransportError;
    expect(err.kind).toBe('timeout');
  });
});
