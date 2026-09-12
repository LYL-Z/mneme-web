/** v7.3 生产验收：他者之声 26/3/23 + 103+ 口径 · 问卷绝密门 · 星图全景精灵渲染 · 赵问竹门回归 */
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const OUT = 'C:/Users/Lenovo/.workbuddy/tmp';
const { chromium } = require('playwright-core');
const BASE = 'https://mneme-309301-9-1455680663.sh.run.tcloudbase.com';
const R = [];
const ok = (n, c, x = '') => R.push((c ? '✅' : '❌') + ' ' + n + (x ? ' · ' + x : ''));

const main = async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Users/Lenovo/.agent-browser/browsers/chrome-152.0.7977.82/chrome.exe', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForTimeout(2600);
  const riskBtn = await page.$('#submitBtn');
  if (riskBtn) {
    await page.waitForFunction(() => {
      const b = document.querySelector('#submitBtn');
      return b && !/(\d)s/.test(b.textContent || '');
    }, { timeout: 10000 }).catch(() => {});
    await riskBtn.click().catch(() => {});
    await page.waitForTimeout(1200);
  }
  await page.fill('#t', 'mneme');
  await page.click('#f button');
  await page.waitForSelector('.st-title', { timeout: 20000 });
  const bundle = await page.evaluate(() => [...document.scripts].map(s => s.src).find(s => s.includes('index-')) || '');
  ok('v7.3 bundle 上线', bundle.includes('index-BdzssGyf'), bundle.slice(-32));

  // 星图全景（精灵渲染）
  await page.evaluate(() => { location.hash = '#/space/graph'; });
  await page.waitForTimeout(2600);
  await page.screenshot({ path: path.join(OUT, 'prod73-graph.png') });
  // 赵问竹门回归
  await page.fill('.gp-search-q', '赵问竹');
  await page.waitForTimeout(450);
  await page.click('.gp-search-hits button');
  await page.waitForTimeout(1400);
  ok('赵问竹仍弹绝密门', !!(await page.$('.sg')) && !(await page.$('.gp-sheet')));
  await page.keyboard.press('Escape').catch(() => {});
  await page.evaluate(() => document.querySelector('.sg-mask')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
  await page.waitForTimeout(400);

  // 他者之声
  await page.evaluate(() => { location.hash = '#/space/voices'; });
  await page.waitForTimeout(1800);
  const vo = await page.evaluate(() => ({
    cards: document.querySelectorAll('.vo-card').length,
    locked: document.querySelectorAll('.vo-card.locked').length,
    rounds: document.querySelectorAll('.vo-round-title').length,
    sub: (document.querySelector('.vo-sub')?.textContent || ''),
  }));
  ok('生产站 26 份三轮分区', vo.cards === 26 && vo.rounds === 3, `${vo.cards} 张 · ${vo.rounds} 轮`);
  ok('生产站 103+ 与绝密口径', vo.sub.includes('103+') && vo.sub.includes('绝密'));
  ok('生产站 23 锁 3 开', vo.locked === 23, `locked ${vo.locked}`);
  await page.click('.vo-card.locked .vo-read');
  await page.waitForTimeout(500);
  ok('生产站问卷绝密门', !!(await page.$('.sg')));
  await page.screenshot({ path: path.join(OUT, 'prod73-voices.png') });

  await browser.close();
  console.log(R.join('\n'));
};
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
