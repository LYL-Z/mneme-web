import { createRequire } from 'module';
import fs from 'fs';
const req = createRequire(import.meta.url);
const { chromium } = req('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Users/Lenovo/.agent-browser/browsers/chrome-152.0.7977.82/chrome.exe', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  // 服务端 Gate：先 login 拿 cookie，再进 React 层
  const lr = await p.request.post('http://127.0.0.1:8491/api/login', { data: { token: 'mneme' } });
  if (!lr.ok()) { fs.writeFileSync('C:/Users/Lenovo/.workbuddy/tmp/v45-diag.txt', 'login failed: ' + lr.status()); await b.close(); return; }
  await p.addInitScript(() => {
    sessionStorage.setItem('mneme-gate', '1');
    sessionStorage.setItem('mneme-anno', '1');
    localStorage.setItem('mneme-bgm', JSON.stringify({ on: true, vol: 0.3 }));
  });
  await p.goto('http://127.0.0.1:8491/', { waitUntil: 'load' });
  await p.waitForTimeout(2500);
  const diag = await p.evaluate(() => ({
    bgm: !!document.querySelector('.bgm'),
    stTitle: !!document.querySelector('.st-title'),
    audioVol: document.querySelector('.bgm audio')?.volume ?? null,
    audioPaused: document.querySelector('.bgm audio')?.paused ?? null,
    audioT: Math.round(document.querySelector('.bgm audio')?.currentTime ?? -1),
  }));
  await p.hover('.bgm'); await p.waitForTimeout(300);
  await p.fill('.bgm-vol', '0.65'); await p.waitForTimeout(400);
  const r = await p.evaluate(() => ({ vol: document.querySelector('.bgm audio')?.volume, saved: JSON.parse(localStorage.getItem('mneme-bgm')).vol, playing: !document.querySelector('.bgm audio').paused }));
  // 暂停切换
  await p.click('.bgm-btn'); await p.waitForTimeout(400);
  const paused2 = await p.evaluate(() => document.querySelector('.bgm audio')?.paused);
  fs.writeFileSync('C:/Users/Lenovo/.workbuddy/tmp/v45-diag.txt', JSON.stringify({ diag, slider: r, pauseToggle: paused2, errs: errs.slice(0, 2) }));
  await p.screenshot({ path: 'C:/Users/Lenovo/.workbuddy/tmp/v45-bgm.png', clip: { x: 1100, y: 660, width: 340, height: 240 } });
  await b.close();
})().catch(e => fs.appendFileSync('C:/Users/Lenovo/.workbuddy/tmp/v45-diag.txt', '\nERR ' + e.message));
