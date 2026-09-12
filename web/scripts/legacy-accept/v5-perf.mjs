import { createRequire } from 'module';
import fs from 'fs';
const req = createRequire(import.meta.url);
const { chromium } = req('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Users/Lenovo/.agent-browser/browsers/chrome-152.0.7977.82/chrome.exe', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.request.post('http://127.0.0.1:8491/api/login', { data: { token: 'mneme' } });
  await p.addInitScript(() => { sessionStorage.setItem('mneme-gate', '1'); });
  await p.goto('http://127.0.0.1:8491/', { waitUntil: 'load' });
  await p.waitForSelector('.anno-mask', { timeout: 20000 });
  await p.waitForTimeout(2200);
  await p.evaluate(() => {
    const st = { arr: [], last: performance.now(), n: 0 };
    window.__fpsProbe = st;
    const tick = () => {
      const now = performance.now();
      st.n++;
      if (now - st.last >= 500) { st.arr.push(Math.round(st.n * 1000 / (now - st.last))); st.n = 0; st.last = now; }
      if (st.arr.length < 5) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await p.click('.anno-enter');
  await p.waitForTimeout(150);
  const meta = await p.evaluate(() => {
    const c = [...document.querySelectorAll('body > canvas')].find(x => x.style.zIndex === '200');
    return { canvas: !!c, size: c ? c.width + 'x' + c.height : null, gl: c ? (c.getContext('webgl2') ? 'webgl2' : 'fallback') : 'none' };
  });
  await p.waitForTimeout(2200);
  const fps = await p.evaluate(() => window.__fpsProbe.arr);
  fs.writeFileSync('C:/Users/Lenovo/.workbuddy/tmp/v5-perf.txt', JSON.stringify({ meta, fps }, null, 1));
  await b.close();
})().catch(e => fs.writeFileSync('C:/Users/Lenovo/.workbuddy/tmp/v5-perf.txt', 'ERR ' + e.message));
