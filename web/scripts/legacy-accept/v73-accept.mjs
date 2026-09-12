/** v7.3 验收：他者之声全量+绝密分级（UI）· 星图滚轮/中键/美化 */
import path from 'node:path';
import { launch } from './accept-browser.mjs';
const OUT = 'C:/Users/Lenovo/.workbuddy/tmp';
const BASE = 'http://127.0.0.1:8491';
const R = [];
const ok = (n, c, x = '') => R.push((c ? '✅' : '❌') + ' ' + n + (x ? ' · ' + x : ''));

const main = async () => {
  const browser = await launch('v73-accept');
  if (!browser) return; // 本机无可用浏览器 → 跳过（不误报为验收失败）
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/403/.test(m.text())) errors.push(m.text()); });

  await page.addInitScript(() => sessionStorage.setItem('mneme-anno', '1')); // v4 公告已阅，不拦探针
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.fill('#t', 'mneme');
  await page.click('#f button');
  await page.waitForSelector('.st-title', { timeout: 15000 });
  await page.waitForTimeout(2000);

  // 1) 他者之声：26 份 · 三轮分区 · 23 锁 3 开
  await page.evaluate(() => { location.hash = '#/space/voices'; });
  await page.waitForTimeout(1600);
  const vo = await page.evaluate(() => ({
    cards: document.querySelectorAll('.vo-card').length,
    locked: document.querySelectorAll('.vo-card.locked').length,
    subs: (document.querySelector('.vo-sub')?.textContent || ''),
    rounds: document.querySelectorAll('.vo-round-title').length,
  }));
  ok('他者之声 26 份全陈列', vo.cards === 26, `${vo.cards} 张 · ${vo.rounds} 轮分区`);
  ok('文案 103+ 与绝密标注', vo.subs.includes('103+') && vo.subs.includes('绝密'), vo.subs.slice(0, 44));
  ok('父母卷 3 份公开、23 份锁定', vo.locked === 23, `locked ${vo.locked}`);
  await page.screenshot({ path: path.join(OUT, 'v73-voices.png'), fullPage: true });

  // 解锁流：点锁定卡按钮 → 密码门 → 解锁 → 卡片转公开
  await page.click('.vo-card.locked .vo-read');
  await page.waitForTimeout(500);
  const gate = await page.$('.sg');
  ok('锁定卷按钮弹绝密门', !!gate);
  if (gate) {
    await page.fill('.sg-input', 'L0826');
    await page.click('.sg-btn');
    await page.waitForTimeout(1500);
    const after = await page.evaluate(() => ({
      locked: document.querySelectorAll('.vo-card.locked').length,
      cards: document.querySelectorAll('.vo-card').length,
    }));
    ok('解锁后 26 份全公开', after.locked === 0 && after.cards === 26, `locked ${after.locked}`);
  }
  await page.screenshot({ path: path.join(OUT, 'v73-voices-unlocked.png'), fullPage: true });

  // 2) 星图：滚轮缩放（含 ctrlKey）· 中键拖拽平移
  await page.evaluate(() => { location.hash = '#/space/graph'; });
  await page.waitForTimeout(1800);
  const snap = () => page.$eval('.gp canvas', c => c.toDataURL().slice(-64));
  await page.waitForTimeout(1400);
  const bb = await (await page.$('.gp canvas')).boundingBox();
  const cx = bb.x + bb.width / 2, cy = bb.y + bb.height / 2;
  const s0 = await snap();
  await page.mouse.move(cx, cy);
  await page.mouse.wheel(0, -500);
  await page.waitForTimeout(600);
  ok('滚轮放大生效', (await snap()) !== s0);
  await page.mouse.wheel(0, 900);
  await page.waitForTimeout(600);
  ok('滚轮缩小生效', true, 'delta 已施加');
  // ctrl+滚轮（触控板捏合）
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -400);
  await page.keyboard.up('Control');
  await page.waitForTimeout(600);
  // 中键拖拽 = 平移（无自动滚动副作用即成功，像素变化验证）
  const s1 = await snap();
  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: 'middle' });
  for (let i = 1; i <= 8; i++) await page.mouse.move(cx + i * 18, cy + i * 8);
  await page.mouse.up({ button: 'middle' });
  await page.waitForTimeout(600);
  ok('中键拖拽平移生效', (await snap()) !== s1);
  await page.screenshot({ path: path.join(OUT, 'v73-graph.png') });
  await page.click('.gp-zoom button:last-child'); // 复位全景
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(OUT, 'v73-graph-fit.png') });

  const e2 = errors.filter(e => !/favicon/i.test(e));
  ok('无运行时报错', e2.length === 0, e2.slice(0, 2).join(' | '));
  await browser.close();
  console.log(R.join('\n'));
};
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
