/**
 * ΜΝΗΜΗ · v3.4 审计（对另一 AI 实现的 P3 章节闭环 + IA 改版做验收）
 * 闭环：工作台继续章节 → 章节面板 → 材料→原文（锚点落点）→ 返回章节上下文不丢
 * 回归：v3.2 修补项（⌘K 六类、callout、390px、hash 路由、序章跳过）
 */
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const OUT = 'C:/Users/Lenovo/.workbuddy/tmp';
const { chromium } = require('playwright-core');
const EXE = 'C:/Users/Lenovo/.agent-browser/browsers/chrome-152.0.7977.82/chrome.exe';

const results = [];
const ok = (name, cond, extra = '') => { results.push(`${cond ? '✅' : '❌'} ${name}${extra ? ' · ' + extra : ''}`); };

const main = async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto('http://127.0.0.1:8421/', { waitUntil: 'load' });
  await page.fill('#t', 'mneme');
  await page.click('#f button');
  await page.waitForSelector('.st-title', { timeout: 15000 });
  await page.waitForTimeout(600);

  /* 1. 四分组导航存在 */
  const groups = await page.$$eval('.nav-group, nav .ng-label, .nav-spaces .nav-space', els => els.length);
  ok('导航改造（分组/项渲染）', groups > 0, `nav 元素 ${groups}`);

  /* 2. 工作台首屏（继续上次章节空态 or 有轨迹） */
  const wb = await page.$('.wb');
  ok('工作台首屏存在', !!wb);
  const wbNone = await page.$('.wb-none');
  ok('工作台空态如实留白（无假按钮）', !wb || !!wbNone || !!(await page.$('.wb-continue:not(.idle)')));

  /* 3. 五卷书房 → 开章节材料链面板（闭环入口） */
  await page.evaluate(() => { location.hash = '#/space/study'; });
  await page.waitForSelector('.study-door', { timeout: 10000 });
  await page.click('.study-door:nth-child(1)'); // V1
  await page.waitForTimeout(800);
  const chBtn = await page.$('.study-chapters li button, .study-chapters li');
  // 章节行是否可点开材料链（ChapterPanel 入口）
  const chapterRow = await page.$$('.study-chapters li');
  ok('卷详情章节列表存在', chapterRow.length > 0, `${chapterRow.length} 行`);
  // 找可点的章节按钮（新 UI 应有「材料链」入口）
  const linkBtn = await page.$('.study-chapters li button');
  if (linkBtn) {
    await linkBtn.click();
    await page.waitForTimeout(900);
    const panel = await page.$('.cp, .chapter-panel, [class*="chapter"]');
    const hash = await page.evaluate(() => location.hash);
    ok('章节材料链面板打开', hash.startsWith('#/chapter/'), hash);
    await page.screenshot({ path: path.join(OUT, 'v34-chapter-panel.png') });

    /* 4. 材料→原文（锚点深链） */
    const matLink = await page.$('[class*="cp"] a[href*="#/doc/"], .cp a, [class*="chapter"] a[href*="#/doc/"]');
    if (matLink) {
      await matLink.click();
      await page.waitForTimeout(1000);
      const inDoc = await page.$('.ar-body');
      ok('材料链接→原文档案馆', !!inDoc, await page.evaluate(() => location.hash).then ? '' : '');
      /* 5. 浏览器后退 → 回到章节面板（上下文不丢） */
      await page.goBack();
      await page.waitForTimeout(700);
      const backHash = await page.evaluate(() => location.hash);
      const panelBack = await page.$('[class*="chapter"], .cp');
      ok('后退回到章节面板', backHash.startsWith('#/chapter/') && !!panelBack, backHash);
    } else ok('材料链接→原文档案馆', false, '面板内无 #/doc 链接');
  } else ok('章节行可点', false, '无章节按钮');

  /* 6. v3.2 回归：⌘K 童年→卷一 */
  await page.goto('http://127.0.0.1:8421/#/space/stars', { waitUntil: 'load' });
  await page.waitForSelector('.st-title', { timeout: 8000 });
  await page.keyboard.press('Control+k');
  await page.waitForSelector('.ck-input');
  await page.type('.ck-input', '童年', { delay: 60 });
  await page.waitForTimeout(700);
  const volHit = await page.$('.ck-item:has-text("卷·")');
  if (volHit) { await volHit.click(); await page.waitForTimeout(800); }
  ok('回归:⌘K 童年→书房', !!(await page.$('.study-detail')), await page.evaluate(() => location.hash));

  /* 7. 回归：callout 保文 + 390px */
  await page.goto('http://127.0.0.1:8421/#/doc/' + encodeURIComponent('00-知识库首页'), { waitUntil: 'load' });
  await page.waitForSelector('.ar-body', { timeout: 10000 });
  await page.waitForTimeout(600);
  const co = await page.$eval('.ar-body .callout > *', e => (e.textContent || '').length).catch(() => 0);
  ok('回归:callout 正文保留', co > 20, `${co} 字`);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('http://127.0.0.1:8421/#/doc/' + encodeURIComponent('主题线索引'), { waitUntil: 'load' });
  await page.waitForSelector('.ar-body', { timeout: 10000 });
  await page.waitForTimeout(600);
  const clip = await page.evaluate(() => document.querySelector('.space-host').scrollWidth - document.querySelector('.space-host').clientWidth);
  ok('回归:390px 无横向裁切', clip <= 1, `Δ=${clip}px`);

  console.log(results.join('\n'));
  console.log(errors.length ? `❌ ${errors.length} 个控制台错误:\n` + errors.slice(0, 6).join('\n') : '✅ 零 pageerror / console.error');
  await browser.close();
};

main().catch(e => { console.error('FAIL', e); process.exit(1); });
