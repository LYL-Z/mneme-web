/**
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
            const join = (s) => s + '\n' + messages.map(m => m.content).join('\n');
            let sys = String(systemPrompt || '');
            let inTokens = countTokens(join(sys));
            let maxNew = Math.min(spec.maxOutputTokens || 320, Math.max(48, nCtx - inTokens - 48));
            let cutNote = '';
            for (let guard = 0; guard < 12 && inTokens + maxNew + 48 > nCtx && sys.length > 600; guard++) {
              const cut = Math.min(600, sys.length - 600);
              const mid = Math.floor(sys.length / 2);
              sys = sys.slice(0, mid - cut / 2) + '\n…（语料已按上下文预算裁剪）…\n' + sys.slice(mid + cut / 2);
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
