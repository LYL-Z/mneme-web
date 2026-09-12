import { createRequire } from 'module';
import fs from 'fs';
const req = createRequire(import.meta.url);
const { chromium } = req('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Users/Lenovo/.agent-browser/browsers/chrome-152.0.7977.82/chrome.exe', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.addInitScript(() => { sessionStorage.setItem('mneme-anno', '1'); sessionStorage.setItem('mneme-gate', '1'); localStorage.setItem('mneme-bgm', JSON.stringify({ on: true, vol: 0.3 })); });
  await p.goto('http://127.0.0.1:8491/', { waitUntil: 'load' });
  await p.hover('.bgm'); await p.waitForTimeout(300);
  await p.fill('.bgm-vol', '0.65'); await p.waitForTimeout(400);
  const r = await p.evaluate(() => ({ vol: document.querySelector('.bgm audio')?.volume, saved: JSON.parse(localStorage.getItem('mneme-bgm')).vol, playing: !document.querySelector('.bgm audio').paused }));
  fs.writeFileSync('C:/Users/Lenovo/.workbuddy/tmp/v45-vol.txt', '滑杆调音量: ' + JSON.stringify(r));
  await b.close();
})().catch(e => fs.writeFileSync('C:/Users/Lenovo/.workbuddy/tmp/v45-vol.txt', 'ERR ' + e.message));
