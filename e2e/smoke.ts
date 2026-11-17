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

/** 打开路径卡片的「更多操作」菜单并选择一项。 */
async function cardAction(page: Page, routeName: string, item: string) {
  const c = page.locator('.route-card', { hasText: routeName }).first();
  await c.getByRole('button', { name: '更多操作' }).click();
  await c.getByRole('menuitem', { name: item, exact: true }).click();
}

async function main() {
  const robot = new MockRobotServer({ host: '127.0.0.1', poseHz: 30, runDurationMs: 30_000 }); // 回合都以 STOP 结束；指令 OpMode 需要足够长的 RUNNING 窗口
  seedSampleRobot(robot);
  robot.setCommands([...robot.commands, {
    name: 'optional.flag', paramNames: ['on'], paramTypes: ['boolean'], paramDefaults: [null],
    signatures: [
      { paramNames: [], paramTypes: [], paramDefaults: [] },
      { paramNames: ['on'], paramTypes: ['boolean'], paramDefaults: [null] },
    ],
    acceptedArgCounts: [0, 1], hasUnifiedSignature: true, requiredParamCount: 0, paramRequired: [false],
  }]);
  await robot.start(0);
  log(`mock robot ${robot.url} routes=${robot.routeNames.join(',')} opmodes=${robot.opModes.map((o) => o.name).join(',')}`);

  const preview: ChildProcess = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
  try {
    await waitUrl(`http://localhost:${PORT}/`);
    const exe = findBrowser();
    const browser = await chromium.launch({ headless: true, ...(exe ? { executablePath: exe } : { channel: 'chrome' }) });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text()); });
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

    // 侧栏快速编辑：回车提交，一次提交对应一步撤销；坐标限制在场地内
    const row1 = page.locator('.node-list li').nth(1);
    if (await row1.locator('.node-detail').count() === 0) await row1.locator('.node-sum').click();
    const beforeQuick = await row1.locator('.node-sum span').innerText();
    const quickX = row1.locator('.nq input').first();
    await quickX.fill('500');
    await quickX.press('Enter');
    check((await row1.locator('.node-sum span').innerText()).startsWith('72.00,'), '快速编辑提交并限制在场地内');
    await quickX.evaluate((el) => (el as HTMLInputElement).blur());
    await page.keyboard.press('Control+z');
    check(await row1.locator('.node-sum span').innerText() === beforeQuick, '快速编辑可一步撤销');

    // 编辑器菜单：切换场地地图不会关闭菜单，Esc 关闭
    await page.getByRole('button', { name: '更多操作' }).click();
    await page.getByRole('menuitemradio', { name: '2026 赛季' }).click();
    check((await page.locator('.ed-field image').getAttribute('href'))?.includes('MAP26'), '菜单切换场地地图');
    await page.getByRole('menuitemradio', { name: '2027 赛季' }).click();
    await page.keyboard.press('Escape');
    check(await page.getByRole('menuitem', { name: '导出 JSON' }).count() === 0, 'Esc 关闭菜单');

    // 空格：焦点在按钮上时激活按钮，而不是触发播放
    const timeBefore = await page.locator('.timeline .time').innerText();
    await page.getByRole('button', { name: '更多操作' }).focus();
    await page.keyboard.press('Space');
    check(await page.getByRole('menuitem', { name: '导出 JSON' }).isVisible(), '空格可激活聚焦的按钮');
    await page.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 200));
    check(await page.locator('.timeline .time').innerText() === timeBefore, '空格激活按钮时不触发回放');

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

    // 可选字段必须能从已有值清空：先保存非空值，再清空、保存并重新打开。
    const node2 = page.locator('[data-kind=node][data-i="2"]');
    const optionalValues = { maxSpeed: '30', endSpeed: '5', brakeZoneIn: '12', brakeForwardPower: '0.5' };
    const openNode2 = async () => {
      await node2.click({ button: 'right' });
      await page.locator('dialog').waitFor();
      const toggle = page.locator('dialog .nf-toggle');
      if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
    };
    await openNode2();
    for (const [key, value] of Object.entries(optionalValues)) await page.locator(`#nf-${key}`).fill(value);
    await page.locator('dialog button[type=submit]').click();
    await page.locator('dialog').waitFor({ state: 'detached' });
    await openNode2();
    for (const [key, value] of Object.entries(optionalValues)) {
      check(await page.locator(`#nf-${key}`).inputValue() === value, `${key} 非空值保存后重新打开仍保留`);
    }
    await page.locator('#nf-brakeZoneIn').fill('');
    await page.locator('dialog button[type=submit]').click();
    await page.locator('dialog').waitFor({ state: 'detached' });
    await openNode2();
    check(await page.locator('#nf-endSpeed').inputValue() === '5', '保留目标速度');
    check(await page.locator('#nf-brakeZoneIn').inputValue() === '', '设置目标速度时制动区仍可留空');
    for (const key of Object.keys(optionalValues)) await page.locator(`#nf-${key}`).fill('');
    await page.locator('dialog button[type=submit]').click();
    await page.locator('dialog').waitFor({ state: 'detached' });
    await openNode2();
    for (const key of Object.keys(optionalValues)) {
      check(await page.locator(`#nf-${key}`).inputValue() === '', `${key} 清空保存后重新打开仍为空`);
    }
    check(await page.locator('#nf-delayAfterArrive').inputValue() === '1.5', '清空可选字段不影响其他节点数据');
    await page.locator('#nf-endSpeed').fill('0');
    check(await page.locator('#nf-maxSpeed').inputValue() === '', '模型预估无需填写速度上限');
    check(/^预估 [\d.]+ in$/.test(await page.locator('#nf-brakeZoneIn').getAttribute('placeholder') ?? ''), '未设置速度上限时显示模型预估');
    check(await until(async () => (await page.locator('dialog').innerText()).includes('机器人当前值'), 'live braking parameter', 3000), '连接后读取机器人当前减速度');
    const incomingText = await page.locator('dialog').innerText();
    check(/起点速度 (?!0\.00)\d+\.\d+ in\/s（前序路段推算）/.test(incomingText), '未设上一点目标速度时沿前序路径推算起点速度');
    check(await page.locator('#nf-brakeZoneIn').inputValue() === '', '模型预估不写入手动制动区');
    await page.getByRole('button', { name: '取消' }).click();
    await page.locator('dialog').waitFor({ state: 'detached' });

    // 新目录：节点上的 0/1 重载可直接保存无参调用，不能补一个空字符串。
    await node2.click({ button: 'right' });
    await page.locator('dialog').waitFor();
    await page.locator('#nf-command').fill('intaker.intakerIn');
    check((await page.locator('dialog').innerText()).includes('可选'), '节点编辑器识别重载可选参数');
    await page.locator('dialog button[type=submit]').click();
    await page.locator('dialog').waitFor({ state: 'detached' });
    await node2.click({ button: 'right' });
    await page.locator('dialog').waitFor();
    check(await page.locator('#nf-command').inputValue() === 'intaker.intakerIn', '无参重载保存后重新打开仍保留命令');
    await page.getByRole('button', { name: '取消' }).click();
    await page.locator('dialog').waitFor({ state: 'detached' });

    // 回放
    await page.getByRole('button', { name: '播放' }).click();
    await until(async () => !(await page.locator('.timeline .time').innerText()).startsWith('0.00'), 'playback advances', 3000);
    check(!(await page.locator('.timeline .time').innerText()).startsWith('0.00 /'), '回放推进时间');
    check(await page.locator('.node-list li.current').count() === 1, '回放时列表高亮当前路径点');
    check(await page.locator('.node-list li.current .node-badge').innerText() === '1', '回放开始时高亮第 1 个点');
    check(
      await until(async () => (await page.locator('.node-list li.current .node-badge').innerText()) === '2', 'highlight follows arrival', 3000),
      '回放到达第 2 个点时高亮跟随',
    );
    await page.getByRole('button', { name: '暂停' }).click().catch(() => undefined);

    // 回到路径页，等待同步推送到机器
    await page.getByRole('button', { name: /返回/ }).click();
    check(await until(() => robot.routeNames.includes('E2E 路径'), 'route pushed', 8000), '本地新路径自动上传到机器');
    check(await until(async () => (await page.locator('.sync-panel').innerText()).includes('已同步'), 'synced label'), '同步面板显示已同步');

    const nodeRouteResponse = await fetch(`${robot.url}/api/v2/routes/${encodeURIComponent('E2E 路径')}`, { headers: { 'X-Az-Session': robot.sessionToken! } });
    const savedNodeRoute = await nodeRouteResponse.json() as { command?: string; commandParams?: string[] }[];
    const noArgNode = savedNodeRoute.find((node) => node.command === 'intaker.intakerIn');
    check(noArgNode !== undefined && (noArgNode.commandParams?.length ?? 0) === 0, '节点无参重载上传后仍是空参数数组');
    check(await page.locator('dialog').count() === 0, '合法无参重载离开编辑器不会误报缺参');

    // 机器侧修改 → SSE routes 事件 → 本地拉取
    robot.mutateRemoteRoute(remote0, '[{"x":0,"y":0,"dx":10,"dy":0,"heading":0,"duration":0},{"x":20,"y":20,"dx":10,"dy":0,"duration":2}]');
    await until(async () => (await page.locator('.route-card', { hasText: remote0 }).innerText()).includes('2 个点'), 'remote edit pulled', 8000);
    check((await page.locator('.route-card', { hasText: remote0 }).innerText()).includes('2 个点'), '机器侧修改经 SSE 事件拉取到本地');

    // 本地删除 → 机器同步删除（墓碑）
    page.once('dialog', () => undefined);
    await cardAction(page, 'E2E 路径', '删除');
    await page.locator('dialog button.primary').click();
    check(await until(() => !robot.routeNames.includes('E2E 路径'), 'remote delete', 8000), '本地删除同步删除机器上的路径');
    await new Promise((r) => setTimeout(r, 1500));
    check(await page.locator('.route-card', { hasText: 'E2E 路径' }).count() === 0, '已删除路径不会复活');

    // 镜像
    const card = (n: string) => page.locator('.route-card', { hasText: n }).first();
    await cardAction(page, 'Red Near', '镜像到红方');
    await page.locator('dialog button.primary').click();            // 确认
    await page.locator('dialog input[type=text]').fill('Mirror A');
    await page.locator('dialog button[type=submit]').click();
    check(await until(() => robot.routeNames.includes('Mirror A'), 'mirror pushed', 8000), '镜像路径创建并同步到机器');

    // 重命名 → 机器侧等价于删旧建新
    await cardAction(page, 'Mirror A', '重命名');
    await page.locator('dialog input[type=text]').fill('Mirror B');
    await page.locator('dialog button[type=submit]').click();
    check(await until(() => robot.routeNames.includes('Mirror B') && !robot.routeNames.includes('Mirror A'), 'rename synced', 8000), '重命名同步到机器（旧名消失、新名出现）');

    // 导出 → 导入
    await cardAction(page, 'Mirror B', '导出');
    const exported = await page.locator('dialog textarea').inputValue();
    let parsedOk = false;
    try { parsedOk = Array.isArray(JSON.parse(exported)) && JSON.parse(exported).length >= 2; } catch { /* */ }
    check(parsedOk, '导出 JSON 可解析且包含控制点数组');
    await page.locator('dialog button.primary').click();
    await page.getByRole('button', { name: '导入', exact: true }).click();
    await page.locator('dialog textarea').fill(exported);
    await page.locator('dialog button.primary').click();
    check(await until(async () => (await page.locator('.route-card', { hasText: '导入路径' }).count()) === 1, 'imported card'), '粘贴导入生成新路径');
    check(await until(() => robot.routeNames.includes('导入路径'), 'import pushed', 8000), '导入的路径同步到机器');

    // 冲突：断开 → 本地改 + 机器改 → 重连
    await page.locator('.conn').click();
    await page.getByRole('button', { name: '断开' }).click();
    await page.getByRole('button', { name: '关闭' }).click();
    check(await until(async () => (await page.locator('.conn').innerText()).includes('未连接'), 'disc'), '手动断开连接');
    await page.locator('.route-card', { hasText: 'Mirror B' }).locator('a.card-main').click();
    await page.waitForURL(/#\/edit\//);
    const bb = await fieldBox(page);
    await page.mouse.click(bb.x + bb.width * 0.45, bb.y + bb.height * 0.2);
    await page.getByRole('button', { name: /返回/ }).click();
    robot.mutateRemoteRoute('Mirror B', '[{"x":0,"y":0,"dx":10,"dy":0,"duration":0},{"x":5,"y":5,"dx":10,"dy":0,"duration":1}]');
    await page.locator('.conn').click();
    await page.getByRole('button', { name: '重新连接' }).click();
    await page.getByRole('button', { name: '关闭' }).click();
    check(await until(async () => (await page.locator('.sync-panel').innerText()).includes('冲突'), 'conflict shown', 10000), '本地与机器都修改后出现冲突提示');
    await page.getByRole('button', { name: '处理冲突' }).click();
    await page.getByRole('button', { name: /以机器为准/ }).click();
    check(await until(async () => (await page.locator('.sync-panel').innerText()).includes('已同步'), 'resolved'), '选择以机器为准后冲突解决');
    check((await card('Mirror B').innerText()).includes('2 个点'), '本地已采用机器版本（2 个点）');

    // 机器重启 → 自动重连
    const port = robot.port;
    await robot.stop();
    check(await until(async () => !(await page.locator('.conn').innerText()).includes('已连接'), 'lost', 8000), '机器关闭后连接状态变为断开/失败');
    await robot.start(port);
    check(await until(async () => (await page.locator('.conn').innerText()).includes('已连接'), 'reconnect', 20000), '机器恢复后自动重连');
    // 运行页
    await page.goto(`http://localhost:${PORT}/#/run`);
    check(await until(async () => (await page.locator('.topbar nav a[aria-current=page]').innerText()) === '运行', 'nav current'), '运行页导航高亮「运行」');
    check(await until(async () => (await page.locator('#run-op option').count()) > 1, 'opmodes loaded'), '运行页列出 OpMode');
    // 指令试运行只在支持远程指令的 OpMode（固件的 RemoteCommand Test，TeleOp）RUNNING 时可用
    const cmdOp = 'RemoteCommand Test';
    check((await page.locator('#run-op option', { hasText: cmdOp }).count()) === 1, '下拉框列出 TeleOp（RemoteCommand Test）');
    await page.locator('#run-op').selectOption(cmdOp);
    // @AutoConfig fields are discovered from the robot at runtime, not hard-coded in the UI.
    await page.locator('.tuning-toggle').click();
    check(await until(async () => (await page.locator('.tuning-field').count()) >= 5, 'tuning fields'), '自动驾驶参数面板动态加载固件字段');
    const brakeField = page.locator('.tuning-field', { hasText: 'Auto.SAFE_BRAKE_DECEL' });
    const brakeInput = brakeField.locator('input');
    check((await brakeInput.inputValue()) === '30', '面板显示 Java 源码默认减速度');
    await brakeInput.fill('35.5');
    await page.getByRole('button', { name: '应用修改' }).click();
    const tuningValues = async () => {
      const r = await fetch(`${robot.url}/api/v2/tuning`, { headers: { 'X-Az-Session': robot.sessionToken! } });
      return (await r.json()) as { fields: { name: string; value: number }[] };
    };
    check(await until(async () => (await tuningValues()).fields.find((f) => f.name === 'Auto.SAFE_BRAKE_DECEL')?.value === 35.5,
      'runtime tuning applied'), '浏览器 PATCH 直接修改机器人运行时值');
    check((await brakeField.innerText()).includes('源码：30'), '热更新不改变源码默认值');
    await page.getByRole('button', { name: '恢复源码默认值' }).click();
    check(await until(async () => (await tuningValues()).fields.find((f) => f.name === 'Auto.SAFE_BRAKE_DECEL')?.value === 30,
      'runtime tuning reset'), '面板恢复默认值后机器人参数复原');
    await page.locator('.tuning-toggle').click();
    const panel = page.locator('#cmd-panel');
    const runBtn = (n: string) => page.getByRole('button', { name: `运行 ${n}`, exact: true });
    const field = (n: string, i: number) => page.locator(`[id="cmd-${n}-${i}"]`);
    check(await panel.isVisible() && (await panel.locator('.cmd-item').count()) === robot.commands.length, '宽屏默认展开指令栏并列出全部指令');
    check(await runBtn('intakeOn').isDisabled() && (await panel.innerText()).includes('START'), '无活动 OpMode 时指令不可运行并提示 INIT/START');

    // 默认值自动填充：目录里的 paramDefaults 直接出现在输入框里
    check((await field('shoot', 1).inputValue()) === '0.8' && (await field('shoot', 0).inputValue()) === '', 'shoot 的 power 预填默认值 0.8，必填项 count 为空');
    check((await field('shooter.spin', 1).inputValue()) === '0.8' && (await field('shooter.spin', 2).inputValue()) === 'true' && (await field('shooter.spin', 3).inputValue()) === '', 'shooter.spin 的 double/boolean/String 默认值都已填好');

    await page.getByRole('button', { name: 'INIT', exact: true }).click();
    check(await until(async () => await page.getByRole('button', { name: 'START' }).isEnabled(), 'start enabled'), `INIT 后 START 可用（${cmdOp}）`);
    check(await runBtn('intakeOn').isDisabled() && (await panel.innerText()).includes('START'), 'INIT 阶段指令仍不可运行（固件只在 RUNNING 接受）');
    await page.getByRole('button', { name: 'START', exact: true }).click();
    check(await until(() => runBtn('intakeOn').isEnabled(), 'cmd enabled'), 'START 后无参数指令可运行');

    // 带参数的指令：本地校验后才能运行
    check(await runBtn('shoot').isDisabled(), '必填参数未填时不可运行');
    await field('shoot', 0).fill('1.5');
    check(await runBtn('shoot').isDisabled() && (await page.locator('[id="cmd-shoot-0-error"]').innerText()).includes('整数'), 'int 参数填小数时提示并禁止运行');
    await field('shoot', 0).fill('3000000000');
    check(await runBtn('shoot').isDisabled() && (await page.locator('[id="cmd-shoot-0-error"]').innerText()).includes('范围'), 'int 参数超范围时提示并禁止运行');
    await field('shoot', 0).fill('  3 ');
    await field('shoot', 1).fill('');
    check(await runBtn('shoot').isEnabled(), '带默认值的参数清空后仍可运行');
    await runBtn('shoot').dblclick();
    check(await until(async () => (await panel.locator('.cmd-log li').first().innerText()).includes('已受理'), 'cmd accepted'), '运行结果显示已受理');
    await new Promise((r) => setTimeout(r, 300));
    const runs = () => robot.commandRuns.map((c) => `${c.name}(${c.args.join(',')})`);
    check(runs().join(' ') === 'shoot(3,0.8)', `双击只执行一次；留空的默认值补全、首尾空格去掉，参数不缺 (${runs().join(' ')})`);

    await field('shooter.spin', 0).fill('900');
    await runBtn('shooter.spin').click();
    check(await until(() => robot.commandRuns.length === 2, 'spin run'), '点号命名的指令可运行');
    check(runs()[1] === 'shooter.spin(900,0.8,true,)', `全部默认值随指令下发 (${runs()[1]})`);

    // 新目录：可选尾参为空时必须是真正的无参调用，不能补未知默认值。
    const intakeItem = panel.locator('.cmd-item').filter({ hasText: 'intaker.intakerIn' });
    check(await field('intaker.intakerIn', 0).inputValue() === '' && (await intakeItem.innerText()).includes('可选'), '重载可选参数初始为空并标记可选');
    await runBtn('intaker.intakerIn').click();
    const intakeRuns = () => robot.commandRuns.filter((c) => c.name === 'intaker.intakerIn');
    check(await until(() => intakeRuns().length === 1, 'zero-arg overload'), '可选参数留空时可运行无参重载');
    check(intakeRuns()[0]?.args.length === 0, '无参重载 POST 的 args 是空数组');
    await field('intaker.intakerIn', 0).fill(' 0.4 ');
    await runBtn('intaker.intakerIn').click();
    check(await until(() => intakeRuns().length === 2, 'one-arg overload'), '填写可选参数后运行单参重载');
    check(intakeRuns()[1]?.args.join(',') === '0.4', '单参重载只发送已填参数且去掉数字首尾空格');
    await panel.locator('.cmd-filter').fill('shoot');
    check(!await intakeItem.isVisible(), '筛选隐藏不匹配指令');
    await panel.locator('.cmd-filter').fill('');
    check(await field('intaker.intakerIn', 0).inputValue() === ' 0.4 ', '恢复筛选后保留指令草稿');

    // 可选 boolean 的空值与明确 false 必须是不同调用。
    const flagRuns = () => robot.commandRuns.filter((c) => c.name === 'optional.flag');
    check(await field('optional.flag', 0).inputValue() === '', '可选 boolean 初始选择省略而非 false');
    await runBtn('optional.flag').click();
    check(await until(() => flagRuns().length === 1, 'omitted boolean'), '可选 boolean 留空可运行无参重载');
    check(flagRuns()[0]?.args.length === 0, '省略 boolean 发送空数组');
    await field('optional.flag', 0).selectOption('false');
    await runBtn('optional.flag').click();
    check(await until(() => flagRuns().length === 2, 'explicit false'), '明确 false 可运行有参重载');
    check(flagRuns()[1]?.args.join(',') === 'false', 'false 没有被误判成省略');

    // 参数数量有断档且类型不同：显式选择签名，不按最长签名解释短调用。
    const differentSignature = page.locator('[id="cmd-overload.different-signature"]');
    check(await differentSignature.isVisible(), '不可合并重载显示调用签名选择');
    await field('overload.different', 0).selectOption('true');
    await runBtn('overload.different').click();
    const differentRuns = () => robot.commandRuns.filter((c) => c.name === 'overload.different');
    check(await until(() => differentRuns().length === 1, 'short boolean signature'), '短重载按自己的 boolean 参数运行');
    check(differentRuns()[0]?.args.join(',') === 'true', '短重载未被转换成长签名的 int 参数');
    await differentSignature.selectOption('1');
    check(await field('overload.different', 0).inputValue() === '' && await runBtn('overload.different').isDisabled(), '切换长签名重置草稿并等待必填 count');
    await field('overload.different', 0).fill('3');
    await field('overload.different', 1).fill('0.5');
    await field('overload.different', 2).fill('manual');
    await runBtn('overload.different').click();
    check(await until(() => differentRuns().length === 2, 'long signature'), '长重载按三个参数运行');
    check(differentRuns()[1]?.args.join(',') === '3,0.5,manual', '长重载传入完整精确签名');
    await differentSignature.selectOption('0');
    check(await field('overload.different', 0).inputValue() === 'false', '切回短签名不重用长签名数值');

    // 旧固件：没有这个端点（路由层 404 not_found）；不能显示成“已受理”或笼统失败
    const cors = { 'Access-Control-Allow-Origin': '*' };
    await page.route('**/api/v2/commands/run', (r) => r.fulfill({ status: 404, headers: cors, contentType: 'application/json', body: '{"error":"not_found"}' }));
    await runBtn('intakeOn').click();
    check(await until(async () => (await panel.locator('.cmd-log li').first().innerText()).includes('固件尚不支持'), 'unsupported'), '固件无端点时提示尚不支持');
    await page.unroute('**/api/v2/commands/run');
    // 响应丢失：指令可能已执行，必须提示先确认，不能当作失败引导重试
    await page.route('**/api/v2/commands/run', (r) => r.abort('connectionreset'));
    await runBtn('intakeOn').click();
    check(await until(async () => (await panel.locator('.cmd-log li').first().innerText()).includes('可能已执行'), 'unknown'), '响应丢失时提示结果未知');
    await page.unroute('**/api/v2/commands/run');

    // 结束指令 OpMode，换路径类 OpMode：它在 RUNNING 时不接受手动指令
    await page.getByRole('button', { name: 'STOP', exact: true }).click();
    check(await until(async () => (await page.locator('.run-status').innerText()).includes('已停止'), 'cmd op stopped'), '结束 RemoteCommand Test');
    check(await until(() => runBtn('intakeOn').isDisabled(), 'cmd off after stop'), 'OpMode 结束后指令不可运行');
    const opName = robot.opModes[0]!.name;
    await page.locator('#run-op').selectOption(opName);
    await page.getByRole('button', { name: 'INIT', exact: true }).click();
    check(await until(async () => await page.getByRole('button', { name: 'START' }).isEnabled(), 'route start enabled'), `INIT 后 START 可用（${opName}）`);
    await page.getByRole('button', { name: 'START', exact: true }).click();
    check(await until(async () => (await page.locator('.run-status').innerText()).includes('运行中'), 'running'), 'START 后显示运行中');
    check(await until(() => runBtn('intakeOn').isDisabled(), 'cmd blocked') && (await panel.innerText()).includes('路径执行中'), '路径执行中禁用手动指令');
    const telemetry = page.locator('.telemetry');
    const p1 = await telemetry.innerText();
    await new Promise((r) => setTimeout(r, 800));
    const p2 = await telemetry.innerText();
    check(p1 !== p2 && /\d+\.\d+/.test(p2), `实时位姿更新 (${p1.replace(/\s+/g, ' ')} → ${p2.replace(/\s+/g, ' ')})`);
    check(await until(async () => (await page.locator('.run-map polyline').count()) === 1, 'trail', 3000), '运行时绘制实际轨迹');
    check(await until(async () => (await page.locator('.run-side').innerText()).includes('参考路径：'), 'subject'), '执行时显示参考路径（execution.subject）');
    await page.screenshot({ path: 'e2e/run.png' });
    await page.getByRole('button', { name: 'STOP', exact: true }).click();
    check(await until(async () => (await page.locator('.run-status').innerText()).includes('已停止'), 'stopped'), 'STOP 后回到已停止');

    // STOP 是安全操作：内容滚到底时仍须可见且不被遮挡
    for (const [width, height] of [[800, 390], [1280, 500], [390, 800]] as const) {
      await page.setViewportSize({ width, height });
      const r = await page.evaluate(() => {
        let overflowed = false;
        for (const s of ['.run-side', '.run-main']) {
          const el = document.querySelector(s) as HTMLElement;
          if (el.scrollHeight > el.clientHeight) overflowed = true;
          el.scrollTop = el.scrollHeight;
        }
        const b = document.querySelector('button.stop') as HTMLElement;
        const box = b.getBoundingClientRect();
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return { overflowed, visible: box.top >= 0 && box.bottom <= innerHeight && !!hit && b.contains(hit) };
      });
      const drawer = await panel.isVisible();
      check(r.overflowed && r.visible && drawer, `${width}×${height} 指令栏打开且滚到底后 STOP 仍可见可点 (overflowed=${r.overflowed} visible=${r.visible} panel=${drawer})`);
    }

    // 手机：抽屉可收起和重新打开
    await page.getByRole('button', { name: '收起指令栏' }).click();
    check(!(await panel.isVisible()), '可收起指令栏');
    await page.locator('.run-main').evaluate((el) => { el.scrollTop = 0; });
    await page.locator('.cmd-toggle').click();
    check(await panel.isVisible() && (await page.locator('[id="cmd-shoot-0"]').inputValue()).trim() === '3', '重新打开指令栏且保留已填参数');
    await page.setViewportSize({ width: 1280, height: 800 });

    // 真机现状：目录为空
    robot.setCommands([]);
    check(await until(async () => (await panel.innerText()).includes('没有提供可用指令'), 'empty catalog'), '目录为空时显示空状态');

    // 断线重连：停掉 mock 再启动
    await page.screenshot({ path: 'e2e/final.png' });
    check(errors.length === 0, `页面无控制台错误 ${errors.slice(0, 3).join(' | ')}`);
    // PWA：启用 Service Worker，预缓存后离线重载
    const ctx2 = await browser.newContext({ viewport: { width: 1000, height: 700 } });
    const off = await ctx2.newPage();
    const offErrors: string[] = [];
    let offlinePhase = false;
    off.on('pageerror', (e) => { if (offlinePhase) offErrors.push(`pageerror: ${e}`); });
    off.on('console', (m) => {
      // 浏览器自己对失败网络请求打的 "Failed to load resource" 不算应用报错
      if (offlinePhase && (m.type() === 'error' || m.type() === 'warning') && !m.text().startsWith('Failed to load resource')) offErrors.push(`console.${m.type()}: ${m.text()}`);
    });
    await ctx2.addInitScript((addr) => {
      if (!localStorage.getItem('az.settings')) localStorage.setItem('az.settings', JSON.stringify({ robotAddress: addr, fieldMap: '27', lastRunRoute: '' }));
    }, robot.url);
    await off.goto(`http://localhost:${PORT}/#/`);
    check(await until(async () => off.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.active), 'sw active', 15000), 'Service Worker 已激活');
    await off.reload();
    await new Promise((r) => setTimeout(r, 1500));
    await ctx2.setOffline(true);
    offlinePhase = true;
    await off.reload();
    check(await off.locator('.brand').innerText() === 'AzConductor', '离线重载仍可打开应用（PWA 预缓存）');
    // 带查询串、非根路径的导航也要能回退到应用壳
    await off.goto(`http://localhost:${PORT}/?source=pwa#/`);
    check(await off.locator('.brand').innerText() === 'AzConductor', '离线下带查询串的地址仍可打开应用');
    // 离线下进入编辑器与运行页，场地图必须来自缓存
    await off.getByRole('button', { name: /新建路径/ }).first().click();
    await off.locator('dialog input[type=text]').fill('离线路径');
    await off.locator('dialog button[type=submit]').click();
    await off.waitForURL(/#\/edit\//);
    check(await until(() => off.evaluate(() => { const i = document.querySelector('.ed-field image'); return !!i; }), 'field image'), '离线编辑器渲染场地');
    const imgOk = await off.evaluate(async () => {
      const href = document.querySelector('.ed-field image')?.getAttribute('href') ?? '';
      try { return (await fetch(href)).ok; } catch { return false; }
    });
    check(imgOk, '离线下场地图可从缓存读取');
    await off.goto(`http://localhost:${PORT}/#/run`);
    await new Promise((r) => setTimeout(r, 2500)); // 让连接重试与同步引擎跑几轮
    check(await off.locator('.conn').count() > 0, '离线运行页正常渲染');
    check(offErrors.length === 0, `离线全程无应用报错 ${offErrors.slice(0, 3).join(' | ')}`);
    offlinePhase = false;
    await ctx2.setOffline(false);
    await browser.close();
  } finally {
    preview.kill();
    await robot.stop();
  }
  log(failures === 0 ? 'ALL PASSED' : `${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
