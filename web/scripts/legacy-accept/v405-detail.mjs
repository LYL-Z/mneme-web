import { createRequire } from 'module';
const req = createRequire(import.meta.url);
const { chromium } = req('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Users/Lenovo/.agent-browser/browsers/chrome-152.0.7977.82/chrome.exe', headless: true });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto('http://127.0.0.1:8491/', { waitUntil: 'load' });
  await p.fill('#t', 'mneme'); await p.click('#f button');
  await p.waitForSelector('.st-title', { timeout: 15000 });
  await p.waitForTimeout(3500);
  const detail = await p.evaluate(() => {
    const rects = [...document.querySelectorAll('.sig')].map(el => ({ src: el.getAttribute('src').slice(-12), r: el.getBoundingClientRect() }));
    const out = [];
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i].r, c = rects[j].r;
      const w = Math.min(a.right, c.right) - Math.max(a.left, c.left);
      const h = Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top);
      if (w > 0 && h > 0) out.push(rects[i].src + '@(' + Math.round(a.left) + ',' + Math.round(a.top) + ') x ' + rects[j].src + '@(' + Math.round(c.left) + ',' + Math.round(c.top) + ') = ' + Math.round(w) + 'x' + Math.round(h));
    }
    return out;
  });
  console.log(detail.join('\n') || '无相交');
  await b.close();
})();
