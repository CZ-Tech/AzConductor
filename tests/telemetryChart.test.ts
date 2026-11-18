import { describe, expect, it } from 'vitest';
import { numericTelemetry, telemetryAxes } from '../src/ui/telemetryChart';
import type { TelemetryFrame, TelemetryItem } from '../src/net/models';

const number = (caption: string, value: number | null): TelemetryItem => ({ caption, text: String(value), type: 'number', value });
const frame = (items: TelemetryItem[]): TelemetryFrame => ({ seq: 1, tNanos: 100, lines: [{ caption: null, items }] });

describe('numeric telemetry series', () => {
  it('keeps only typed numeric items without parsing display text', () => {
    const data = numericTelemetry(frame([number('pCross', -0.25), { caption: 'message', text: '123', type: 'text', value: null }, { caption: 'ready', text: 'true', type: 'boolean', value: true }, { ...number('speed', 12.345), text: '12.3 in/s', unit: 'in/s' }]));
    expect(data.fields.map(f => f.label)).toEqual(['pCross', 'speed']);
    expect(data.values[data.fields[1]!.key]).toBe(12.345);
    expect(data.fields[1]!.unit).toBe('in/s');
  });
  it('preserves identities when fields reorder and separates duplicates and lines', () => {
    const first = numericTelemetry(frame([number('a', 1), number('b', 2), number('a', 3)]));
    const reordered = numericTelemetry(frame([number('b', 2), number('a', 1), number('a', 3)]));
    expect(first.fields[0]!.key).toBe(reordered.fields[1]!.key);
    expect(new Set(first.fields.map(f => f.key)).size).toBe(3);
    const grouped = numericTelemetry({ seq: 1, tNanos: 1, lines: [{ caption: 'one', items: [number('a', 1)] }, { caption: 'two', items: [number('a', 2)] }] });
    expect(grouped.fields[0]!.key).not.toBe(grouped.fields[1]!.key);
  });
  it('keeps invalid numeric fields selectable but creates gaps', () => {
    const data = numericTelemetry(frame([number('null', null), number('nan', NaN), number('__proto__', 2)]));
    expect(data.fields).toHaveLength(3);
    expect(Object.values(data.values)).toEqual([2]);
  });
  it('includes zero, negative and positive data and uses retained time range', () => {
    const axes = telemetryAxes([{ t: 50, values: { a: -4 } }, { t: 60, values: { a: 8 } }], 'a');
    expect(axes.min).toBeLessThan(-4);
    expect(axes.max).toBeGreaterThan(8);
    expect(axes.start).toBe(50);
    expect(axes.end).toBe(60);
    expect(telemetryAxes([], 'a').max).toBeGreaterThan(0);
  });
});
