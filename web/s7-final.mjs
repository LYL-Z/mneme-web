import fs from 'fs';
const BASE = 'https://mneme-309301-9-1455680663.sh.run.tcloudbase.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';
const H = { 'user-agent': UA, 'accept': 'application/json,text/html,*/*;q=0.8', 'accept-language': 'zh-CN,zh;q=0.9' };
const out = [];
(async () => {
  /* 登录 */
  const lr = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json', ...H }, body: JSON.stringify({ token: 'mneme' }) });
  const setc = lr.headers.getSetCookie();
  const cookie = setc.map(c => c.split(';')[0]).join('; ');
  out.push(`① 登录 ${lr.status} | cookie: ${cookie ? cookie.split(';')[0].slice(0, 14) + '…' : '✗ 无'}`);

  const health = await fetch(BASE + '/api/health', { headers: { ...H, cookie } });
  let hj = {}; try { hj = JSON.parse(await health.text()); } catch {}
  out.push(`② health ${health.status} build=${hj.build} ${/BiJx17_9/.test(String(hj.build)) ? '✅ BUILD 文件优先生效' : '⚠️'}`);

  const PW = (() => { try { return JSON.parse(fs.readFileSync('server/privacy.local.json', 'utf8')).secretPassword; } catch { return 'L0826'; } })();
  const g = async (p, ck = cookie) => { const r = await fetch(BASE + p, { headers: { ...H, cookie: ck } }); return { s: r.status, b: await r.text() }; };

  /* 门禁四级 */
  const dz = await g('/api/doc/' + encodeURIComponent('初中/素材/成长记录/赵问竹2021-2022开福区优秀学生干部.md'));
  const dp = await g('/api/doc/' + encodeURIComponent('私人资料/人物/刘佑林/刘佑林朋友圈148则完整转录与索引-2018至2024（私密）.md'));
  const dw = await g('/api/doc/' + encodeURIComponent('长篇创作/章节设计-第三卷-困境与重建.md'));
  const doo = await g('/api/doc/' + encodeURIComponent('00-知识库首页.md'));
  out.push(`③ doc 门禁: 绝密=${dz.s}${dz.s === 403 ? '✅' : '❌'} 私密=${dp.s}${dp.s === 404 ? '✅' : '❌'} 施工稿=${dw.s}${dw.s === 404 || dw.s === 403 ? '✅' : '❌'} 公开=${doo.s}${doo.s === 200 ? '✅' : '❌'}`);

  /* 列表出口 */
  for (const p of ['/api/graph', '/api/entities?limit=400', '/api/timeline', '/api/imagery', '/api/questionnaires', '/api/queue']) {
    const r = await g(p);
    const b = r.b;
    const privLeak = /私人资料|\/隐私\//.test(b);
    const qnLeak = p.includes('questionnaires') && /"respondent_label"\s*:\s*"(?!母亲|父亲|妈妈|爸爸)/.test(b);
    out.push(`④ ${p} → ${r.s}${privLeak ? ' ❌私密泄漏' : ''}${qnLeak ? ' ❌非父母卷泄漏' : ' ✅'}`);
  }

  /* 检索锁定档 */
  const z = await g('/api/search?q=' + encodeURIComponent('赵问竹'), cookie);
  const t = await z.text();
  let zj = null; try { zj = JSON.parse(t); } catch {}
  const items = Object.values(zj?.groups || {}).flat().filter(x => x && typeof x === 'object');
  const locked = items.filter(x => x.locked === true).length;
  const leaked = items.filter(x => (x.snippet || '').replace(/<[^>]+>/g, '').length > 60).length;
  out.push(`⑤ 检索绝密名: ${z.s} 条目=${items.length} 锁定档=${locked} 带长摘要=${leaked} ${leaked === 0 ? '✅ 零正文' : '❌'}`);

  /* 中文搜索 */
  const zh = [];
  for (const t of ['高中', '问卷作答全文', '刘弈帆']) { const r = await g('/api/search?q=' + encodeURIComponent(t), cookie); zh.push(`${t}=${r.status}`); }
  out.push('⑥ 中文搜索: ' + zh.join(' ') + (zh.every(x => x.endsWith('200')) ? ' ✅' : ' ⚠️'));

  /* PWA */
  const st = [];
  for (const p of ['/sw.js', '/offline.html', '/robots.txt', '/manifest.webmanifest', '/favicon.svg']) { const r = await fetch(BASE + p, { headers: H }); st.push(`${p}=${r.status}`); }
  out.push('⑦ 静态/PWA: ' + st.join(' ') + (st.every(x => x.endsWith('200')) ? ' ✅' : ' ⚠️'));

  /* 解锁 → 正文 → 锁定 */
  const u = await fetch(BASE + '/api/secret/unlock', { method: 'POST', headers: { 'content-type': 'application/json', ...H, cookie }, body: JSON.stringify({ password: PW }) });
  if (u.ok) {
    const c2 = u.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    const d = await g('/api/doc/' + encodeURIComponent('初中/素材/成长记录/赵问竹2021-2022开福区优秀学生干部.md'), cookie + '; ' + c2);
    out.push(`⑧ 解锁后取绝密: ${d.status}${d.status === 200 ? ' ✅' : ' ❌'}`);
    const lk = await fetch(BASE + '/api/secret/lock', { method: 'POST', headers: { ...H, cookie: cookie + '; ' + c2 } });
    const d2 = await g('/api/doc/' + encodeURIComponent('初中/素材/成长记录/赵问竹2021-2022开福区优秀学生干部.md'), cookie);
    out.push(`⑨ 手动锁定: ${lk.status}${lk.status === 200 ? ' ✅' : ''} | 锁定后取绝密: ${d2.status}${d2.status === 403 ? ' ✅ 已上锁' : ' ❌'}`);
  } else out.push(`⑧ 解锁: ${u.status} ${(await u.text()).slice(0, 50)}`);

  fs.writeFileSync('C:/Users/Lenovo/.workbuddy/tmp/s7-final.txt', out.join('\n'));
})().catch(e => fs.writeFileSync('C:/Users/Lenovo/.workbuddy/tmp/s7-final.txt', out.join('\n') + '\nERR ' + e.message));
