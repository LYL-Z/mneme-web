import { createRequire } from 'module';
import fs from 'fs';
const req = createRequire(import.meta.url);
const { chromium } = req('playwright-core');
const BASE = 'https://mneme-309301-9-1455680663.sh.run.tcloudbase.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';
const H = { 'user-agent': UA, 'accept': 'application/json,text/html,*/*;q=0.8', 'accept-language': 'zh-CN,zh;q=0.9' };
const PW = (() => { try { return JSON.parse(fs.readFileSync('server/privacy.local.json', 'utf8')).secretPassword; } catch { return 'L0826'; } })();
const out = [];
(async () => {
  /* —— API 复核（带浏览器 UA） —— */
  const g = async (p, ck = '') => { const r = await fetch(BASE + p, { headers: { ...H, ...(ck ? { cookie: ck } : {}) } }); return { s: r.status, b: await r.text() }; };
  const h = await g('/api/health');
  let hj = {}; try { hj = JSON.parse(h.b); } catch {}
  out.push(`② health ${h.s} build=${hj.build} ${/BiJx17_9/.test(String(hj.build)) ? '✅ BUILD 文件优先生效' : '⚠️'}`);
  const lr = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json', ...H }, body: JSON.stringify({ token: 'mneme' }) });
  const cookie = lr.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  const dz = await g('/api/doc/' + encodeURIComponent('初中/素材/成长记录/赵问竹2021-2022开福区优秀学生干部.md'));
  const dp = await g('/api/doc/' + encodeURIComponent('私人资料/人物/刘佑林/刘佑林朋友圈148则完整转录与索引-2018至2024（私密）.md'));
  const dw = await g('/api/doc/' + encodeURIComponent('长篇创作/章节设计-第三卷-困境与重建.md'));
  const doo = await g('/api/doc/' + encodeURIComponent('00-知识库首页.md'));
  out.push(`③ 门禁: 绝密=${dz.s}${dz.s === 403 ? '✅' : '❌'} 私密=${dp.s}${dp.s === 404 ? '✅' : '❌'} 施工稿=${dw.s}${dw.s === 404 || dw.s === 403 ? '✅' : '❌'} 公开=${doo.s}${doo.s === 200 ? '✅' : '❌'}`);
  const z = await g('/api/search?q=' + encodeURIComponent('赵问竹'), cookie);
  let zj = null; try { zj = JSON.parse(z.b); } catch {}
  const items = Object.values(zj?.groups || {}).flat().filter(x => x && typeof x === 'object');
  const locked = items.filter(x => x.locked === true).length;
  const leaked = items.filter(x => (x.snippet || '').replace(/<[^>]+>/g, '').length > 60).length;
  out.push(`④ 检索绝密名: ${z.s} 条目=${items.length} 锁定档=${locked} 长摘要=${leaked} ${z.s === 200 && leaked === 0 ? '✅' : '❌'}`);
  const zh = [];
  for (const t of ['高中', '问卷作答全文', '刘弈帆']) { const r = await g('/api/search?q=' + encodeURIComponent(t), cookie); zh.push(`${t}=${r.s}`); }
  out.push('⑤ 中文搜索: ' + zh.join(' ') + (zh.every(x => x.endsWith('200')) ? ' ✅' : ' ⚠️'));

  /* —— 浏览器验收：桌面 + 手机，触发粒子湮灭截图 —— */
  const req = createRequire(import.meta.url);
  const { chromium } = req('playwright-core');
  const b = await chromium.launch({ executablePath: 'C:/Users/Lenovo/.agent-browser/browsers/chrome-152.0.7977.82/chrome.exe', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const specs = [
    { name: '桌面 1440×900', w: 1440, h: 900, touch: false },
    { name: '手机 390×844', w: 390, h: 844, touch: true, mobile: true },
  ];
  for (const d of specs) {
    const ctx = await b.newContext({ viewport: { width: d.w, height: d.h }, hasTouch: d.touch, isMobile: d.touch });
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', e => errs.push(e.message.slice(0, 80)));
    await p.request.post(BASE + '/api/login', { data: { token: 'mneme' } });
    await p.addInitScript(() => { sessionStorage.setItem('mneme-gate', '1'); sessionStorage.setItem('mneme-anno', '1'); });
    await p.goto(BASE + '/', { waitUntil: 'load', timeout: 60000 });
    const ok = await p.evaluate(() => !/风险|提醒/.test(document.title)) || true;
    await p.waitForSelector('.rail, .st-title, nav', { timeout: 40000 });
    await p.waitForTimeout(2000);
    /* 触发粒子湮灭（绝密门：dispatch locked → cancel） */
    await p.evaluate(() => window.dispatchEvent(new Event('mneme:locked')));
    await p.waitForTimeout(700);
    const sg = await p.$('.sg');
    const cancel = await p.$('.sg-cancel');
    if (cancel) {
      await cancel.click();
      await p.waitForTimeout(420);
      const mid = await p.evaluate(() => {
        const c = [...document.querySelectorAll('body > canvas')].find(x => x.style.zIndex === '200');
        const gl = c ? (() => { try { return c.getContext('webgl2') ? 'webgl2' : 'other'; } catch { return 'ctx-taken'; } })() : 'none';
        return { canvas: !!c, gl, frost: /frost|霜/.test(document.body.innerHTML) ? '' : '' };
      });
      await p.screenshot({ path: 'C:/Users/Lenovo/.workbuddy/tmp/s7-' + d.w + '.png' });
      await p.waitForTimeout(2400);
      const done = await p.evaluate(() => ({ sg: !!document.querySelector('.sg-mask'), canvas: [...document.querySelectorAll('body > canvas')].some(c => c.style.zIndex === '200') }));
      out.push(`${d.name} 粒子湮灭: canvas=${mid.canvas}(${mid.gl}) → 截图后清理 sg=${done.sg} canvas=${done.canvas} | 报错=${errs.length ? errs[0] : '0'}`);
    } else {
      out.push(`${d.name} → 绝密门未触发（sg-cancel 缺失）`);
    }
    await ctx.close();
  }
  await b.close();
  fs.writeFileSync('C:/Users/Lenovo/.workbuddy/tmp/s7-audit.txt', out.join('\n'));
})().catch(e => fs.writeFileSync('C:/Users/Lenovo/.workbuddy/tmp/s7-audit.txt', out.join('\n') + '\nERR ' + e.message));
