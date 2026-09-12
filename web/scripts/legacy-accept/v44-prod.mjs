import { createRequire } from 'module';
const req = createRequire(import.meta.url);
const { chromium } = req('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Users/Lenovo/.agent-browser/browsers/chrome-152.0.7977.82/chrome.exe', headless: true });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto('https://mneme-309301-9-1455680663.sh.run.tcloudbase.com/', { waitUntil: 'load' });
  await p.waitForTimeout(2600);
  const btn = await p.$('#submitBtn');
  if (btn) { await p.waitForFunction(() => { const x = document.querySelector('#submitBtn'); return x && !/(\d)s/.test(x.textContent || ''); }, { timeout: 10000 }).catch(() => {}); await btn.click().catch(() => {}); await p.waitForTimeout(1000); }
  await p.fill('#t', 'mneme'); await p.click('#f button');
  await p.waitForSelector('.anno-mask', { timeout: 25000 });
  await p.waitForTimeout(1600);
  console.log('公告: mask 可见');
  await p.click('.anno-enter'); await p.waitForTimeout(700);
  // A4：档案馆开一篇带卷的文档 → 开对照 → 右栏默认载本卷大纲
  await p.evaluate(() => { location.hash = '#/doc/' + encodeURIComponent('长篇创作/章节设计-第二卷-青春与阵痛.md') ; });
  await p.waitForTimeout(2000);
  console.log('页面:', await p.$eval('.ar-head h2', e => e.textContent).catch(() => 'FAIL'), '| 对照钮:', !!(await p.$('button[title="双栏对照阅读"]')));
  const dualBtn = await p.$('button[title="双栏对照阅读"]');
  if (dualBtn) { await dualBtn.click(); await p.waitForTimeout(1800); }
  const sug = await p.$eval('.ar-pick-sug, .ar-sec-path', e => e.textContent.slice(0, 30)).catch(() => 'none');
  console.log('A4 对照:', sug);
  await p.screenshot({ path: 'C:/Users/Lenovo/.workbuddy/tmp/prod44-a4.png' });
  await b.close(); console.log('done');
})();
