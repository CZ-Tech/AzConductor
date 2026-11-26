import { afterEach, describe, expect, it, vi } from 'vitest';

function loadSettings(entries: Record<string, string> = {}) {
  vi.resetModules();
  vi.stubGlobal('localStorage', { getItem: (key: string) => entries[key] ?? null });
  return import('../../src/state/settings');
}

afterEach(() => vi.unstubAllGlobals());

describe('默认机器人地址', () => {
  it.each([{}, { 'az.settings': '{"fieldMap":"26"}' }])('未保存地址时使用 Control Hub 的 HTTPS 地址和端口（%j）', async (entries) => {
    const { settings } = await loadSettings(entries);
    expect(settings.value.robotAddress).toBe('https://ftc-control-hub.solitarymc.top:8889');
  });

  it('保留已保存的机器人地址', async () => {
    const { settings } = await loadSettings({ 'az.settings': '{"robotAddress":"192.168.43.2:8888"}' });
    expect(settings.value.robotAddress).toBe('192.168.43.2:8888');
  });
});
