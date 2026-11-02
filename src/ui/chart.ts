/** 路径误差折线图（Canvas）。x 轴最小 30s、按 5s 步进增长；y 轴最小 5in。 */
export interface ErrorSample { t: number; e: number }

export const X_MIN_SEC = 30;
export const X_STEP_SEC = 5;
export const Y_MIN_IN = 5;

/** x 轴标注间距候选（秒）与标注最小像素间距。 */
const X_TICKS = [5, 10, 20, 30, 60, 120, 300];
const X_TICK_MIN_PX = 40;

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
  const muted = css.getPropertyValue('--ink-3').trim() || '#777';
  const grid = css.getPropertyValue('--line').trim() || '#ddd';
  const axis = css.getPropertyValue('--line-strong').trim() || '#bbb';
  const accent = css.getPropertyValue('--brand').trim() || '#3964fe';
  const font = css.getPropertyValue('--font').trim() || 'sans-serif';
  ctx.clearRect(0, 0, w, h);
  const L = 26, R = 10, T = 6, B = 18;
  const pw = w - L - R, ph = h - T - B;
  const { xMax, yMax } = chartAxes(samples);
  ctx.font = `10px ${font}`;
  ctx.fillStyle = muted;
  ctx.lineWidth = 1;
  // 只画水平网格，竖向用刻度标注，减少视觉噪声
  for (let i = 0; i <= 5; i++) {
    const y = Math.round(T + ph - (ph * i) / 5) + 0.5;
    ctx.strokeStyle = i === 0 ? axis : grid;
    ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + pw, y); ctx.stroke();
    ctx.textAlign = 'right';
    ctx.fillText(String((yMax * i) / 5), L - 6, y + 3);
  }
  const xt = X_TICKS.find((t) => (pw * t) / xMax >= X_TICK_MIN_PX) ?? xMax;
  ctx.textAlign = 'center';
  for (let x = 0; x <= xMax; x += xt) ctx.fillText(`${x}s`, L + (pw * x) / xMax, h - 4);
  if (samples.length === 0) return;

  const px = (s: ErrorSample) => L + (pw * s.t) / xMax;
  const py = (s: ErrorSample) => T + ph - (ph * s.e) / yMax;
  const first = samples[0] as ErrorSample;
  const last = samples[samples.length - 1] as ErrorSample;
  ctx.beginPath();
  samples.forEach((s, i) => { if (i === 0) ctx.moveTo(px(s), py(s)); else ctx.lineTo(px(s), py(s)); });
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.stroke();
  // 面积填充
  ctx.lineTo(px(last), T + ph);
  ctx.lineTo(px(first), T + ph);
  ctx.closePath();
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = accent;
  ctx.fill();
  ctx.globalAlpha = 1;
  // 当前值
  ctx.beginPath();
  ctx.arc(px(last), py(last), 2.5, 0, Math.PI * 2);
  ctx.fill();
}
