import { createRequire } from 'module';
import fs from 'fs';
const req = createRequire(import.meta.url);
const { chromium } = req('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Users/Lenovo/.agent-browser/browsers/chrome-152.0.7977.82/chrome.exe', headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--enable-webgl', '--use-gl=angle'] });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const lr = await p.request.post('http://127.0.0.1:8491/api/login', { data: { token: 'mneme' } });
  if (!lr.ok()) { fs.writeFileSync('C:/Users/Lenovo/.workbuddy/tmp/v5-result.txt', 'login failed'); await b.close(); return; }
  await p.addInitScript(() => { sessionStorage.setItem('mneme-gate', '1'); });
  await p.goto('http://127.0.0.1:8491/', { waitUntil: 'load' });
  await p.waitForSelector('.anno-mask', { timeout: 20000 });
  await p.waitForTimeout(2200); // 等预采样完成（html2canvas 400ms 后启动）
  const pre = await p.evaluate(() => !!document.querySelector('.anno-card'));
  await p.click('.anno-enter');
  await p.waitForTimeout(130);
  const f1 = await p.evaluate(() => {
    const c = [...document.querySelectorAll('body > canvas')].find(x => x.style.zIndex === '200');
    const gl = c ? (c.getContext('webgl2') ? 'webgl2' : 'ctx-taken') : 'no-canvas';
    return { canvas: !!c, gl, clip: document.querySelector('.anno-card')?.style.clipPath };
  });
  await p.screenshot({ path: 'C:/Users/Lenovo/.workbuddy/tmp/v5-f1.png' });
  await p.waitForTimeout(280);
  await p.screenshot({ path: 'C:/Users/Lenovo/.workbuddy/tmp/v5-f2.png' });
  await p.waitForTimeout(1300);
  await p.screenshot({ path: 'C:/Users/Lenovo/.workbuddy/tmp/v5-f3.png' });
  await p.waitForTimeout(700);
  const done = await p.evaluate(() => ({
    gone: ![...document.querySelectorAll('body > canvas')].some(c => c.style.zIndex === '200'),
    mask: !!document.querySelector('.anno-mask'),
  }));
  fs.writeFileSync('C:/Users/Lenovo/.workbuddy/tmp/v5-result.txt', JSON.stringify({ pre, f1, done, errs: errs.slice(0, 3) }, null, 1));
  await b.close();
})().catch(e => fs.writeFileSync('C:/Users/Lenovo/.workbuddy/tmp/v5-result.txt', 'ERR ' + e.message));
