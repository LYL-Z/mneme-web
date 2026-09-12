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
  const lr = await p.request.post('https://mneme-309301-9-1455680663.sh.run.tcloudbase.com/api/login', { data: { token: 'mneme' } });
  await p.addInitScript(() => { sessionStorage.setItem('mneme-gate', '1'); sessionStorage.setItem('mneme-anno', '1'); });
  await p.goto('https://mneme-309301-9-1455680663.sh.run.tcloudbase.com/', { waitUntil: 'load' });
  await p.waitForSelector('.st-title', { timeout: 25000 });
  await p.waitForTimeout(900);
  const bundle = await p.evaluate(() => [...document.scripts].map(s => s.src.split('/').pop()).find(x => x.startsWith('index-')) || '');
  out.push('bundle: ' + bundle + (bundle.includes('VShwepIK') ? ' ✓ 026' : ' ⚠'));
  const lvl = await p.evaluate(() => document.documentElement.dataset.imm || 'unset');
  out.push('档位: ' + lvl);
  // 渐变模糊
  await p.evaluate(() => document.querySelector('.space-host').scrollTo({ top: 400 }));
  await p.waitForTimeout(400);
  const sc = await p.evaluate(() => document.getElementById('topNav').style.getPropertyValue('--nav-sc'));
  out.push('渐变模糊 scroll400 --nav-sc=' + sc);
  await p.evaluate(() => document.querySelector('.space-host').scrollTo({ top: 0 }));
  await p.waitForTimeout(300);
  // 公告湮灭
  await p.evaluate(() => { sessionStorage.removeItem('mneme-anno'); location.reload(); });
  await p.waitForSelector('.anno-mask', { timeout: 20000 });
  await p.waitForTimeout(1300);
  await p.click('.anno-enter');
  await p.waitForTimeout(140);
  const burst = await p.evaluate(() => ({
    canvas: [...document.querySelectorAll('body > canvas')].some(c => c.style.zIndex === '200'),
    vanish: !!document.querySelector('.imm-vanish'),
  }));
  out.push('公告湮灭: canvas=' + burst.canvas + ' vanish=' + burst.vanish);
  await p.waitForTimeout(1500);
  // BGM
  const bgm = await p.evaluate(() => { const a = document.querySelector('.bgm audio'); return { ctrl: !!document.querySelector('.bgm'), playing: a && !a.paused }; });
  out.push('BGM: ' + JSON.stringify(bgm));
  out.push('无报错: ' + (errs.length === 0 ? 'OK' : errs[0]));
  await b.close();
  fs.writeFileSync('C:/Users/Lenovo/.workbuddy/tmp/v46-prod.txt', out.join('\n'));
})().catch(e => fs.writeFileSync('C:/Users/Lenovo/.workbuddy/tmp/v46-prod.txt', (out.join('\n')) + '\nERR ' + e.message));
