/** 截图辅助：npx tsx e2e/shots.ts（需先 npm run build）。输出 e2e/shot-*.png（已 gitignore）。 */
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { MockRobotServer, seedSampleRobot } from '../src/tools/mock-robot';

const exe = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const robot = new MockRobotServer({ host: '127.0.0.1', poseHz: 30 });
seedSampleRobot(robot);
await robot.start(0);
const pv = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', '4174', '--strictPort'], { stdio: 'ignore' });
for (let i = 0; i < 50; i++) { try { if ((await fetch('http://localhost:4174/')).ok) break; } catch { /* retry */ } await new Promise((r) => setTimeout(r, 200)); }
const browser = await chromium.launch({ headless: true, executablePath: exe });
for (const [name, vp] of [['desktop', { width: 1280, height: 800 }], ['mobile', { width: 390, height: 800 }]] as const) {
  const ctx = await browser.newContext({ viewport: vp, serviceWorkers: 'block', hasTouch: name === 'mobile', isMobile: name === 'mobile' });
  await ctx.addInitScript((a) => localStorage.setItem('az.settings', JSON.stringify({ robotAddress: a, fieldMap: '27', lastRunRoute: '' })), robot.url);
  const page = await ctx.newPage();
  await page.goto('http://localhost:4174/#/');
  await page.waitForSelector('.route-card');
  await new Promise((r) => setTimeout(r, 800));
  await page.screenshot({ path: `e2e/shot-${name}-routes.png` });
  await page.locator('.route-card a.card-main').first().click();
  await page.waitForSelector('.field-svg');
  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({ path: `e2e/shot-${name}-editor.png` });
  await ctx.close();
}
await browser.close();
pv.kill();
await robot.stop();
process.exit(0);
