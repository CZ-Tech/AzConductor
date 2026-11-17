/** 运行页与节点编辑器共用的受控指令签名/参数表单，不擅自补齐或截断草稿。 */
import { argError, commandVariants, isOptionalParam, paramKind, type ArgError, type CommandSignature } from '../../core/commandArgs';
import { S } from '../strings';

interface CommandArgumentsProps {
  idPrefix: string;
  command: CommandSignature;
  /** nonunified 的精确签名索引；-1 表示现有参数数量无匹配签名。 */
  variantIndex: number;
  args: readonly string[];
  /** 父组件负责在显式切换签名时重置草稿，不按旧输入位置重解释类型。 */
  onVariant: (index: number) => void;
  onArgs: (args: string[]) => void;
}

function ParamField(p: {
  id: string; name: string; type: string; value: string; optional: boolean;
  modern: boolean; fallback: string | null; error: ArgError | null; onInput: (value: string) => void;
}) {
  const kind = paramKind(p.type);
  const msg = p.error ? S.commands.argErrors[p.error] : '';
  const hint = p.modern && p.fallback !== null ? S.commands.defaultValue(p.fallback) : '';
  const describedBy = [hint ? `${p.id}-hint` : '', msg ? `${p.id}-error` : ''].filter(Boolean).join(' ') || undefined;
  const label = <label for={p.id}>{p.name}<span>{p.type} · {p.optional ? S.commands.optional : S.commands.required}</span></label>;
  return (
    <div class="cmd-param">{label}
      {kind === 'boolean' ? (
        <select id={p.id} value={p.value} aria-invalid={p.error ? 'true' : undefined} aria-describedby={describedBy}
          onChange={(e) => p.onInput((e.target as HTMLSelectElement).value)}>
          <option value="">{p.optional && p.modern ? S.commands.omit : p.optional && p.fallback !== null ? S.commands.defaultValue(p.fallback) : S.commands.chooseValue}</option>
          {p.value !== '' && p.value !== 'false' && p.value !== 'true' && <option value={p.value}>{p.value}</option>}
          <option value="false">false</option>
          <option value="true">true</option>
        </select>
      ) : (
        <input id={p.id} type="text" inputMode={kind === 'integer' ? 'numeric' : kind === 'number' ? 'decimal' : 'text'} autocomplete="off"
          value={p.value} placeholder={p.optional && p.modern ? S.commands.omit : p.fallback !== null ? S.commands.defaultValue(p.fallback) : undefined}
          aria-invalid={p.error ? 'true' : undefined} aria-describedby={describedBy}
          onInput={(e) => p.onInput((e.target as HTMLInputElement).value)} />
      )}
      {hint && <div class="hint" id={`${p.id}-hint`}>{hint}</div>}
      {msg && <div class="field-error" id={`${p.id}-error`}>{msg}</div>}
    </div>
  );
}

export function CommandArguments(p: CommandArgumentsProps) {
  const variants = commandVariants(p.command);
  const split = p.command.hasUnifiedSignature === false;
  const form = variants[split ? p.variantIndex : 0];
  const signatureId = `${p.idPrefix}-signature`;
  const updateArg = (i: number, value: string) => {
    const next = [...p.args];
    // 只有用户输入后才扩展数组；打开已存节点绝不补参。
    while (next.length <= i) next.push('');
    next[i] = value;
    p.onArgs(next);
  };
  const count = Math.max(form?.paramNames.length ?? 0, p.args.length);
  return (
    <div class="cmd-params">
      {split && (
        <div class="cmd-param">
          <label for={signatureId}>{S.commands.signature}</label>
          <select id={signatureId} value={form ? String(p.variantIndex) : ''}
            aria-invalid={!form ? 'true' : undefined} aria-describedby={!form ? `${signatureId}-error` : undefined}
            onChange={(e) => {
              const value = (e.target as HTMLSelectElement).value;
              if (value !== '') p.onVariant(Number(value));
            }}>
            <option value="" disabled>{S.commands.chooseSignature}</option>
            {variants.map((variant, i) => (
              <option key={i} value={String(i)}>
                ({variant.paramNames.length ? variant.paramNames.map((name, k) => `${name}: ${variant.paramTypes[k] ?? 'String'}`).join(', ') : S.commands.noParams})
              </option>
            ))}
          </select>
          {!form && <div class="field-error" id={`${signatureId}-error`}>{S.commands.signatureMismatch}</div>}
        </div>
      )}
      {form && p.args.length > form.paramNames.length && <div class="field-error">{S.commands.invalidArgs}</div>}
      {Array.from({ length: count }, (_, i) => {
        const id = `${p.idPrefix}-${i}`;
        if (!form || i >= form.paramNames.length) {
          // 不匹配签名或目录变更后多出的已存参数仍可见，切换签名前不丢弃。
          return <div class="cmd-param" key={i}>
            <label for={id}>{S.commands.paramN(i + 1)}</label>
            <input id={id} type="text" value={p.args[i] ?? ''} onInput={(e) => updateArg(i, (e.target as HTMLInputElement).value)} />
          </div>;
        }
        return <ParamField key={i} id={id} name={form.paramNames[i] ?? S.commands.paramN(i + 1)} type={form.paramTypes[i] ?? 'String'}
          value={p.args[i] ?? ''} optional={isOptionalParam(form, i)} modern={form.hasUnifiedSignature !== undefined}
          fallback={form.paramDefaults?.[i] ?? null} error={argError(form, i, p.args[i], p.args)} onInput={(value) => updateArg(i, value)} />;
      })}
    </div>
  );
}
