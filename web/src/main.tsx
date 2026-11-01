import { render } from 'preact';
import { App } from './ui/app';
import { startSettingsPersistence } from './state/settings';
import { registerSW } from 'virtual:pwa-register';
import { pwaStatus } from './ui/pwa';
import './ui/styles.css';

startSettingsPersistence();

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() { pwaStatus.value = 'needRefresh'; },
  onOfflineReady() { pwaStatus.value = 'offlineReady'; },
});
pwaStatus.subscribe(() => { /* keep signal alive */ });
(globalThis as { __azUpdateSW?: typeof updateSW }).__azUpdateSW = updateSW;

navigator.storage?.persist?.().catch(() => { /* ignore */ });

render(<App />, document.getElementById('app')!);