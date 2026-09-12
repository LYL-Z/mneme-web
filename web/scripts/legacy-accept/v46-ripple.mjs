import { createRequire } from 'module';
import fs from 'fs';
const req = createRequire(import.meta.url);
const { chromium } = req('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Users/Lenovo/.agent-browser/browsers/chrome-152.0.7977.82/chrome.exe', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const lr = await p.request.post('http://127.0.0.1:8491/api/login', { data: { token: 'mneme' } });
  if (!lr.ok()) { fs.writeFileSync('C:/Users/Lenovo/.workbuddy/tmp/v46-ripple.txt', 'login failed ' + lr.status()); await b.close(); return; }
  await p.goto('http://127.0.0.1:8491/', { waitUntil: 'load' });
  await p.addInitScript(() => { sessionStorage.setItem('mneme-anno', '1'); sessionStorage.setItem('mneme-gate', '1'); });
  await p.reload(); await p.waitForTimeout(1500);
  const nav = await p.$('#topNav');
  const nb = await nav.boundingBox();
  await p.mouse.move(nb.x + nb.width - 60, nb.y + nb.height / 2);
  await p.mouse.down(); await p.waitForTimeout(150);
  const rippleMid = await p.evaluate(() => document.querySelectorAll('.imm-ripple').length);
  await p.mouse.up(); await p.waitForTimeout(800);
  const rippleClean = await p.evaluate(() => document.querySelectorAll('.imm-ripple').length);
  fs.writeFileSync('C:/Users/Lenovo/.workbuddy/tmp/v46-ripple.txt', `按压点光源(nav.glass): 生成=${rippleMid > 0} 清理=${rippleClean === 0}`);
  await b.close();
})().catch(e => fs.writeFileSync('C:/Users/Lenovo/.workbuddy/tmp/v46-ripple.txt', 'ERR ' + e.message));
