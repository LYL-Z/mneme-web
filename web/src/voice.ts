/**
 * v9.5.2 · 语音输出：神经语音（可选，高性能设备）+ 系统 TTS（零下载兜底）
 *
 * 两条路，自动择优：
 *   ① **神经语音**：`/models/voice/` 下放好 kokoro 运行时与模型后启用（WebGPU/WASM 推理，
 *      中文音色 zf_xiaobei / zm_yunxi 等）。下载见 scripts/fetch-voice.mjs。
 *   ② **系统 TTS**：speechSynthesis（Windows/Edge 上"自然"音色本身就是 OS 级神经语音），
 *      零下载、零账单，随时可用。
 *
 * 状态如实暴露：usedKind = 'neural' | 'system' | null；加载失败会把原因带回 UI。
 */

export type VoiceKind = 'neural' | 'system';
export interface VoiceStatus { kind: VoiceKind | null; detail: string; loading: boolean; error: string | null }

let status: VoiceStatus = { kind: null, detail: '', loading: false, error: null };
let neuralPromise: Promise<boolean> | null = null;

const VENDOR = '/models/voice/';

export function getVoiceStatus(): VoiceStatus { return status; }

/** 神经语音是否已就位：manifest 存在才尝试（文件由 scripts/fetch-voice.mjs 准备） */
async function manifestOk(): Promise<boolean> {
  try {
    const r = await fetch(VENDOR + 'manifest.json', { cache: 'no-cache' });
    return r.ok;
  } catch { return false; }
}

/** 尝试启用神经语音（kokoro）。失败返回 false 并记录原因。 */
export async function enableNeuralVoice(): Promise<boolean> {
  if (status.kind === 'neural') return true;
  if (neuralPromise) return neuralPromise;
  neuralPromise = (async () => {
    const nav = navigator as Navigator & { gpu?: unknown };
    if (typeof navigator !== 'undefined' && !nav.gpu) {
      status = { kind: null, detail: '无 WebGPU，神经语音跳过（用系统语音）', loading: false, error: null };
      return false;
    }
    if (!(await manifestOk())) {
      status = { kind: null, detail: '未安装神经语音模型（可用系统语音）', loading: false, error: null };
      return false;
    }
    try {
      status = { kind: null, detail: '正在载入神经语音…', loading: true, error: null };
      const man = await (await fetch(VENDOR + 'manifest.json')).json();
      const mod = await import(/* @vite-ignore */ man.runtime) as {
        createEngine?: (m: unknown) => Promise<{ synthesize: (text: string, voice: string) => Promise<ArrayBuffer> }>;
      };
      if (typeof mod.createEngine !== 'function') throw new Error('runtime 未导出 createEngine');
      const eng = await mod.createEngine(man);
      neural = {
        synthesize: (text: string) => eng.synthesize(text, man.voice || 'zf_xiaobei'),
        sampleRate: man.sampleRate || 24000,
      };
      status = { kind: 'neural', detail: man.name || '神经语音（kokoro）', loading: false, error: null };
      return true;
    } catch (e) {
      status = { kind: null, detail: '神经语音载入失败（用系统语音）', loading: false, error: e instanceof Error ? e.message : String(e) };
      return false;
    }
  })();
  return neuralPromise;
}

let neural: { synthesize: (text: string, voice: string) => Promise<ArrayBuffer>; sampleRate: number } | null = null;

function zhVoice(): SpeechSynthesisVoice | null {
  const vs = speechSynthesis.getVoices?.() ?? [];
  return vs.find(v => /zh[-_]CN/i.test(v.lang)) ?? vs.find(v => /^zh/i.test(v.lang)) ?? null;
}

export function systemVoiceName(): string {
  const v = zhVoice();
  return v ? `${v.name}（系统）` : '系统默认音色';
}

/** 朗读入口：优先神经语音（WAV → Audio），否则系统 TTS */
export async function speak(text: string): Promise<void> {
  const clean = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  if (!clean) return;
  const hasNeural = await enableNeuralVoice();
  if (hasNeural && neural) {
    try {
      const wav = await neural.synthesize(clean, 'zf_xiaobei');
      const url = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
      const au = new Audio(url);
      au.onended = () => URL.revokeObjectURL(url);
      void au.play();
      return;
    } catch { /* 落回系统语音 */ }
  }
  if (typeof speechSynthesis === 'undefined') return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(clean);
  const v = zhVoice();
  if (v) u.voice = v;
  u.lang = v?.lang || 'zh-CN';
  speechSynthesis.speak(u);
}

export function stopSpeaking(): void {
  try { speechSynthesis.cancel(); } catch { /* */ }
}
