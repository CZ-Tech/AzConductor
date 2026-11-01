import { signal } from '@preact/signals';
export const pwaStatus = signal<'idle' | 'needRefresh' | 'offlineReady'>('idle');