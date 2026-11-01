/**
 * 端到端冒烟：真实 Chromium（本机 Edge/Chrome）+ vite preview 产物 + 本地 mock 机器人。
 * 运行：npm run build && npm run e2e
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { chromium, type Page } from 'playwright-core';
import { existsSync } from 'node:fs';
import { MockRobotServer, seedSampleRobot } from '../src/tools/mock-robot';

const PORT = 4173;
const log = (m: string) => process.stdout.write(`[e2e] ${m}\n`);
let failures = 0;
function check(cond: unknown, msg: string) {
  if (cond) log(`PASS ${msg}`); else { failures++; log(`FAIL ${msg}`); }
}

function findBrowser(): string | undefined {
  const c = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  return c.find(existsSync);
}

async function waitUrl(url: string, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if ((await fetch(url)).ok) return; } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`timeout waiting for ${url}`);
}

async function until(fn: () => Promise<boolean> | boolean, what: string, ms = 10000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  log(`  (timeout) ${what}`);
  return false;
}

async function fieldBox(page: Page) {
  const b = await page.locator('.ed-field .field-svg').boundingBox();
  if (!b) throw new Error('no field svg');
  return b;
}

async function main() {
  const robot = new MockRobotServer({ host: '127.0.0.1', poseHz: 30, runDurationMs: 4000 });
  seedSampleRobot(robot);
  await robot.start(0);
  log(`mock robot ${robot.url} routes=${robot.routeNames.join(',')} opmodes=${robot.opModes.map((o) => o.name).join(',')}`);

  const preview: ChildProcess = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', shell: true });
  try {
    await waitUrl(`http://localhost:${PORT}/`);
    const exe = findBrowser();
    const browser = await chromium.launch({ headless: true, ...(exe ? { executablePath: exe } : { channel: 'chrome' }) });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await ctx.addInitScript((addr) => {
      if (!localStorage.getItem('az.settings')) localStorage.setItem('az.settings', JSON.stringify({ robotAddress: addr, fieldMap: '27', lastRunRoute: '' }));
    }, robot.url);

    await page.goto(`http://localhost:${PORT}/#/`);
    check(await until(async () => (await page.locator('.conn').innerText()).includes('已连接'), 'connected chip'), '连接 mock 机器人后顶栏显示已连接');

    // 机器人上的示例路径应自动拉取到本地
    const remote0 = robot.routeNames[0]!;
    check(await until(async () => (await page.locator('.route-card').count()) >= robot.routeNames.length, 'pulled routes'), `机器上的 ${robot.routeNames.length} 条路径自动同步到本地`);
    check(await page.locator('.route-card', { hasText: remote0 }).count() === 1, `本地出现路径 ${remote0}`);

    // 新建路径并编辑
    await page.getByRole('button', { name: /新建路径/ }).click();
    await page.locator('dialog input[type=text]').fill('E2E 路径');
    await page.locator('dialog button[type=submit]').click();
    await page.waitForURL(/#\/edit\//);
    check(await page.locator('.ed-title').innerText() === 'E2E 路径', '进入编辑器');

    const box = await fieldBox(page);
    const at = (fx: number, fy: number) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy });
    // 点击空白添加 3 个点（首点是新建时自带的）
    for (const [fx, fy] of [[0.3, 0.3], [0.6, 0.5], [0.8, 0.8]] as const) {
      const p = at(fx, fy);
      await page.mouse.click(p.x, p.y);
    }
    check(await page.locator('.node-list li').count() === 4, '点击场地添加控制点（共 4 个）');

    // 拖动第 2 个节点
    const before = await page.locator('.node-list li').nth(1).locator('.node-sum span').innerText();
    const dot = page.locator('[data-kind=node][data-i="1"]');
    const db = (await dot.boundingBox())!;
    await page.mouse.move(db.x + db.width / 2, db.y + db.height / 2);
    await page.mouse.down();
    await page.mouse.move(db.x + db.width / 2 + 40, db.y + db.height / 2 + 30, { steps: 6 });
    await page.mouse.up();
    const after = await page.locator('.node-list li').nth(1).locator('.node-sum span').innerText();
    check(before !== after, `拖动节点改变坐标 (${before} → ${after})`);
    await page.keyboard.press('Control+z');
    const undone = await page.locator('.node-list li').nth(1).locator('.node-sum span').innerText();
    check(undone === before, '撤销恢复拖动前坐标');
    await page.keyboard.press('Control+y');

    // 右键编辑：设置到点等待并保存
    await page.locator('[data-kind=node][data-i="2"]').click({ button: 'right' });
    await page.locator('dialog').waitFor();
    await page.locator('#nf-delayAfterArrive').fill('1.5');
    await page.locator('dialog button[type=submit]').click();
    await page.locator('dialog').waitFor({ state: 'detached', timeout: 3000 }).catch(async () => {
      log(`  dialog errors: ${(await page.locator('dialog .field-error').allInnerTexts()).join(' | ')}; page errors: ${errors.join(' | ')}`);
      await page.screenshot({ path: 'e2e/fail.png' });
      throw new Error('node editor did not close');
    });
    const total = await page.locator('.side-head .muted').innerText();
    check(/总时长/.test(total), `编辑节点后总时长刷新：${total}`);

    // 回放
    await page.getByRole('button', { name: '播放' }).click();
    await until(async () => !(await page.locator('.timeline .time').innerText()).startsWith('0.00'), 'playback advances', 3000);
    check(!(await page.locator('.timeline .time').innerText()).startsWith('0.00 /'), '回放推进时间');
    await page.getByRole('button', { name: '暂停' }).click().catch(() => undefined);

    // 回到路径页，等待同步推送到机器
    await page.getByRole('button', { name: /返回/ }).click();
    check(await until(() => robot.routeNames.includes('E2E 路径'), 'route pushed', 8000), '本地新路径自动上传到机器');
    check(await until(async () => (await page.locator('.sync-panel').innerText()).includes('已同步'), 'synced label'), '同步面板显示已同步');

    // 机器侧修改 → SSE routes 事件 → 本地拉取
    robot.mutateRemoteRoute(remote0, '[{"x":0,"y":0,"dx":10,"dy":0,"heading":0,"duration":0},{"x":20,"y":20,"dx":10,"dy":0,"duration":2}]');
    await until(async () => (await page.locator('.route-card', { hasText: remote0 }).innerText()).includes('2 个点'), 'remote edit pulled', 8000);
    check((await page.locator('.route-card', { hasText: remote0 }).innerText()).includes('2 个点'), '机器侧修改经 SSE 事件拉取到本地');

    // 本地删除 → 机器同步删除（墓碑）
    page.once('dialog', () => undefined);
    await page.locator('.route-card', { hasText: 'E2E 路径' }).getByRole('button', { name: '删除' }).click();
    await page.locator('dialog button.primary').click();
    check(await until(() => !robot.routeNames.includes('E2E 路径'), 'remote delete', 8000), '本地删除同步删除机器上的路径');
    await new Promise((r) => setTimeout(r, 1500));
    check(await page.locator('.route-card', { hasText: 'E2E 路径' }).count() === 0, '已删除路径不会复活');

    // 运行页
    await page.goto(`http://localhost:${PORT}/#/run`);
    check(await until(async () => (await page.locator('#run-op option').count()) > 1, 'opmodes loaded'), '运行页列出 Autonomous');
    const opName = robot.opModes[0]!.name;
    await page.locator('#run-op').selectOption(opName);
    await page.getByRole('button', { name: 'INIT', exact: true }).click();
    check(await until(async () => await page.getByRole('button', { name: 'START' }).isEnabled(), 'start enabled'), `INIT 后 START 可用（${opName}）`);
    await page.getByRole('button', { name: 'START', exact: true }).click();
    check(await until(async () => (await page.locator('.run-side .chips').innerText()).includes('运行中'), 'running'), 'START 后显示运行中');
    const p1 = await page.locator('.run-side .mono').first().innerText();
    await new Promise((r) => setTimeout(r, 800));
    const p2 = await page.locator('.run-side .mono').first().innerText();
    check(p1 !== p2 && p2.includes('x='), `实时位姿更新 (${p1.trim()} → ${p2.trim()})`);
    check(await until(async () => (await page.locator('.run-side').innerText()).includes('参考路径：'), 'subject'), '执行时显示参考路径（execution.subject）');
    await page.screenshot({ path: 'e2e/run.png' });
    await page.getByRole('button', { name: 'STOP', exact: true }).click();
    check(await until(async () => (await page.locator('.run-side .chips').innerText()).includes('已停止'), 'stopped'), 'STOP 后回到已停止');

    // 断线重连：停掉 mock 再启动
    await page.screenshot({ path: 'e2e/final.png' });
    check(errors.length === 0, `页面无控制台错误 ${errors.slice(0, 3).join(' | ')}`);
    // PWA：启用 Service Worker，预缓存后离线重载
    const ctx2 = await browser.newContext({ viewport: { width: 1000, height: 700 } });
    const off = await ctx2.newPage();
    await off.goto(`http://localhost:${PORT}/#/`);
    check(await until(async () => off.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.active), 'sw active', 15000), 'Service Worker 已激活');
    await off.reload();
    await new Promise((r) => setTimeout(r, 1500));
    await ctx2.setOffline(true);
    await off.reload();
    check(await off.locator('.brand').innerText() === 'AzConductor', '离线重载仍可打开应用（PWA 预缓存）');
    await ctx2.setOffline(false);
    await browser.close();
  } finally {
    preview.kill();
    if (process.platform === 'win32' && preview.pid) spawn('taskkill', ['/pid', String(preview.pid), '/T', '/F'], { stdio: 'ignore' });
    await robot.stop();
  }
  log(failures === 0 ? 'ALL PASSED' : `${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
