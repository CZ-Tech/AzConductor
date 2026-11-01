import { signal, effect } from '@preact/signals';
import { kv } from '../storage/kv';

export const SETTINGS_KEY = 'az.settings';
export type FieldMap = '26' | '27';

export interface Settings {
  robotAddress: string;
  fieldMap: FieldMap;
  /** 运行页手动选择的路径名（subject 为空时的回退） */
  lastRunRoute: string;
}

const DEFAULTS: Settings = { robotAddress: '192.168.43.1', fieldMap: '27', lastRunRoute: '' };

function load(): Settings {
  const out = { ...DEFAULTS };
  try {
    const raw = kv.get(SETTINGS_KEY);
    if (raw) {
      const o = JSON.parse(raw) as Partial<Settings>;
      if (typeof o.robotAddress === 'string' && o.robotAddress.trim()) out.robotAddress = o.robotAddress.trim();
      if (o.fieldMap === '26' || o.fieldMap === '27') out.fieldMap = o.fieldMap;
      if (typeof o.lastRunRoute === 'string') out.lastRunRoute = o.lastRunRoute;
    }
    // 兼容旧版 ConfigManager(key=route) 中的 robot_ip
    else {
      const legacy = kv.get('route');
      if (legacy) {
        const o = JSON.parse(legacy) as Record<string, unknown>;
        if (typeof o['robot_ip'] === 'string' && o['robot_ip']) out.robotAddress = o['robot_ip'];
      }
    }
  } catch { /* 使用默认值 */ }
  return out;
}

export const settings = signal<Settings>(load());

export function updateSettings(patch: Partial<Settings>) {
  settings.value = { ...settings.value, ...patch };
}

export function startSettingsPersistence(): () => void {
  const stop = effect(() => { kv.set(SETTINGS_KEY, JSON.stringify(settings.value)); });
  const onStorage = (e: StorageEvent) => {
    if (e.key === SETTINGS_KEY && e.newValue) {
      try { settings.value = { ...DEFAULTS, ...(JSON.parse(e.newValue) as Partial<Settings>) }; } catch { /* ignore */ }
    }
  };
  addEventListener('storage', onStorage);
  return () => { stop(); removeEventListener('storage', onStorage); };
}