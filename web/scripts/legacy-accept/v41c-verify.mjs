import { createRequire } from 'module';
const req = createRequire(import.meta.url);
const { chromium } = req('playwright-core');
const R = [];
const ok = (n, c, x = '') => R.push((c ? '✅' : '❌') + ' ' + n + (x ? ' · ' + x : ''));
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Users/Lenovo/.agent-browser/browsers/chrome-152.0.7977.82/chrome.exe', headless: true });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://127.0.0.1:8491/', { waitUntil: 'load' });
  await p.fill('#t', 'mneme'); await p.click('#f button');
  await p.waitForSelector('.st-title', { timeout: 15000 });
  await p.waitForTimeout(800);

  // C5：? 帮助 + Esc 关 + g r 跳转（每步独立）
  await p.keyboard.press('Shift+Slash');
  await p.waitForTimeout(400);
  ok('? 唤起快捷键表', !!(await p.$('.keys-rows')));
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  await p.keyboard.press('g'); await p.waitForTimeout(150);
  await p.keyboard.press('r'); await p.waitForTimeout(1400);
  ok('g+r 跳时间之河', !!(await p.$('.rv-flow')));
  await p.keyboard.press('j'); await p.waitForTimeout(600);
  const s1 = await p.evaluate(() => document.querySelector('.space-host')?.scrollTop ?? 0);
  ok('j 滚动', s1 > 0, '→' + s1);

  // E4/E2：直接驱动 localStorage（等价于面板开关），验证 class 应用与持久化
  await p.evaluate(() => { localStorage.setItem('mneme-prefs', JSON.stringify({ motion: true, glass: true, contrast: true })); });
  await p.reload(); await p.waitForTimeout(1500);
  ok('高对比持久化生效', await p.evaluate(() => document.documentElement.classList.contains('contrast-high')));
  await p.evaluate(() => { localStorage.setItem('mneme-prefs', JSON.stringify({ motion: false, glass: true, contrast: false })); });
  await p.reload(); await p.waitForTimeout(1500);
  ok('关动效 class 生效', await p.evaluate(() => document.documentElement.classList.contains('no-motion')));
  await p.evaluate(() => { localStorage.setItem('mneme-prefs', JSON.stringify({ motion: true, glass: true, contrast: false })); });

  ok('无运行时报错', errs.length === 0, errs.slice(0, 1).join(';'));
  await b.close();
  console.log(R.join('\n'));
})();
