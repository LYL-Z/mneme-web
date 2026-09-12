import { useEffect, useMemo, useRef, useState } from 'react';
import { api, apiErrorMessage, swrInvalidate, type AdminStatus, type SourceDoc } from '../api';
import { clearDraft, loadDraft, saveDraft } from '../drafts';
import { isPublicPath } from '../history';
import { notify } from '../toast';
import { useFocusTrap } from '../focusTrap';

/**
 * 站内写作台 · 对照 iA Writer / Linear
 * 源码即工作面；写回本机 vault；AI 只插入草稿，不自动保存。
 */
export function DeskWrite({ path, wantAi, onClose, onSaved }: {
  path: string;
  wantAi?: boolean;
  onClose: () => void;
  onSaved: (text: string) => void;
}) {
  const [st, setSt] = useState<AdminStatus | null>(null);
  const [src, setSrc] = useState<SourceDoc | null>(null);
  const [text, setText] = useState('');
  const [token, setToken] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [aiOpen, setAiOpen] = useState(!!wantAi);
  const [mode, setMode] = useState<'continue' | 'polish' | 'expand'>('continue');
  const [hint, setHint] = useState('');
  const [draft, setDraft] = useState('');
  const [engine, setEngine] = useState('');
  const [conflict, setConflict] = useState(false);
  const [restored, setRestored] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const ta = useRef<HTMLTextAreaElement>(null);
  const gate = useRef<HTMLInputElement>(null);
  const dirty = !!src && text !== src.text;
  const textRef = useRef(text);
  const dirtyRef = useRef(dirty);
  textRef.current = text;
  dirtyRef.current = dirty;

  const askClose = () => {
    if (dirty && !window.confirm('有未写回的改动，确定丢掉？')) return;
    onClose();
  };
  const onEsc = () => {
    if (aiOpen) { setAiOpen(false); return; }
    askClose();
  };
  useFocusTrap(box, true, onEsc);

  const chars = useMemo(() => text.replace(/\s+/g, '').length, [text]);
  const syncLabel = !st?.sync ? '' : st.sync.pending ? '索引中' : '已跟上';

  const applySource = (s: SourceDoc, keepLocal?: string) => {
    setSrc(s);
    const local = keepLocal ?? (isPublicPath(path) ? loadDraft(path)?.text : undefined);
    if (local && local !== s.text) {
      setText(local);
      setRestored(true);
    } else {
      setText(s.text);
      setRestored(false);
    }
    setConflict(false);
  };

  const load = (keepLocal?: string) => {
    api.source(path).then(s => {
      if (!s) { notify('这篇不能在站内打开', 'warn'); onClose(); return; }
      applySource(s, keepLocal);
    }).catch(e => notify(apiErrorMessage(e) || '无法读取原文', 'error'));
  };

  useEffect(() => { api.adminStatus().then(setSt).catch(() => setSt({ admin: false, vault: false, ai: false })); }, []);
  useEffect(() => { if (st?.admin) load(); }, [st?.admin, path]);
  useEffect(() => () => {
    if (dirtyRef.current && isPublicPath(path)) saveDraft(path, textRef.current);
  }, [path]);
  useEffect(() => { if (wantAi) setAiOpen(true); }, [wantAi]);
  useEffect(() => {
    if (st && !st.admin) setTimeout(() => gate.current?.focus(), 40);
    else setTimeout(() => ta.current?.focus(), 40);
  }, [st?.admin]);
  useEffect(() => {
    if (!st?.admin) return;
    const tick = () => api.adminStatus().then(setSt).catch(() => {});
    const id = window.setInterval(tick, 4000);
    return () => window.clearInterval(id);
  }, [st?.admin]);
  useEffect(() => {
    if (!dirty || !isPublicPath(path)) return;
    const t = window.setTimeout(() => saveDraft(path, text), 400);
    return () => window.clearTimeout(t);
  }, [dirty, path, text]);
  useEffect(() => {
    if (!dirty) return;
    const on = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', on);
    return () => window.removeEventListener('beforeunload', on);
  }, [dirty]);

  const signIn = async () => {
    setBusy(true); setErr('');
    const ok = await api.adminSession(token);
    setBusy(false);
    setToken('');
    if (!ok) { setErr('管理口令不符'); return; }
    const next = await api.adminStatus();
    setSt(next);
  };

  const save = async () => {
    if (!src?.writable) { notify('当前环境不能写回知识库', 'warn'); return; }
    setBusy(true);
    try {
      const r = await api.saveSource(path, text, src.mtime);
      setSrc({ ...src, text, mtime: r.mtime, sha256: r.sha256, title: r.title || src.title });
      clearDraft(path);
      setRestored(false);
      setConflict(false);
      swrInvalidate();
      navigator.serviceWorker?.controller?.postMessage({ type: 'mneme-forget-doc', path });
      notify('已写回知识库', 'info');
      onSaved(text);
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 409) setConflict(true);
      else notify(apiErrorMessage(e) || '写回失败', 'error');
    } finally { setBusy(false); }
  };

  const takeRemote = () => { load(''); };
  const keepMine = async () => {
    const remote = await api.source(path).catch(() => null);
    if (!remote) { notify('无法读取知识库版本', 'warn'); return; }
    setSrc({ ...remote, text });
    setConflict(false);
    notify('已对齐知识库时间，可再写回', 'info');
  };

  const runAi = async () => {
    setBusy(true);
    try {
      const sel = ta.current ? text.slice(ta.current.selectionStart, ta.current.selectionEnd) : '';
      const r = await api.aiDraft({ path, text, selection: sel, mode, instruction: hint });
      setDraft(r.text);
      setEngine(r.engine === 'llm' ? '模型起草' : '本地脚手架');
    } catch (e) {
      notify(apiErrorMessage(e) || '起草失败', 'error');
    } finally { setBusy(false); }
  };

  const insertDraft = () => {
    if (!draft) return;
    const el = ta.current;
    if (!el) { setText(t => `${t}\n\n${draft}`); setDraft(''); return; }
    el.focus();
    const ok = document.execCommand('insertText', false, draft);
    if (!ok) {
      const a = el.selectionStart;
      const b = el.selectionEnd;
      el.setRangeText(draft, a, b, 'end');
      setText(el.value);
    }
    setDraft('');
    notify('草稿已插入，尚未写回', 'info');
  };

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return;
      if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S')) { e.preventDefault(); void save(); }
      if (e.key === 'Escape') onEsc();
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  });

  return (
    <div className="dw" ref={box} role="dialog" aria-label="写作台">
      <header className="dw-bar">
        <p className="dw-kicker">ΓΡΑΦΕΙΟΝ · 写作台</p>
        <h2>{src?.title || path.split('/').pop()}</h2>
        <span className="dw-meta">
          {chars.toLocaleString()} 字
          {dirty ? ' · 未写回' : ''}
          {src && !src.writable ? ' · 只读' : ''}
          {syncLabel ? ` · ${syncLabel}` : ''}
        </span>
        <button type="button" className="ar-tool" onClick={() => setAiOpen(v => !v)}>AI</button>
        <button type="button" className="ar-tool" disabled={busy || !dirty || !src?.writable} onClick={() => void save()}>写回</button>
        <button type="button" className="ar-tool" onClick={askClose}>完成</button>
      </header>

      {conflict && (
        <div className="dw-conflict glass" role="alert">
          <p>知识库里的文件已更新。</p>
          <button type="button" className="dw-run" onClick={takeRemote}>载入知识库版本</button>
          <button type="button" className="dw-run" onClick={() => void keepMine()}>保留我的并重试</button>
        </div>
      )}

      {restored && (
        <p className="dw-restore">
          已恢复本机未写回草稿
          <button type="button" onClick={() => {
            if (!src) return;
            setText(src.text);
            clearDraft(path);
            setRestored(false);
          }}>丢掉草稿</button>
        </p>
      )}

      {!st?.admin && (
        <form className="dw-gate glass" onSubmit={e => { e.preventDefault(); void signIn(); }}>
          <p>写回知识库需要管理口令。私密层不会出现在这个台面上。</p>
          <input ref={gate} type="password" value={token} onChange={e => setToken(e.target.value)} placeholder="管理口令" autoComplete="current-password" />
          <button type="submit" disabled={busy || !token.trim()}>开启写作台</button>
          {err && <em>{err}</em>}
        </form>
      )}

      {st?.admin && (
        <div className={`dw-work${aiOpen ? ' ai' : ''}`}>
          <textarea
            ref={ta}
            className="dw-ta"
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => {
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
              if (e.key === 'Tab') {
                e.preventDefault();
                const ok = document.execCommand('insertText', false, '  ');
                if (!ok) {
                  const el = e.currentTarget;
                  el.setRangeText('  ', el.selectionStart, el.selectionEnd, 'end');
                  setText(el.value);
                }
                return;
              }
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && draft) {
                e.preventDefault();
                insertDraft();
              }
            }}
            spellCheck={false}
            aria-label="正文"
          />
          {aiOpen && (
            <aside className="dw-ai glass" aria-label="代写">
              <p className="dw-ai-h">代写 · 不自动保存</p>
              <p className="dw-ai-note">缺材料会标【待采】或【有界推演】。评价不是人格结论。</p>
              <div className="dw-modes">
                {(['continue', 'polish', 'expand'] as const).map(m => (
                  <button key={m} type="button" className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>
                    {m === 'continue' ? '续写' : m === 'polish' ? '润色' : '扩提纲'}
                  </button>
                ))}
              </div>
              <input className="dw-hint" value={hint} onChange={e => setHint(e.target.value)} placeholder="可选指令，例如：停在回望，不要补对白" />
              <button type="button" className="dw-run" disabled={busy} onClick={() => void runAi()}>起草</button>
              {engine && <p className="dw-eng">{engine}</p>}
              {draft && (
                <>
                  <pre className="dw-draft">{draft}</pre>
                  <button type="button" className="dw-run" onClick={insertDraft}>插入正文</button>
                </>
              )}
            </aside>
          )}
        </div>
      )}
    </div>
  );
}
