import type { TelemetryFrame } from '../net/models';

export interface NumericField { key: string; label: string; unit?: string }
export interface TelemetrySample { t: number; values: Record<string, number> }

/** Caption identities survive reordering; repeated captions remain separate series. */
export function numericTelemetry(frame: TelemetryFrame): { fields: NumericField[]; values: Record<string, number> } {
  const fields: NumericField[] = [];
  const values: Record<string, number> = {};
  const occurrences = new Map<string, number>();
  for (const line of frame.lines) for (const item of line.items) {
    const identity = JSON.stringify([line.caption, item.caption]);
    const occurrence = occurrences.get(identity) ?? 0;
    occurrences.set(identity, occurrence + 1);
    if (item.type !== 'number') continue;
    const key = JSON.stringify([line.caption, item.caption, occurrence]);
    const label = [line.caption, item.caption].filter(Boolean).join(' / ') || '—';
    fields.push({ key, label: occurrence ? `${label} (${occurrence + 1})` : label, ...(item.unit ? { unit: item.unit } : {}) });
    if (typeof item.value === 'number' && Number.isFinite(item.value)) values[key] = item.value;
  }
  return { fields, values };
}

export function telemetryAxes(samples: readonly TelemetrySample[], key: string) {
  let min = 0, max = 0;
  for (const s of samples) {
    const v = s.values[key];
    if (v !== undefined && Number.isFinite(v)) { min = Math.min(min, v); max = Math.max(max, v); }
  }
  const span = max - min || 1;
  return { min: min - span * 0.1, max: max + span * 0.1,
    start: samples[0]?.t ?? 0, end: Math.max(30, (samples[samples.length - 1]?.t ?? 0)) };
}

export function drawTelemetryChart(canvas: HTMLCanvasElement, samples: readonly TelemetrySample[], key: string) {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
  if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const css = getComputedStyle(canvas);
  const { min, max, start, end } = telemetryAxes(samples, key);
  const l = 52, r = w - 12, top = 8, bottom = h - 22;
  const x = (t: number) => l + (r - l) * (t - start) / (end - start || 1);
  const y = (v: number) => bottom - (bottom - top) * (v - min) / (max - min);
  ctx.font = `10px ${css.getPropertyValue('--font').trim() || 'sans-serif'}`;
  ctx.lineWidth = 1;
  ctx.fillStyle = css.getPropertyValue('--ink-3').trim();
  ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const v = min + (max - min) * i / 4;
    ctx.strokeStyle = css.getPropertyValue('--line').trim();
    ctx.beginPath(); ctx.moveTo(l, y(v)); ctx.lineTo(r, y(v)); ctx.stroke();
    ctx.fillText(Number(v.toPrecision(3)).toString(), l - 5, y(v) + 3);
  }
  ctx.strokeStyle = css.getPropertyValue('--line-strong').trim();
  ctx.beginPath(); ctx.moveTo(l, y(0)); ctx.lineTo(r, y(0)); ctx.stroke();
  for (let i = 0; i <= 3; i++) {
    const t = start + (end - start) * i / 3;
    ctx.textAlign = i === 0 ? 'left' : i === 3 ? 'right' : 'center';
    ctx.fillText(`${t.toFixed(1)}s`, x(t), h - 4);
  }
  ctx.strokeStyle = css.getPropertyValue('--brand').trim();
  ctx.fillStyle = ctx.strokeStyle;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  let pen = false;
  for (const s of samples) {
    const v = s.values[key];
    if (v === undefined || !Number.isFinite(v)) { pen = false; continue; }
    if (pen) ctx.lineTo(x(s.t), y(v)); else ctx.moveTo(x(s.t), y(v));
    pen = true;
  }
  ctx.stroke();
  const last = samples[samples.length - 1];
  const value = last?.values[key];
  if (last && value !== undefined) { ctx.beginPath(); ctx.arc(x(last.t), y(value), 2.5, 0, Math.PI * 2); ctx.fill(); }
}
