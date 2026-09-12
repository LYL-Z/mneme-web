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
  await p.request.post('https://mneme-309301-9-1455680663.sh.run.tcloudbase.com/api/login', { data: { token: 'mneme' } });
  await p.addInitScript(() => { sessionStorage.setItem('mneme-gate', '1'); sessionStorage.setItem('mneme-anno', '1'); });
  await p.goto('https://mneme-309301-9-1455680663.sh.run.tcloudbase.com/', { waitUntil: 'load' });
  await p.waitForSelector('.st-title', { timeout: 25000 });
  await p.waitForTimeout(800);
  const bundle = await p.evaluate(() => [...document.scripts].map(s => s.src.split('/').pop()).find(x => x.startsWith('index-')) || '');
  // 绝密弹窗湮灭（生产直接可触发）
  await p.evaluate(() => window.dispatchEvent(new Event('mneme:locked')));
  await p.waitForTimeout(700);
  await p.click('.sg-cancel');
  await p.waitForTimeout(120);
  const burst = await p.evaluate(() => ({
    canvasFull: [...document.querySelectorAll('body > canvas')].find(c => c.style.zIndex === '200') ? (() => { const c = [...document.querySelectorAll('body > canvas')].find(c => c.style.zIndex === '200'); const r = c.getBoundingClientRect(); return Math.round(r.width) === innerWidth && Math.round(r.left) === 0; })() : false,
    hidden: (() => { const sg = document.querySelector('.sg'); return sg ? sg.style.visibility === 'hidden' : true; })(),
  }));
  await p.waitForTimeout(1500);
  const cleaned = await p.evaluate(() => !document.querySelector('.sg-mask') && ![...document.querySelectorAll('body > canvas')].some(c => c.style.zIndex === '200'));
  fs.writeFileSync('C:/Users/Lenovo/.workbuddy/tmp/v47-prod.txt', 'bundle: ' + bundle + (bundle.includes('yuWy4hnc') ? ' ✓027' : ' ⚠') + '\n湮灭: canvas全屏=' + burst.canvasFull + ' 卡片隐身=' + burst.hidden + ' 清理=' + cleaned + '\nerrs: ' + (errs.length ? errs[0] : 'OK'));
  await b.close();
})().catch(e => fs.writeFileSync('C:/Users/Lenovo/.workbuddy/tmp/v47-prod.txt', 'ERR ' + e.message));
