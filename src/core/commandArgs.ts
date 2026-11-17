/**
 * 指令参数的文本校验与签名选择。线上参数一律是字符串，由固件 CommandArgs.convert 严格转换。
 * 新目录按重载元数据省略可选尾参；只有填补中间空位时才使用显式默认值，不推测重载方法体。
 * 旧目录没有签名元数据时保留按 paramDefaults 补全的兼容行为。
 */
export type ParamKind = 'integer' | 'number' | 'boolean' | 'char' | 'text';
export type ArgError = 'missing' | 'integer' | 'number' | 'boolean' | 'char' | 'range';

/** 固件按这些类型名转换，区分大小写；别的类型当文本原样传。整数位宽用于范围检查。 */
const INT_BITS: Readonly<Record<string, number>> = { int: 32, Integer: 32, long: 64, Long: 64, short: 16, Short: 16, byte: 8, Byte: 8 };
const NUMBER_TYPES: ReadonlySet<string> = new Set(['float', 'Float', 'double', 'Double']);

function bareType(type: string | undefined): string {
  return (type ?? '').trim().replace(/^java\.lang\./, '');
}

export function paramKind(type: string | undefined): ParamKind {
  const t = bareType(type);
  if (t in INT_BITS) return 'integer';
  if (NUMBER_TYPES.has(t)) return 'number';
  if (t === 'boolean' || t === 'Boolean') return 'boolean';
  if (t === 'char' || t === 'Character') return 'char';
  return 'text';
}

const INTEGER = /^[+-]?\d+$/;
const DECIMAL = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/**
 * 合法返回 null。数字类型按去掉首尾空格后的值检查（下发前也会同样去掉）。
 * 空白值算缺失；`allowEmpty`（该参数有默认值）时文本可以为空串。
 */
export function validateArg(type: string | undefined, value: string, allowEmpty = false): ArgError | null {
  const kind = paramKind(type);
  if (value.trim() === '') return allowEmpty && kind === 'text' ? null : 'missing';
  switch (kind) {
    case 'integer': {
      const v = value.trim();
      if (!INTEGER.test(v)) return 'integer';
      const lim = 1n << BigInt((INT_BITS[bareType(type)] ?? 32) - 1);
      const n = BigInt(v);
      return n >= -lim && n < lim ? null : 'range';
    }
    case 'number': {
      const v = value.trim();
      if (!DECIMAL.test(v)) return 'number';
      const n = Number(v);
      const single = bareType(type).toLowerCase() === 'float';
      return Number.isFinite(single ? Math.fround(n) : n) ? null : 'range';
    }
    case 'boolean': return /^(true|false)$/i.test(value.trim()) ? null : 'boolean';
    case 'char': return value.length === 1 ? null : 'char'; // 固件按 UTF-16 长度算
    default: return null;
  }
}

export interface CommandParameters {
  paramNames: readonly string[];
  paramTypes: readonly string[];
  /** 显式默认值文本；null 只代表未知默认值，不足以判断参数是否必填。 */
  paramDefaults?: readonly (string | null)[];
}

export interface CommandSignature extends CommandParameters {
  signatures?: readonly CommandParameters[];
  acceptedArgCounts?: readonly number[];
  hasUnifiedSignature?: boolean;
  requiredParamCount?: number | null;
  paramRequired?: readonly boolean[] | null;
}

const defaultOf = (cmd: CommandParameters, i: number): string | null => cmd.paramDefaults?.[i] ?? null;
const supplied = (value: string | undefined): boolean => value !== undefined && value.trim() !== '';

export function isOptionalParam(cmd: CommandSignature, i: number): boolean {
  if (cmd.hasUnifiedSignature !== undefined) return cmd.paramRequired?.[i] === false;
  return defaultOf(cmd, i) !== null;
}

/** 不可合并的重载必须先选定精确调用形式，各形式不再隐含其他可选尾参。 */
export function commandVariants(cmd: CommandSignature): CommandSignature[] {
  if (cmd.hasUnifiedSignature !== false) return [cmd];
  return (cmd.signatures ?? []).map((signature) => ({
    ...signature,
    signatures: [signature],
    acceptedArgCounts: [signature.paramNames.length],
    hasUnifiedSignature: true,
    requiredParamCount: signature.paramNames.length,
    paramRequired: signature.paramNames.map(() => true),
  }));
}

/** 已存参数按数量恢复独立签名；不匹配返回 -1，由 UI 提示而不是静默截断。 */
export function variantForArgs(cmd: CommandSignature, args: readonly string[]): number {
  return cmd.hasUnifiedSignature === false
    ? (cmd.signatures ?? []).findIndex((signature) => signature.paramNames.length === args.length)
    : 0;
}

/** 新目录的可选输入初始为空，尤其不能把可省略 boolean 自动变成 false。 */
function initialArg(cmd: CommandSignature, i: number): string {
  if (cmd.hasUnifiedSignature !== undefined && isOptionalParam(cmd, i)) return '';
  const def = defaultOf(cmd, i);
  const kind = paramKind(cmd.paramTypes[i]);
  if (def !== null) return kind === 'boolean' && /^(true|false)$/i.test(def.trim()) ? def.trim().toLowerCase() : def;
  return kind === 'boolean' ? 'false' : '';
}

/** 仅用于表单显示；不会直接改写节点中保存的参数数量。 */
export function draftArgs(cmd: CommandSignature, previous: readonly string[] = []): string[] {
  return cmd.paramNames.map((_, i) => previous[i] ?? initialArg(cmd, i));
}

/** 显式默认值可填补中间空位；数字/布尔去首尾空格，文本与字符原样。 */
export function resolveArg(cmd: CommandParameters, i: number, value: string | undefined): string {
  const v = value ?? '';
  const def = defaultOf(cmd, i);
  const kind = paramKind(cmd.paramTypes[i]);
  const resolved = v.trim() === '' && def !== null ? def : v;
  return kind === 'text' || kind === 'char' ? resolved : resolved.trim();
}

function invocationLength(cmd: CommandSignature, args: readonly string[]): number {
  if (cmd.hasUnifiedSignature === undefined) return cmd.paramNames.length;
  const count = cmd.requiredParamCount ?? cmd.paramNames.length;
  for (let i = cmd.paramNames.length - 1; i >= count; i--) {
    if (supplied(args[i])) return i + 1;
  }
  return count;
}

function exactVariant(cmd: CommandSignature, args: readonly string[]): CommandSignature | undefined {
  return commandVariants(cmd)[variantForArgs(cmd, args)];
}

/** 新目录只提交选择的调用前缀；旧目录继续补全默认值。调用前须先 argsValid。 */
export function resolveArgs(cmd: CommandSignature, args: readonly string[]): string[] {
  if (cmd.hasUnifiedSignature === false) {
    const variant = exactVariant(cmd, args);
    // 无效已存参数不应被截断或按错误类型重解释；调用者会阻止提交。
    return variant ? resolveArgs(variant, args) : [...args];
  }
  return Array.from({ length: invocationLength(cmd, args) }, (_, i) => resolveArg(cmd, i, args[i]));
}

/** 第 i 项按实际调用检查；完整草稿可用于显示“前面留空、后面已填”的错误。 */
export function argError(cmd: CommandSignature, i: number, value: string | undefined, args?: readonly string[]): ArgError | null {
  if (cmd.hasUnifiedSignature === false) {
    const variant = args ? exactVariant(cmd, args) : undefined;
    return variant ? argError(variant, i, value, args) : 'missing';
  }
  if (cmd.hasUnifiedSignature !== undefined && isOptionalParam(cmd, i) && !supplied(value)
      && (args === undefined || i >= invocationLength(cmd, args))) return null;
  return validateArg(cmd.paramTypes[i], resolveArg(cmd, i, value), defaultOf(cmd, i) !== null);
}

export function argsValid(cmd: CommandSignature, args: readonly string[]): boolean {
  if (cmd.hasUnifiedSignature === false) {
    const variant = exactVariant(cmd, args);
    return variant !== undefined && argsValid(variant, args);
  }
  if (cmd.hasUnifiedSignature !== undefined && args.length > cmd.paramNames.length) return false;
  const values = resolveArgs(cmd, args);
  if (cmd.hasUnifiedSignature !== undefined && !cmd.acceptedArgCounts?.includes(values.length)) return false;
  return values.every((value, i) => validateArg(cmd.paramTypes[i], value, defaultOf(cmd, i) !== null) === null);
}
