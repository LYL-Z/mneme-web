import fs from 'fs';
const BASE = process.argv[2] || 'https://mneme-biography-47924.app.workbuddy.host';
const PW = (() => { try { return JSON.parse(fs.readFileSync('server/privacy.local.json', 'utf8')).secretPassword; } catch { return 'L0826'; } })();
const out = [];
(async () => {
  const g = async (p, cookie = '', raw = false) => {
    const r = await fetch(BASE + p, { headers: cookie ? { cookie } : {}, redirect: 'manual' });
    let b = ''; try { b = await r.text(); } catch {}
    return { s: r.status, b, h: r.headers, raw };
  };
  /* 登录 */
  const lr = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: 'mneme' }) });
  const cookie = lr.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  out.push('① 登录: ' + lr.status + (cookie ? ' ✓' : ' ✗无cookie'));

  /* health / build */
  const h = await g('/api/health');
  let hj = {}; try { hj = JSON.parse(h.b); } catch {}
  out.push(`② health ${h.s} build=${hj.build} ${String(hj.build).includes('grok46') ? '✅' : '⚠️'}`);

  /* 隐私出口（未解锁） */
  const checks = [
    ['/api/graph', /赵问竹|私人资料/],
    ['/api/entities?limit=400', /私人资料|\/隐私\//],
    ['/api/timeline', /V2\/|V3\//],
    ['/api/questionnaires', /respondent_label/],
    ['/api/search?q=' + encodeURIComponent('zwz'), /赵问竹/],
    ['/api/search?q=' + encodeURIComponent('赵问竹'), /赵问竹[^"]*\.md/],
  ];
  for (const [p, re] of checks) {
    const r = await g(p, cookie);
    const leak = re.test(r.b);
    out.push(`③ ${decodeURIComponent(p)} → ${r.s} ${leak ? '❌ 含敏感 ' : '0 ✅'}`);
  }
  /* respondent_label 是否仅父母卷 */
  const q = await g('/api/questionnaires', cookie);
  const labels = [...q.b.matchAll(/"respondent_label"\s*:\s*"([^"]+)"/g)].map(m => m[1]);
  const nonParent = labels.filter(l => !['母亲', '父亲', '妈妈', '爸爸'].includes(l));
  out.push(`④ questionnaires labels=[${labels.join('/')}] ${nonParent.length ? '❌非父母卷:' + nonParent.join(',') : '✅均为父母卷'}`);

  /* doc 三级 */
  const dz = await g('/api/doc/' + encodeURIComponent('初中/素材/成长记录/赵问竹2021-2022开福区优秀学生干部.md'), cookie);
  const dp = await g('/api/doc/' + encodeURIComponent('私人资料/人物/刘佑林/刘佑林朋友圈148则完整转录与索引-2018至2024（私密）.md'), cookie);
  const doo = await g('/api/doc/' + encodeURIComponent('00-知识库首页.md'), cookie);
  out.push(`⑤ doc 绝密=${dz.s}${dz.s === 403 ? '✅' : '❌'} 私密=${dp.s}${dp.s === 404 ? '✅' : '❌'} 公开=${doo.s}${doo.s === 200 ? '✅' : '❌'}`);

  /* volumes V2/V3 */
  const v2 = await g('/api/volumes/V2', cookie);
  const v3 = await g('/api/volumes/V3', cookie);
  out.push(`⑥ volumes V2=${v2.s}${v2.s === 403 ? '✅' : '❌'} V3=${v3.s}${v3.s === 403 ? '✅' : '❌'}`);

  /* 中文搜索稳定性 */
  const zh = [];
  for (const t of ['高中', '问卷作答全文', '刘弈帆', '私人资料']) {
    const r = await g('/api/search?q=' + encodeURIComponent(t), cookie);
    zh.push(`${t}=${r.s}`);
  }
  out.push('⑦ 中文搜索: ' + zh.join(' ') + (zh.every(x => x.endsWith('200')) ? ' ✅' : ' ⚠️'));

  /* PWA / 静态 */
  const st = [];
  for (const p of ['/sw.js', '/offline.html', '/robots.txt', '/manifest.webmanifest', '/favicon.svg', '/icon-512.png']) {
    const r = await fetch(BASE + p);
    st.push(`${p}=${r.status}`);
  }
  out.push('⑧ 静态/PWA: ' + st.join(' ') + (st.every(x => x.endsWith('200')) ? ' ✅' : ' ⚠️'));

  /* 头 */
  const csp = h.h.get('content-security-policy') || '';
  out.push(`⑨ 头: CSP=${csp ? '✅' : '❌'} | sw.js cache-control=${(await fetch(BASE + '/sw.js')).headers.get('cache-control') || '-'}`);

  /* 解锁链路 */
  const pw = PW;
  const u = await fetch(BASE + '/api/secret/unlock', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ password: pw }) });
  if (u.ok) {
    const c2 = u.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    const d4 = await fetch(BASE + '/api/doc/' + encodeURIComponent('初中/素材/成长记录/赵问竹2021-2022开福区优秀学生干部.md'), { headers: { cookie: cookie + '; ' + c2 } });
    out.push(`⑩ 解锁后取绝密: ${d4.status}${d4.status === 200 ? ' ✅' : ' ❌'}`);
  } else {
    out.push(`⑩ 解锁: ${u.s} ${(await u.text()).slice(0, 60)}`);
  }

  fs.writeFileSync('C:/Users/Lenovo/.workbuddy/tmp/g6-prod.txt', out.join('\n'));
  function 读密码() { try { return JSON.parse(fs.readFileSync('server/privacy.local.json', 'utf8')).secretPassword; } catch { return 'L0826'; } }
})().catch(e => fs.writeFileSync('C:/Users/Lenovo/.workbuddy/tmp/g6-prod.txt', out.join('\n') + '\nERR ' + e.message));
