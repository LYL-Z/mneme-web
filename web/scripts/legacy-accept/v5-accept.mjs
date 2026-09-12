/** v5 UI 验收：绝密门禁 UI 流程 / 时间之船巡航 / 签名 / 云海 / 总纲 / 回归 */
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const OUT = 'C:/Users/Lenovo/.workbuddy/tmp';
const { chromium } = require('playwright-core');
const EXE = 'C:/Users/Lenovo/.agent-browser/browsers/chrome-152.0.7977.82/chrome.exe';

const R = [];
const ok = (n, c, x = '') => R.push(`${c ? '✅' : '❌'} ${n}${x ? ' · ' + x : ''}`);

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
  await page.waitForTimeout(800);

  /* 1. Σ1 签名背景 */
  const sign = await page.$('.st-sign');
  ok('Σ1 签名手迹背景', !!sign);
  await page.screenshot({ path: path.join(OUT, 'v5-stars-sign.png') });

  /* 2. 时间之河：双击起航 */
  await page.evaluate(() => { location.hash = '#/space/river'; });
  await page.waitForSelector('.rv-title', { timeout: 10000 });
  await page.waitForTimeout(1200);
  const t0 = await page.evaluate(() => document.querySelector('.rv-strip').style.transform);
  const flow = await page.$('.rv-flow');
  const bb = await flow.boundingBox();
  await page.mouse.dblclick(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await page.waitForTimeout(600);
  const boatSail = await page.$('.rv-boat.sail');
  const t1 = await page.evaluate(() => document.querySelector('.rv-strip').style.transform);
  await page.waitForTimeout(900);
  const t2 = await page.evaluate(() => document.querySelector('.rv-strip').style.transform);
  ok('双击起航：时间之船扬帆', !!boatSail);
  ok('巡航自动右移', t1 !== t0 && t2 !== t1, `${t0} → ${t1} → ${t2}`);
  await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); // 单击停靠
  await page.waitForTimeout(300);
  const t3 = await page.evaluate(() => document.querySelector('.rv-strip').style.transform);
  await page.waitForTimeout(600);
  const t4 = await page.evaluate(() => document.querySelector('.rv-strip').style.transform);
  ok('单击停靠', t3 === t4);
  await page.screenshot({ path: path.join(OUT, 'v5-river.png') });

  /* 3. 年距拉开（strip 总宽应 > 6000px） */
  const w = await page.evaluate(() => document.querySelector('.rv-strip').scrollWidth);
  ok('河流拉长（1990–2032）', w > 6000, `${w}px`);

  /* 4. 绝密门禁 UI：书房点卷二 → 弹窗 → 错密码 → 对密码 → 卷详情 */
  await page.evaluate(() => { location.hash = '#/space/study'; });
  await page.waitForSelector('.study-door', { timeout: 10000 });
  const v2door = await page.$('.study-door[data-secret]:nth-of-type(2)');
  const doors = await page.$$('.study-door');
  await doors[2].click(); // 第三个门 = V2（P0,V1,V2…）
  await page.waitForSelector('.sg', { timeout: 8000 });
  ok('卷二触发绝密门（液态玻璃）', true);
  await page.screenshot({ path: path.join(OUT, 'v5-secret-gate.png') });
  await page.fill('.sg-input', 'wrong');
  await page.click('.sg-btn');
  await page.waitForTimeout(500);
  ok('错密码被拒', !!(await page.$('.sg-err')));
  await page.fill('.sg-input', 'L0826');
  await page.click('.sg-btn');
  await page.waitForTimeout(1200);
  const studyOpen = await page.$('.study-detail');
  ok('L0826 解锁 → 卷二打开', !!studyOpen, await page.evaluate(() => location.hash));

  /* 5. 赵问竹：档案馆打开她的专属文档 → 门禁 → 已解锁态直接可读（cookie 已种） */
  const zwDoc = await page.evaluate(async () => {
    const r = await fetch('/api/doc/' + encodeURIComponent('私人资料/人物/刘佑林/刘佑林朋友圈148则完整转录与索引-2018至2024（私密）'));
    return r.status;
  });
  ok('私密文档已解锁可读（cookie 生效）', zwDoc === 200, `status=${zwDoc}`);

  /* 6. 问卷：100+ 口径 + 云海 */
  await page.evaluate(() => { location.hash = '#/space/voices'; });
  await page.waitForSelector('.vo-card', { timeout: 10000 });
  const has100 = await page.$('.vo-big');
  const clouds = await page.$('.vo-clouds');
  ok('问卷 100+ 陈列口径', !!has100);
  ok('底部云海归档', !!clouds);
  await page.screenshot({ path: path.join(OUT, 'v5-voices-clouds.png') });

  /* 7. 总纲目录 */
  await page.click('.toc-hint');
  await page.waitForSelector('.toc', { timeout: 5000 });
  const tocItems = await page.$$('.toc-item');
  ok('总纲目录（9 空间导览）', tocItems.length === 9, `${tocItems.length} 项`);
  await page.screenshot({ path: path.join(OUT, 'v5-toc.png') });
  await page.click('.toc-head .gp-sheet-x');

  /* 8. 回归：callout + 390px */
  await page.goto('http://127.0.0.1:8421/#/doc/' + encodeURIComponent('00-知识库首页'), { waitUntil: 'load' });
  await page.waitForSelector('.ar-body', { timeout: 10000 });
  await page.waitForTimeout(600);
  const co = await page.$eval('.ar-body .callout > *', e => (e.textContent || '').length).catch(() => 0);
  ok('回归:callout 保文', co > 20, `${co} 字`);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('http://127.0.0.1:8421/#/doc/' + encodeURIComponent('主题线索引'), { waitUntil: 'load' });
  await page.waitForSelector('.ar-body', { timeout: 10000 });
  await page.waitForTimeout(500);
  const clip = await page.evaluate(() => document.querySelector('.space-host').scrollWidth - document.querySelector('.space-host').clientWidth);
  ok('回归:390px 无裁切', clip <= 1, `Δ=${clip}`);

  console.log(R.join('\n'));
  console.log(errors.length ? `❌ ${errors.length} 控制台错误:\n` + errors.slice(0, 6).join('\n') : '✅ 零 pageerror / console.error');
  await browser.close();
};
main().catch(e => { console.error('FAIL', e); process.exit(1); });
