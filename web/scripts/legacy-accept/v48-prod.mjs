import { createRequire } from 'module';
import fs from 'fs';
const req = createRequire(import.meta.url);
const { chromium } = req('playwright-core');
const out = [];
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
  out.push('bundle: ' + bundle + (bundle.includes('BgVUTe3d') ? ' ✓ v4.2' : ' ⚠ 旧'));
  const lvl = await p.evaluate(() => document.documentElement.dataset.imm || 'unset');
  out.push('沉浸档位: ' + lvl);
  // 绝密弹窗湮灭（含 clip 锋面 + canvas 粒子）
  await p.evaluate(() => window.dispatchEvent(new Event('mneme:locked')));
  await p.waitForTimeout(700);
  await p.click('.sg-cancel');
  await p.waitForTimeout(150);
  const f1 = await p.evaluate(() => ({
    clip: document.querySelector('.sg')?.style.clipPath || null,
    canvas: !!([...document.querySelectorAll('body > canvas')].find(c => c.style.zIndex === '200')),
  }));
  out.push('湮灭 f1: clip=' + f1.clip + ' canvas=' + f1.canvas);
  await p.waitForTimeout(2000);
  const clean = await p.evaluate(() => !document.querySelector('.sg-mask') && ![...document.querySelectorAll('body > canvas')].some(c => c.style.zIndex === '200'));
  out.push('清理: ' + clean);
  // BGM 抽查
  const bgm = await p.evaluate(() => { const a = document.querySelector('.bgm audio'); return { ctrl: !!document.querySelector('.bgm'), ok: !!a }; });
  out.push('BGM: ' + JSON.stringify(bgm));
  out.push('无报错: ' + (errs.length === 0 ? 'OK' : errs[0]));
  await b.close();
  fs.writeFileSync('C:/Users/Lenovo/.workbuddy/tmp/v48-prod.txt', out.join('\n'));
})().catch(e => fs.writeFileSync('C:/Users/Lenovo/.workbuddy/tmp/v48-prod.txt', (out.join('\n')) + '\nERR ' + e.message));
