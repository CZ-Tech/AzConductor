/** 视觉检查截图：npm run build 后 `npx tsx e2e/visual.ts`，输出 e2e/vis/*.png（已 gitignore）。 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium, type Page } from 'playwright-core';
import { MockRobotServer, seedSampleRobot } from '../src/tools/mock-robot';

const exe = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
mkdirSync('e2e/vis', { recursive: true });
const robot = new MockRobotServer({ host: '127.0.0.1', poseHz: 30, runDurationMs: 9000 });
seedSampleRobot(robot);
await robot.start(0);
const pv = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', '4175', '--strictPort'], { stdio: 'ignore' });
for (let i = 0; i < 50; i++) { try { if ((await fetch('http://localhost:4175/')).ok) break; } catch { /* retry */ } await new Promise((r) => setTimeout(r, 200)); }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ headless: true, executablePath: exe });

async function shot(page: Page, name: string) { await page.screenshot({ path: `e2e/vis/${name}.png` }); console.log('shot', name); }

for (const [tag, vp, dark] of [['d', { width: 1280, height: 800 }, false], ['m', { width: 390, height: 800 }, false], ['dark', { width: 1280, height: 800 }, true]] as const) {
  const ctx = await browser.newContext({ viewport: vp, serviceWorkers: 'block', colorScheme: dark ? 'dark' : 'light', hasTouch: tag === 'm', isMobile: tag === 'm' });
  await ctx.addInitScript((a) => localStorage.setItem('az.settings', JSON.stringify({ robotAddress: a, fieldMap: '27', lastRunRoute: '' })), robot.url);
  const page = await ctx.newPage();
  await page.goto('http://localhost:4175/#/');
  await page.waitForSelector('.route-card');
  await sleep(800);
  await shot(page, `${tag}-routes`);

  // 连接对话框
  await page.locator('.conn').click();
  await sleep(200);
  await shot(page, `${tag}-conn-dialog`);
  await page.getByRole('button', { name: '关闭' }).click();

  // 卡片菜单
  await page.locator('.route-card').first().getByRole('button', { name: '更多操作' }).click();
  await sleep(200);
  await shot(page, `${tag}-card-menu`);
  await page.keyboard.press('Escape');

  if (tag !== 'm') {
    // 新建对话框
    await page.getByRole('button', { name: /新建路径/ }).click();
    await sleep(200);
    await shot(page, `${tag}-new-dialog`);
    await page.getByRole('button', { name: '取消' }).click();
    // 导出 / 导入
    await page.locator('.route-card').first().getByRole('button', { name: '更多操作' }).click();
    await page.locator('.route-card').first().getByRole('menuitem', { name: '导出', exact: true }).click();
    await sleep(200);
    await shot(page, `${tag}-export-dialog`);
    await page.getByRole('button', { name: '关闭' }).click();
    await page.getByRole('button', { name: '导入', exact: true }).click();
    await page.locator('dialog textarea').fill('[bad');
    await page.locator('dialog button.primary').click();
    await sleep(200);
    await shot(page, `${tag}-import-error`);
    await page.getByRole('button', { name: '取消' }).click();
  }

  // 编辑器（Blue Far：含 marker/command）
  await page.locator('.route-card', { hasText: 'Blue Far' }).locator('a.card-main').click();
  await page.waitForSelector('.field-svg');
  await sleep(400);
  await page.locator('.node-list li').nth(1).locator('.node-sum').click();   // 选中点 2 → 速度/朝向手柄
  await sleep(200);
  await shot(page, `${tag}-editor-selected`);
  await page.locator('.ed-bar').getByRole('button', { name: '更多操作' }).click();
  await sleep(200);
  await shot(page, `${tag}-editor-menu`);
  await page.keyboard.press('Escape');
  await page.locator('.node-list li').nth(1).getByRole('button', { name: '编辑控制点' }).click();
  await sleep(300);
  await shot(page, `${tag}-node-dialog`);
  await page.getByRole('button', { name: /高级/ }).click();
  await sleep(200);
  await shot(page, `${tag}-node-dialog-adv`);
  await page.getByRole('button', { name: '取消' }).click();
  // 回放到一半
  await page.locator('.scrub').fill('2');
  await sleep(200);
  await shot(page, `${tag}-editor-scrub`);

  // 运行页：用 Auto Blue Far（绑定 Blue Far，含指令任务）
  await page.goto('http://localhost:4175/#/run');
  await page.waitForFunction(() => document.querySelectorAll('#run-op option').length > 1);
  await shot(page, `${tag}-run-idle`);
  await page.locator('#run-op').selectOption('Auto Blue Far');
  await page.getByRole('button', { name: 'INIT', exact: true }).click();
  await sleep(600);
  await page.getByRole('button', { name: 'START', exact: true }).click();
  await sleep(5000);
  await shot(page, `${tag}-run-running`);
  await page.getByRole('button', { name: 'STOP', exact: true }).click();
  await sleep(500);
  await ctx.close();
}

// 冲突对话框（桌面）
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  await ctx.addInitScript((a) => localStorage.setItem('az.settings', JSON.stringify({ robotAddress: a, fieldMap: '27', lastRunRoute: '' })), robot.url);
  const page = await ctx.newPage();
  await page.goto('http://localhost:4175/#/');
  await page.waitForSelector('.route-card');
  await sleep(800);
  await page.locator('.conn').click();
  await page.getByRole('button', { name: '断开' }).click();
  await page.getByRole('button', { name: '关闭' }).click();
  await page.locator('.route-card', { hasText: 'Red Near' }).locator('a.card-main').click();
  await page.waitForSelector('.field-svg');
  const b = (await page.locator('.ed-field .field-svg').boundingBox())!;
  await page.mouse.click(b.x + b.width * 0.2, b.y + b.height * 0.2);
  await page.getByRole('button', { name: /返回/ }).click();
  robot.mutateRemoteRoute('Red Near', '[{"x":0,"y":0,"dx":10,"dy":0,"duration":0},{"x":9,"y":9,"dx":10,"dy":0,"duration":1}]');
  await page.locator('.conn').click();
  await page.getByRole('button', { name: '重新连接' }).click();
  await page.getByRole('button', { name: '关闭' }).click();
  await page.getByRole('button', { name: '处理冲突' }).waitFor();
  await shot(page, 'd-routes-conflict-banner');
  await page.getByRole('button', { name: '处理冲突' }).click();
  await sleep(300);
  await shot(page, 'd-conflict-dialog');
  await ctx.close();
}

// 未连接：空状态、同步提示、运行页（桌面 + 手机）
for (const [tag, vp] of [['d', { width: 1280, height: 800 }], ['m', { width: 390, height: 800 }]] as const) {
  const ctx = await browser.newContext({ viewport: vp, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  await page.goto('http://localhost:4175/#/');
  await page.waitForSelector('.empty');
  await shot(page, `${tag}-empty`);
  await page.goto('http://localhost:4175/#/run');
  await page.waitForSelector('.run-status');
  await sleep(300); // 等导航高亮的 .15s 过渡结束
  await shot(page, `${tag}-run-offline`);
  await ctx.close();
}

// 其他尺寸下的编辑器：平板竖屏、手机横屏
for (const [tag, vp] of [['tablet', { width: 768, height: 1024 }], ['landscape', { width: 800, height: 390 }]] as const) {
  const ctx = await browser.newContext({ viewport: vp, serviceWorkers: 'block' });
  await ctx.addInitScript((a) => localStorage.setItem('az.settings', JSON.stringify({ robotAddress: a, fieldMap: '27', lastRunRoute: '' })), robot.url);
  const page = await ctx.newPage();
  await page.goto('http://localhost:4175/#/');
  await page.waitForSelector('.route-card');
  await sleep(800);
  await page.locator('.route-card', { hasText: 'Blue Far' }).locator('a.card-main').click();
  await page.waitForSelector('.field-svg');
  await page.locator('.node-list li').nth(1).locator('.node-sum').click();
  await sleep(300);
  await shot(page, `${tag}-editor`);
  await page.goto('http://localhost:4175/#/run');
  await page.waitForSelector('.run-status');
  await sleep(500);
  await shot(page, `${tag}-run`);
  await ctx.close();
}

await browser.close();
pv.kill();
await robot.stop();
process.exit(0);
