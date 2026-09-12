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

  // C5 ? 帮助（单次触发）
  await p.keyboard.press('Slash'); // '/' 无 shift = '/'；有 shift 才是 '?'
  await p.waitForTimeout(300);
  ok('斜杠不误触帮助', !(await p.$('.keys-rows')));
  await p.keyboard.down('Shift'); await p.keyboard.press('Slash'); await p.keyboard.up('Shift');
  await p.waitForTimeout(400);
  ok('? 唤起快捷键表', !!(await p.$('.keys-rows')));
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
  ok('Esc 关闭', !(await p.$('.keys-rows')));

  // j/k 滚动（在 stars 页，.space-host 为滚动容器）
  const s0 = await p.evaluate(() => document.querySelector('.space-host')?.scrollTop ?? -1);
  await p.keyboard.press('j'); await p.waitForTimeout(700);
  const s1 = await p.evaluate(() => document.querySelector('.space-host')?.scrollTop ?? -1);
  await p.keyboard.press('k'); await p.waitForTimeout(700);
  const s2 = await p.evaluate(() => document.querySelector('.space-host')?.scrollTop ?? -1);
  ok('j 向下滚动', s1 > s0, `${s0}→${s1}`);
  ok('k 向上滚动', s2 < s1, `${s1}→${s2}`);

  // E4/E2 开关持久化语义：开高对比 → 刷新 → 仍生效 → 关闭恢复
  await p.click('.pref-hint'); await p.waitForTimeout(300);
  await p.click('.pref-row:nth-child(3) input'); await p.waitForTimeout(200);
  await p.click('.pref-head .gp-sheet-x'); await p.waitForTimeout(200);
  await p.reload(); await p.waitForTimeout(1500);
  ok('高对比刷新后仍生效（持久化）', await p.evaluate(() => document.documentElement.classList.contains('contrast-high')));
  await p.click('.pref-hint'); await p.waitForTimeout(300);
  await p.click('.pref-row:nth-child(3) input'); await p.waitForTimeout(200);
  ok('关闭高对比恢复', !(await p.evaluate(() => document.documentElement.classList.contains('contrast-high'))));
  await p.click('.pref-head .gp-sheet-x');

  ok('无运行时报错', errs.length === 0, errs.slice(0, 1).join(';'));
  await b.close();
  console.log(R.join('\n'));
})();
