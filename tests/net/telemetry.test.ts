import { afterEach, describe, expect, it } from 'vitest';
import { decodeTelemetryFrame, decodeTelemetrySnapshot, DecodeError, type TelemetryLine } from '../../src/net/models';
import { Cleanup, recordEvents, waitFor } from './_util';

const cleanup = new Cleanup();
afterEach(() => cleanup.run());
const lines: TelemetryLine[] = [{ caption: null, items: [
  { caption: '自定义速度', text: '-1.23456789 in/s', type: 'number', value: -1.23456789, unit: 'in/s' },
  { caption: 'ready', text: 'false', type: 'boolean', value: false },
  { caption: 'status', text: '任意文本\n第二行', type: 'text', value: null },
  { caption: 'invalid', text: 'NaN', type: 'number', value: null },
] }, { caption: '空行', items: [] }];

describe('telemetry wire DTOs', () => {
  it('preserves typed values, display text, optional units, order, empty frames and number precision', () => {
    const frame = { seq: 3, tNanos: 123, lines };
    expect(decodeTelemetryFrame(frame)).toEqual(frame);
    expect(decodeTelemetrySnapshot({ frame, logSeq: 7 })).toEqual({ frame, logSeq: 7 });
    expect(decodeTelemetryFrame({ seq: 0, tNanos: 0, lines: [] })).toEqual({ seq: 0, tNanos: 0, lines: [] });
    expect(decodeTelemetryFrame(frame).lines[0]?.items[1]).not.toHaveProperty('unit');
  });

  it.each([
    { type: 'number', value: '1' }, { type: 'number', value: Infinity },
    { type: 'boolean', value: null }, { type: 'text', value: 'text' },
    { type: 'unknown', value: null }, { type: 'number' },
  ])('rejects invalid item %j', (item) => {
    expect(() => decodeTelemetryFrame({ seq: 1, tNanos: 1, lines: [{ caption: null,
      items: [{ caption: 'c', text: 't', ...item }] }] })).toThrow(DecodeError);
  });
});

describe('telemetry HTTP and SSE', () => {
  it('requires a session and returns the empty boot snapshot', async () => {
    const robot = await cleanup.mock();
    const conn = cleanup.connection({ baseUrl: robot.url });
    expect(await conn.api.getTelemetry()).toMatchObject({ ok: false, error: { kind: 'no_session' } });
    await conn.api.openSession('test');
    expect(await conn.api.getTelemetry()).toMatchObject({ ok: true, value: {
      frame: { seq: 0, tNanos: 0, lines: [] }, logSeq: 0,
    } });
    const request = robot.requests.find((r) => r.path === '/api/v2/telemetry');
    expect(request?.headers['x-az-session']).toBe(robot.sessionToken);
  });

  it('delivers an existing latest frame immediately, then new frames exactly once, and resets on close', async () => {
    const robot = await cleanup.mock();
    robot.publishTelemetry([], 100);
    robot.publishTelemetry(lines, 200);
    const conn = cleanup.connection({ baseUrl: robot.url });
    const events = recordEvents(conn);
    expect((await conn.connect()).ok).toBe(true);
    await waitFor(() => conn.data.telemetry?.seq === 2, 'initial latest telemetry');
    expect(conn.data.telemetry).toEqual({ seq: 2, tNanos: 200, lines });
    expect(await conn.api.getTelemetry()).toMatchObject({ ok: true, value: { frame: conn.data.telemetry, logSeq: 0 } });
    robot.publishTelemetry([], 300);
    await waitFor(() => conn.data.telemetry?.seq === 3, 'empty clearing frame');
    expect(events.filter((e) => e.type === 'telemetry')).toEqual([
      { type: 'telemetry', data: { seq: 2, tNanos: 200, lines } },
      { type: 'telemetry', data: { seq: 3, tNanos: 300, lines: [] } },
    ]);
    await conn.close();
    expect(conn.data.telemetry).toBeNull();
    expect((await conn.connect()).ok).toBe(true);
    await waitFor(() => conn.data.telemetry?.seq === 3, 'latest telemetry on reconnect');
  });

  it('keeps old firmware connected without telemetry endpoint or events', async () => {
    const robot = await cleanup.mock({ telemetryEnabled: false });
    robot.publishTelemetry(lines);
    const conn = cleanup.connection({ baseUrl: robot.url });
    expect((await conn.connect()).ok).toBe(true);
    await waitFor(() => conn.data.lastHeartbeat !== null, 'legacy stream');
    expect(conn.data.telemetry).toBeNull();
    expect(robot.requests.some((r) => r.path === '/api/v2/telemetry')).toBe(false);
    expect(await conn.api.getTelemetry()).toMatchObject({ ok: false, error: { kind: 'http', status: 404, code: 'not_found' } });
    expect(conn.state.kind).toBe('connected');
  });

  it('reports malformed telemetry as a parse error consistently with other known channels', async () => {
    const robot = await cleanup.mock();
    const conn = cleanup.connection({ baseUrl: robot.url, autoRetry: false });
    await conn.connect();
    await waitFor(() => conn.data.lastHeartbeat !== null);
    robot.emitRaw('telemetry', '{"seq":"bad","tNanos":0,"lines":[]}');
    await waitFor(() => conn.state.kind === 'failed');
    expect(conn.state).toMatchObject({ kind: 'failed', error: { kind: 'parse' } });
    expect(conn.data.telemetry).toBeNull();
  });
});
