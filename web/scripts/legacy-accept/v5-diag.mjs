import { createRequire } from 'module';
import fs from 'fs';
const req = createRequire(import.meta.url);
const { chromium } = req('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Users/Lenovo/.agent-browser/browsers/chrome-152.0.7977.82/chrome.exe', headless: true });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push('PG: ' + e.message.slice(0, 120)));
  const lr = await p.request.post('http://127.0.0.1:8491/api/login', { data: { token: 'mneme' } });
  await p.addInitScript(() => { sessionStorage.setItem('mneme-gate', '1'); });
  await p.goto('http://127.0.0.1:8491/', { waitUntil: 'load' });
  await p.waitForSelector('.anno-mask', { timeout: 20000 });
  await p.waitForTimeout(1500);
  // 手动跑 html2canvas 诊断
  const diag = await p.evaluate(async () => {
    try {
      const mod = await import('/assets/html2canvas.esm-BfxBtG_O.js').catch(() => null);
      const h2c = mod ? (mod.default || mod) : null;
      if (!h2c) return { step: 'import-fail' };
      const card = document.querySelector('.anno-card');
      if (!card) return { step: 'no-card' };
      const start = performance.now();
      const cv = await h2c(card, { backgroundColor: 'rgba(246,242,233,0.88)', scale: 1, logging: false, useCORS: false });
      const ctx = cv.getContext('2d');
      const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
      let opaque = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 48) opaque++;
      return { step: 'ok', w: cv.width, h: cv.height, ms: Math.round(performance.now() - start), opaquePx: opaque, totalPx: d.length / 4 };
    } catch (e) { return { step: 'error', msg: String(e).slice(0, 180) }; }
  });
  fs.writeFileSync('C:/Users/Lenovo/.workbuddy/tmp/v5-diag.txt', JSON.stringify({ diag, errs }, null, 1));
  await b.close();
})().catch(e => fs.writeFileSync('C:/Users/Lenovo/.workbuddy/tmp/v5-diag.txt', 'ERR ' + e.message));
