import fs from 'fs';
const B = 'http://127.0.0.1:8495';
const out = [];
(async () => {
  await new Promise(r => setTimeout(r, 2500));
  const lr = await fetch(B + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: 'mneme' }) });
  const cookie = lr.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  out.push('登录: ' + lr.status);
  const g = async (p) => { const r = await fetch(B + p, { headers: { cookie } }); return { s: r.status, b: await r.text() }; };

  /* 1. 中文搜索（含 ≥3 字，验证 FTS/LIKE 两路） */
  for (const q of ['高中', '问卷作答全文', '赵问竹', '刘弈帆', '私人资料']) {
    const r = await g('/api/search?q=' + encodeURIComponent(q));
    out.push(`搜索「${q}」→ ${r.s} len=${r.b.length}`);
  }
  /* 2. 绝密范围检查：搜索"赵问竹"是否含绝密文档路径 */
  const z = await g('/api/search?q=' + encodeURIComponent('赵问竹'));
  const secretHit = /赵问竹[^"]*\.md/.test(z.b);
  out.push('搜「赵问竹」含绝密文档路径: ' + (secretHit ? '❌ 泄漏' : '0 ✅'));
  /* 3. 绝密 doc 403 / 私密 404 / 公开 200 */
  const d1 = await g('/api/doc/' + encodeURIComponent('初中/素材/成长记录/赵问竹2021-2022开福区优秀学生干部.md'));
  const d2 = await g('/api/doc/' + encodeURIComponent('私人资料/人物/刘佑林/刘佑林朋友圈148则完整转录与索引-2018至2024（私密）.md'));
  const d3 = await g('/api/doc/' + encodeURIComponent('00-知识库首页.md'));
  out.push(`doc 绝密=${d1.s}${d1.s === 403 ? ' ✅' : ' ❌'} 私密=${d2.s}${d2.s === 404 ? ' ✅' : ' ❌'} 公开=${d3.s}${d3.s === 200 ? ' ✅' : ' ❌'}`);
  /* 4. 解锁 → 绝密可取 */
  const pw = JSON.parse(fs.readFileSync('server/privacy.local.json', 'utf8')).secretPassword;
  const u = await fetch(B + '/api/secret/unlock', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ password: pw }) });
  const ubody = await u.text();
  out.push('解锁: ' + u.status + ' ' + ubody.slice(0, 40));
  if (u.ok) {
    const c2 = u.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    const merged = cookie + '; ' + c2;
    const d4 = await fetch(B + '/api/doc/' + encodeURIComponent('初中/素材/成长记录/赵问竹2021-2022开福区优秀学生干部.md'), { headers: { cookie: merged } });
    out.push('解锁后取绝密: ' + d4.status + (d4.status === 200 ? ' ✅' : ' ❌'));
  }
  /* 5. 其他出口抽检（graph / entities / timeline / imagery / questionnaires / volumes） */
  for (const p of ['/api/graph', '/api/entities?limit=400', '/api/timeline', '/api/imagery', '/api/questionnaires', '/api/volumes', '/api/volumes/V2', '/api/volumes/V3']) {
    const r = await g(p);
    const leak = /赵问竹|私人资料/.test(r.b) && !p.includes('V');
    out.push(`出口 ${p} → ${r.s}${leak ? ' ⚠️含敏感串' : ''}`);
  }
  /* 6. PWA 与静态资源 */
  for (const p of ['/sw.js', '/offline.html', '/robots.txt', '/manifest.webmanifest', '/favicon.svg']) {
    const r = await fetch(B + p);
    out.push(`静态 ${p} → ${r.status}${r.status === 200 ? ' ✅' : ' ❌'}`);
  }
  fs.writeFileSync('C:/Users/Lenovo/.workbuddy/tmp/g5-result.txt', out.join('\n'));
})().catch(e => fs.writeFileSync('C:/Users/Lenovo/.workbuddy/tmp/g5-result.txt', out.join('\n') + '\nERR ' + e.message));
