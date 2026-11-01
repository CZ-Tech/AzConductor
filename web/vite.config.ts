import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  plugins: [
    preact(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      manifest: {
        name: 'AzConductor 路径规划',
        short_name: 'AzConductor',
        description: 'FTC 机器人路径规划器',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#f4f1ea',
        theme_color: '#f4f1ea',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,webp,png,ico,woff2,webmanifest}'],
        navigateFallback: null,
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  build: { target: 'es2022', sourcemap: false },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 15000,
  },
});
