import { createRequire } from 'module';
import fs from 'fs';
const req = createRequire(import.meta.url);
const { chromium } = req('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Users/Lenovo/.agent-browser/browsers/chrome-152.0.7977.82/chrome.exe', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto('http://127.0.0.1:8491/', { waitUntil: 'load' });
  await p.waitForTimeout(1200);
  const srcs = await p.evaluate(() => [...document.scripts].map(s => s.src.split('/').pop()).filter(Boolean).join(' | '));
  const html = await p.evaluate(() => (document.querySelector('script[type="module"]')?.getAttribute('src') || ''));
  fs.writeFileSync('C:/Users/Lenovo/.workbuddy/tmp/v45-src.txt', 'srcs: ' + srcs + '\nmodule: ' + html);
  await b.close();
})().catch(e => fs.writeFileSync('C:/Users/Lenovo/.workbuddy/tmp/v45-src.txt', 'ERR ' + e.message));
