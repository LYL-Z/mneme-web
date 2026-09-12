/**
 * ΜΝΗΜΗ · v3.1 视觉验收（单进程直驱 playwright-core）
 * 覆盖：Σ1 数字丰碑 / Σ2 时间之河（含脱敏+河流动效帧）/ Σ3 环带星图 /
 *       Σ4 书房内容化 / Σ5 域内容化 / Σ6 博物馆内容化
 */
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const OUT = 'C:/Users/Lenovo/.workbuddy/tmp';
const { chromium } = require('playwright-core');
const EXE = 'C:/Users/Lenovo/.agent-browser/browsers/chrome-152.0.7977.82/chrome.exe';

const shot = (page, name) => page.screenshot({ path: path.join(OUT, name) });

const main = async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 960 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto('http://127.0.0.1:8421/', { waitUntil: 'load' });
  await page.fill('#t', 'mneme');
  await page.click('#f button');
  await page.waitForSelector('.st-title', { timeout: 15000 });
  await page.waitForTimeout(1500);

  // Σ1 数字丰碑（滚到展板）
  await page.evaluate(() => document.querySelector('.space-host').scrollTo({ top: 620 }));
  await page.waitForTimeout(500);
  await shot(page, 'v31-stars-monument.png');

  // Σ2 时间之河
  await page.click('text=五卷书房'); // 先离场避免 entrance 动画半途
  await page.waitForTimeout(300);
  await page.click('.nav-space:nth-child(2)');
  await page.waitForSelector('.rv-title', { timeout: 15000 });
  await page.waitForTimeout(1500);
  await shot(page, 'v31-river-early.png');
  // 航行到 2020s：直接设置滚动位置
  await page.evaluate(() => { const el = document.querySelector('.rv-flow'); el.scrollLeft = el.scrollWidth - el.clientWidth - 300; });
  await page.waitForTimeout(700);
  await shot(page, 'v31-river-late.png');

  // Σ3 环带星图
  await page.click('.nav-space:nth-child(3)');
  await page.waitForTimeout(2600); // 等 collide 松弛收敛
  await shot(page, 'v31-graph.png');

  // Σ4 书房：开 V3 卷
  await page.click('.nav-space:nth-child(4)');
  await page.waitForSelector('.study-door', { timeout: 10000 });
  await page.click('.study-door:nth-child(4)');
  await page.waitForTimeout(900);
  await page.evaluate(() => document.querySelector('.space-host').scrollTo({ top: 340 }));
  await page.waitForTimeout(400);
  await shot(page, 'v31-study.png');

  // Σ5 主题域：开 人物谱系
  await page.click('.nav-space:nth-child(5)');
  await page.waitForSelector('.th-card', { timeout: 10000 });
  await page.click('text=人物谱系');
  await page.waitForTimeout(900);
  await page.evaluate(() => document.querySelector('.space-host').scrollTo({ top: 200 }));
  await page.waitForTimeout(300);
  await shot(page, 'v31-themes.png');

  // Σ6 博物馆：开 烟花
  await page.click('.nav-space:nth-child(6)');
  await page.waitForSelector('.mu-case', { timeout: 10000 });
  await page.click('text=烟花');
  await page.waitForTimeout(900);
  await page.evaluate(() => document.querySelector('.space-host').scrollTo({ top: 300 }));
  await page.waitForTimeout(300);
  await shot(page, 'v31-museum.png');

  console.log(errors.length ? `❌ ${errors.length} 个错误:\n${errors.join('\n')}` : '✅ 零 pageerror / console.error');
  await browser.close();
};

main().catch(e => { console.error('FAIL', e); process.exit(1); });
