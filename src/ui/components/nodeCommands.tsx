import type { NodeCommand } from '../../core/node';
import { argsValid, commandVariants, draftArgs, variantForArgs } from '../../core/commandArgs';
import { commandCatalog } from '../../state/robotData';
import { CommandArguments } from './commandArguments';
import { IconClose, IconPlus } from './icons';
import { S } from '../strings';

/** 本地草稿身份；只用于 key / label，保存时不得进入文档。 */
export type CommandDraft = NodeCommand & { uiId: string };
let nextId = 0;
export const commandDraft = (command: NodeCommand = { name: '', params: [] }): CommandDraft => ({
  uiId: `nc-${++nextId}`, name: command.name, params: [...command.params],
});

export function NodeCommands(p: { rows: CommandDraft[]; onRows: (rows: CommandDraft[]) => void }) {
  const catalog = commandCatalog.value;
  const update = (id: string, change: Partial<NodeCommand>) => p.onRows(p.rows.map((r) => r.uiId === id ? { ...r, ...change } : r));
  const move = (index: number, delta: number) => {
    const rows = [...p.rows];
    const target = index + delta;
    if (target < 0 || target >= rows.length) return;
    [rows[index], rows[target]] = [rows[target]!, rows[index]!];
    p.onRows(rows);
  };
  return <div class="node-commands">
    <div class="hint">{S.node.commandsHint}</div>
    <datalist id="nf-command-catalog">{catalog?.commands.map((c) => <option key={c.name} value={c.name} />)}</datalist>
    <ol class="node-command-list">
      {p.rows.map((row, index) => {
        const desc = catalog?.commands.find((c) => c.name === row.name);
        const prefix = row.uiId;
        const setName = (name: string) => {
          if (name === row.name) return;
          const command = catalog?.commands.find((c) => c.name === name);
          const variant = command ? commandVariants(command)[0] : undefined;
          // 仅显式换命令重置；打开、重排和刷新目录不修改原参数。
          update(row.uiId, { name, params: variant ? draftArgs(variant) : [] });
        };
        return <li class="node-command-card" key={row.uiId} data-command-id={row.uiId}>
          <div class="node-command-head">
            <label class="nf-label" for={`${prefix}-name`}>{S.node.commandN(index + 1)}</label>
            <span class="spacer" />
            <button type="button" class="ghost" disabled={index === 0} aria-label={S.node.moveCommandUp(index + 1)} onClick={() => move(index, -1)}>{S.node.moveUp}</button>
            <button type="button" class="ghost" disabled={index === p.rows.length - 1} aria-label={S.node.moveCommandDown(index + 1)} onClick={() => move(index, 1)}>{S.node.moveDown}</button>
            <button type="button" class="icon ghost" aria-label={S.node.removeCommand(index + 1)} title={S.node.removeCommand(index + 1)} onClick={() => p.onRows(p.rows.filter((r) => r.uiId !== row.uiId))}><IconClose /></button>
          </div>
          <input id={`${prefix}-name`} class="node-command-name" type="text" list="nf-command-catalog" value={row.name} placeholder={S.node.selectCommand} onInput={(e) => setName(e.currentTarget.value)} />
          {catalog && row.name && !desc && <div class="hint">{S.node.noMatch}</div>}
          {desc ? <>
            <CommandArguments idPrefix={prefix} command={desc} variantIndex={variantForArgs(desc, row.params)} args={row.params}
              onVariant={(i) => { const v = commandVariants(desc)[i]; if (v) update(row.uiId, { params: draftArgs(v) }); }}
              onArgs={(params) => update(row.uiId, { params })} />
            {!argsValid(desc, row.params) && <div class="hint">{S.commands.invalidArgs}</div>}
          </> : <>
            {row.params.map((value, i) => <div class="param-row" key={i}>
              <input type="text" aria-label={S.node.paramN(i + 1)} value={value} placeholder={S.node.paramN(i + 1)}
                onInput={(e) => { const params = [...row.params]; params[i] = e.currentTarget.value; update(row.uiId, { params }); }} />
              <button type="button" class="icon ghost" aria-label={S.node.removeParam} title={S.node.removeParam} onClick={() => update(row.uiId, { params: row.params.filter((_, j) => j !== i) })}><IconClose /></button>
            </div>)}
            <button type="button" class="ghost" onClick={() => update(row.uiId, { params: [...row.params, ''] })}><IconPlus />{S.node.addParam}</button>
          </>}
        </li>;
      })}
    </ol>
    <button type="button" class="ghost" onClick={() => p.onRows([...p.rows, commandDraft()])}><IconPlus />{S.node.addCommand}</button>
  </div>;
}
