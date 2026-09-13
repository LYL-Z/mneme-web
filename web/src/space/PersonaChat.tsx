import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type PersonaChunk, type PersonaContext, type PersonaMeta } from '../api';
import { notify } from '../toast';
import { useFocusTrap } from '../focusTrap';
import {
  scheduleLocalModel, loadRuntime, probeCapabilities,
  type Capabilities, type Decision, type LoadProgress, type LocalEngine, type ModelSpec, type Usage,
} from '../localModel';
/* 语音：神经语音（高性能设备，可选）优先，系统 TTS 兜底——统一入口 */
import { speak as speakAloud, getVoiceStatus, enableNeuralVoice, systemVoiceName } from '../voice';

/**
 * v9.5.1 · 人物人格体——「与 TA 说话」
 *
 * 定位（docs/人物AI对话-技术方案-2026-09-13.md §14）：
 *   人格体是**由档案构建、可以超越档案**的对话体。两条界面红线：
 *   ① 不冒充确凿事实（常驻「AI 模仿体 · 非本人发言」角标）② 绝不回流正史（纯只读会话）。
 *
 * 本轮能力：
 *   · **点开即加载**：模型在对话打开时就后台装载，带下载/初始化进度与真实错误
 *   · **模型可选**：按本机能力给出推荐序，用户可手动切换（选择持久化）
 *   · **实时性能面板**：后端 / 设备 / 内存核数 / 输出速度 tok/s / 输入输出 token / 首字延迟
 *   · **思维链**：人格档要求模型先在 <think>…</think> 里简述即时想法，界面折叠展示
 *   · **语音**：高性能设备可用系统语音朗读（speechSynthesis，零账单）
 */

type Mode = 'persona' | 'voice' | 'source';
interface Msg {
  role: 'user' | 'assistant' | 'system';
  text: string;
  think?: string;
  chunks?: PersonaChunk[];
  engine?: string;
  usage?: Usage;
  speakable?: boolean;
}

/** 把流式文本拆成「思维链」与「回答」：<think>…</think> 未闭合时视为仍在思考 */
function splitThink(raw: string): { think: string; answer: string; thinking: boolean } {
  const open = raw.indexOf('<think>');
  if (open < 0) return { think: '', answer: raw, thinking: false };
  const close = raw.indexOf('</think>', open);
  if (close < 0) {
    return { think: raw.slice(open + 7).trim(), answer: '', thinking: true };
  }
  const think = raw.slice(open + 7, close).trim();
  const answer = raw.slice(close + 8).trim();
  return { think, answer, thinking: false };
}

/** 无模型时的确定性作答：只列受控片段原文与出处，不做任何改写 */
function groundedAnswer(ctx: PersonaContext, query: string): string {
  const cs = ctx.chunks.slice(0, 4);
  if (!cs.length) return '档案中没有检索到与该问题相关的片段。可以换个说法，或先去「时间之河」「原文档案馆」检索。';
  const head = query.trim()
    ? `档案中与该问题最相关的 ${cs.length} 段原文如下（本机模型未就绪，此处只列原文、不做改写）：`
    : `先给你这个人物的档案基底，共 ${cs.length} 段（本机模型未就绪，只列原文）：`;
  return head + '\n\n' + cs.map(c => `〔${c.pathLabel}${c.kind ? ' · ' + c.kind : ''}〕\n${c.text}`).join('\n\n');
}

/* ---------- 语音（零账单：系统 TTS；不做云 TTS） ---------- */
const speechReady = (): boolean => typeof speechSynthesis !== 'undefined';

/** 人格档输出要求：先给一行思维链，再作答 */
const THINK_INSTRUCTION = '\n【输出格式】回答最前面先写一行 <think>…</think>（用不超过 40 字说明你此刻的即时想法），随后直接给出回答。不要解释这个格式。';

const PREF_MODEL = 'mneme-persona-model';
const PREF_VOICE = 'mneme-persona-voice';

export function PersonaChat({ entityId, displayName, onOpenDoc, onClose }: {
  entityId: number;
  displayName: string;
  onOpenDoc?: (path: string) => void;
  onClose: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [meta, setMeta] = useState<PersonaMeta | null | 'loading'>('loading');
  const [mode, setMode] = useState<Mode>('persona');
  const [decision, setDecision] = useState<Decision | null>(null);
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [engine, setEngine] = useState<LocalEngine | null>(null);
  const [engineName, setEngineName] = useState<string>('');
  const [rtPhase, setRtPhase] = useState<'idle' | 'loading' | 'ready' | 'failed' | 'none'>('idle');
  const [rtErr, setRtErr] = useState<string | null>(null);
  const [prog, setProg] = useState<LoadProgress | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [showBasis, setShowBasis] = useState(false);
  const [showSched, setShowSched] = useState(true);
  const [lastCtx, setLastCtx] = useState<PersonaContext | null>(null);
  const [meters, setMeters] = useState<{ ttft: number | null; tokps: number | null; inTok: number; outTok: number; ms: number | null; loadMs: number | null }>({
    ttft: null, tokps: null, inTok: 0, outTok: 0, ms: null, loadMs: null,
  });
  const [voiceOn, setVoiceOn] = useState<boolean>(() => {
    try { return localStorage.getItem(PREF_VOICE) === '1'; } catch { return false; }
  });
  const [voiceAvail, setVoiceAvail] = useState(false);
  const [voiceLabel, setVoiceLabel] = useState('系统语音');
  const [cpuEst, setCpuEst] = useState<number | null>(null);

  useFocusTrap(rootRef, true, onClose);

  /* 调度 + **点开即加载**：不等第一次提问，进面板就开始装模型（带进度与真实错误） */
  const boot = useCallback((preferredId?: string | null) => {
    setRtPhase('loading'); setRtErr(null); setProg(null); setEngine(null);
    const t0 = performance.now();
    return scheduleLocalModel(p => {
      setProg(p);
      if (p.phase === 'download' && p.pct != null) {
        setCpuEst(prev => prev);   // 保持
      }
    }, preferredId ?? (() => { try { return localStorage.getItem(PREF_MODEL); } catch { return null; } })())
      .then(({ decision: d, engine: e, error }) => {
        setDecision(d);
        setEngine(e);
        setEngineName(e?.name || '');
        setRtPhase(e ? 'ready' : (d.fallbackToSource ? 'none' : 'failed'));
        if (e) setMeters(m => ({ ...m, loadMs: Math.round(performance.now() - t0) }));
        if (error) setRtErr(error);
        return e;
      });
  }, []);

  useEffect(() => {
    let dead = false;
    setVoiceAvail(speechReady());
    /* 神经语音（高性能设备）：/models/voice/ 就位则启用 kokoro，否则系统 TTS 兜底 */
    void enableNeuralVoice().then(ok => { if (!dead) setVoiceLabel(ok ? '神经语音(kokoro)' : systemVoiceName()); });
    try { speechSynthesis.addEventListener?.('voiceschanged', () => setVoiceAvail(typeof speechSynthesis !== 'undefined')); } catch { /* */ }
    void probeCapabilities().then(c => { if (!dead) setCaps(c); });
    void boot();
    return () => { dead = true; };
  }, [boot]);

  useEffect(() => {
    let dead = false;
    api.persona(entityId).then(m => { if (!dead) setMeta(m); }).catch(() => { if (!dead) setMeta(null); });
    return () => { dead = true; };
  }, [entityId]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, busy]);

  /* CPU 负载（估算）：用主线程帧间隔抖动近似。浏览器没有标准的 CPU 占用率 API——如实标注。 */
  useEffect(() => {
    if (typeof requestAnimationFrame !== 'function') return;
    let raf = 0; let frames = 0; let t0 = performance.now(); let stopped = false;
    const loop = () => {
      if (stopped) return;
      frames += 1;
      const dt = performance.now() - t0;
      if (dt >= 1000) {
        /* 60fps 为满载基准：帧率越低，主线程越忙 */
        const busyPct = Math.max(0, Math.min(100, Math.round((1 - frames / 60) * 100)));
        setCpuEst(busyPct);
        frames = 0; t0 = performance.now();
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => { stopped = true; cancelAnimationFrame(raf); };
  }, []);

  const modeList = useMemo(() => ([
    { m: 'persona' as Mode, label: '人格档', desc: '像和 TA 本人说话（可即兴）' },
    { m: 'voice' as Mode, label: '语域档', desc: '用 TA 的用词口吻，明示为档案再现', need: true },
    { m: 'source' as Mode, label: '信源档', desc: '客观档案口吻，只给原文与出处' },
  ]), []);
  const voiceOk = !!meta && meta !== 'loading' && meta.has_lang_corpus;
  const viable = decision?.viable ?? [];
  const hasModel = rtPhase === 'ready';

  const push = useCallback((m: Msg) => setMsgs(prev => [...prev, m]), []);

  /* 朗读统一走 ../voice（神经语音优先，系统 TTS 兜底） */
  const speak = useCallback((text: string) => { void speakAloud(text); }, []);

  const send = useCallback(async () => {
    const q = input.trim();
    if (!q || busy || !meta || meta === 'loading') return;
    setInput('');
    push({ role: 'user', text: q });
    setBusy(true);
    try {
      const budget = decision?.budget;
      const ctx = await api.personaContext(entityId, { mode, query: q, maxChars: budget?.maxChars, topK: budget?.topK });
      if (!ctx || !ctx.ok) { push({ role: 'system', text: '这段档案暂时取不回来，请稍后重试。' }); return; }
      setLastCtx(ctx);

      /* 信源档无需模型；人格/语域档在模型就绪时走本地推理 */
      if (ctx.mode !== 'source' && hasModel && engine) {
        /* 人格档：要求先给一行思维链 */
        const sys = mode === 'persona'
          ? ctx.systemPrompt + THINK_INSTRUCTION
          : ctx.systemPrompt;
        const history = msgs.filter(m => m.role === 'user' || m.role === 'assistant')
          .map(m => ({ role: m.role, content: m.text }));
        const corpus = ctx.chunks.map(c => `[${c.id}]（${c.pathLabel}）${c.text}`).join('\n');
        push({ role: 'assistant', text: '', engine: engine.name, speakable: true });

        let firstAt: number | null = null;
        let acc = '';
        const usage = await new Promise<Usage | null>(resolve => {
          let settled = false;
          engine.generate(sys + '\n\n【可依据的档案片段】\n' + corpus, history,
            piece => {
              if (firstAt == null) firstAt = performance.now();
              acc += piece;
              setMsgs(prev => {
                const last = prev[prev.length - 1];
                if (!last || last.role !== 'assistant') return prev;
                const sp = splitThink(acc);
                return [...prev.slice(0, -1), { ...last, text: acc, think: sp.think || undefined }];
              });
            },
            u => { if (!settled) { settled = true; resolve(u); } },
          ).then(t => {
            if (!settled) { settled = true; resolve(null); }
            setMsgs(prev => {
              const last = prev[prev.length - 1];
              if (!last || last.role !== 'assistant') return prev;
              const sp = splitThink(t || acc);
              return [...prev.slice(0, -1), {
                ...last, text: t || acc,
                think: sp.think || undefined,
                chunks: ctx.chunks.slice(0, 4),
                speakable: true,
              }];
            });
          }).catch(() => { if (!settled) { settled = true; resolve(null); } });
        });

        const ms = usage?.ms ?? (firstAt != null ? performance.now() - firstAt : null);
        setMeters(m => ({
          ttft: firstAt != null ? Math.round(firstAt - (performance.now() - (usage?.ms ?? 0))) : m.ttft,
          tokps: usage && usage.ms > 0 ? Math.round((usage.outTokens / usage.ms) * 1000) : m.tokps,
          inTok: usage?.inTokens ?? m.inTok,
          outTok: usage?.outTokens ?? m.outTok,
          ms: ms != null ? Math.round(ms) : m.ms,
          loadMs: m.loadMs,
        }));
        if (voiceOn) speak(acc);
        return;
      }

      /* 信源档 / 模型未就绪：确定性直读 */
      push({
        role: 'assistant',
        text: groundedAnswer(ctx, q),
        chunks: ctx.chunks.slice(0, 4),
        engine: ctx.mode === 'source' ? '信源档 · 无模型直读' : '本机模型未就绪 · 仅列原文',
      });
    } catch {
      push({ role: 'system', text: '这次没有取回响应，请稍后再试。' });
    } finally { setBusy(false); }
  }, [input, busy, meta, mode, entityId, msgs, push, decision, engine, hasModel, voiceOn, speak]);

  const switchModel = useCallback((m: ModelSpec) => {
    try { localStorage.setItem(PREF_MODEL, m.id); } catch { /* 隐私模式 */ }
    notify('切换到 ' + m.name + '，正在装载…', 'info');
    void boot(m.id);
  }, [boot]);

  const ready = meta !== 'loading' && meta && meta.can_chat;

  return (
    <div className="pc-mask" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }} role="presentation">
      <div ref={rootRef} className="pc glass chrome" role="dialog" aria-modal="true" aria-labelledby="pc-title">
        <header className="pc-head">
          <div className="pc-head-main">
            <p className="pc-kicker greek">ΠΡΟΣΩΠΟΝ · 人格体</p>
            <h2 id="pc-title">{displayName}</h2>
          </div>
          <p className="pc-disclose" role="note"><b>AI 模仿体</b>·非本人发言 · 内容可能超出档案</p>
          <button className="pc-x" onClick={onClose} aria-label="关闭">×</button>
        </header>

        <div className="pc-modes" role="tablist" aria-label="对话档位">
          {modeList.map(({ m, label, desc, need }) => {
            const disabled = !!need && !voiceOk;
            return (
              <button key={m} role="tab" aria-selected={mode === m}
                className={`pc-mode ${mode === m ? 'on' : ''}`} disabled={disabled}
                title={disabled ? '该人物没有本人语言语料，此档不可用' : desc}
                onClick={() => { if (!disabled) { setMode(m); setMsgs([]); } }}>
                <b>{label}</b><span>{disabled ? '无本人语料' : desc}</span>
              </button>
            );
          })}
        </div>

        {meta === 'loading' && <p className="pc-note" role="status">正在取档案…</p>}
        {meta !== 'loading' && meta && !meta.can_chat && (
          <p className="pc-note">这个人物在档案里还没有足够的素材可供对话（{meta.reason === 'insufficient_corpus' ? '素材不足' : meta.reason}）。</p>
        )}
        {meta === null && <p className="pc-note">没有找到这个人物的人格档案。</p>}

        {ready && (
          <>
            {/* 调度条：点开即加载 + 进度 + 真实错误 */}
            <div className="pc-sched">
              <button type="button" className="pc-sched-head" onClick={() => setShowSched(v => !v)} aria-expanded={showSched}>
                <i className={`pc-dot ${rtPhase === 'ready' ? 'on' : rtPhase === 'loading' ? 'load' : rtPhase === 'failed' ? 'err' : 'off'}`} aria-hidden />
                <span>
                  {rtPhase === 'loading' && (prog?.phase === 'download'
                    ? `正在下载本机模型… ${prog.pct != null ? Math.round(prog.pct) + '%' : ''}${prog.total ? `（${((prog.loaded || 0) / 1048576).toFixed(0)}/${(prog.total / 1048576).toFixed(0)}MB）` : ''}`
                    : (prog?.message || '正在装载本机模型…'))}
                  {rtPhase === 'ready' && (decision?.reason || '本机模型已就绪')}
                  {rtPhase === 'failed' && '本机模型装载失败——已退回信源档（展开可看原因）'}
                  {rtPhase === 'none' && '本机没有可用的本地模型——走信源档'}
                </span>
                <em>{showSched ? '收起' : '调度详情'}</em>
              </button>
              {showSched && (
                <div className="pc-sched-body">
                  {rtPhase === 'loading' && (
                    <div className="pc-bar"><i style={{ width: `${prog?.pct ?? 6}%` }} /></div>
                  )}
                  {rtErr && (
                    <details className="pc-sched-err">
                      <summary>装载失败 · 点开看原因（已退回信源档）</summary>
                      <p>{rtErr}</p>
                    </details>
                  )}
                  {decision && (
                    <>
                      <p>检索预算：{decision.budget.maxChars.toLocaleString()} 字符 · 取 {decision.budget.topK} 段
                        {decision.budget.contextWindow ? `（按窗口 ${decision.budget.contextWindow} / 输出上限 ${decision.budget.maxOutputTokens} 推导）` : ''}</p>
                      {viable.length > 0 && (
                        <div className="pc-mmodels">
                          <p className="pc-mmodels-t">本机可用的模型（★ = 按能力推荐）：</p>
                          {viable.map(v => (
                            <button key={v.spec.id} type="button"
                              className={`pc-mmodel ${engineName.startsWith(v.spec.name) ? 'on' : ''} ${decision.model?.id === v.spec.id ? 'rec' : ''}`}
                              disabled={rtPhase === 'loading'}
                              onClick={() => switchModel(v.spec)}>
                              <b>{decision.model?.id === v.spec.id ? '★ ' : ''}{v.spec.name}</b>
                              <span>{v.why} · {(v.spec.sizeBytes / 1048576).toFixed(0)}MB · 窗口 {v.spec.contextWindow}</span>
                            </button>
                          ))}
                        </div>
                      )}
                      {decision.rejected.length > 0 && (
                        <details><summary>被淘汰的候选（{decision.rejected.length}）</summary>
                          <ul>{decision.rejected.map(r => <li key={r.id}>{r.id}：{r.why}</li>)}</ul>
                        </details>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>

            {/* 性能 HUD：能测的精确测；测不了的（GPU 利用率/CPU 占用）如实标注 */}
            <div className="pc-hud" role="status" aria-label="性能面板">
              <span className="pc-hud-i"><i>后端</i><b>{engineName ? (engineName.includes('webgpu') ? 'WebGPU' : 'CPU/WASM') : (caps?.webgpu ? 'WebGPU 可用' : 'CPU')}</b></span>
              <span className="pc-hud-i"><i>设备</i><b>{caps ? ({ phone: '手机', tablet: '平板', desktop: '电脑' }[caps.shell]) : '—'}{caps ? ` · ${caps.os}` : ''}</b></span>
              <span className="pc-hud-i"><i>内存/核</i><b>{caps?.memoryGB ? caps.memoryGB + 'GB' : '—'} / {caps?.cores ?? '—'}</b></span>
              <span className="pc-hud-i"><i>输出速度</i><b>{meters.tokps != null ? meters.tokps + ' tok/s' : '—'}</b></span>
              <span className="pc-hud-i"><i>首字</i><b>{meters.ttft != null ? meters.ttft + 'ms' : '—'}</b></span>
              <span className="pc-hud-i"><i>token 入/出</i><b>{meters.inTok}/{meters.outTok}</b></span>
              <span className="pc-hud-i"><i>本轮耗时</i><b>{meters.ms != null ? meters.ms + 'ms' : '—'}</b></span>
              <span className="pc-hud-i" title="浏览器无 CPU 占用率 API；此值由主线程帧率抖动估算"><i>CPU 负载(估)</i><b>{cpuEst != null ? cpuEst + '%' : '—'}</b></span>
              <span className="pc-hud-i" title="浏览器无 GPU 利用率 API；这里显示的是当前所用推理后端"><i>GPU</i><b>{engineName && engineName.includes('webgpu') ? 'WebGPU 推理中' : '未使用'}</b></span>
              <span className="pc-hud-i" title="权重装载耗时"><i>装载</i><b>{meters.loadMs != null ? (meters.loadMs / 1000).toFixed(1) + 's' : '—'}</b></span>
              <span className="pc-hud-i" title={getVoiceStatus().detail || '朗读引擎'}><i>语音</i><b>{voiceLabel}</b></span>
              {voiceAvail && (
                <button className={`pc-hud-tts ${voiceOn ? 'on' : ''}`} type="button"
                  onClick={() => { const v = !voiceOn; setVoiceOn(v); try { localStorage.setItem(PREF_VOICE, v ? '1' : '0'); } catch { /* */ } if (!v) speechSynthesis.cancel(); }}>
                  {voiceOn ? '🔊 自动朗读开' : '🔈 自动朗读关'}
                </button>
              )}
            </div>

            <div className="pc-list" ref={listRef} role="log" aria-live="polite">
              {msgs.length === 0 && (
                <div className="pc-empty">
                  <p>你可以直接开口——想聊什么都可以。</p>
                  <p className="pc-empty-sub">
                    素材分层：公开 {meta.tier_counts.public} 段
                    {meta.tier_counts.private > 0 && <> · 私密 {meta.tier_counts.private} 段{meta.needs_unlock_for_private ? '（需管理员密码解锁）' : ''}</>}
                    {meta.tier_counts.secret > 0 && <> · 绝密 {meta.tier_counts.secret} 段</>}
                  </p>
                </div>
              )}
              {msgs.map((m, i) => {
                const sp = m.role === 'assistant' ? splitThink(m.text) : { think: '', answer: m.text, thinking: false };
                return (
                  <div key={i} className={`pc-msg ${m.role}`}>
                    {m.role === 'assistant' && m.engine && <span className="pc-tag">{m.engine}</span>}
                    {sp.think && (
                      <details className="pc-think" open={sp.thinking}>
                        <summary>{sp.thinking ? '思考中…' : '思路'}</summary>
                        <p>{sp.think}</p>
                      </details>
                    )}
                    {sp.answer && <p>{sp.answer}</p>}
                    {m.role === 'assistant' && sp.answer && voiceAvail && m.speakable && (
                      <button type="button" className="pc-say" onClick={() => speak(sp.answer)}>🔊 朗读</button>
                    )}
                    {m.chunks && m.chunks.length > 0 && (
                      <details className="pc-basis">
                        <summary>依据 {m.chunks.length} 段</summary>
                        {m.chunks.map(c => (
                          <div key={c.id} className="pc-basis-item">
                            <button type="button" className="pc-basis-src" disabled={!c.path || !onOpenDoc}
                              onClick={() => { if (c.path && onOpenDoc) { onOpenDoc(c.path); onClose(); } }}>
                              {c.pathLabel}{c.kind ? ` · ${c.kind}` : ''}{c.year ? ` · ${c.year}` : ''}
                              {c.tier !== 'public' && <i className="pc-tier">{c.tier === 'secret' ? '绝密' : '私密'}</i>}
                            </button>
                            <p>{c.text}</p>
                          </div>
                        ))}
                      </details>
                    )}
                  </div>
                );
              })}
              {busy && <div className="pc-msg assistant"><span className="pc-dots"><i /><i /><i /></span></div>}
            </div>

            <div className="pc-input">
              <textarea value={input} onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
                placeholder={`和 ${displayName} 说话…（Enter 发送 · Shift+Enter 换行）`}
                rows={2} aria-label="输入消息" />
              <button className="pc-send" onClick={() => void send()} disabled={busy || !input.trim()}>发送</button>
            </div>

            <footer className="pc-foot">
              <button type="button" className="pc-foot-btn" onClick={() => setShowBasis(v => !v)} aria-expanded={showBasis}>
                {showBasis ? '收起本次语料' : '查看本次装入的语料'}
              </button>
              {lastCtx && <span className="pc-foot-meta">本次装入 {lastCtx.meta.retrieved} 段 · 因未解锁拦截 {lastCtx.meta.blockedByUnlock} 段</span>}
              <span className="pc-foot-meta">对话不留存 · 不写入档案</span>
            </footer>
            {showBasis && lastCtx && <div className="pc-basis-all"><pre>{lastCtx.systemPrompt}</pre></div>}
          </>
        )}
      </div>
    </div>
  );
}
