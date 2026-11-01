/** 机器人侧的目录数据：指令目录、OpMode 列表。连接成功及 commands 事件时刷新。 */
import { signal } from '@preact/signals';
import type { CommandCatalog, CommandDescriptor, OpModeDescriptor } from '../net/models';
import { getConnection, onConnectionEvent } from './session';

export const commandCatalog = signal<CommandCatalog | null>(null);
export const opModes = signal<OpModeDescriptor[]>([]);

export function commandByName(name: string): CommandDescriptor | undefined {
  return commandCatalog.value?.commands.find((c) => c.name === name);
}

async function refreshCommands() {
  const c = getConnection();
  if (!c) return;
  const r = await c.api.commandCatalog();
  if (r.ok && getConnection() === c) commandCatalog.value = r.value;
}

async function refreshOpModes() {
  const c = getConnection();
  if (!c) return;
  const r = await c.api.listOpModes();
  if (r.ok && getConnection() === c) opModes.value = r.value.opModes;
}

export async function refreshRobotData(): Promise<void> {
  await Promise.all([refreshCommands(), refreshOpModes()]);
}

let started = false;
export function startRobotData(): void {
  if (started) return;
  started = true;
  onConnectionEvent((e) => {
    if (e.type === 'state') {
      if (e.state.kind === 'connected') void refreshRobotData();
      else if (e.state.kind === 'idle') { commandCatalog.value = null; opModes.value = []; }
    } else if (e.type === 'commands') {
      void refreshCommands();
    }
  });
}
