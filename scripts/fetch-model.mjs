#!/usr/bin/env node
/**
 * ΜΝΗΜΗ · fetch-model.mjs —— 把本地模型「运行时 + 权重」准备到 web/public/models/
 *
 * 为什么需要这一步：站点 CSP 是 `default-src 'self'`，**运行期不能从 CDN 拉模型**。
 * 所以必须在**准备阶段**（本机、有网）把文件落到同源目录，再由站点静态发布。
 *
 * 两条运行时路线（实测结论见 web/public/models/STATUS.md）：
 *   · onnx（**推荐/默认**）：transformers.js + ONNX。运行时全部可下载，无需任何编译工具链。
 *   · gguf：wllama + GGUF。⚠️ `@wllama/wllama` npm 包**只发布源码、不含 dist**，
 *     jsDelivr/unpkg 也 404 —— 必须自行用 Emscripten 编译，故本脚本只做「检查与提示」。
 *
 * 用法：
 *   node scripts/fetch-model.mjs --probe                 # 只拉取小体积运行时并校验（约 7MB，快速）
 *   node scripts/fetch-model.mjs                          # 默认 onnx + small 档（约 470MB）
 *   node scripts/fetch-model.mjs --tier medium            # 1.5B（约 1GB）
 *   node scripts/fetch-model.mjs --runtime gguf           # 检查 GGUF 路线前置条件
 *   node scripts/fetch-model.mjs --list
 *
 * 产出（onnx 路线）：
 *   web/public/models/vendor/transformers.min.js
 *   web/public/models/vendor/ort-wasm-simd-threaded.jsep.{mjs,wasm}   ← WebGPU
 *   web/public/models/vendor/ort-wasm-simd-threaded.{mjs,wasm}        ← CPU 回退
 *   web/public/models/runtime.js            ← 适配器：导出 createEngine(spec)
 *   web/public/models/<repo>/…              ← 模型与分词器（保持 HF 仓库目录结构）
 *   web/public/models/registry.json         ← 清单（含**实测**体积），供调度器读取
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, '..', 'web');
const OUT = path.join(WEB, 'public', 'models');
const VENDOR = path.join(OUT, 'vendor');

const HF = 'https://hf-mirror.com';
const TRANSFORMERS_VER = '3.0.2';
const CDN = `https://cdn.jsdelivr.net/npm/@huggingface/transformers@${TRANSFORMERS_VER}/dist`;

/** 运行时要同源落地的文件 —— 依据**实际包清单**核定，不猜文件名。
 *  实测（@huggingface/transformers@3.0.2，dist 下只有这一个 wasm）：
 *    · transformers.min.js                0.71MB  （加载器）
 *    · ort-wasm-simd-threaded.jsep.wasm   20.64MB （jsep 版：WebGPU 优先，无 WebGPU 时回退 CPU SIMD）
 *  注意：dist 下**没有**非 jsep 的 CPU 版 wasm，也没有 .mjs 加载器（v3 已内联）。
 *  若未来升级版本，请用 jsDelivr 文件清单核对：https://data.jsdelivr.com/v1/packages/npm/@huggingface/transformers@<ver>?structure=flat */
const RUNTIME_FILES = [
  'transformers.min.js',
  'ort-wasm-simd-threaded.jsep.wasm',
];

const TIERS = {
  small: {
    runtime: 'onnx',
    id: 'qwen2.5-0.5b-instruct-onnx-q4f16',
    name: '本机 · Qwen2.5 0.5B（ONNX q4f16）',
    repo: 'onnx-community/Qwen2.5-0.5B-Instruct',
    dir: 'qwen2.5-0.5b-instruct-onnx',
    dtype: 'q4f16',
    params: 0.5, quantization: 'q4f16',
    minMemoryGB: 2, contextWindow: 2048, maxOutputTokens: 320, qualityScore: 52,
    preferDtype: ['model_q4f16.onnx', 'model_quantized.onnx', 'model_int8.onnx'],
  },
  medium: {
    runtime: 'onnx',
    id: 'qwen2.5-1.5b-instruct-onnx-q4f16',
    name: '本机 · Qwen2.5 1.5B（ONNX q4f16）',
    repo: 'onnx-community/Qwen2.5-1.5B-Instruct',
    dir: 'qwen2.5-1.5b-instruct-onnx',
    dtype: 'q4f16',
    params: 1.5, quantization: 'q4f16',
    minMemoryGB: 4, contextWindow: 4096, maxOutputTokens: 480, qualityScore: 68,
    preferDtype: ['model_q4f16.onnx', 'model_quantized.onnx', 'model_int8.onnx'],
  },
  large: {
    runtime: 'onnx',
    id: 'qwen2.5-3b-instruct-onnx-q4f16',
    name: '本机 · Qwen2.5 3B（ONNX q4f16）',
    repo: 'onnx-community/Qwen2.5-3B-Instruct',
    dir: 'qwen2.5-3b-instruct-onnx',
    dtype: 'q4f16',
    params: 3, quantization: 'q4f16',
    minMemoryGB: 8, contextWindow: 8192, maxOutputTokens: 640, qualityScore: 78,
    preferDtype: ['model_q4f16.onnx', 'model_quantized.onnx', 'model_int8.onnx'],
  },
};

const log = (...a) => console.log('  ', ...a);
const mb = (n) => `${(n / 1048576).toFixed(1)}MB`;

async function download(urls, dest, label, { optional = false } = {}) {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 512) {
    log(`· ${label} 已存在，跳过（${mb(fs.statSync(dest).size)}）`);
    return fs.statSync(dest).size;
  }
  let lastErr = null;
  for (const url of [].concat(urls)) {
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const tmp = dest + '.part';
      const fh = fs.openSync(tmp, 'w');
      let got = 0, last = 0;
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        fs.writeSync(fh, Buffer.from(value));
        got += value.length;
        if (Date.now() - last > 3000) { last = Date.now(); process.stdout.write(`\r     ${mb(got)}`); }
      }
      fs.closeSync(fh);
      process.stdout.write('\r' + ' '.repeat(26) + '\r');
      fs.renameSync(tmp, dest);
      log(`✓ ${label} ${mb(got)}`);
      return got;
    } catch (e) { lastErr = e; }
  }
  if (optional) { log(`· ${label} 不可用（可跳过）：${lastErr?.message}`); return 0; }
  throw new Error(`${label} 下载失败：${lastErr?.message}`);
}

/* ---------- ONNX 路线 ---------- */
const hfTree = (repo) => fetch(`${HF}/api/models/${repo}/tree/main?recursive=true`, { redirect: 'follow' })
  .then(r => (r.ok ? r.json() : Promise.reject(new Error(`tree HTTP ${r.status}`))));

async function fetchRuntimeOnnx() {
  let ok = 0;
  for (const f of RUNTIME_FILES) {
    const dest = path.join(VENDOR, f);
    const got = await download([`${CDN}/${f}`, `https://unpkg.com/@huggingface/transformers@${TRANSFORMERS_VER}/dist/${f}`],
      dest, `vendor/${f}`, { optional: f.includes('.mjs') });
    if (got || fs.existsSync(dest)) ok++;
  }
  if (!fs.existsSync(path.join(VENDOR, 'transformers.min.js'))) throw new Error('transformers 运行时缺失，无法继续');
  log(`✓ 运行时就绪：vendor/ 共 ${ok} 个文件`);
}

async function fetchModelOnnx(spec) {
  const tree = await hfTree(spec.repo);
  const all = tree.filter(f => f.type === 'file');
  /* 需要的 ONNX 权重：按 preferDtype 优先序挑第一个存在的 */
  const onnxFiles = all.filter(f => /^onnx\/[^/]+\.onnx$/.test(f.path));
  const chosen = spec.preferDtype
    .map(n => onnxFiles.find(f => f.path === `onnx/${n}`))
    .find(Boolean);
  if (!chosen) throw new Error(`未在 ${spec.repo} 找到可用的 onnx 权重（现有：${onnxFiles.map(f => f.path).join(', ') || '无'}）`);
  /* 需要的配置文件：分词器/生成配置等小文件（跳过不需要的 onnx 变体与图片） */
  const keep = all.filter(f => !f.path.startsWith('onnx/')
    && !/\.(png|jpg|jpeg|gif|md|onnx_data)$/i.test(f.path)
    && !/^(\.gitattributes|README)/i.test(f.path));

  log(`仓库 ${spec.repo}：权重 ${chosen.path}（${mb(chosen.size)}）+ 配置 ${keep.length} 个`);
  let total = 0;
  for (const f of [chosen, ...keep]) {
    const dest = path.join(OUT, spec.dir, f.path.split('/').join(path.sep));
    total += await download([`${HF}/${spec.repo}/resolve/main/${f.path}`], dest, `${spec.dir}/${f.path}`);
  }
  return { total, weightsPath: `/${path.posix.join('models', spec.dir, chosen.path)}`, chosen: chosen.path };
}

function writeAdapterOnnx() {
  const p = path.join(OUT, 'runtime.js');
  fs.writeFileSync(p, `/**
 * ΜΝΗΜΗ · 本地模型运行时适配器（transformers.js / ONNX）
 * 由 scripts/fetch-model.mjs 生成，可手动修改。
 *
 * 契约：导出 createEngine(spec, onProgress)
 *   → { name, generate(systemPrompt, messages, onDelta) }
 *   onProgress 把「权重下载进度 / 初始化阶段」回传给界面——**点开对话即开始加载**。
 *
 * 约束：只做生成；**不碰访问控制**——授权语料由服务端按解锁状态过滤后下发，
 *       未授权片段根本不会到达这里，因此本地推理不可能绕过门禁。
 * 全部资源同源（CSP default-src 'self'）：allowRemoteModels=false，禁止任何外部拉取。
 */
const VENDOR = '/models/vendor/';
const DIR = '/models/';

let libPromise = null;
async function lib() {
  if (!libPromise) {
    libPromise = (async () => {
      let mod;
      try {
        mod = await import(/* @vite-ignore */ VENDOR + 'transformers.min.js');
      } catch (e) {
        throw new Error('加载 transformers 运行时失败：' + (e && e.message ? e.message : e) + '（检查 /models/vendor/transformers.min.js 是否存在且为 ESM 构建）');
      }
      if (!mod || !mod.env) {
        throw new Error('transformers 运行时未导出 env——文件很可能不是 ESM 构建版');
      }
      const env = mod.env;
      env.allowRemoteModels = false;          // 禁止任何外部拉取（CSP + 隐私）
      env.allowLocalModels = true;
      env.localModelPath = DIR;               // 权重与分词器都在 /models/ 下
      env.useBrowserCache = true;             // 权重进 CacheStorage，二次进入不再下载
      try {
        env.backends.onnx.wasm.wasmPaths = VENDOR;
        env.backends.onnx.wasm.proxy = false; // 主线程内跑，避免 worker 路径再 404
      } catch { /* 结构变化时忽略 */ }
      return mod;
    })();
  }
  return libPromise;
}

/** 把 transformers.js 的进度回调归一化成 LoadProgress */
function toProgress(cb) {
  return (data) => {
    if (!cb || !data) return;
    if (data.status === 'progress' || data.status === 'download') {
      cb({ phase: 'download',
        pct: typeof data.progress === 'number' ? Math.max(0, Math.min(100, data.progress)) : null,
        file: data.file, loaded: data.loaded, total: data.total });
    } else if (data.status === 'done') {
      cb({ phase: 'download', pct: 100, file: data.file });
    } else if (data.status === 'ready' || data.status === 'initiate') {
      cb({ phase: 'init', pct: null, file: data.file, message: data.status === 'ready' ? '权重就绪' : '开始取权重' });
    }
  };
}

export async function createEngine(spec, onProgress) {
  const { pipeline } = await lib();
  const prog = toProgress(onProgress);
  const dir = spec.dir || '';

  /* 多策略：WebGPU（若可用）→ CPU；每种再按 dtype 降级。
     **每一次失败都记下原因**，全败时把明细抛给界面——
     之前静默回退，只能看到"未就绪"，根本无法定位。 */
  const devices = [];
  if (typeof navigator !== 'undefined' && navigator.gpu) devices.push('webgpu');
  devices.push('wasm');
  /* dtype 链**只用真实存在的变体**（registry.dtypes）。
     瞎试不存在的变体（如只下了 q4f16 却去试 q4）→ 服务端 404 后被 SPA 兜底喂回
     index.html → ORT 拿 HTML 解析 protobuf → "protobuf parsing failed"。 */
  const dtypes = Array.isArray(spec.dtypes) && spec.dtypes.length
    ? spec.dtypes.slice()
    : [spec.dtype || 'q4f16'];

  const tried = [];
  for (const device of devices) {
    for (const dtype of dtypes) {
      try {
        onProgress?.({ phase: 'init', pct: null, message: '初始化 ' + device + ' / ' + dtype + '…' });
        /* n_ctx：**输入+输出绝不能超窗**——超窗正是"胡言乱语"的根源（KV 溢出 → 词表乱采样）。
           手机给 2048 省内存，桌面/平板给 4096（Qwen2.5 支持，桌面内存充足）。 */
        const shell = (typeof document !== 'undefined' && document.documentElement.dataset.shell) || 'desktop';
        const nCtx = shell === 'phone' ? 2048 : 4096;
        const gen = await pipeline('text-generation', dir, {
          dtype, device, progress_callback: prog,
          n_ctx: nCtx,
          n_threads: Math.max(2, Math.min(8, (navigator.hardwareConcurrency || 8) - 1)),
        });

        /* token 计数：用模型**自带分词器**精确统计（不是按字符数估算） */
        const countTokens = (s) => {
          try {
            const e = gen.tokenizer(s);
            const ids = e && e.input_ids;
            if (ids && ids.dims && ids.dims.length) return ids.dims[ids.dims.length - 1];
            if (ids && ids.length) return ids.length;
          } catch { /* 无所谓，返回 0 即可 */ }
          return 0;
        };

        const extract = (out) => {
          const t = out && out[0] && out[0].generated_text;
          if (Array.isArray(t)) return String((t[t.length - 1] && t[t.length - 1].content) || '');
          return String(t ?? '');
        };

        return {
          name: spec.name + '（' + device + ' / ' + dtype + '）',
          tokenize: (s) => countTokens(String(s || '')),
          async generate(systemPrompt, messages, onDelta, onUsage) {
            /* 硬预算：**输入 + 输出绝不能超 n_ctx**——超窗 = KV 溢出 = 词表乱采样，
               这正是"胡言乱语"的根源。超出时从 systemPrompt **中部**裁剪
               （保住开头的人物设定与结尾的边界说明），并把输出上限动态压下来。 */
            const nCtx = spec.n_ctx || 4096;
            const join = (s) => s + '\\n' + messages.map(m => m.content).join('\\n');
            let sys = String(systemPrompt || '');
            let inTokens = countTokens(join(sys));
            let maxNew = Math.min(spec.maxOutputTokens || 320, Math.max(48, nCtx - inTokens - 48));
            let cutNote = '';
            for (let guard = 0; guard < 12 && inTokens + maxNew + 48 > nCtx && sys.length > 600; guard++) {
              const cut = Math.min(600, sys.length - 600);
              const mid = Math.floor(sys.length / 2);
              sys = sys.slice(0, mid - cut / 2) + '\\n…（语料已按上下文预算裁剪）…\\n' + sys.slice(mid + cut / 2);
              inTokens = countTokens(join(sys));
              maxNew = Math.min(spec.maxOutputTokens || 320, Math.max(48, nCtx - inTokens - 48));
              cutNote = '（语料已按窗口预算裁剪）';
            }
            onProgress?.({ phase: 'init', pct: null, message: '输入 ' + inTokens + ' tok · 输出上限 ' + maxNew + ' tok' + cutNote });

            const payload = () => [{ role: 'system', content: sys }, ...messages];
            let outTokens = 0;
            const t0 = (self.performance || performance).now();
            const opts = {
              max_new_tokens: maxNew,
              temperature: 0.7, top_p: 0.9, top_k: 40, do_sample: true, repetition_penalty: 1.15,
              streamer: new ((await lib()).TextStreamer)(gen.tokenizer, {
                skip_prompt: true, skip_special_tokens: true,
                callback_function: (t) => { if (onDelta && t) onDelta(t); },
                token_callback_function: () => { outTokens += 1; },
              }),
            };
            const out = await gen(payload(), opts);
            const ms = (self.performance || performance).now() - t0;
            onUsage?.({ inTokens, outTokens: outTokens || countTokens(extract(out)), ms });
            return extract(out);
          },
        };
      } catch (e) {
        tried.push(device + '/' + dtype + ' → ' + (e && e.message ? e.message : String(e)));
      }
    }
  }
  throw new Error('所有后端均加载失败：' + tried.join(' ｜ '));
}
`);
  log(`✓ 适配器 → ${path.relative(process.cwd(), p)}`);
}

function writeRegistry(spec, sizeBytes, backend) {
  const p = path.join(OUT, 'registry.json');
  let models = [];
  try { models = JSON.parse(fs.readFileSync(p, 'utf8')).models || []; } catch { /* 首次 */ }
  const entry = {
    id: spec.id, name: spec.name,
    path: spec.path, runtime: '/models/runtime.js',
    dir: spec.dir,
    backend,
    /** **只列真实下载到的 dtype**——适配器的降级链据此构建，
        绝不能瞎试：请求不存在的变体会被 SPA 兜底喂回 index.html，
        ORT 拿 HTML 解析 protobuf → "protobuf parsing failed"。 */
    dtypes: [spec.quantization],
    sizeBytes, params: spec.params, quantization: spec.quantization,
    minMemoryGB: spec.minMemoryGB, contextWindow: spec.contextWindow,
    maxOutputTokens: spec.maxOutputTokens, qualityScore: spec.qualityScore,
    languages: ['zh', 'en'],
  };
  const byId = new Map(models.filter(m => m.id !== spec.id).map(m => [m.id, m]));
  byId.set(spec.id, entry);
  fs.writeFileSync(p, JSON.stringify({ generatedAt: new Date().toISOString(), models: [...byId.values()] }, null, 2) + '\n');
  log(`✓ 清单 → registry.json（${byId.size} 个模型，本次 ${mb(sizeBytes)}）`);
}

/* ---------- GGUF 路线：仅做前置检查 ---------- */
async function checkGguf() {
  log('检查 GGUF 路线前置条件…');
  const meta = await (await fetch('https://registry.npmmirror.com/%40wllama%2Fwllama/latest')).json();
  log(`npm 包 wllama@${meta.version}：脚本 ${JSON.stringify(Object.keys(meta.scripts || {}).filter(k => k.startsWith('build')))}`);
  const hasToolchain = ['emscripten', 'cmake'].some(k => k in (meta.devDependencies || {}));
  log(hasToolchain ? 'devDependencies 含工具链依赖' : '⚠️ devDependencies 不含 emscripten/cmake —— 构建需**全局安装 Emscripten SDK**');
  for (const u of [
    `https://cdn.jsdelivr.net/npm/@wllama/wllama@${meta.version}/dist/single-thread/wllama.js`,
    `https://unpkg.com/@wllama/wllama@${meta.version}/dist/single-thread/wllama.js`,
  ]) {
    const r = await fetch(u, { method: 'HEAD', redirect: 'follow' }).catch(() => ({ status: 'ERR' }));
    log(`  备用源 ${new URL(u).host} → HTTP ${r.status}`);
  }
  log('结论：GGUF 路线需自行编译 wllama（见 STATUS.md 路线 A）。本脚本不做编译。');
}

const argv = process.argv.slice(2);
const tierIdx = argv.indexOf('--tier');
const tier = tierIdx >= 0 ? argv[tierIdx + 1] : 'small';
const runtimeIdx = argv.indexOf('--runtime');
const runtime = runtimeIdx >= 0 ? argv[runtimeIdx + 1] : 'onnx';

if (argv.includes('--list')) {
  console.log('可选档位：');
  for (const [k, v] of Object.entries(TIERS)) console.log(`  ${k.padEnd(7)} ${v.name.padEnd(34)} 建议内存 ≥${v.minMemoryGB}GB  窗口 ${v.contextWindow}`);
  console.log('\n可选运行时：onnx（推荐，免编译） / gguf（需自行编译 wllama）');
  process.exit(0);
}

console.log('=== ΜΝΗΜΗ · 准备本地模型 ===');
try {
  fs.mkdirSync(OUT, { recursive: true });
  if (runtime === 'gguf') { await checkGguf(); process.exit(0); }
  if (runtime !== 'onnx') { console.error(`未知运行时：${runtime}`); process.exit(1); }
  const tiers = tier === 'all' ? Object.keys(TIERS) : [tier];
  const bad = tiers.filter(t => !TIERS[t]);
  if (bad.length) { console.error(`未知档位：${bad.join(' / ')}（可选 ${Object.keys(TIERS).join(' / ')} / all）`); process.exit(1); }

  await fetchRuntimeOnnx();
  if (argv.includes('--probe')) { console.log('\n✅ 运行时探测通过（未下载权重）。'); process.exit(0); }
  writeAdapterOnnx();

  let done = 0;
  for (const t of tiers) {
    const spec = TIERS[t];
    try {
      const { total, weightsPath } = await fetchModelOnnx(spec);
      /* backend 标为 wasm：onnxruntime 在无 WebGPU 时自动回退 CPU，故不作为硬门槛淘汰；
         WebGPU 加速与否由适配器内的 device 尝试顺序决定（见 runtime.js） */
      writeRegistry({ ...spec, path: weightsPath }, total, 'wasm');
      done += 1;
    } catch (e) {
      console.warn(`  ⚠ ${t} 跳过：${e.message}（可能该仓库尚无此 ONNX 变体）`);
    }
  }
  if (!done) throw new Error('没有任何档位成功，registry 未更新');
  console.log(`\n✅ 完成（${done}/${tiers.length} 档）。执行 npm --prefix web run sync:dist 后，站点即会按能力调度加载。`);
  console.log('   注意：权重体积大，请确认 .gitignore 已忽略 web/public/models/*（已默认忽略 *-onnx/ 与 vendor/）。');
} catch (e) {
  console.error(`\n❌ 准备失败：${e.message}`);
  console.error('   可重试，或手动放置文件（格式见 web/public/models/STATUS.md）。');
  process.exit(1);
}
