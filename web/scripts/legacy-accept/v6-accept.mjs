/** v6 验收：签名墙 / 星图帧时间实测 / 门禁 / 回归（纯 JS） */
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const OUT = 'C:/Users/Lenovo/.workbuddy/tmp';
const { chromium } = require('playwright-core');
const EXE = 'C:/Users/Lenovo/.agent-browser/browsers/chrome-152.0.7977.82/chrome.exe';
const R = [];
const ok = (n, c, x = '') => R.push((c ? '✅' : '❌') + ' ' + n + (x ? ' · ' + x : ''));

const main = async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto('http://127.0.0.1:8421/', { waitUntil: 'load' });
  await page.fill('#t', 'mneme');
  await page.click('#f button');
  await page.waitForSelector('.st-title', { timeout: 15000 });
  await page.waitForTimeout(2200);

  const sigs = await page.$$eval('.sig', els => els.map(e => ({
    src: e.src.slice(0, 22), shown: e.offsetWidth > 0 && +e.style.opacity > 0,
  })));
  const pngCount = sigs.filter(s => s.src.startsWith('data:image/png')).length;
  ok('签名墙 7 幅提取显现', pngCount === 7, 'png ' + pngCount + '/7');
  await page.screenshot({ path: path.join(OUT, 'v6-signwall.png') });

  await page.evaluate(() => { location.hash = '#/space/graph'; });
  await page.waitForTimeout(1500);

  const idleProbe = await page.evaluate(() => new Promise(res => {
    const gaps = []; let last = performance.now(); let n = 0;
    const probe = t => { gaps.push(t - last); last = t; if (++n < 90) requestAnimationFrame(probe); else res(gaps); };
    requestAnimationFrame(probe);
  }));
  const idleMax = Math.max.apply(null, idleProbe);
  ok('静止态帧间隔正常', idleMax < 100, 'max ' + idleMax.toFixed(1) + 'ms');

  const gapsP = page.evaluate(() => new Promise(res => {
    const gaps = []; let last = performance.now();
    const cb = t => { gaps.push(t - last); last = t; requestAnimationFrame(cb); };
    requestAnimationFrame(cb);
    setTimeout(() => res(gaps), 3400);
  }));
  const cv = await page.$('.gp canvas');
  const bb = await cv.boundingBox();
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await page.mouse.down();
  for (let i = 0; i <= 24; i++) {
    await page.mouse.move(bb.x + bb.width / 2 - i * 40, bb.y + bb.height / 2, { steps: 1 });
    await page.waitForTimeout(45);
  }
  await page.mouse.up();
  const dragGaps = await gapsP;
  const mid = dragGaps.slice(Math.floor(dragGaps.length * 0.35), Math.floor(dragGaps.length * 0.75));
  const dragAvg = mid.reduce((a, b) => a + b, 0) / Math.max(1, mid.length);
  const jankN = mid.filter(g => g > 34).length;
  ok('拖拽帧时间达标（中段 avg<20ms，卡帧<8%）', dragAvg < 20 && jankN / Math.max(1, mid.length) < 0.08,
    'avg ' + dragAvg.toFixed(1) + 'ms · jank ' + jankN + '/' + mid.length);
  await page.screenshot({ path: path.join(OUT, 'v6-graph.png') });

  const t0 = Date.now();
  await page.evaluate(() => { location.hash = '#/space/river'; });
  await page.waitForSelector('.rv-title', { timeout: 8000 });
  ok('星图→时间之河切换顺畅', Date.now() - t0 < 1500, (Date.now() - t0) + 'ms');

  await page.evaluate(() => { location.hash = '#/space/study'; });
  await page.waitForSelector('.study-door', { timeout: 8000 });
  const doors = await page.$$('.study-door');
  await doors[2].click();
  const sg = await page.waitForSelector('.sg', { timeout: 6000 }).catch(() => null);
  ok('回归:绝密门仍生效', !!sg);
  if (sg) { await page.fill('.sg-input', 'L0826'); await page.click('.sg-btn'); await page.waitForTimeout(900); }
  ok('解锁后卷二可开', !!(await page.$('.study-detail')));

  console.log(R.join('\n'));
  console.log(errors.length ? '❌ ' + errors.length + ' 控制台错误:\n' + errors.slice(0, 6).join('\n') : '✅ 零 pageerror / console.error');
  await browser.close();
};
main().catch(e => { console.error('FAIL', e); process.exit(1); });
