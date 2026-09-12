/** v7.1 验收：行星星图（拖拽/缩放/搜索/名牌）· 9 幅签名墙 · 时间之河缓速与稀疏 · 全设备（移动视口） */
import path from 'node:path';
import { launch } from './accept-browser.mjs';
const OUT = 'C:/Users/Lenovo/.workbuddy/tmp';
const BASE = 'http://127.0.0.1:8491';
const R = [];
const ok = (n, c, x = '') => R.push((c ? '✅' : '❌') + ' ' + n + (x ? ' · ' + x : ''));

const main = async () => {
  const browser = await launch('v71-accept');
  if (!browser) return; // 本机无可用浏览器 → 跳过（不误报为验收失败）
  const errors = [];

  /* ---------- 桌面 1440×900 ---------- */
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.addInitScript(() => sessionStorage.setItem('mneme-anno', '1')); // v4 公告已阅，不拦探针
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.fill('#t', 'mneme');
  await page.click('#f button');
  await page.waitForSelector('.st-title', { timeout: 15000 });
  await page.waitForTimeout(2600);

  // 1) 签名墙 9 幅
  const sigs = await page.$$eval('.sig', els => els.map(e => ({
    src: e.src.slice(0, 24), shown: e.offsetWidth > 0 && +e.style.opacity > 0,
    x: e.style.left, y: e.style.top, w: e.offsetWidth,
  })));
  const pngCount = sigs.filter(s => s.src.startsWith('data:image/png')).length;
  ok('签名墙 9 幅提取显现（含爸妈两幅）', pngCount === 9 && sigs.length === 9, `png ${pngCount}/9 · entries ${sigs.length}`);
  await page.screenshot({ path: path.join(OUT, 'v71-home-top.png') });
  await page.evaluate(() => document.querySelector('.st-enter')?.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, 'v71-home-bottom.png') });

  // 2) 星图：加载 + 名牌 + 全景适配
  await page.evaluate(() => { location.hash = '#/space/graph'; });
  await page.waitForTimeout(1800);
  const canvasBox = await (await page.$('.gp canvas')).boundingBox();
  ok('星图画布就位', !!canvasBox && canvasBox.width > 500, `${canvasBox && Math.round(canvasBox.width)}x${canvasBox && Math.round(canvasBox.height)}`);
  await page.screenshot({ path: path.join(OUT, 'v71-graph-fit.png') });

  // 名牌抽测：静态层位图上应有文字像素——直接检测白色画布非空即可（有星点）；名牌靠视觉截图验收
  // 搜索：输入 → 候选 → 飞行 → 抽屉（v7.2 起绝密实体弹密码门，故改用非绝密人物回归）
  await page.fill('.gp-search-q', '刘佑林');
  await page.waitForTimeout(400);
  const hitCount = await page.$$eval('.gp-search-hits button', els => els.length);
  ok('搜索候选出现', hitCount > 0, `hits ${hitCount}`);
  await page.screenshot({ path: path.join(OUT, 'v71-graph-search.png') });
  if (hitCount > 0) {
    await page.click('.gp-search-hits button');
    await page.waitForTimeout(1400); // 飞行 760ms + 脉冲
    const sheetName = await page.$eval('.gp-sheet h3', e => e.textContent).catch(() => null);
    ok('搜索飞行后档案开启', !!sheetName, sheetName ?? 'no sheet');
    await page.screenshot({ path: path.join(OUT, 'v71-graph-fly.png') });
    await page.click('.gp-sheet-x').catch(() => {});
  }

  // 拖拽平移：对比画布像素签名
  const snap = () => page.$eval('.gp canvas', c => c.toDataURL().length + ':' + c.toDataURL().slice(-64));
  await page.waitForTimeout(1600); // 等停绘
  const before = await snap();
  const bb2 = await (await page.$('.gp canvas')).boundingBox();
  await page.mouse.move(bb2.x + bb2.width / 2, bb2.y + bb2.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(bb2.x + bb2.width / 2 + i * 24, bb2.y + bb2.height / 2 + i * 10);
  await page.mouse.up();
  await page.waitForTimeout(700);
  const afterDrag = await snap();
  ok('拖拽平移生效', before !== afterDrag);
  await page.screenshot({ path: path.join(OUT, 'v71-graph-drag.png') });

  // 滚轮缩放
  await page.waitForTimeout(1500);
  const beforeZ = await snap();
  await page.mouse.move(bb2.x + bb2.width / 2, bb2.y + bb2.height / 2);
  await page.mouse.wheel(0, -600);
  await page.waitForTimeout(700);
  const afterZoom = await snap();
  ok('滚轮缩放生效', beforeZ !== afterZoom);
  await page.screenshot({ path: path.join(OUT, 'v71-graph-zoom.png') });

  // 缩放按钮 + 复位
  await page.waitForTimeout(1400);
  await page.click('.gp-zoom button:first-child');
  await page.waitForTimeout(500);
  await page.click('.gp-zoom button:last-child'); // 复位全景
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, 'v71-graph-reset.png') });

  // 3) 时间之河：缓巡航 + 稀疏
  await page.evaluate(() => { location.hash = '#/space/river'; });
  await page.waitForTimeout(1600);
  await page.screenshot({ path: path.join(OUT, 'v71-river.png') });
  // 双击起航（点河面下方空白水域，避开事件卡）→ 实测巡航速度（渐入完成后两次采样取平均）
  const flow = await (await page.$('.rv-flow')).boundingBox();
  const sailX = flow.x + flow.width / 2, sailY = flow.y + flow.height - 46;
  const readTx = () => page.$eval('.rv-strip', e => new DOMMatrix(getComputedStyle(e).transform).m41);
  await page.mouse.dblclick(sailX, sailY);
  await page.waitForTimeout(1600); // 等 1.2s 渐入完成
  ok('仍在时间之河（未误点卡片跳转）', (await page.evaluate(() => location.hash)) === '#/space/river');
  const t1 = await readTx();
  await page.waitForTimeout(2000);
  const t2 = await readTx();
  const pxPerSec = Math.abs(t2 - t1) / 2;
  ok('缓速巡航 ≈33px/s（0.55px/帧）', pxPerSec > 20 && pxPerSec < 48, `${pxPerSec.toFixed(1)}px/s`);
  await page.mouse.click(sailX, sailY); // 停靠
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, 'v71-river-cruise.png') });

  // 卡片越界抽测（密集年不缺界，带诊断）
  const clipInfo = await page.evaluate(() => {
    const flow = document.querySelector('.rv-flow').getBoundingClientRect();
    const out = [];
    document.querySelectorAll('.rv-card').forEach(c => {
      const r = c.getBoundingClientRect();
      if (r.height > 0 && (r.top < flow.top - 4 || r.bottom > flow.bottom + 4)) {
        const col = c.closest('.rv-col');
        out.push((col?.dataset.year ?? '?') + ':' + (c.textContent || '').slice(0, 14) + ` top${Math.round(r.top - flow.top)} bottom${Math.round(r.bottom - flow.bottom)}`);
      }
    });
    return out;
  });
  ok('事件卡片无纵向缺失', clipInfo.length === 0, clipInfo.join(' | ') || '全部在界内');
  // 年距
  const cols = await page.$$eval('.rv-col', els => {
    if (els.length < 3) return 0;
    return els[2].getBoundingClientRect().left - els[1].getBoundingClientRect().left;
  });
  ok('年距放宽至 210', Math.round(cols) === 210, `col ${Math.round(cols)}px`);

  // 4) 夜主题星图
  await page.evaluate(() => { location.hash = '#/space/graph'; });
  await page.waitForTimeout(900);
  await page.click('.nav-theme');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(OUT, 'v71-graph-night.png') });
  await page.click('.nav-theme');
  await page.waitForTimeout(600);

  const dErr = errors.filter(e => !/favicon/.test(e));
  ok('桌面无运行时报错', dErr.length === 0, dErr.slice(0, 3).join(' | '));
  await page.close();

  /* ---------- 移动 390×844（触屏） ---------- */
  const mpage = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  mpage.on('pageerror', e => errors.push('m-pageerror: ' + e.message));
  mpage.on('console', m => { if (m.type() === 'error') errors.push('m-console: ' + m.text()); });
  await mpage.goto(BASE + '/', { waitUntil: 'load' });
  await mpage.fill('#t', 'mneme'); // 服务器层口令门（cookie 门禁）
  await mpage.click('#f button');
  await mpage.waitForSelector('.st-title', { timeout: 15000 });
  await mpage.evaluate(() => { location.hash = '#/space/graph'; });
  await mpage.waitForTimeout(2000);
  const hscroll = await mpage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok('移动端无横向滚动', hscroll <= 1, `overflow ${hscroll}px`);
  const searchVisible = await mpage.$eval('.gp-search', e => { const r = e.getBoundingClientRect(); return r.width > 100 && r.right <= innerWidth; });
  ok('移动端搜索框完整可见', searchVisible);
  await mpage.screenshot({ path: path.join(OUT, 'v71-m-graph.png') });
  // 触摸拖拽星图
  const mbb = await (await mpage.$('.gp canvas')).boundingBox();
  const msnap = () => mpage.$eval('.gp canvas', c => c.toDataURL().slice(-64));
  await mpage.waitForTimeout(1500);
  const m0 = await msnap();
  await mpage.touchscreen.tap(mbb.x + mbb.width / 2, mbb.y + mbb.height / 2);
  await mpage.waitForTimeout(600);
  // 单指拖拽：dispatch pointer 序列（hasTouch 下 pointerdown 由 touch 触发）
  await mpage.evaluate(() => {
    const c = document.querySelector('.gp canvas');
    const y = innerHeight / 2, x0 = innerWidth / 2;
    const fire = (type, x, y2, id = 1) => c.dispatchEvent(new PointerEvent(type, {
      pointerId: id, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y2, bubbles: true, buttons: 1,
    }));
    fire('pointerdown', x0, y);
    for (let i = 1; i <= 8; i++) fire('pointermove', x0 + i * 15, y + i * 6);
    fire('pointerup', x0 + 120, y + 48);
  });
  await mpage.waitForTimeout(600);
  const m1 = await msnap();
  ok('移动端触摸拖拽生效', m0 !== m1);
  // 河移动端
  await mpage.evaluate(() => { location.hash = '#/space/river'; });
  await mpage.waitForTimeout(1500);
  const mClip = await mpage.evaluate(() => {
    const flow = document.querySelector('.rv-flow').getBoundingClientRect();
    const out = [];
    document.querySelectorAll('.rv-card').forEach(c => {
      const r = c.getBoundingClientRect();
      if (r.height > 0 && (r.top < flow.top - 4 || r.bottom > flow.bottom + 4)) {
        const col = c.closest('.rv-col');
        out.push((col?.dataset.year ?? '?') + ':' + (c.textContent || '').slice(0, 14));
      }
    });
    return out;
  });
  ok('移动端事件卡片无缺失', mClip.length === 0, mClip.join(' | ') || '全部在界内');
  await mpage.screenshot({ path: path.join(OUT, 'v71-m-river.png') });
  // 首页移动端
  await mpage.evaluate(() => { location.hash = '#/space/stars'; });
  await mpage.waitForTimeout(2200);
  await mpage.screenshot({ path: path.join(OUT, 'v71-m-home.png') });
  const mErr = errors.filter(e => !/favicon/.test(e));
  ok('移动端无运行时报错', mErr.length === 0, mErr.slice(0, 3).join(' | '));
  await mpage.close();

  await browser.close();
  console.log(R.join('\n'));
};

main().catch(e => { console.error('FATAL', e); process.exit(1); });
