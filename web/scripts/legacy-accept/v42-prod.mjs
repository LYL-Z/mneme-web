import { createRequire } from 'module';
const req = createRequire(import.meta.url);
const { chromium } = req('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Users/Lenovo/.agent-browser/browsers/chrome-152.0.7977.82/chrome.exe', headless: true });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto('https://mneme-309301-9-1455680663.sh.run.tcloudbase.com/', { waitUntil: 'load' });
  await p.waitForTimeout(2600);
  const btn = await p.$('#submitBtn');
  if (btn) { await p.waitForFunction(() => { const x = document.querySelector('#submitBtn'); return x && !/(\d)s/.test(x.textContent || ''); }, { timeout: 10000 }).catch(() => {}); await btn.click().catch(() => {}); await p.waitForTimeout(1000); }
  await p.fill('#t', 'mneme'); await p.click('#f button');
  await p.waitForSelector('.st-title', { timeout: 20000 });
  await p.waitForTimeout(800);
  const bundle = await p.evaluate(() => [...document.scripts].map(s => s.src).find(s => s.includes('index-')) || '');
  console.log('bundle:', bundle.includes('index-u1PW7FT7') ? 'OK v4.0-4' : 'OLD');
  await p.evaluate(() => { location.hash = '#/foreshadow'; });
  await p.waitForTimeout(1600);
  const rows = await p.$$eval('.fo-row', e => e.length).catch(() => 0);
  const arcs = await p.$$eval('.fo-row path', e => e.length).catch(() => 0);
  console.log('生产伏应矩阵:', rows, '行 ·', arcs, '弧线');
  await p.screenshot({ path: 'C:/Users/Lenovo/.workbuddy/tmp/prod42-foreshadow.png' });
  await b.close(); console.log('done');
})();
