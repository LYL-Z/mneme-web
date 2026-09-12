import { createRequire } from 'module';
import fs from 'fs';
const req = createRequire(import.meta.url);
const { chromium } = req('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Users/Lenovo/.agent-browser/browsers/chrome-152.0.7977.82/chrome.exe', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('https://mneme-309301-9-1455680663.sh.run.tcloudbase.com/', { waitUntil: 'load' });
  await p.waitForTimeout(2600);
  const btn = await p.$('#submitBtn');
  if (btn) { await p.waitForFunction(() => { const x = document.querySelector('#submitBtn'); return x && !/(\d)s/.test(x.textContent || ''); }, { timeout: 10000 }).catch(() => {}); await btn.click().catch(() => {}); await p.waitForTimeout(1000); }
  const lr = await p.request.post('https://mneme-309301-9-1455680663.sh.run.tcloudbase.com/api/login', { data: { token: 'mneme' } });
  await p.addInitScript(() => { sessionStorage.setItem('mneme-gate', '1'); sessionStorage.setItem('mneme-anno', '1'); });
  await p.goto('https://mneme-309301-9-1455680663.sh.run.tcloudbase.com/', { waitUntil: 'load' });
  await p.waitForSelector('.st-title', { timeout: 25000 });
  await p.waitForTimeout(900);
  const bundle = await p.evaluate(() => [...document.scripts].map(s => s.src.split('/').pop()).find(x => x.startsWith('index-')) || '');
  const st0 = await p.evaluate(() => !!document.querySelector('.bgm'));
  await p.click('.bgm-btn'); await p.waitForTimeout(1200);
  const play = await p.evaluate(() => { const a = document.querySelector('.bgm audio'); return { paused: a?.paused, vol: a?.volume, loop: a?.loop, t: Math.round(a?.currentTime ?? 0) }; });
  fs.writeFileSync('C:/Users/Lenovo/.workbuddy/tmp/prod45-result.txt', 'bundle: ' + bundle + '\nbgm控件: ' + st0 + '\n播放态: ' + JSON.stringify(play) + '\nerrs: ' + (errs.length ? errs[0] : 'OK'));
  await p.hover('.bgm'); await p.waitForTimeout(400);
  await p.screenshot({ path: 'C:/Users/Lenovo/.workbuddy/tmp/prod45-bgm.png', clip: { x: 1100, y: 640, width: 340, height: 260 } });
  await b.close();
})().catch(e => fs.writeFileSync('C:/Users/Lenovo/.workbuddy/tmp/prod45-result.txt', 'ERR ' + e.message));
