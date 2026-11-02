/**
 * 指令参数的文本校验与补全。参数在线上一律是字符串（与路径节点的 commandParams 相同），由机器人按
 * 方法签名严格转换（固件 CommandArgs.convert）；这里提前拦下转换必失败的输入，并保证下发时
 * 参数一个不缺：留空的参数用目录里的默认值补上（固件 paramDefaults）。
 */
export type ParamKind = 'integer' | 'number' | 'boolean' | 'char' | 'text';
export type ArgError = 'missing' | 'integer' | 'number' | 'char' | 'range';

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
    case 'char': return value.length === 1 ? null : 'char'; // 固件按 UTF-16 长度算
    default: return null;
  }
}

export interface CommandSignature {
  paramNames: readonly string[];
  paramTypes: readonly string[];
  /** 每个参数的默认值文本，null = 必填；旧固件没有这一项 */
  paramDefaults?: readonly (string | null)[];
}

const defaultOf = (cmd: CommandSignature, i: number): string | null => cmd.paramDefaults?.[i] ?? null;

/** 输入框的初始值：默认值优先；没有默认值时 boolean 为 false，其余为空。 */
function initialArg(cmd: CommandSignature, i: number): string {
  const def = defaultOf(cmd, i);
  const kind = paramKind(cmd.paramTypes[i]);
  if (def !== null) return kind === 'boolean' && /^(true|false)$/i.test(def.trim()) ? def.trim().toLowerCase() : def;
  return kind === 'boolean' ? 'false' : '';
}

/** 按当前签名整理草稿：多余的丢弃，缺的用默认值补上。 */
export function draftArgs(cmd: CommandSignature, previous: readonly string[] = []): string[] {
  return cmd.paramNames.map((_, i) => previous[i] ?? initialArg(cmd, i));
}

/** 实际下发的第 i 个参数：留空且有默认值就用默认值；数字/布尔去掉首尾空格，文本与字符原样。 */
export function resolveArg(cmd: CommandSignature, i: number, value: string | undefined): string {
  const v = value ?? '';
  const def = defaultOf(cmd, i);
  if (v.trim() === '' && def !== null) return def;
  const kind = paramKind(cmd.paramTypes[i]);
  return kind === 'text' || kind === 'char' ? v : v.trim();
}

/** 下发用的完整参数表：长度恒等于参数个数，不会缺项。 */
export function resolveArgs(cmd: CommandSignature, args: readonly string[]): string[] {
  return cmd.paramNames.map((_, i) => resolveArg(cmd, i, args[i]));
}

/** 第 i 个参数按下发值检查；合法返回 null。 */
export function argError(cmd: CommandSignature, i: number, value: string | undefined): ArgError | null {
  return validateArg(cmd.paramTypes[i], resolveArg(cmd, i, value), defaultOf(cmd, i) !== null);
}

export function argsValid(cmd: CommandSignature, args: readonly string[]): boolean {
  return cmd.paramNames.every((_, i) => argError(cmd, i, args[i]) === null);
}
