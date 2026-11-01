/** 导入 / 导出对话框。 */
import { useRef, useState } from 'preact/hooks';
import type { DocStore } from '../../state/docStore';
import { importText, type RouteData } from '../../core/archive';
import { showDialog, toast } from './dialogs';
import { S } from '../strings';

export function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function showExportDialog(title: string, text: string, filename: string): Promise<null> {
  return showDialog<null>(title, (close) => <ExportForm text={text} filename={filename} onClose={() => close(null)} />);
}

function ExportForm(p: { text: string; filename: string; onClose: () => void }) {
  const ta = useRef<HTMLTextAreaElement>(null);
  return (
    <div>
      <div class="dlg-body">
        <textarea ref={ta} class="mono" readOnly rows={14} value={p.text} onFocus={(e) => (e.target as HTMLTextAreaElement).select()} aria-label="JSON" />
      </div>
      <div class="dlg-foot">
        <button onClick={async () => { toast((await copyText(p.text)) ? S.io.copied : S.io.copyFailed, 'info'); ta.current?.select(); }}>{S.io.copy}</button>
        <button onClick={() => downloadText(p.filename, p.text)}>{S.io.download}</button>
        <button class="primary" onClick={p.onClose}>{S.common.close}</button>
      </div>
    </div>
  );
}

export interface ImportOptions {
  /** 单路径导入时的默认名称 */
  defaultName?: string;
  /** 导入为替换当前路径的点（编辑器）时，只取第一条路径 */
  single?: boolean;
}

/** 导入对话框：返回解析出的路径（未写入仓库）；取消返回 null。 */
export function showImportDialog(opts: ImportOptions = {}): Promise<RouteData[] | null> {
  return showDialog<RouteData[]>(S.io.importTitle, (close) => <ImportForm opts={opts} onDone={close} />);
}

function ImportForm(p: { opts: ImportOptions; onDone: (r: RouteData[] | null) => void }) {
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const submit = () => {
    const r = importText(text, p.opts.defaultName);
    if (!r.ok) { setErr(r.error); return; }
    p.onDone(p.opts.single ? r.routes.slice(0, 1) : r.routes);
  };
  const onFile = async (e: Event) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    setText(await f.text());
    setErr(null);
  };
  return (
    <div>
      <div class="dlg-body">
        <textarea class="mono" rows={12} value={text} placeholder={S.io.importPlaceholder} aria-invalid={err ? 'true' : undefined}
          onInput={(e) => { setText((e.target as HTMLTextAreaElement).value); setErr(null); }} />
        {err && <div class="field-error" role="alert">{err}</div>}
        <input ref={file} type="file" accept=".json,application/json,text/plain" hidden onChange={onFile} />
      </div>
      <div class="dlg-foot">
        <button onClick={() => file.current?.click()}>{S.io.chooseFile}</button>
        <span class="spacer" />
        <button onClick={() => p.onDone(null)}>{S.common.cancel}</button>
        <button class="primary" disabled={!text.trim()} onClick={submit}>{S.io.doImport}</button>
      </div>
    </div>
  );
}

/** 方便路径管理页使用：导入并写入仓库，toast 提示。 */
export async function importIntoStore(store: DocStore): Promise<void> {
  const routes = await showImportDialog();
  if (!routes || routes.length === 0) return;
  const names = store.importRoutes(routes);
  toast(S.io.imported(names.length), 'ok');
}
