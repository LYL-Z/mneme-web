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
  const probe = await p.evaluate(() => {
    const solids = ['.st-title', '.st-quote', '.st-orbitry', '.wb', '.ds', '.st-stats', '.monument', '.glass'].flatMap(s => [...document.querySelectorAll(s)]).filter(el => !el.closest('.sigwall')).map(el => el.getBoundingClientRect());
    const hit = (a, c) => Math.max(0, Math.min(a.right, c.right) - Math.max(a.left, c.left)) * Math.max(0, Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top));
    const rects = [...document.querySelectorAll('.sig')].map(el => el.getBoundingClientRect());
    let cardBad = 0, overlapBad = 0, out = 0;
    for (const r of rects) {
      for (const s of solids) if (hit(r, s) / (r.width * r.height) > 0.10) { cardBad++; break; }
      if (r.right > innerWidth + 1 || r.left < -1) out++;
    }
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
      if (hit(rects[i], rects[j]) > 1) overlapBad++;
    }
    return { cardBad, overlapBad, out };
  });
  console.log('严格零重叠 → 被卡片压:', probe.cardBad, '| bbox 相交对:', probe.overlapBad, '| 出界:', probe.out);
  await p.screenshot({ path: 'C:/Users/Lenovo/.workbuddy/tmp/v405-layered.png' });
  await b.close();
})();
