/** v7.4 验收：他者之声注脚 · 星图交互帧率（拖拽/滚轮 p95）· 切页时长 */
import path from 'node:path';
import { launch } from './accept-browser.mjs';
const OUT = 'C:/Users/Lenovo/.workbuddy/tmp';
const BASE = 'http://127.0.0.1:8491';
const R = [];
const ok = (n, c, x = '') => R.push((c ? '✅' : '❌') + ' ' + n + (x ? ' · ' + x : ''));

const main = async () => {
  const browser = await launch('v74-accept');
  if (!browser) return; // 本机无可用浏览器 → 跳过（不误报为验收失败）
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.addInitScript(() => sessionStorage.setItem('mneme-anno', '1')); // v4 公告已阅，不拦探针
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.fill('#t', 'mneme');
  await page.click('#f button');
  await page.waitForSelector('.st-title', { timeout: 15000 });

  // 1) 注脚
  await page.evaluate(() => { location.hash = '#/space/voices'; });
  await page.waitForTimeout(1200);
  const note = await page.$eval('.vo-cloud-note', e => e.textContent);
  ok('他者之声注脚含新句', !!note && note.includes('受系统限制，只能显示这些部分'), (note || '').slice(-20));

  // 2) 星图交互帧率
  await page.evaluate(() => { location.hash = '#/space/graph'; });
  await page.waitForTimeout(2400);
  const bb = await (await page.$('.gp canvas')).boundingBox();
  const cx = bb.x + bb.width / 2, cy = bb.y + bb.height / 2;

  // 拖拽期间帧间隔探针（90 帧）
  const dragStats = await page.evaluate(({ x, y }) => new Promise(res => {
    const gaps = []; let last = performance.now();
    const cb = t => { gaps.push(t - last); last = t; if (gaps.length < 90) requestAnimationFrame(cb); else res(gaps); };
    requestAnimationFrame(cb);
    const c = document.querySelector('.gp canvas');
    const fire = (type, px, py) => c.dispatchEvent(new PointerEvent(type, {
      pointerId: 9, pointerType: 'mouse', isPrimary: true, clientX: px, clientY: py, bubbles: true, buttons: 1,
    }));
    fire('pointerdown', x, y);
    let i = 0;
    const step = () => { i++; fire('pointermove', x + i * 9, y + i * 4); if (i < 90) requestAnimationFrame(step); else fire('pointerup', x + 810, y + 360); };
    requestAnimationFrame(step);
  }), { x: cx - 400, y: cy - 180 });
  const stat = gaps => {
    const s = [...gaps].sort((a, b) => a - b);
    const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    return { avg, p95: s[Math.floor(s.length * 0.95)], max: s[s.length - 1] };
  };
  const ds = stat(dragStats);
  ok('拖拽帧率 p95 < 25ms', ds.p95 < 25, `avg ${ds.avg.toFixed(1)} · p95 ${ds.p95.toFixed(1)} · max ${ds.max.toFixed(1)}ms`);

  // 滚轮缩放期间帧率
  await page.mouse.move(cx, cy);
  const zoomGaps = await page.evaluate(() => new Promise(res => {
    const gaps = []; let last = performance.now();
    const cb = t => { gaps.push(t - last); last = t; if (gaps.length < 60) requestAnimationFrame(cb); else res(gaps); };
    requestAnimationFrame(cb);
    let i = 0;
    const step = () => {
      // @ts-ignore
      window.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, clientX: innerWidth / 2, clientY: innerHeight / 2, bubbles: true, cancelable: true }));
      const c = document.querySelector('.gp canvas');
      c.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, clientX: innerWidth / 2, clientY: innerHeight / 2, bubbles: true, cancelable: true }));
      if (++i < 30) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    setTimeout(() => res(gaps), 1200);
  }));
  const zs = stat(zoomGaps);
  ok('缩放帧率 p95 < 25ms', zs.p95 < 25, `avg ${zs.avg.toFixed(1)} · p95 ${zs.p95.toFixed(1)}ms`);

  // 3) 星图 → 档案馆 切页时长（点击到新空间首帧）
  await page.waitForTimeout(1600); // 等停绘
  await page.mouse.move(20, 20); // 离开画布
  await page.waitForTimeout(300);
  const t0 = Date.now();
  await page.click('.nav-space:nth-of-type(1) >> nth=1').catch(async () => { await page.evaluate(() => { location.hash = '#/space/archive'; }); });
  await page.waitForFunction(() => !!document.querySelector('.ar, .st, .rv, .th, .mu, .vo, .lh'), { timeout: 5000 });
  const sw = Date.now() - t0;
  ok('星图切其他界面 < 500ms', sw < 500, `${sw}ms`);
  await page.screenshot({ path: path.join(OUT, 'v74-after-switch.png') });
  // 切回星图再切走一次（canvas 已重建再释放）
  await page.evaluate(() => { location.hash = '#/space/graph'; });
  await page.waitForTimeout(2200);
  const t1 = Date.now();
  await page.evaluate(() => { location.hash = '#/space/stars'; });
  await page.waitForFunction(() => !!document.querySelector('.st-title'), { timeout: 5000 });
  ok('星图→记忆恒星二次切换 < 500ms', Date.now() - t1 < 500, `${Date.now() - t1}ms`);

  await page.screenshot({ path: path.join(OUT, 'v74-graph.png') });
  await browser.close();
  console.log(R.join('\n'));
};
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
