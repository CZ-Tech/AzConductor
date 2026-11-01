/** 命令式对话框与 Toast：基于原生 <dialog>.showModal()。 */
import { signal } from '@preact/signals';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChild } from 'preact';
import { S } from '../strings';

interface DialogEntry {
  id: number;
  title: string;
  render: (close: (v: unknown) => void) => ComponentChild;
  resolve: (v: unknown) => void;
}

const dialogs = signal<DialogEntry[]>([]);
let nextId = 1;

/** 打开自定义对话框；close(null) 或 Esc 关闭时 resolve null。 */
export function showDialog<T>(
  title: string,
  render: (close: (v: T | null) => void) => ComponentChild,
): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    const id = nextId++;
    const entry: DialogEntry = {
      id,
      title,
      render: render as DialogEntry['render'],
      resolve: (v) => {
        dialogs.value = dialogs.value.filter((d) => d.id !== id);
        resolve(v as T | null);
      },
    };
    dialogs.value = [...dialogs.value, entry];
  });
}

export function askText(opts: { title: string; label?: string; initial?: string; placeholder?: string; okText?: string }): Promise<string | null> {
  return showDialog<string>(opts.title, (close) => (
    <TextForm label={opts.label} initial={opts.initial ?? ''} placeholder={opts.placeholder} okText={opts.okText ?? S.common.ok} onDone={close} />
  ));
}

function TextForm(p: { label: string | undefined; initial: string; placeholder: string | undefined; okText: string; onDone: (v: string | null) => void }) {
  const [v, setV] = useState(p.initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const submit = (e: Event) => { e.preventDefault(); if (v.trim()) p.onDone(v.trim()); };
  return (
    <form onSubmit={submit}>
      <div class="dlg-body">
        {p.label && <label for="ask-text">{p.label}</label>}
        <input id="ask-text" ref={ref} type="text" value={v} placeholder={p.placeholder} onInput={(e) => setV((e.target as HTMLInputElement).value)} />
      </div>
      <div class="dlg-foot">
        <button type="button" onClick={() => p.onDone(null)}>{S.common.cancel}</button>
        <button type="submit" class="primary" disabled={!v.trim()}>{p.okText}</button>
      </div>
    </form>
  );
}

export interface ConfirmResult { extra: boolean }

export function askConfirm(opts: {
  title: string; message: string; okText?: string; danger?: boolean; extraLabel?: string; extraDefault?: boolean;
}): Promise<ConfirmResult | null> {
  return showDialog<ConfirmResult>(opts.title, (close) => (
    <ConfirmForm {...opts} onDone={close} />
  ));
}

function ConfirmForm(p: { message: string; okText?: string | undefined; danger?: boolean | undefined; extraLabel?: string | undefined; extraDefault?: boolean | undefined; onDone: (v: ConfirmResult | null) => void }) {
  const [extra, setExtra] = useState(p.extraDefault ?? false);
  return (
    <div>
      <div class="dlg-body">
        <p style="margin-top:0">{p.message}</p>
        {p.extraLabel && (
          <label class="check"><input type="checkbox" checked={extra} onChange={(e) => setExtra((e.target as HTMLInputElement).checked)} /> {p.extraLabel}</label>
        )}
      </div>
      <div class="dlg-foot">
        <button onClick={() => p.onDone(null)}>{S.common.cancel}</button>
        <button class={p.danger ? 'primary danger' : 'primary'} onClick={() => p.onDone({ extra })}>{p.okText ?? S.common.ok}</button>
      </div>
    </div>
  );
}

function ModalDialog({ entry }: { entry: DialogEntry }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) { try { d.showModal(); } catch { d.setAttribute('open', ''); } }
  }, []);
  return (
    <dialog ref={ref} aria-label={entry.title} onCancel={(e) => { e.preventDefault(); entry.resolve(null); }}>
      <div class="dlg-head">{entry.title}</div>
      {entry.render(entry.resolve)}
    </dialog>
  );
}

// ---------- Toast ----------
export interface ToastItem { id: number; text: string; kind: 'info' | 'error' | 'ok' }
export const toasts = signal<ToastItem[]>([]);

export function toast(text: string, kind: ToastItem['kind'] = 'info', ms = 3500): void {
  const id = nextId++;
  toasts.value = [...toasts.value, { id, text, kind }];
  setTimeout(() => { toasts.value = toasts.value.filter((t) => t.id !== id); }, ms);
}

export function DialogHost() {
  return (
    <>
      {dialogs.value.map((d) => <ModalDialog key={d.id} entry={d} />)}
      <div class="toast-host" role="status" aria-live="polite">
        {toasts.value.map((t) => <div key={t.id} class={`toast ${t.kind}`}>{t.text}</div>)}
      </div>
    </>
  );
}
