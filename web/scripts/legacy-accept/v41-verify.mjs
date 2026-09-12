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

  // E4 偏好面板 + E2 高对比
  await p.click('.pref-hint');
  await p.waitForTimeout(400);
  ok('偏好面板打开', !!(await p.$('.pref')));
  await p.click('.pref-row:nth-child(3) input').catch(() => {});
  await p.waitForTimeout(200);
  ok('高对比开关生效', await p.evaluate(() => document.documentElement.classList.contains('contrast-high')));
  ok('足迹统计显示', ((await p.$eval('.pref-footline', e => e.textContent)) || '').includes('本周打开'));
  await p.click('.pref-head .gp-sheet-x');
  await p.waitForTimeout(300);
  ok('高对比关闭恢复', !(await p.evaluate(() => document.documentElement.classList.contains('contrast-high'))));

  // C5 快捷键
  await p.keyboard.press('Shift+Slash').catch(() => {});
  await p.keyboard.press('?').catch(() => {});
  await p.waitForTimeout(400);
  ok('? 唤起快捷键表', !!(await p.$('.keys-rows')));
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
  await p.keyboard.press('g');
  await p.waitForTimeout(120);
  await p.keyboard.press('r'); // g r → 时间之河
  await p.waitForTimeout(1400);
  ok('g+r 跳转时间之河', p.url().includes('river') || !!(await p.$('.rv-flow')));
  // j/k 滚动
  const s0 = await p.evaluate(() => document.querySelector('.space-host')?.scrollTop ?? -1);
  await p.keyboard.press('j');
  await p.waitForTimeout(600);
  const s1 = await p.evaluate(() => document.querySelector('.space-host')?.scrollTop ?? -1);
  ok('j 向下滚动', s1 > s0, `${s0}→${s1}`);

  // B2 轻量性能基线（导航计时 + 首屏指标）
  const perf = await p.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const lcp = performance.getEntriesByType('largest-contentful-paint').pop();
    return { domContentLoaded: Math.round(nav?.domContentLoadedEventEnd ?? 0), transferKB: Math.round((nav?.transferSize ?? 0) / 1024) };
  });
  ok('性能基线采集', true, `DCL ${perf.domContentLoaded}ms · nav ${perf.transferKB}KB`);

  ok('无运行时报错', errs.length === 0, errs.slice(0, 1).join(';'));
  await b.close();
  console.log(R.join('\n'));
})();
