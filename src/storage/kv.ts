/** 带内存回退的 localStorage 封装（隐私模式/配额异常时不崩溃）。 */
export interface KV {
  get(key: string): string | null;
  set(key: string, value: string): boolean;
  remove(key: string): void;
  keys(): string[];
}

export class MemoryKV implements KV {
  private m = new Map<string, string>();
  get(key: string) { return this.m.get(key) ?? null; }
  set(key: string, value: string) { this.m.set(key, value); return true; }
  remove(key: string) { this.m.delete(key); }
  keys() { return [...this.m.keys()]; }
}

export class LocalStorageKV implements KV {
  constructor(private readonly ls: Storage) {}
  get(key: string) { try { return this.ls.getItem(key); } catch { return null; } }
  set(key: string, value: string) {
    try { this.ls.setItem(key, value); return true; } catch { return false; }
  }
  remove(key: string) { try { this.ls.removeItem(key); } catch { /* ignore */ } }
  keys() {
    try { return Array.from({ length: this.ls.length }, (_, i) => this.ls.key(i)).filter((k): k is string => k !== null); }
    catch { return []; }
  }
}

export function defaultKV(): KV {
  try {
    if (typeof localStorage !== 'undefined') return new LocalStorageKV(localStorage);
  } catch { /* fallthrough */ }
  return new MemoryKV();
}

export const kv: KV = defaultKV();