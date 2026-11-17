/** JSON 导入边界：旧单命令只在这里转换，内部始终只有 commands。 */
import type { NodeCommand } from './node';

export class WireError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WireError';
  }
}

export const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
export const hasOwn = (o: Record<string, unknown>, k: string): boolean =>
  Object.prototype.hasOwnProperty.call(o, k);

/** v1 只接受裸帧数组；封装必须是数字 version:2 和 frames 数组。 */
export function unwrapRobotFrames(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!isObject(value)) throw new WireError('机器人路径必须是 JSON 数组或 version 2 路径对象');
  if (!hasOwn(value, 'version') || typeof value['version'] !== 'number' || value['version'] !== 2) {
    throw new WireError('机器人路径 version 必须为数字 2');
  }
  if (!Array.isArray(value['frames'])) throw new WireError('机器人路径 frames 必须是数组');
  return value['frames'];
}

function strings(value: unknown, where: string): string[] {
  if (!Array.isArray(value) || value.some((p: unknown) => typeof p !== 'string')) {
    throw new WireError(`${where} 必须为字符串数组`);
  }
  return [...value] as string[];
}

/** 同时出现非空旧/新命令是歧义，拒绝而不是猜测或合并。 */
export function decodeCommands(obj: Record<string, unknown>, frameNo: number): NodeCommand[] {
  const where = `第 ${frameNo} 帧`;
  let commands: NodeCommand[] = [];
  if (hasOwn(obj, 'commands')) {
    const raw = obj['commands'];
    if (!Array.isArray(raw)) throw new WireError(`${where} commands 必须为数组`);
    commands = raw.map((item: unknown, i: number) => {
      if (!isObject(item)) throw new WireError(`${where} commands[${i}] 必须为对象`);
      const name = item['name'];
      if (typeof name !== 'string' || name.trim() === '') {
        throw new WireError(`${where} commands[${i}].name 必须为非空字符串`);
      }
      const params = hasOwn(item, 'params') ? strings(item['params'], `${where} commands[${i}].params`) : [];
      return { name, params };
    });
  }
  const legacy = hasOwn(obj, 'command') ? obj['command'] : '';
  if (typeof legacy !== 'string') throw new WireError(`${where} command 必须为字符串`);
  const params = hasOwn(obj, 'commandParams') ? strings(obj['commandParams'], `${where} commandParams`) : [];
  if (legacy !== '') {
    if (legacy.trim() === '') throw new WireError(`${where} command 必须为非空字符串`);
    if (commands.length > 0) throw new WireError(`${where} 不能同时包含非空 command 和 commands`);
    return [{ name: legacy, params }];
  }
  return commands;
}
