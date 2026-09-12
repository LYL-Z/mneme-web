/** v3.4 闭环精测：V1 辑一（有提纲+台账材料）→ 提纲→原文锚点 → 后退回面板 */
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const OUT = 'C:/Users/Lenovo/.workbuddy/tmp';
const { chromium } = require('playwright-core');
const EXE = 'C:/Users/Lenovo/.agent-browser/browsers/chrome-152.0.7977.82/chrome.exe';

const main = async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  const R = [];

  await page.goto('http://127.0.0.1:8421/', { waitUntil: 'load' });
  await page.fill('#t', 'mneme');
  await page.click('#f button');
  await page.waitForSelector('.st-title', { timeout: 15000 });

  // 深链直达章节面板
  await page.goto('http://127.0.0.1:8421/#/chapter/V1/1', { waitUntil: 'load' });
  await page.waitForSelector('.cp', { timeout: 10000 });
  await page.waitForTimeout(800);
  R.push(`${await page.$('.cp-title') ? '✅' : '❌'} 章节面板深链直达 (#/chapter/V1/1)`);
  const rows = await page.$$('.cp-row');
  R.push(`${rows.length > 0 ? '✅' : '❌'} 面板材料行渲染 · ${rows.length} 行`);
  const pendingN = await page.$$eval('.cp-badge.wait', els => els.map(e => e.textContent)).catch(() => []);
  R.push(`ℹ️ 待办徽标: ${pendingN.join(',') || '无'}`);

  // 点提纲（含锚点）→ 原文
  const outlineBtn = await page.$('.cp-row');
  await outlineBtn.click();
  await page.waitForSelector('.ar-body', { timeout: 10000 });
  await page.waitForTimeout(1300);
  const hash = await page.evaluate(() => location.hash);
  const flashed = await page.$('.anchor-flash');
  R.push(`${hash.includes('%3Fh%3D') || hash.includes('?h=') ? '✅' : '❌'} 提纲→原文（锚点深链）· ${decodeURIComponent(hash).slice(0, 80)}`);
  R.push(`${flashed ? '✅' : '⚠️'} 锚点闪烁定位${flashed ? '' : '（可能已滚动到位但类名已移除）'}`);
  await page.screenshot({ path: path.join(OUT, 'v34-anchor.png') });

  // 后退 → 回面板
  await page.goBack();
  await page.waitForTimeout(800);
  const backPanel = await page.$('.cp');
  R.push(`${backPanel ? '✅' : '❌'} 浏览器后退回章节面板 · ${await page.evaluate(() => location.hash)}`);

  // 星表入口
  await page.goto('http://127.0.0.1:8421/#/space/graph', { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  await page.click('.gp-roster-btn').catch(() => {});
  await page.waitForTimeout(400);
  const rosterItems = await page.$$('.gp-roster-item');
  R.push(`${rosterItems.length > 100 ? '✅' : '❌'} 星表（等价列表入口）· ${rosterItems.length} 位`);

  // 工作台有轨迹后：继续上次章节
  await page.goto('http://127.0.0.1:8421/#/space/stars', { waitUntil: 'load' });
  await page.waitForTimeout(800);
  const cont = await page.$('.wb-continue:not(.idle)');
  R.push(`${cont ? '✅' : '❌'} 工作台「继续上次章节」有轨迹可用`);

  console.log(R.join('\n'));
  console.log(errors.length ? `❌ 控制台错误 ${errors.length}:\n` + errors.slice(0, 5).join('\n') : '✅ 零 pageerror / console.error');
  await browser.close();
};
main().catch(e => { console.error('FAIL', e); process.exit(1); });
