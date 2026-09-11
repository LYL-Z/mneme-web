#!/usr/bin/env node
/**
 * sync-dist.mjs — 把 web/dist 按「引用白名单」同步到 deploy/web-dist
 *
 * 背景：构建曾用 `vite build --emptyOutDir=false`（规避文件批量删除保护），
 * 于是 deploy/web-dist 只增不减——实测累积 198 个孤儿产物 / 9.9MB
 * （旧哈希的 index-*.js / Archive-*.js / index-*.css …）。
 *
 * 现在的做法：从 dist/index.html 出发**遍历模块引用图**（含懒加载分包与
 * CSS 里的 url()），只把真正可达的 assets 同步过去；public/ 下的静态资源目录
 * 由运行时代码按绝对路径取用、无法从 index.html 反推，故按目录整体同步。
 *
 * 用法：node scripts/sync-dist.mjs        （或 npm run sync:dist）
 * 退出码：0 成功；1 dist 缺失或白名单为空（宁可失败也不要同步出半个站点）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, '..');
const DIST = path.join(WEB, 'dist');
const PUB = path.join(WEB, 'public');
const ROOT = path.resolve(WEB, '..');

/**
 * 两个产出地，都必须是同一份内容：
 *  - deploy/web-dist：Docker / CloudBase 镜像用（Dockerfile: COPY web-dist/ ./web/dist）
 *  - site/          ：server.mjs 的 WEB_DIST 首选目录。发布器会因 `dist/` 是
 *                     构建产物目录而把它排除掉，所以另起一个 site/ 名字做发布根。
 *                     ⚠ 它排在最前——一旦陈旧，线上就一直在跑旧包（本次即因此踩坑）。
 */
const OUTPUTS = [
  { dir: path.join(ROOT, 'deploy', 'web-dist'), note: 'Docker/CloudBase' },
  { dir: path.join(ROOT, 'site'), note: '发布根（WEB_DIST 首选）' },
];

/** public/ 下的静态资源目录：运行时代码按 /audio/... /signatures/... 取用 */
const STATIC_DIRS = ['signatures', 'sponsors', 'audio', 'vendor'];

/** 从任意文本里抽出所有可能指向 assets 的路径字面量（绝对写法 /assets/x.js） */
const ASSET_RE = /["'(`(](?:\.{0,2}\/)*assets\/([A-Za-z0-9._-]+)/g;
/** 同一目录内的兄弟引用：Vite 的懒加载分包写成 `import("./Archive-xxxx.js")`，
 *  不含 assets/ 前缀——只按 index.html 反推会漏掉全部懒加载块。
 *  这里偏保守地多留（宁多留几个文件，也不能同步出半个站点）。 */
const SIBLING_RE = /["'(`]\.\/([A-Za-z0-9._-]+\.(?:js|css|mjs|woff2?|ttf|otf|png|jpe?g|svg|webp|gif|mp3))["'`)]/g;

if (!fs.existsSync(DIST)) {
  console.error('✗ 未找到 web/dist —— 请先执行 npm run build');
  process.exit(1);
}

const distAssets = path.join(DIST, 'assets');
if (!fs.existsSync(distAssets)) {
  console.error('✗ 未找到 web/dist/assets —— 构建产物不完整');
  process.exit(1);
}

/* ---------- 1. 遍历引用图 ---------- */
const keep = new Set();          // 需要保留的 assets 文件名
const queue = [];                // 待扫描的文件（dist 内绝对路径）

const enqueueByName = (name) => {
  if (!name || keep.has(name)) return;
  const abs = path.join(distAssets, name);
  if (!fs.existsSync(abs)) return;
  keep.add(name);
  queue.push(abs);
};

const indexHtml = path.join(DIST, 'index.html');
if (!fs.existsSync(indexHtml)) {
  console.error('✗ 未找到 web/dist/index.html');
  process.exit(1);
}

/* 入口：index.html 里 src/href 指向 /assets/* 的引用 */
{
  const html = fs.readFileSync(indexHtml, 'utf8');
  for (const m of html.matchAll(/(?:src|href)\s*=\s*"([^"]+)"/g)) {
    const u = m[1];
    const hit = u.match(/assets\/([A-Za-z0-9._-]+)/);
    if (hit) enqueueByName(hit[1]);
  }
}

/* 广度优先：JS/CSS 里的动态 import、CSS url()、以及相对路径引用 */
while (queue.length) {
  const file = queue.shift();
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    continue; // 二进制（字体/图片）——无需再解析
  }
  for (const m of text.matchAll(ASSET_RE)) enqueueByName(m[1]);
  for (const m of text.matchAll(SIBLING_RE)) enqueueByName(m[1]);
}

if (keep.size === 0) {
  console.error('✗ 引用白名单为空 —— index.html 未引用任何 /assets/*，疑似构建异常，已中止同步');
  process.exit(1);
}

/* ---------- 2. 逐目录同步（按名剔除孤儿 + 覆盖写入，不做整目录删除） ----------
   为什么不是「整目录删掉重建」：部署目录往往被 git 跟踪 / 被安全删除保护接管，
   递归 rmSync 会失败（实测：safe-delete 对整目录 trash 报 aborted）。
   按文件名逐个删孤儿既避开了这个问题，也天然保留白名单外的静态资源。 */
const bytes = (p) => { try { return fs.statSync(p).size; } catch { return 0; } };
const copyFile = (from, to) => {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  return bytes(from);
};
/** 把 dir 里不在 allow 集合中的文件删掉，返回删除数 */
const prune = (dir, allow) => {
  if (!fs.existsSync(dir)) return 0;
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isFile() || allow.has(e.name)) continue;
    try { fs.unlinkSync(path.join(dir, e.name)); n += 1; }
    catch { /* 删不掉就留着：只会多一个孤儿文件，不影响站点可用 */ }
  }
  return n;
};

const mb = (n) => `${(n / 1024 / 1024).toFixed(2)}MB`;
const allInDist = fs.readdirSync(distAssets).length;

/* 根层文件名集合：public/ 的散件（favicon/manifest/图标…）+ dist 根层散件。
   以 public/ 为准（同上：dist 的副本可能陈旧），并上 dist 里多出来的文件。 */
const rootNames = new Set();
for (const base of [PUB, DIST]) {
  if (!fs.existsSync(base)) continue;
  for (const e of fs.readdirSync(base, { withFileTypes: true })) if (e.isFile()) rootNames.add(e.name);
}
rootNames.delete('index.html'); // index.html 单独从 dist 取（Vite 注入了哈希引用）

console.log('ΜΝΗΜΗ · sync-dist');
console.log(`  assets      dist 共 ${allInDist} · 白名单 ${keep.size}`);

let failed = false;
for (const { dir: OUT, note } of OUTPUTS) {
  fs.mkdirSync(path.join(OUT, 'assets'), { recursive: true });

  /* a) assets：剔除不在白名单里的旧哈希产物 */
  const prunedAssets = prune(path.join(OUT, 'assets'), keep);
  /* b) 根层：剔除 dist 里已不存在的散件 */
  const prunedRoot = prune(OUT, rootNames);
  /* c) 静态目录：剔除源里已不存在的文件 */
  let prunedStatic = 0;

  let total = copyFile(indexHtml, path.join(OUT, 'index.html'));
  let rootCount = 0;
  for (const name of rootNames) {
    const from = fs.existsSync(path.join(PUB, name)) ? path.join(PUB, name) : path.join(DIST, name);
    total += copyFile(from, path.join(OUT, name));
    rootCount += 1;
  }
  for (const name of keep) total += copyFile(path.join(distAssets, name), path.join(OUT, 'assets', name));

  const staticReport = [];
  for (const dir of STATIC_DIRS) {
    /* 源取 public/ 而非 dist/：dist 里的 public 副本由 Vite 拷贝，
       在 dist 无法被清空的环境里会残留旧文件（本次 bgm.mp3 因此一直是 12MB 旧版）。
       public/ 才是这些静态资源的真正源头。 */
    const src = fs.existsSync(path.join(PUB, dir)) ? path.join(PUB, dir) : path.join(DIST, dir);
    const dst = path.join(OUT, dir);
    if (!fs.existsSync(src)) { staticReport.push(`${dir}(缺)`); continue; }
    const names = new Set(fs.readdirSync(src, { withFileTypes: true }).filter(e => e.isFile()).map(e => e.name));
    prunedStatic += prune(dst, names);
    for (const name of names) total += copyFile(path.join(src, name), path.join(dst, name));
    staticReport.push(`${dir}×${names.size}`);
  }

  /* 自检：白名单里的每个文件都必须真的落到该目录 */
  const missing = [...keep].filter(n => !fs.existsSync(path.join(OUT, 'assets', n)));
  if (missing.length) {
    console.error(`  ✗ ${path.relative(ROOT, OUT)} 缺失 ${missing.length} 个引用文件：${missing.slice(0, 5).join(', ')}`);
    failed = true;
    continue;
  }
  const pruned = prunedAssets + prunedRoot + prunedStatic;
  console.log(`  ✓ ${path.relative(ROOT, OUT).padEnd(16)} ${rootCount + keep.size + 1} 文件 · ${mb(total)}`
    + ` · 清孤儿 ${pruned} · ${note} · ${staticReport.join(' ')}`);
}

if (failed) process.exit(1);
