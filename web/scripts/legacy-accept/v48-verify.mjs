import { createRequire } from 'module';
import fs from 'fs';
const req = createRequire(import.meta.url);
const { chromium } = req('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Users/Lenovo/.agent-browser/browsers/chrome-152.0.7977.82/chrome.exe', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const lr = await p.request.post('http://127.0.0.1:8491/api/login', { data: { token: 'mneme' } });
  if (!lr.ok()) { fs.writeFileSync('C:/Users/Lenovo/.workbuddy/tmp/v48-result.txt', 'login failed'); await b.close(); return; }
  await p.addInitScript(() => { sessionStorage.setItem('mneme-gate', '1'); });
  await p.goto('http://127.0.0.1:8491/', { waitUntil: 'load' });
  await p.waitForSelector('.anno-mask', { timeout: 20000 });
  await p.waitForTimeout(1600);
  const R = await p.evaluate(() => { const c = document.querySelector('.anno-card').getBoundingClientRect(); return { x: Math.round(c.left), y: Math.round(c.top), w: Math.round(c.width) }; });
  await p.click('.anno-enter');
  await p.waitForTimeout(120);
  const f1 = await p.evaluate(() => {
    const card = document.querySelector('.anno-card');
    const c = [...document.querySelectorAll('body > canvas')].find(x => x.style.zIndex === '200');
    return { clip: card?.style.clipPath, canvas: !!c };
  });
  await p.screenshot({ path: 'C:/Users/Lenovo/.workbuddy/tmp/v48-f1.png' });
  await p.waitForTimeout(260);
  const f2 = await p.evaluate(() => document.querySelector('.anno-card')?.style.clipPath);
  await p.screenshot({ path: 'C:/Users/Lenovo/.workbuddy/tmp/v48-f2.png' });
  await p.waitForTimeout(420);
  const f3 = await p.evaluate(() => document.querySelector('.anno-card')?.style.clipPath);
  await p.screenshot({ path: 'C:/Users/Lenovo/.workbuddy/tmp/v48-f3.png' });
  await p.waitForTimeout(1500);
  const clean = await p.evaluate(() => !document.querySelector('.anno-mask') && ![...document.querySelectorAll('body > canvas')].some(c => c.style.zIndex === '200'));
  fs.writeFileSync('C:/Users/Lenovo/.workbuddy/tmp/v48-result.txt', JSON.stringify({ card: R, f1, clipF2: f2, clipF3: f3, clean, errs: errs.slice(0, 2) }, null, 1));
  await b.close();
})().catch(e => fs.writeFileSync('C:/Users/Lenovo/.workbuddy/tmp/v48-result.txt', 'ERR ' + e.message));
