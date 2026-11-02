/** 线上部署验证：`npx tsx e2e/live.ts [url]`。真实浏览器打开已部署页面，连本机 mock 机器人。 */
import { chromium } from 'playwright-core';
import { MockRobotServer, seedSampleRobot } from '../src/tools/mock-robot';

const url = process.argv[2] ?? 'https://cz-tech.github.io/AzConductor/';
const exe = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const robot = new MockRobotServer({ host: '127.0.0.1', poseHz: 30 });
seedSampleRobot(robot);
await robot.start(0);
const browser = await chromium.launch({ headless: true, executablePath: exe });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.addInitScript((a) => localStorage.setItem('az.settings', JSON.stringify({ robotAddress: a, fieldMap: '27', lastRunRoute: '' })), robot.url);
const page = await ctx.newPage();
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(url);
let ok = true;
const check = (c: boolean, m: string) => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) ok = false; };
await page.waitForSelector('.brand');
check((await page.title()) === 'AzConductor', `页面标题 (${url})`);
try { await page.waitForFunction(() => document.querySelector('.conn')?.textContent?.includes('已连接'), null, { timeout: 15000 }); check(true, 'HTTPS 线上页面连上本机 http mock 机器人'); }
catch { check(false, `连接失败：${await page.locator('.conn').innerText()}`); }
try { await page.waitForFunction((n) => document.querySelectorAll('.route-card').length >= n, robot.routeNames.length, { timeout: 15000 }); check(true, `自动同步 ${robot.routeNames.length} 条路径`); }
catch { check(false, '路径未同步'); }
const sw = await page.evaluate(async () => { for (let i = 0; i < 50; i++) { const r = await navigator.serviceWorker.getRegistration(); if (r?.active) return true; await new Promise((x) => setTimeout(x, 300)); } return false; });
check(sw, '线上 Service Worker 已激活');
check(errors.length === 0, `无页面错误 ${errors.join('|')}`);
await browser.close();
await robot.stop();
process.exit(ok ? 0 : 1);
