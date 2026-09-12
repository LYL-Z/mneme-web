import { createRequire } from 'module';
import fs from 'fs';
const req = createRequire(import.meta.url);
const { chromium } = req('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Users/Lenovo/.agent-browser/browsers/chrome-152.0.7977.82/chrome.exe', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const lr = await p.request.post('http://127.0.0.1:8491/api/login', { data: { token: 'mneme' } });
  if (!lr.ok()) { fs.writeFileSync('C:/Users/Lenovo/.workbuddy/tmp/v47-result.txt', 'login failed'); await b.close(); return; }
  await p.addInitScript(() => { sessionStorage.setItem('mneme-gate', '1'); });
  await p.goto('http://127.0.0.1:8491/', { waitUntil: 'load' });
  await p.waitForSelector('.st-title', { timeout: 20000 });
  await p.waitForTimeout(700);

  // 公告重现：清 anno 标记（不用 reload——用事件直接重开不方便，走 reload）
  // 公告应已自动弹出（无 anno 标记）
  const canvasBox0 = await p.evaluate(() => {
    const card = document.querySelector('.anno-card')?.getBoundingClientRect();
    return card ? { x: Math.round(card.left), y: Math.round(card.top), w: Math.round(card.width), h: Math.round(card.height) } : null;
  });
  await p.click('.anno-enter');
  await p.waitForTimeout(80);
  const f1 = await p.evaluate(() => {
    const c = [...document.querySelectorAll('body > canvas')].find(x => x.style.zIndex === '200');
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { css: { w: Math.round(r.width), h: Math.round(r.height), l: Math.round(r.left), t: Math.round(r.top) }, attr: { w: c.width, h: c.height }, card: (() => { const x = document.querySelector('.anno-card'); return x ? { v: x.style.visibility } : null; })() };
  });
  await p.screenshot({ path: 'C:/Users/Lenovo/.workbuddy/tmp/v47-frame1.png' });
  await p.waitForTimeout(240);
  await p.screenshot({ path: 'C:/Users/Lenovo/.workbuddy/tmp/v47-frame2.png' });
  await p.waitForTimeout(400);
  await p.screenshot({ path: 'C:/Users/Lenovo/.workbuddy/tmp/v47-frame3.png' });
  await p.waitForTimeout(1200);
  const cleaned = await p.evaluate(() => !document.querySelector('.anno-mask') && ![...document.querySelectorAll('body > canvas')].some(c => c.style.zIndex === '200'));
  fs.writeFileSync('C:/Users/Lenovo/.workbuddy/tmp/v47-result.txt', JSON.stringify({ cardRect: canvasBox0, canvasFrame: f1, cleaned, errs: errs.slice(0, 2) }, null, 1));
  await b.close();
})().catch(e => fs.writeFileSync('C:/Users/Lenovo/.workbuddy/tmp/v47-result.txt', 'ERR ' + e.message));
