import { useEffect, useRef, useState } from 'preact/hooks';
import { connData, getConnection, onConnectionEvent } from '../../state/session';
import type { TelemetryFrame } from '../../net/models';
import { drawTelemetryChart, numericTelemetry, type NumericField, type TelemetrySample } from '../telemetryChart';
import { S } from '../strings';

const MAX_SAMPLES = 3000;

function SeriesChart({ field, samples, version }: { field: NumericField; samples: TelemetrySample[]; version: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const draw = () => drawTelemetryChart(c, samples, field.key);
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(c);
    const scheme = matchMedia('(prefers-color-scheme: dark)');
    scheme.addEventListener('change', draw);
    return () => { observer.disconnect(); scheme.removeEventListener('change', draw); };
  }, [field.key, samples, version]);
  const value = samples[samples.length - 1]?.values[field.key];
  return <div class="run-chart">
    <div class="run-chart-head"><strong>{field.label}{field.unit ? ` (${field.unit})` : ''}</strong><span class="muted mono">{value === undefined ? '--' : Number(value.toPrecision(6)).toString()}</span></div>
    <canvas ref={canvas} role="img" aria-label={S.run.telemetryPlot.chart(field.label)} />
  </div>;
}

export function TelemetryPanel({ running, connected }: { running: boolean; connected: boolean }) {
  const [fields, setFields] = useState<NumericField[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [version, setVersion] = useState(0);
  const samples = useRef<TelemetrySample[]>([]);
  const known = useRef(new Map<string, NumericField>());
  const recording = useRef(running);
  recording.current = running;
  const last = useRef<TelemetryFrame | null>(null);
  const origin = useRef<number | null>(null);

  const clear = () => {
    samples.current = [];
    origin.current = null;
    setVersion(v => v + 1);
  };
  useEffect(() => { if (running) clear(); }, [running]);
  useEffect(() => {
    const accept = (frame: TelemetryFrame) => {
      const previous = last.current;
      if (frame === previous || (previous && frame.seq === previous.seq && frame.tNanos === previous.tNanos)) return;
      last.current = frame;
      const numeric = numericTelemetry(frame);
      let changed = false;
      for (const field of numeric.fields) {
        const old = known.current.get(field.key);
        if (!old || old.unit !== field.unit) { known.current.set(field.key, field); changed = true; }
      }
      if (changed) setFields([...known.current.values()]);
      if (!recording.current) return;
      if (origin.current === null) origin.current = frame.tNanos;
      let t = (frame.tNanos - origin.current) / 1e9;
      if (t < (samples.current[samples.current.length - 1]?.t ?? 0)) {
        samples.current = [];
        origin.current = frame.tNanos;
        t = 0;
      }
      samples.current.push({ t, values: numeric.values });
      if (samples.current.length > MAX_SAMPLES) samples.current.shift();
      setVersion(v => v + 1);
    };
    const initial = connData.peek()?.telemetry;
    if (initial) accept(initial);
    return onConnectionEvent(event => {
      if (event.type === 'telemetry') accept(event.data);
      if (event.type === 'state' && event.state.kind !== 'connected') last.current = null;
    });
  }, []);
  useEffect(() => {
    // Optional endpoint: old firmware may return 404; do not disturb its connection.
    const c = getConnection();
    if (!connected || !c) return;
    let cancelled = false;
    void c.api.getTelemetry().then(result => {
      if (cancelled || !result.ok || last.current) return;
      const numeric = numericTelemetry(result.value.frame);
      for (const field of numeric.fields) known.current.set(field.key, field);
      setFields([...known.current.values()]);
    });
    return () => { cancelled = true; };
  }, [connected]);

  return <section class="telemetry-panel" aria-label={S.run.telemetryPlot.title}>
    <div class="run-chart-head"><strong>{S.run.telemetryPlot.title}</strong><button type="button" class="link" onClick={clear}>{S.run.telemetryPlot.clear}</button></div>
    <p class="muted telemetry-hint">{S.run.telemetryPlot.hint}</p>
    {fields.length === 0 ? <p class="muted">{S.run.telemetryPlot.empty}</p> : <details class="telemetry-picker" open>
      <summary>{S.run.telemetryPlot.pick(selected.length)}</summary>
      <div class="telemetry-options">{fields.map(field => <label key={field.key}><input type="checkbox" checked={selected.includes(field.key)} onChange={e => { const checked = e.currentTarget.checked; setSelected(keys => checked ? [...keys, field.key] : keys.filter(key => key !== field.key)); }} /><span>{field.label}{field.unit ? ` (${field.unit})` : ''}</span></label>)}</div>
    </details>}
    {selected.map(key => {
      const field = known.current.get(key);
      return field ? <SeriesChart key={key} field={field} samples={samples.current} version={version} /> : null;
    })}
  </section>;
}
