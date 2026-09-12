import { createRequire } from 'module';
import fs from 'fs';
const req = createRequire(import.meta.url);
const { chromium } = req('playwright-core');
const out = [];
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Users/Lenovo/.agent-browser/browsers/chrome-152.0.7977.82/chrome.exe', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://127.0.0.1:8491/', { waitUntil: 'load' });
  await p.fill('#t', 'mneme'); await p.click('#f button');
  await p.waitForSelector('.st-title', { timeout: 20000 });
  await p.waitForTimeout(800);

  // 1) ADAPTIVE 档位探测
  const lvl = await p.evaluate(() => document.documentElement.dataset.imm);
  out.push('档位探测: ' + lvl);

  // 2) 渐变模糊：滚动前 --nav-sc≈0，滚动 300px 后 ≈1
  const sc0 = await p.evaluate(() => document.getElementById('topNav').style.getPropertyValue('--nav-sc'));
  await p.evaluate(() => document.querySelector('.space-host').scrollTo({ top: 400 }));
  await p.waitForTimeout(400);
  const sc1 = await p.evaluate(() => document.getElementById('topNav').style.getPropertyValue('--nav-sc'));
  out.push(`渐变模糊: scroll0=${sc0 || '0'} → scroll400=${sc1}`);

  // 3) 按压点光源：pointerdown 在玻璃卡上生成 .imm-ripple
  await p.evaluate(() => document.querySelector('.space-host').scrollTo({ top: 0 }));
  await p.waitForTimeout(300);
  const wb = await p.$('.wb');
  const wbBox = await wb.boundingBox();
  await p.mouse.move(wbBox.x + 60, wbBox.y + 30);
  await p.mouse.down(); await p.waitForTimeout(120); await p.mouse.up();
  const ripple = await p.evaluate(() => document.querySelectorAll('.imm-ripple').length);
  out.push('按压点光源: ripple=' + ripple);

  // 4) 粒子湮灭：公告关闭 → canvas 粒子 + 卡片 vanish
  await p.evaluate(() => { sessionStorage.removeItem('mneme-anno'); location.reload(); });
  await p.waitForSelector('.anno-mask', { timeout: 20000 });
  await p.waitForTimeout(1300);
  await p.click('.anno-enter');
  await p.waitForTimeout(140);
  const burst = await p.evaluate(() => ({
    canvas: [...document.querySelectorAll('body > canvas')].some(c => c.style.zIndex === '200'),
    vanish: !!document.querySelector('.imm-vanish'),
  }));
  await p.waitForTimeout(1300);
  const cleaned = await p.evaluate(() => document.querySelectorAll('.anno-mask').length === 0);
  out.push(`公告湮灭: canvas=${burst.canvas} vanish=${burst.vanish} → 卸载=${cleaned}`);

  // 5) 绝密弹窗湮灭：触发 mneme:locked → 取消按钮
  await p.evaluate(() => window.dispatchEvent(new Event('mneme:locked')));
  await p.waitForTimeout(700);
  const sg0 = await p.$('.sg');
  await p.click('.sg-cancel');
  await p.waitForTimeout(140);
  const burst2 = await p.evaluate(() => ({
    canvas: [...document.querySelectorAll('body > canvas')].some(c => c.style.zIndex === '200'),
    vanish: !!document.querySelector('.imm-vanish'),
  }));
  await p.waitForTimeout(1300);
  const cleaned2 = await p.evaluate(() => !document.querySelector('.sg-mask'));
  out.push(`绝密湮灭: sg=${!!sg0} canvas=${burst2.canvas} vanish=${burst2.vanish} → 卸载=${cleaned2}`);

  out.push('无报错: ' + (errs.length === 0 ? 'OK' : errs[0]));
  await p.screenshot({ path: 'C:/Users/Lenovo/.workbuddy/tmp/v46-imm.png' });
  await b.close();
  fs.writeFileSync('C:/Users/Lenovo/.workbuddy/tmp/v46-result.txt', out.join('\n'));
})().catch(e => fs.writeFileSync('C:/Users/Lenovo/.workbuddy/tmp/v46-result.txt', 'ERR ' + e.message));
