/**
 * v9.5 · 本地模型调度器（人物人格体）
 *
 * 设计目标：**零账单 + 全设备可用**。云端 API 已否决，所以推理只能在设备上跑；
 * 而设备差异极大（鸿蒙手机无 WebGPU、iPad 有、桌面最强），因此不能"一套模型打天下"，
 * 需要按能力探测 + 预算评分来调度。
 *
 * 三层职责：
 *   ① probeCapabilities() —— 探测真实能力（WebGPU / WASM SIMD / 内存 / 流量 / 电量 / 设备壳）
 *   ② pickModel()        —— **纯函数**：能力 + 模型清单 → 选型决策（可单元测试）
 *   ③ loadRuntime()      —— 动态加载所选模型的运行时（Vite 需 @vite-ignore）
 *
 * 硬约束：CSP 是 `default-src 'self'`，**运行时与权重必须同源**——不能挂 CDN。
 * 因此模型清单从 `/models/registry.json` 读，文件由 `scripts/fetch-model.mjs` 准备。
 */

export type Backend = 'webgpu' | 'wasm';

export interface Capabilities {
  webgpu: boolean;
  wasmSimd: boolean;
  /** navigator.deviceMemory（GB，可能缺省） */
  memoryGB: number | null;
  cores: number | null;
  /** 省流量模式 / 弱网 */
  saveData: boolean;
  effectiveType: string | null;
  /** 电池：0–1 与是否充电（可能缺省） */
  batteryLevel: number | null;
  charging: boolean | null;
  /** 设备壳与系统（来自 device.ts 写入的 dataset） */
  shell: 'phone' | 'tablet' | 'desktop';
  os: string;
  secure: boolean;
}

export interface ModelSpec {
  id: string;
  name: string;
  /** 同源路径，如 /models/qwen2.5-0.5b-q4.gguf */
  path: string;
  /** 同源运行时模块，导出 createEngine(manifest) */
  runtime: string;
  backend: Backend;
  sizeBytes: number;
  /** 粗略参数量（B） */
  params: number;
  quantization: string;
  minMemoryGB: number;
  contextWindow: number;
  maxOutputTokens: number;
  /** 0–100 的质量分（人工评估占位，跑分后回填） */
  qualityScore: number;
  /** 语言覆盖：'zh' 优先 */
  languages: string[];
  /** **真实存在**的 dtype 变体（决定 onnx 文件名）。降级链绝不尝试没有的档——
      缺失文件会被 SPA 兜底喂回 HTML，ORT 解析即报 "protobuf parsing failed" */
  dtypes?: string[];
}

export interface Decision {
  model: ModelSpec | null;
  /** 全部过得了硬门槛的候选（按推荐度降序）——界面据此做"模型选择"，推荐项排第一 */
  viable: { spec: ModelSpec; score: number; why: string }[];
  /** 人类可读的选型理由（UI 直接展示"为何用这个档"） */
  reason: string;
  /** 被淘汰的候选与原因，便于排查与手动覆盖 */
  rejected: { id: string; why: string }[];
  /** 服务端检索预算：由上下文窗口推导，避免把窗口塞爆 */
  budget: { maxChars: number; topK: number; contextWindow: number; maxOutputTokens: number };
  /** 若为 null，说明只能走信源档（无模型，但仍可用） */
  fallbackToSource: boolean;
}

/* ---------- ① 能力探测 ---------- */
const SIMD_TEST = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11,
]);

let capsCache: Promise<Capabilities> | null = null;

export function probeCapabilities(): Promise<Capabilities> {
  if (capsCache) return capsCache;
  capsCache = (async () => {
    const nav = navigator as Navigator & {
      gpu?: { requestAdapter: () => Promise<unknown> };
      deviceMemory?: number;
      connection?: { saveData?: boolean; effectiveType?: string };
      getBattery?: () => Promise<{ level: number; charging: boolean }>;
    };
    const root = document.documentElement;

    let webgpu = false;
    try {
      if (nav.gpu?.requestAdapter) webgpu = !!(await nav.gpu.requestAdapter());
    } catch { webgpu = false; }

    let wasmSimd = false;
    try { wasmSimd = WebAssembly.validate(SIMD_TEST); } catch { wasmSimd = false; }

    let batteryLevel: number | null = null;
    let charging: boolean | null = null;
    try {
      if (nav.getBattery) {
        const b = await nav.getBattery();
        batteryLevel = b.level; charging = b.charging;
      }
    } catch { /* 桌面多数不支持 */ }

    const shell = (root.dataset.shell as Capabilities['shell']) || 'desktop';
    return {
      webgpu, wasmSimd,
      memoryGB: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null,
      cores: typeof navigator.hardwareConcurrency === 'number' ? navigator.hardwareConcurrency : null,
      saveData: !!nav.connection?.saveData,
      effectiveType: nav.connection?.effectiveType ?? null,
      batteryLevel, charging, shell,
      os: root.dataset.os || 'other',
      secure: typeof isSecureContext === 'boolean' ? isSecureContext : true,
    };
  })();
  return capsCache;
}

/* ---------- ② 选型（纯函数，可单测） ---------- */
/** 单次会话可接受的下载上限（省流量模式下收紧到 120MB） */
export function downloadBudget(caps: Capabilities): number {
  if (caps.saveData) return 120 * 1024 * 1024;
  if (caps.effectiveType && /^(slow-)?2g$/.test(caps.effectiveType)) return 120 * 1024 * 1024;
  if (caps.shell === 'phone') return 700 * 1024 * 1024;
  if (caps.shell === 'tablet') return 1400 * 1024 * 1024;
  return 2500 * 1024 * 1024;
}

/** 由上下文窗口推导检索预算：给系统提示与输出留足余量，中文约 1.5 字符/token */
export function deriveBudget(m: ModelSpec | null) {
  if (!m) return { maxChars: 12000, topK: 8, contextWindow: 0, maxOutputTokens: 0 };
  const reserveForPrompt = 1400;                       // 人格基底 + 规则 + 历史摘要（token）
  const usable = Math.max(512, m.contextWindow - m.maxOutputTokens - reserveForPrompt);
  const maxChars = Math.round(usable * 1.5);           // 中文经验换算
  const topK = Math.max(4, Math.min(24, Math.round(maxChars / 900)));
  return { maxChars, topK, contextWindow: m.contextWindow, maxOutputTokens: m.maxOutputTokens };
}

/** 是否已在浏览器缓存里（避免重复下载几百 MB） */
export type CacheProbe = (path: string) => Promise<boolean>;

export function pickModel(
  caps: Capabilities,
  registry: ModelSpec[],
  cached: Record<string, boolean> = {},
  preferredId?: string | null,
): Decision {
  const rejected: { id: string; why: string }[] = [];
  const budgetBytes = downloadBudget(caps);
  const mem = caps.memoryGB;

  const viable: { m: ModelSpec; score: number; why: string }[] = [];
  for (const m of registry) {
    if (!m.languages?.includes('zh')) { rejected.push({ id: m.id, why: '不支持中文' }); continue; }
    if (m.backend === 'webgpu' && !caps.webgpu) { rejected.push({ id: m.id, why: '本机无 WebGPU' }); continue; }
    if (m.backend === 'wasm' && !caps.wasmSimd) { rejected.push({ id: m.id, why: 'WASM SIMD 不可用' }); continue; }
    if (mem != null && mem < m.minMemoryGB) { rejected.push({ id: m.id, why: `内存不足（需 ${m.minMemoryGB}GB，本机 ${mem}GB）` }); continue; }
    const overBudget = m.sizeBytes > budgetBytes && !cached[m.path];
    if (overBudget) { rejected.push({ id: m.id, why: `体积 ${(m.sizeBytes / 1048576).toFixed(0)}MB 超出当前下载预算（省流量/设备限制）` }); continue; }

    /* 评分：质量为主，缓存加权（已缓存则几乎必选，避免重复下载），再按代价扣分 */
    let score = m.qualityScore;
    if (cached[m.path]) score += 40;
    if (caps.webgpu && m.backend === 'webgpu') score += 12; else if (m.backend === 'wasm') score -= 10;
    if (caps.shell === 'phone') score -= m.params * 22;                 // 手机偏好小模型（速度与耗电）
    else if (caps.shell === 'tablet') score -= m.params * 8;
    if (caps.batteryLevel != null && caps.batteryLevel < 0.25 && caps.charging === false) score -= 18;
    if (caps.saveData) score -= 12;
    const why = [
      `${m.params}B ${m.quantization}`,
      `质量分 ${m.qualityScore}`,
      cached[m.path] ? '已缓存' : '需下载',
      caps.webgpu && m.backend === 'webgpu' ? 'WebGPU 加速' : 'CPU 回退',
    ].join(' · ');
    viable.push({ m, score, why });
  }

  viable.sort((a, b) => b.score - a.score);

  /* 林哥要求：**模型可以自己选**。所以把"全部可选项 + 推荐项"都交出去；
     preferredId 是用户的手动选择——只要它仍然过得了硬门槛，就尊重用户而不是调度器。 */
  const preferred = preferredId ? viable.find(v => v.m.id === preferredId) : undefined;
  const best = preferred ?? viable[0] ?? null;

  const capNote: string[] = [];
  capNote.push(caps.webgpu ? 'WebGPU 可用' : '无 WebGPU（CPU 回退）');
  if (mem != null) capNote.push(`内存约 ${mem}GB`);
  if (caps.cores != null) capNote.push(`${caps.cores} 核`);
  if (caps.saveData) capNote.push('省流量模式');
  if (caps.batteryLevel != null && caps.batteryLevel < 0.25 && caps.charging === false) capNote.push('电量偏低）');
  if (caps.shell === 'phone' && !caps.webgpu) capNote.push('手机纯 CPU —— 会慢，属预期');

  const reason = best
    ? `${preferred ? '已手动选择' : '按本机能力调度'}：${capNote.join(' · ')} → 「${best.m.name}」（${best.why}）`
    : `本机暂无可用的本地模型（${capNote.join(' · ')}）→ 退回信源档`;

  return {
    model: best?.m ?? null,
    /** 全部过得了硬门槛的候选（按推荐度降序）——供界面做"模型选择" */
    viable: viable.map(v => ({ spec: v.m, score: Math.round(v.score), why: v.why })),
    reason,
    rejected,
    budget: deriveBudget(best?.m ?? null),
    fallbackToSource: !best,
  };
}

/* ---------- ③ 运行时加载 ---------- */
/** 单轮用量：token 数由模型自带分词器**精确统计**，不是字符估算 */
export interface Usage { inTokens: number; outTokens: number; ms: number }

export interface LocalEngine {
  name: string;
  spec: ModelSpec;
  generate: (
    systemPrompt: string,
    messages: { role: string; content: string }[],
    onDelta?: (s: string) => void,
    /** 生成本次用量（首字延迟/输出速度由调用方用 onDelta 时间戳算，token 数这里给真值） */
    onUsage?: (u: Usage) => void,
  ) => Promise<string>;
}

/** 加载进度（下载 / 初始化） */
export interface LoadProgress {
  phase: 'download' | 'init';
  /** 0–100，未知时为 null */
  pct: number | null;
  file?: string;
  loaded?: number;
  total?: number;
  message?: string;
}

export type EngineFactory = (spec: ModelSpec, onProgress?: (p: LoadProgress) => void) => Promise<Omit<LocalEngine, 'spec'>>;

export interface RuntimeLoad { engine: LocalEngine | null; error: string | null }

const engineCache = new Map<string, Promise<RuntimeLoad>>();

export function loadRuntime(spec: ModelSpec, onProgress?: (p: LoadProgress) => void): Promise<RuntimeLoad> {
  const hit = engineCache.get(spec.id);
  if (hit) return hit;
  const p = (async (): Promise<RuntimeLoad> => {
    try {
      onProgress?.({ phase: 'init', pct: null, message: '加载运行时…' });
      const mod = await import(/* @vite-ignore */ spec.runtime) as {
        createEngine?: (spec: ModelSpec, onProgress?: (p: LoadProgress) => void) => Promise<Omit<LocalEngine, 'spec'>>;
      };
      if (typeof mod.createEngine !== 'function') {
        return { engine: null, error: `运行时 ${spec.runtime} 未导出 createEngine（文件可能是旧版/损坏）` };
      }
      onProgress?.({ phase: 'init', pct: 1, message: '运行时就绪，正在载入权重…' });
      const eng = await mod.createEngine(spec, onProgress);
      return { engine: { ...eng, spec, name: eng.name || spec.name }, error: null };
    } catch (e) {
      /* **不吞错误**：把真实原因带回 UI，否则永远只能看到"未就绪"而无法定位 */
      const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      return { engine: null, error: msg };
    }
  })();
  engineCache.set(spec.id, p);
  return p;
}

/** 读模型清单；不存在或损坏时返回空表（→ 自动走信源档，不报错） */
export async function loadRegistry(): Promise<ModelSpec[]> {
  try {
    const r = await fetch('/models/registry.json', { cache: 'no-cache' });
    if (!r.ok) return [];
    const j = await r.json() as { models?: ModelSpec[] };
    return Array.isArray(j.models) ? j.models.filter(m => m?.id && m?.path && m?.runtime) : [];
  } catch { return []; }
}

/** 查缓存：命中则避免重复下载（CacheStorage 可能不可用，静默降级） */
export async function probeCached(registry: ModelSpec[]): Promise<Record<string, boolean>> {
  const out: Record<string, boolean> = {};
  try {
    if (typeof caches === 'undefined') return out;
    for (const m of registry) {
      const hit = await caches.match(m.path);
      out[m.path] = !!hit;
    }
  } catch { /* 隐私模式或不可用 */ }
  return out;
}

/** 一步到位：探测 → 选型 → 加载（含进度与**真实错误**；失败调用方走信源档但要知道原因）
 *  preferredId：用户手动指定的模型——只要过得了硬门槛就尊重用户，否则仍按能力调度 */
export async function scheduleLocalModel(onProgress?: (p: LoadProgress) => void, preferredId?: string | null): Promise<{
  decision: Decision;
  engine: LocalEngine | null;
  error: string | null;
}> {
  const caps = await probeCapabilities();
  const registry = await loadRegistry();
  const cached = await probeCached(registry);
  const decision = pickModel(caps, registry, cached, preferredId);
  if (!decision.model) return { decision, engine: null, error: null };
  const { engine, error } = await loadRuntime(decision.model, onProgress);
  return { decision, engine, error };
}
