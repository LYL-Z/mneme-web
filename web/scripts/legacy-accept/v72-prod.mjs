/** v7.2 生产验收：绝密锁 · 签名墙 · 他者之声口径 · 意象全量 · 主题域充实 */
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
  ok('v7.2 bundle 上线', bundle.includes('index-CugDXx'), bundle.slice(-32));

  await page.waitForTimeout(2200);
  const sigN = await page.$$eval('.sig', els => els.filter(e => +e.style.opacity > 0).length);
  ok('签名墙 9 幅', sigN === 9, `${sigN}/9`);
  await page.screenshot({ path: path.join(OUT, 'prod72-home.png') });

  await page.evaluate(() => { location.hash = '#/space/graph'; });
  await page.waitForTimeout(1800);
  await page.fill('.gp-search-q', '赵问竹');
  await page.waitForTimeout(450);
  await page.click('.gp-search-hits button');
  await page.waitForTimeout(1400);
  const gate = await page.$('.sg');
  const sheet = await page.$('.gp-sheet');
  ok('生产站赵问竹弹绝密门', !!gate && !sheet);
  await page.screenshot({ path: path.join(OUT, 'prod72-gate.png') });

  await page.evaluate(() => { location.hash = '#/space/museum'; });
  await page.waitForTimeout(1600);
  const mu = await page.$$eval('.mu-case', els => els.length);
  ok('生产站意象 53 件', mu === 53, `${mu} 件`);

  await page.evaluate(() => { location.hash = '#/space/voices'; });
  await page.waitForTimeout(1000);
  const vo = await page.$eval('.vo-sub', e => e.textContent);
  ok('生产站他者之声三轮口径', vo.includes('V1–V3') && !vo.includes('亲历者'));

  await page.evaluate(() => { location.hash = '#/space/themes'; });
  await page.waitForTimeout(1300);
  const desc = await page.$$eval('.th-card-desc', els => els.filter(e => e.textContent.trim().length > 5).length);
  ok('生产站主题域导览就位', desc >= 6, `${desc} 张`);
  await page.screenshot({ path: path.join(OUT, 'prod72-themes.png') });

  await browser.close();
  console.log(R.join('\n'));
};
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
