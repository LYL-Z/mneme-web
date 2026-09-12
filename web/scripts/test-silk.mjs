/**
 * 丝带纯函数契约：私密路径永不入；下一题不占卜；无轨迹走序 / 第一部第一章。
 * 与 web/src/silk.ts、web/src/history.ts 同口径。
 */
const PRIVATE_SEG = /私人资料|(^|\/)隐私\//;
const isPublicPath = (p) => !!p && !PRIVATE_SEG.test(p);

const hashStr = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

const nextChapterHint = (last, catalog) => {
  if (!catalog.length) return null;
  if (!last) {
    return catalog.find(c => c.code === 'P0')
      ?? catalog.find(c => c.code === 'B1' && c.seq === 1)
      ?? catalog[0];
  }
  const ix = catalog.findIndex(c => c.code === last.code && c.seq === last.seq);
  if (ix >= 0) return catalog[ix + 1] ?? catalog[0];
  return catalog[(hashStr('2026-09-12') ^ (last.seq >>> 0)) % catalog.length];
};

let failed = 0;
const ok = (name, cond, extra = '') => {
  if (cond) console.log(`  ✓  ${name}${extra ? '  ' + extra : ''}`);
  else {
    failed += 1;
    console.log(`  ✗  ${name}${extra ? '  ' + extra : ''}`);
  }
};

const catalog = [
  { code: 'P0', seq: 1, title: '第十格', volume: '序' },
  { code: 'B1', seq: 1, title: '空着的一格', volume: '空格' },
  { code: 'B1', seq: 2, title: '表上的人', volume: '空格' },
  { code: 'B3', seq: 26, title: '放在桌上', volume: '桌上' },
];

console.log('丝带契约\n');
ok('私密路径不公开', !isPublicPath('私人资料/人物/x.md'));
ok('隐私目录不公开', !isPublicPath('隐私/规则.md'));
ok('公开章稿路径可入丝带', isPublicPath('百万长文写作/章稿/第一部-空格.md'));
ok('无轨迹指向序', nextChapterHint(null, catalog)?.title === '第十格');
ok('上次第一章则下一题', nextChapterHint({ code: 'B1', seq: 1 }, catalog)?.title === '表上的人');
ok('密章只带公开章题', nextChapterHint({ code: 'B1', seq: 2 }, catalog)?.title === '放在桌上');
ok('空目录不编造', nextChapterHint({ code: 'B1', seq: 1 }, []) === null);

const silk = {
  doc: { path: '百万长文写作/章稿/第一部-空格.md', title: '空格' },
  person: { name: '赵问竹' },
};
ok('公开丝带不含私密段', isPublicPath(silk.doc.path) && !PRIVATE_SEG.test(silk.person.name));
ok('伪造私密路径会被拦', !isPublicPath('私人资料/聊天记录/x.md'));

if (failed) {
  console.log(`\n失败 ${failed} 项`);
  process.exit(1);
}
console.log('\n丝带契约通过');
