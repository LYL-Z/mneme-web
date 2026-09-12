/** v7.2 验收：绝密锁（姓名制）· 签名墙 v6.3 · 他者之声口径 · 意象博物馆全量 · 主题域充实 */
import path from 'node:path';
import { launch } from './accept-browser.mjs';
const OUT = 'C:/Users/Lenovo/.workbuddy/tmp';
const BASE = 'http://127.0.0.1:8491';
const R = [];
const ok = (n, c, x = '') => R.push((c ? '✅' : '❌') + ' ' + n + (x ? ' · ' + x : ''));

const main = async () => {
  const browser = await launch('v72-accept');
  if (!browser) return; // 本机无可用浏览器 → 跳过（不误报为验收失败）
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  await page.addInitScript(() => sessionStorage.setItem('mneme-anno', '1')); // v4 公告已阅，不拦探针
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.fill('#t', 'mneme');
  await page.click('#f button');
  await page.waitForSelector('.st-title', { timeout: 15000 });
  await page.waitForTimeout(2400);

  // 1) 签名墙 v6.3：9 幅显现
  const sigN = await page.$$eval('.sig', els => els.filter(e => +e.style.opacity > 0).length);
  ok('签名墙 9 幅显现', sigN === 9, `${sigN}/9`);
  await page.screenshot({ path: path.join(OUT, 'v72-home.png') });

  // 2) 绝密锁回归：星图点击赵问竹 → 必须弹管理员密码门，而非档案
  await page.evaluate(() => { location.hash = '#/space/graph'; });
  await page.waitForTimeout(1800);
  await page.fill('.gp-search-q', '赵问竹');
  await page.waitForTimeout(450);
  const zhHits = await page.$$eval('.gp-search-hits button', els => els.map(e => e.textContent));
  ok('搜索到赵问竹系实体', zhHits.length > 0, zhHits.slice(0, 3).join('|'));
  await page.click('.gp-search-hits button');
  await page.waitForTimeout(1400);
  const gateShown = await page.$('.sg');
  const sheetShown = await page.$('.gp-sheet');
  ok('赵问竹档案弹出绝密门（非直接展示）', !!gateShown && !sheetShown, gateShown ? 'SecretGate 已弹' : '未弹门');
  await page.screenshot({ path: path.join(OUT, 'v72-secret-gate.png') });
  // 输入管理员密码解锁 → 档案自动补开
  if (gateShown) {
    await page.fill('.sg-input', 'L0826');
    await page.click('.sg-btn');
    await page.waitForTimeout(1200);
    const name = await page.$eval('.gp-sheet h3', e => e.textContent).catch(() => null);
    ok('管理员密码解锁后档案补开', !!name, name ?? '');
    await page.click('.gp-sheet-x').catch(() => {});
  }

  // 3) 意象博物馆全量
  await page.evaluate(() => { location.hash = '#/space/museum'; });
  await page.waitForTimeout(1500);
  const muStats = await page.evaluate(() => ({
    total: document.querySelectorAll('.mu-case').length,
    sub: (document.querySelector('.mu-sub')?.textContent || ''),
  }));
  ok('意象博物馆 ≥50 件', muStats.total >= 50, `${muStats.total} 件 · ${muStats.sub.slice(0, 30)}`);
  await page.screenshot({ path: path.join(OUT, 'v72-museum.png'), fullPage: true });

  // 4) 他者之声口径
  await page.evaluate(() => { location.hash = '#/space/voices'; });
  await page.waitForTimeout(1200);
  const voText = await page.$eval('.vo-sub', e => e.textContent);
  ok('他者之声改为三轮采集口径', voText.includes('V1–V3') && !voText.includes('亲历者'), voText.slice(0, 40));

  // 5) 主题域充实
  await page.evaluate(() => { location.hash = '#/space/themes'; });
  await page.waitForTimeout(1400);
  const cardDesc = await page.$$eval('.th-card-desc', els => els.filter(e => e.textContent.trim().length > 5).length);
  ok('域卡带一句话导览', cardDesc >= 6, `${cardDesc} 张`);
  await page.click('.th-card:first-child');
  await page.waitForTimeout(1400);
  const chips = await page.$$('.th-stage-chip');
  ok('域内学段分布筛选就位', chips.length >= 2, `${chips.length} 枚 chips`);
  await page.screenshot({ path: path.join(OUT, 'v72-themes.png'), fullPage: true });

  // 403 资源报错 = 绝密锁按设计拦截（/api/entities/:id 返回 403 → SecretGate），属预期
  const e2 = errors.filter(e => !/favicon/i.test(e) && !/403/.test(e));
  ok('无运行时报错', e2.length === 0, e2.slice(0, 2).join(' | '));
  await browser.close();
  console.log(R.join('\n'));
};
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
