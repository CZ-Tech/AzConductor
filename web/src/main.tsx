import { render } from 'preact';
import { App } from './ui/app';
import { startSettingsPersistence } from './state/settings';
import { registerSW } from 'virtual:pwa-register';
import { pwaStatus } from './ui/pwa';
import { docStore } from './state/docStore';
import { startSession } from './state/session';
import { startRobotData } from './state/robotData';
import { startSync } from './state/sync';
import './ui/styles.css';

startSettingsPersistence();
docStore().attachBrowser();
startRobotData();
startSync();
startSession();

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() { pwaStatus.value = 'needRefresh'; },
  onOfflineReady() { pwaStatus.value = 'offlineReady'; },
});
pwaStatus.subscribe(() => { /* keep signal alive */ });
(globalThis as { __azUpdateSW?: typeof updateSW }).__azUpdateSW = updateSW;

navigator.storage?.persist?.().catch(() => { /* ignore */ });

render(<App />, document.getElementById('app')!);