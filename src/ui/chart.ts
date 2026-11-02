/** 路径误差折线图（Canvas）。x 轴最小 30s、按 5s 步进增长；y 轴最小 5in。 */
export interface ErrorSample { t: number; e: number }

export const X_MIN_SEC = 30;
export const X_STEP_SEC = 5;
export const Y_MIN_IN = 5;

export function chartAxes(samples: readonly ErrorSample[]): { xMax: number; yMax: number } {
  const last = samples.length ? (samples[samples.length - 1] as ErrorSample).t : 0;
  const xMax = Math.max(X_MIN_SEC, Math.ceil(last / X_STEP_SEC) * X_STEP_SEC);
  let maxE = 0;
  for (const s of samples) if (s.e > maxE) maxE = s.e;
  const yMax = Math.max(Y_MIN_IN, Math.ceil(maxE / 5) * 5);
  return { xMax, yMax };
}

export function drawErrorChart(canvas: HTMLCanvasElement, samples: readonly ErrorSample[]): void {
  const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w === 0 || h === 0) return;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const css = getComputedStyle(canvas);
  const ink = css.getPropertyValue('--ink').trim() || '#111';
  const line = css.getPropertyValue('--line').trim() || '#ccc';
  const accent = css.getPropertyValue('--blue').trim() || '#2563eb';
  ctx.clearRect(0, 0, w, h);
  const L = 36, R = 8, T = 8, B = 20;
  const pw = w - L - R, ph = h - T - B;
  const { xMax, yMax } = chartAxes(samples);
  ctx.font = '10px sans-serif';
  ctx.fillStyle = ink;
  ctx.strokeStyle = line;
  ctx.lineWidth = 1;
  for (let i = 0; i <= 5; i++) {
    const y = T + ph - (ph * i) / 5;
    ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + pw, y); ctx.stroke();
    ctx.textAlign = 'right';
    ctx.fillText(String((yMax * i) / 5), L - 4, y + 3);
  }
  const xt = xMax / X_STEP_SEC > 12 ? 10 : X_STEP_SEC;
  for (let x = 0; x <= xMax; x += xt) {
    const px = L + (pw * x) / xMax;
    ctx.beginPath(); ctx.moveTo(px, T); ctx.lineTo(px, T + ph); ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillText(String(x), px, h - 6);
  }
  if (samples.length === 0) return;
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  samples.forEach((s, i) => {
    const px = L + (pw * s.t) / xMax;
    const py = T + ph - (ph * s.e) / yMax;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  });
  ctx.stroke();
}
