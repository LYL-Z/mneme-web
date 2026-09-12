/**
 * ΜΝΗΜΗ · v3.2 可靠性/检索/移动端验收（对照 GPT6-astra 审查文档验收方案）
 * 第一组：读者任务（六类命中直达、深链接刷新、IMC 无关项跳过）
 * 第二组：内容可靠性（callout 正文保留、wikilink href、标题锚点、404/网络分态）
 * 第三组：界面（390px 正文无横向裁切）
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

  /* 登录 */
  await page.goto('http://127.0.0.1:8421/', { waitUntil: 'load' });
  await page.fill('#t', 'mneme');
  await page.click('#f button');
  await page.waitForSelector('.st-title', { timeout: 15000 });

  /* 跳过序章（刷新后 Gate 重播 → 应出现跳过按钮） */
  await page.evaluate(() => { sessionStorage.removeItem('mneme-gate'); });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.gate-skip', { timeout: 6000 });
  await page.click('.gate-skip');
  await page.waitForSelector('.st-title', { timeout: 8000 });
  ok('序章可跳过', true);

  /* ⌘K：检索「童年」→ 命中卷 → 应开书房并展示卷详情（文档点名的 bug） */
  await page.keyboard.press('Control+k');
  await page.waitForSelector('.ck-input');
  await page.type('.ck-input', '童年', { delay: 60 });
  await page.waitForTimeout(700);
  const volHit = await page.$('.ck-item:has-text("卷·")');
  if (volHit) {
    await volHit.click();
    await page.waitForTimeout(900);
    const inStudy = await page.$('.study-detail');
    const hash = await page.evaluate(() => location.hash);
    ok('检索卷命中→开书房', !!inStudy, `hash=${hash}`);
  } else ok('检索卷命中→开书房', false, '无卷命中');

  /* ⌘K：意象命中 → 博物馆聚焦展柜 */
  await page.keyboard.press('Control+k');
  await page.waitForSelector('.ck-input');
  await page.type('.ck-input', '烟花', { delay: 60 });
  await page.waitForTimeout(700);
  const imHit = await page.$('.ck-item:has-text("意象·")');
  if (imHit) {
    await imHit.click();
    await page.waitForTimeout(900);
    const detail = await page.$('.mu-detail');
    ok('检索意象命中→博物馆展柜', !!detail, await page.evaluate(() => location.hash));
  } else ok('检索意象命中→博物馆展柜', false, '无意象命中');

  /* ⌘K：时间线命中 → 河上定位（有 pulse 卡片） */
  await page.keyboard.press('Control+k');
  await page.waitForSelector('.ck-input');
  await page.type('.ck-input', '生日', { delay: 60 });
  await page.waitForTimeout(700);
  const tlHit = await page.$('.ck-item:has-text("生日")');
  if (tlHit) {
    await tlHit.click();
    await page.waitForTimeout(700);
    const inRiver = await page.$('.rv-title');
    const pulse = await page.$('.rv-card.pulse');
    ok('时间线命中→河上定位+脉冲', !!inRiver && !!pulse);
    await page.screenshot({ path: path.join(OUT, 'v32-river-pulse.png') });
  } else ok('时间线命中→河上定位+脉冲', false, '无时间线命中');

  /* 深链接：直接打开 doc hash（等效刷新恢复） */
  await page.goto('http://127.0.0.1:8421/#/doc/' + encodeURIComponent('主题线索引'), { waitUntil: 'load' });
  await page.waitForSelector('.ar-body', { timeout: 10000 });
  await page.waitForTimeout(600);
  const wlHref = await page.$eval('.ar-body a.wl', a => a.getAttribute('href'));
  const h2ids = await page.$$eval('.ar-body h2[id], .ar-body h3[id]', els => els.length);
  ok('深链接直达文档', true);
  ok('wikilink 具备真实 href', !!wlHref && wlHref.startsWith('#/doc/'), wlHref || '');
  ok('标题锚点 id 已注入', h2ids > 0, `${h2ids} 个`);

  /* callout 正文保留：00-知识库首页 */
  await page.goto('http://127.0.0.1:8421/#/doc/' + encodeURIComponent('00-知识库首页'), { waitUntil: 'load' });
  await page.waitForSelector('.ar-body', { timeout: 10000 });
  await page.waitForTimeout(600);
  const callout = await page.$('.ar-body .callout');
  if (callout) {
    const tag = await page.$eval('.ar-body .callout .co-tag', e => e.textContent);
    const pText = await page.$eval('.ar-body .callout p, .ar-body .callout > *', e => (e.textContent || '').length);
    ok('callout 标签化', !!tag, `tag=${tag}`);
    ok('callout 正文未被吞', pText > 20, `首块文本长度=${pText}`);
  } else ok('callout 存在于首页', false);

  /* 404 与网络错误分态：不存在的路径 → miss；断网态难以模拟，此处验证 404 走 miss 而非 error */
  await page.goto('http://127.0.0.1:8421/#/doc/' + encodeURIComponent('不存在的页面-xyz'), { waitUntil: 'load' });
  await page.waitForTimeout(700);
  const missShown = await page.$('.ar-miss:has-text("未收录")');
  ok('404 → 未收录态（非错误）', !!missShown);

  /* 第三组：390×844 正文无横向裁切 */
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('http://127.0.0.1:8421/#/doc/' + encodeURIComponent('主题线索引'), { waitUntil: 'load' });
  await page.waitForSelector('.ar-body', { timeout: 10000 });
  await page.waitForTimeout(700);
  const clip = await page.evaluate(() => {
    const host = document.querySelector('.space-host');
    const body = document.querySelector('.ar-body');
    return {
      hostOverflow: host.scrollWidth - host.clientWidth,
      bodyScroll: body.scrollWidth - body.clientWidth,
      tableScrollable: !!body.querySelector('table') ? (getComputedStyle(body.querySelector('table')).overflowX === 'auto' || body.querySelector('table').scrollWidth <= body.clientWidth) : true,
    };
  });
  ok('390px 正文无横向裁切', clip.hostOverflow <= 1, `hostΔ=${clip.hostOverflow}px bodyΔ=${clip.bodyScroll}px`);
  await page.screenshot({ path: path.join(OUT, 'v32-mobile-390.png') });

  /* 浏览器后退：从文档返回上一空间 */
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto('http://127.0.0.1:8421/#/space/stars', { waitUntil: 'load' });
  await page.waitForSelector('.st-title', { timeout: 8000 });
  await page.evaluate(() => { location.hash = '#/doc/' + encodeURIComponent('主题线索引'); });
  await page.waitForSelector('.ar-body', { timeout: 8000 });
  await page.goBack();
  await page.waitForTimeout(500);
  const backStars = await page.$('.st-title');
  ok('浏览器后退恢复空间', !!backStars, await page.evaluate(() => location.hash));

  console.log(results.join('\n'));
  console.log(errors.length ? `❌ ${errors.length} 个控制台错误:\n` + errors.slice(0, 5).join('\n') : '✅ 零 pageerror / console.error');
  await browser.close();
};

main().catch(e => { console.error('FAIL', e); process.exit(1); });
