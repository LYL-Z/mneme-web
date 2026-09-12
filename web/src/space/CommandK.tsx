import { useEffect, useRef, useState, type ReactNode } from 'react';
import { animate } from 'animejs';
import { api, apiErrorMessage, type SearchGroups } from '../api';
import { notify } from '../toast';
import { useFocusTrap } from '../focusTrap';
import { getHighlights, getRecentDocs, isPublicPath, resumeTarget, timeAgo } from '../history';
import { readSilk, recordImagery, recordPerson } from '../silk';
import { routeToPath, type SpaceKey } from '../route';
import { isModifiedClick } from '../navClick';
import { askUnlock } from '../unlock';
import { prefetchDoc } from '../prefetch';
import { copyPermalink } from '../cite';
import { armSnapshot, dismissGlass } from '../glassDismiss';

/**
 * ⌘K / Ctrl+K 全局检索 · 六分组全部可达（v3.2）
 * 文档→Σ7 · 人物→Σ3 · 时间线→Σ2 定位 · 意象→Σ6 聚焦 · 卷章→Σ4 开卷/读章 · 问卷→Σ7 原卷
 * 防抖 250ms + 过期响应守卫；中文输入法组词期不触发 Enter/方向键。
 */
type Act =
  | { t: 'doc'; path: string; label: string; sn: string }
  | { t: 'person'; id: number; label: string }
  | { t: 'river'; year: number; eventId: number; label: string }
  | { t: 'imagery'; id: number; label: string }
  | { t: 'chapter'; code: string; seq: number | null; docPath: string | null; label: string }
  | { t: 'questionnaire'; docPath: string; label: string }
  /* v8 · 3.4 检索历史（v3 §3.3 要求）：空输入时列出最近检索词，↑↓ 选择、Enter 回填重检 */
  | { t: 'hist'; q: string; label: string }
  | { t: 'recent'; path: string; label: string }
  | { t: 'gate'; label: string }
  | { t: 'cmd'; id: string; label: string; hint: string }
  | { t: 'hl'; path: string; heading: string; snippet: string; label: string }
  | { t: 'silk'; label: string; hint: string };

const CMDS: { id: string; label: string; hint: string }[] = [
  { id: 'archive', label: '去原文档案馆', hint: 'g a' },
  { id: 'stars', label: '去记忆恒星', hint: 'g h' },
  { id: 'river', label: '去时间之河', hint: 'g r' },
  { id: 'graph', label: '去人物星图', hint: 'g p' },
  { id: 'study', label: '去书房', hint: 'g y' },
  { id: 'themes', label: '去主题域', hint: 'g t' },
  { id: 'voices', label: '去他者之声', hint: 'g v' },
  { id: 'museum', label: '去意象博物馆', hint: 'g m' },
  { id: 'lighthouse', label: '去证据灯塔', hint: 'g l' },
  { id: 'copy', label: '复制本页深链', hint: 'c' },
  { id: 'prefs', label: '打开偏好', hint: '' },
  { id: 'theme', label: '切换纸色 / 墨夜', hint: '' },
  { id: 'unlock', label: '打开绝密档案', hint: '' },
];

const HIST_KEY = 'mneme-ck-history';
const HIST_MAX = 8;
const loadHist = (): string[] => {
  try {
    const o: unknown = JSON.parse(localStorage.getItem(HIST_KEY) || '[]');
    return Array.isArray(o) ? o.filter(x => typeof x === 'string' && x.trim()).slice(0, HIST_MAX) : [];
  } catch { return []; } // 隐私模式/损坏 → 空历史
};
const saveHist = (list: string[]): void => {
  try { localStorage.setItem(HIST_KEY, JSON.stringify(list.slice(0, HIST_MAX))); } catch { /* 存储不可用则仅存会话内存 */ }
};

/** 分组标题（组件外声明：避免每次渲染重建组件类型导致列表重挂载、键盘焦点错位） */
function Group({ name, greek }: { name: string; greek: string }) {
  return <p className="ck-gname"><span className="greek">{greek}</span>{name}</p>;
}

function CkHit({ href, ix, on, onHover, onPick, children }: {
  href: string;
  ix: number;
  on: boolean;
  onHover: () => void;
  onPick: () => void;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      id={`ck-opt-${ix}`}
      role="option"
      aria-selected={on}
      className={`ck-item ${on ? 'on' : ''}`}
      onMouseEnter={onHover}
      onClick={e => { if (isModifiedClick(e)) return; e.preventDefault(); onPick(); }}
    >
      {children}
    </a>
  );
}

export function CommandK({ open, onClose, onOpenDoc, onOpenPerson, onOpenRiver, onOpenImagery, onOpenVolume, onOpenChapter, onGoSpace, onToggleTheme }: {
  open: boolean;
  onClose: () => void;
  onOpenDoc: (path: string, h?: string, ev?: number, q?: string) => void;
  onOpenPerson: (id: number) => void;
  onOpenRiver: (year?: number, eventId?: number) => void;
  onOpenImagery: (id: number) => void;
  onOpenVolume: (code: string) => void;
  onOpenChapter: (code: string, seq: number) => void;
  onGoSpace?: (key: SpaceKey) => void;
  onToggleTheme?: () => void;
}) {
  const [q, setQ] = useState('');
  const [groups, setGroups] = useState<SearchGroups | null>(null);
  const [cursor, setCursor] = useState(0);
  const [hist, setHist] = useState<string[]>(loadHist);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const seqRef = useRef(0);
  const triggerRef = useRef<HTMLElement | null>(null); // 打开时的触发点：关闭后归还焦点
  const closing = useRef(false);
  useFocusTrap(boxRef, open);

  /* 统一出口：检索命中立刻关（保 INP）；Esc / 点遮罩走粒子 */
  const finishClose = () => {
    closing.current = false;
    const t = triggerRef.current;
    triggerRef.current = null;
    onClose();
    if (t && document.contains(t)) t.focus({ preventScroll: true });
    else (document.querySelector('.rail-space.on') as HTMLElement | null)?.focus({ preventScroll: true });
  };
  const close = (fx = false) => {
    if (closing.current) return;
    if (fx) {
      closing.current = true;
      dismissGlass(boxRef.current, finishClose);
      return;
    }
    finishClose();
  };

  useEffect(() => {
    if (!open) return;
    const vv = window.visualViewport;
    if (!vv) return;
    const sync = () => {
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      document.documentElement.style.setProperty('--vv-kb', `${inset}px`);
    };
    vv.addEventListener('resize', sync);
    vv.addEventListener('scroll', sync);
    sync();
    return () => {
      vv.removeEventListener('resize', sync);
      vv.removeEventListener('scroll', sync);
      document.documentElement.style.removeProperty('--vv-kb');
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (!triggerRef.current) {
      const el = document.activeElement as HTMLElement | null;
      if (el && el !== document.body) triggerRef.current = el; // ⌘K 唤起自按钮/链接时记住
      else triggerRef.current = document.querySelector('.ck-hint'); // 键盘唤起无触发点 → 归给常驻入口
    }
    setQ(''); setGroups(null); setCursor(0);
    closing.current = false;
    setTimeout(() => inputRef.current?.focus(), 30);
    setTimeout(() => armSnapshot(boxRef.current), 400);
    const el = listRef.current?.parentElement;
    if (el && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      animate(el, { opacity: [0, 1], translateY: [-14, 0], scale: [0.98, 1], duration: 320, ease: 'outExpo' });
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const query = q.trim();
    if (!query) { setGroups(null); return; }
    const t = setTimeout(() => {
      const seq = ++seqRef.current;
      api.search(query).then(r => {
        if (seq !== seqRef.current) return; // 过期响应丢弃，旧结果不覆盖新输入
        setGroups(r.groups); setCursor(0);
      }).catch(e => {
        if (seq !== seqRef.current) return; // 过期响应丢弃
        setGroups({});
        notify(apiErrorMessage(e), 'error'); // 「无结果」与「检索失败」不再混为一谈
      });
    }, 250);
    return () => clearTimeout(t);
  }, [q, open]);

  const flat: Act[] = [];
  const qn = q.trim();
  const qLow = qn.toLowerCase();
  const cmdHits = CMDS.filter(c =>
    !qn
    || c.label.includes(qn)
    || c.label.toLowerCase().includes(qLow)
    || c.id.toLowerCase().includes(qLow)
    || c.hint.toLowerCase().includes(qLow),
  );
  /* 空输入 → 最近检索（同样可 ↑↓ / Enter）；有输入时命令仍可被滤出 */
  const recents = !qn
    ? getRecentDocs().filter(d => isPublicPath(d.path)).slice(0, 5)
    : [];
  const marks = !qn ? getHighlights().slice(0, 3) : [];
  const silkAct = !qn ? (() => {
    const s = readSilk();
    const r = s.resume;
    if (r?.kind === 'chapter' && s.chapter) return { t: 'silk' as const, label: s.chapter.title, hint: `${s.chapter.volume} · ${timeAgo(s.chapter.t)}` };
    if (r?.kind === 'doc' && s.doc) return { t: 'silk' as const, label: s.doc.title, hint: `${s.doc.domain} · ${timeAgo(s.doc.t)}` };
    return { t: 'silk' as const, label: '从序翻起', hint: '按昨天停的地方往下翻' };
  })() : null;
  if (silkAct) flat.push(silkAct);
  cmdHits.forEach(c => flat.push({ t: 'cmd', id: c.id, label: c.label, hint: c.hint }));
  if (!qn) {
    hist.forEach(h => flat.push({ t: 'hist', q: h, label: h }));
    recents.forEach(d => flat.push({ t: 'recent', path: d.path, label: d.title }));
    marks.forEach(h => flat.push({ t: 'hl', path: h.path, heading: h.heading, snippet: h.snippet, label: h.snippet }));
  }
  if (qn && groups) {
    (groups.doc ?? []).slice(0, 6).forEach(d => flat.push(d.locked
      ? { t: 'gate', label: `${d.title}（绝密）` }
      : { t: 'doc', path: d.path, label: d.title, sn: d.sn || '' }));
    (groups.person ?? []).slice(0, 4).forEach(p => flat.push(p.locked
      ? { t: 'gate', label: `${p.display_name}（绝密档案）` }
      : { t: 'person', id: p.id, label: `${p.display_name}（${p.relation_group}·${p.mention_count}次）` }));
    (groups.timeline ?? []).slice(0, 3).forEach(t => flat.push(t.locked
      ? { t: 'gate', label: `${t.year} ${t.title}（绝密）` }
      : { t: 'river', year: t.year, eventId: t.id, label: `${t.year} ${t.title}` }));
    (groups.imagery ?? []).slice(0, 2).forEach(i => flat.push(i.locked
      ? { t: 'gate', label: `意象·${i.name}（绝密）` }
      : { t: 'imagery', id: i.id, label: `意象·${i.name}` }));
    (groups.volume ?? []).slice(0, 3).forEach(v => flat.push(v.locked
      ? { t: 'gate', label: `${v.typ === 'chapter' ? '章节' : '部'}·${v.title}（绝密）` }
      : {
        t: 'chapter', code: v.code,
        seq: v.typ === 'chapter' ? (v.seq ?? null) : null,
        docPath: v.doc_path ?? null,
        label: `${v.typ === 'chapter' ? '章节' : '部'}·${v.title}`,
      }));
    (groups.questionnaire ?? []).slice(0, 2).forEach(qq => flat.push(qq.locked || !qq.doc_path
      ? { t: 'gate', label: qq.respondent_label ? `问卷·${qq.respondent_label}（绝密）` : '绝密问卷' }
      : { t: 'questionnaire', docPath: qq.doc_path, label: `问卷·${qq.respondent_label}` }));
  }

  /* 只有真正「打开了东西」才记历史：单纯的输入不算 */
  const remember = (s: string) => {
    const v = s.trim();
    if (v.length < 2) return;
    setHist(prev => {
      const next = [v, ...prev.filter(x => x !== v)].slice(0, HIST_MAX);
      saveHist(next);
      return next;
    });
  };
  const run = (a: Act) => {
    if (a.t === 'hist') { setQ(a.q); setCursor(0); inputRef.current?.focus(); return; } // 回填重检，面板不关
    if (a.t === 'silk') {
      close();
      const r = resumeTarget();
      if (!r) { onOpenChapter('P0', 1); return; }
      if (r.kind === 'chapter') onOpenChapter(r.code, r.seq);
      else onOpenDoc(r.path);
      return;
    }
    if (a.t === 'recent') { close(); onOpenDoc(a.path); return; }
    if (a.t === 'hl') { close(); onOpenDoc(a.path, a.heading || undefined, undefined, a.snippet.slice(0, 48)); return; }
    if (a.t === 'cmd') {
      close();
      if (a.id === 'copy') copyPermalink();
      else if (a.id === 'prefs') window.dispatchEvent(new CustomEvent('mneme:prefs'));
      else if (a.id === 'theme') onToggleTheme?.();
      else if (a.id === 'unlock') askUnlock();
      else if (onGoSpace) onGoSpace(a.id as SpaceKey);
      return;
    }
    if (a.t === 'gate') { close(); askUnlock(); return; }
    remember(q);
    close();
    const hitQ = (q.trim() || (a.t === 'doc' ? a.sn : '')).slice(0, 48) || undefined;
    if (a.t === 'doc') onOpenDoc(a.path, undefined, undefined, hitQ);
    else     if (a.t === 'person') { recordPerson({ id: a.id, name: a.label }); onOpenPerson(a.id); }
    else if (a.t === 'river') onOpenRiver(a.year, a.eventId);
    else if (a.t === 'imagery') { recordImagery({ id: a.id, name: a.label.replace(/^意象·/, '') }); onOpenImagery(a.id); }
    else if (a.t === 'chapter') {
      if (a.seq != null) onOpenChapter(a.code, a.seq);      // 章节命中 → 直达材料链面板
      else if (a.docPath) onOpenDoc(a.docPath, undefined, undefined, hitQ);
      else onOpenVolume(a.code);                            // 部命中 → 书房开门
    }
    else if (a.t === 'questionnaire') onOpenDoc(a.docPath, undefined, undefined, hitQ);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // 中文输入法组词/确认候选阶段：不拦截任何键（Enter 属于选字，不执行命令）
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Escape') {
        e.stopPropagation(); // 捕获阶段拦截：Esc 只关检索，不穿透关闭底层章节面板
        close(true);
      }
      else if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(c + 1, flat.length - 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)); }
      else if (e.key === 'Enter' && flat[cursor]) run(flat[cursor]);
    };
    window.addEventListener('keydown', onKey, true); // 捕获：先于面板的同名监听
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, flat, cursor]);

  useEffect(() => {
    listRef.current?.querySelector('.ck-item.on')?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  if (!open) return null;
  let idx = -1;

  return (
    <div className="ck-mask" onMouseDown={() => close(true)}>
      <div ref={boxRef} className="ck glass chrome" onMouseDown={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="检索全库">
        <input
          ref={inputRef} className="ck-input" value={q}
          placeholder="检索全库，或选择一条命令…"
          onChange={e => setQ(e.target.value)}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded="true"
          aria-controls="ck-listbox"
          aria-activedescendant={flat.length ? `ck-opt-${cursor}` : undefined}
        />
        <div className="ck-list" ref={listRef} id="ck-listbox" role="listbox" aria-label="检索结果">
          {silkAct && (() => {
            idx += 1;
            const ix = idx;
            return (
              <>
                <p className="ck-gname"><span className="greek">ΤΑΙΝΙΑ</span>丝带续读</p>
                <button key="silk" id={`ck-opt-${ix}`} role="option" aria-selected={cursor === ix}
                  className={`ck-item ${cursor === ix ? 'on' : ''}`}
                  onMouseEnter={() => setCursor(ix)} onClick={() => run(silkAct)}>
                  <b>{silkAct.label}</b><span>{silkAct.hint}</span>
                </button>
              </>
            );
          })()}
          {cmdHits.length > 0 && (
            <>
              <p className="ck-gname"><span className="greek">ΕΝΤΟΛΗ</span>命令</p>
              {cmdHits.map(c => {
                idx += 1;
                const ix = idx;
                return (
                  <button key={c.id} id={`ck-opt-${ix}`} role="option" aria-selected={cursor === ix}
                    className={`ck-item ${cursor === ix ? 'on' : ''}`}
                    onMouseEnter={() => setCursor(ix)} onClick={() => run({ t: 'cmd', id: c.id, label: c.label, hint: c.hint })}>
                    <b>{c.label}</b><span>{c.hint || '动作'}</span>
                  </button>
                );
              })}
            </>
          )}
          {!q.trim() && hist.length > 0 && (
            <>
              <p className="ck-gname">
                <span className="greek">ΑΝΑΜΝΗΣΙΣ</span>最近检索
                <button className="ck-clear" onClick={() => { setHist([]); saveHist([]); setCursor(0); }}>清除</button>
              </p>
              {hist.map(h => {
                idx += 1;
                const ix = idx;
                return (
                  <button key={h} id={`ck-opt-${ix}`} role="option" aria-selected={cursor === ix} className={`ck-item ${cursor === ix ? 'on' : ''}`}
                    onMouseEnter={() => setCursor(ix)} onClick={() => run({ t: 'hist', q: h, label: h })}>
                    <b>{h}</b><span>重新检索</span>
                  </button>
                );
              })}
            </>
          )}
          {!q.trim() && recents.length > 0 && (
            <>
              <p className="ck-gname"><span className="greek">ΥΛΗ</span>最近材料</p>
              {recents.map(d => {
                idx += 1;
                const ix = idx;
                return (
                  <CkHit key={d.path} href={routeToPath({ v: 'doc', path: d.path })} ix={ix} on={cursor === ix}
                    onHover={() => { setCursor(ix); prefetchDoc(d.path); }} onPick={() => run({ t: 'recent', path: d.path, label: d.title })}>
                    <b>{d.title}</b><span>{d.domain} · 续读</span>
                  </CkHit>
                );
              })}
            </>
          )}
          {!q.trim() && marks.length > 0 && (
            <>
              <p className="ck-gname"><span className="greek">ΣΗΜΕΙΟΝ</span>本机划线</p>
              {marks.map(h => {
                idx += 1;
                const ix = idx;
                return (
                  <button key={h.id} id={`ck-opt-${ix}`} role="option" aria-selected={cursor === ix}
                    className={`ck-item ${cursor === ix ? 'on' : ''}`}
                    onMouseEnter={() => setCursor(ix)}
                    onClick={() => run({ t: 'hl', path: h.path, heading: h.heading, snippet: h.snippet, label: h.snippet })}>
                    <b>{h.snippet}</b><span>{h.title}</span>
                  </button>
                );
              })}
            </>
          )}
          {q.trim() && groups === null && <p className="ck-empty" aria-busy="true">检索中…</p>}
          {q.trim() && flat.length === 0 && groups && <p className="ck-empty">无所检出。</p>}
          {q.trim() && groups?.doc?.length ? <Group name="文档" greek="ΓΡΑΦΗ" /> : null}
          {q.trim() && groups?.doc?.slice(0, 6).map(d => {
            idx += 1;
            const sn = (d.sn || '').replace(/\s+/g, ' ').trim();
            if (d.locked) {
              return (
                <button key={d.path} id={`ck-opt-${idx}`} role="option" aria-selected={cursor === idx}
                  className={`ck-item ${cursor === idx ? 'on' : ''}`}
                  onMouseEnter={() => setCursor(idx)} onClick={() => run({ t: 'gate', label: d.title })}>
                  <b>{d.title}</b><span>绝密档案 · 需管理员密码</span>
                </button>
              );
            }
            return (
              <CkHit key={d.path} href={routeToPath({ v: 'doc', path: d.path, q: q.trim() || undefined })} ix={idx} on={cursor === idx}
                onHover={() => { setCursor(idx); prefetchDoc(d.path); }} onPick={() => run({ t: 'doc', path: d.path, label: d.title, sn: d.sn || '' })}>
                <b>{d.title}</b><span>{d.domain} · {d.stage}</span>
                {sn ? <span className="ck-sn">{sn.slice(0, 88)}{sn.length > 88 ? '…' : ''}</span> : null}
              </CkHit>
            );
          })}
          {q.trim() && groups?.person?.length ? <Group name="人物" greek="ΠΡΟΣΩΠΑ" /> : null}
          {q.trim() && groups?.person?.slice(0, 4).map(p => {
            idx += 1;
            if (p.locked) {
              return (
                <button key={p.id} id={`ck-opt-${idx}`} role="option" aria-selected={cursor === idx}
                  className={`ck-item ${cursor === idx ? 'on' : ''}`}
                  onMouseEnter={() => setCursor(idx)} onClick={() => run({ t: 'gate', label: p.display_name })}>
                  <b>{p.display_name}</b><span>绝密档案 · 需管理员密码</span>
                </button>
              );
            }
            return (
              <CkHit key={p.id} href={routeToPath({ v: 'person', id: p.id })} ix={idx} on={cursor === idx}
                onHover={() => setCursor(idx)} onPick={() => run({ t: 'person', id: p.id, label: p.display_name })}>
                <b>{p.display_name}</b><span>{p.relation_group} · 提及 {p.mention_count}</span>
              </CkHit>
            );
          })}
          {q.trim() && groups?.timeline?.length ? <Group name="时间线" greek="ΧΡΟΝΟΣ" /> : null}
          {q.trim() && groups?.timeline?.slice(0, 3).map(t => {
            idx += 1;
            if (t.locked) {
              return (
                <button key={t.id} id={`ck-opt-${idx}`} role="option" aria-selected={cursor === idx}
                  className={`ck-item ${cursor === idx ? 'on' : ''}`}
                  onMouseEnter={() => setCursor(idx)} onClick={() => run({ t: 'gate', label: t.title })}>
                  <b>{t.year} {t.title}</b><span>绝密档案 · 需管理员密码</span>
                </button>
              );
            }
            return (
              <CkHit key={t.id} href={routeToPath({ v: 'space', key: 'river', river: { y: t.year } })} ix={idx} on={cursor === idx}
                onHover={() => setCursor(idx)} onPick={() => run({ t: 'river', year: t.year, eventId: t.id, label: t.title })}>
                <b>{t.year} {t.title}</b><span>{t.stage} · 河上定位</span>
              </CkHit>
            );
          })}
          {q.trim() && (groups?.imagery?.length || groups?.volume?.length || groups?.questionnaire?.length) ? (
            <>
              <Group name="其余线索" greek="ΙΧΝΟΣ" />
              {groups?.imagery?.slice(0, 2).map(i => {
                idx += 1;
                if (i.locked) {
                  return (
                    <button key={`im${i.id}`} id={`ck-opt-${idx}`} role="option" aria-selected={cursor === idx}
                      className={`ck-item ${cursor === idx ? 'on' : ''}`}
                      onMouseEnter={() => setCursor(idx)} onClick={() => run({ t: 'gate', label: i.name })}>
                      <b>意象·{i.name}</b><span>绝密档案 · 需管理员密码</span>
                    </button>
                  );
                }
                return (
                  <CkHit key={`im${i.id}`} href={routeToPath({ v: 'imagery', id: i.id })} ix={idx} on={cursor === idx}
                    onHover={() => setCursor(idx)} onPick={() => run({ t: 'imagery', id: i.id, label: i.name })}>
                    <b>意象·{i.name}</b><span>{i.occ} 处登场 · 直达展柜</span>
                  </CkHit>
                );
              })}
              {groups?.volume?.slice(0, 3).map((v, i2) => {
                idx += 1;
                const isCh = v.typ === 'chapter';
                if (v.locked) {
                  return (
                    <button key={`vo${v.typ}-${v.code}-${i2}`} id={`ck-opt-${idx}`} role="option" aria-selected={cursor === idx}
                      className={`ck-item ${cursor === idx ? 'on' : ''}`}
                      onMouseEnter={() => setCursor(idx)} onClick={() => run({ t: 'gate', label: v.title })}>
                      <b>{isCh ? '章节' : '部'}·{v.title}</b><span>绝密档案 · 需管理员密码</span>
                    </button>
                  );
                }
                const href = isCh && v.seq != null
                  ? routeToPath({ v: 'chapter', code: v.code, seq: v.seq })
                  : v.doc_path
                    ? routeToPath({ v: 'doc', path: v.doc_path })
                    : routeToPath({ v: 'volume', code: v.code });
                return (
                  <CkHit key={`vo${v.typ}-${v.code}-${i2}`} href={href} ix={idx} on={cursor === idx}
                    onHover={() => setCursor(idx)} onPick={() => run({ t: 'chapter', code: v.code, seq: isCh ? (v.seq ?? null) : null, docPath: v.doc_path ?? null, label: v.title })}>
                    <b>{isCh ? '章节' : '部'}·{v.title}</b><span>{isCh ? '开材料链' : '开部 · 书房'}</span>
                  </CkHit>
                );
              })}
              {groups?.questionnaire?.slice(0, 2).map(qq => {
                idx += 1;
                if (qq.locked || !qq.doc_path) {
                  return (
                    <button key={`qu${qq.id}`} id={`ck-opt-${idx}`} role="option" aria-selected={cursor === idx}
                      className={`ck-item ${cursor === idx ? 'on' : ''}`}
                      onMouseEnter={() => setCursor(idx)} onClick={() => run({ t: 'gate', label: '绝密问卷' })}>
                      <b>{qq.respondent_label ? `问卷·${qq.respondent_label}` : '绝密问卷'}</b><span>绝密档案 · 需管理员密码</span>
                    </button>
                  );
                }
                const qPath = qq.doc_path;
                return (
                  <CkHit key={`qu${qq.id}`} href={routeToPath({ v: 'doc', path: qPath })} ix={idx} on={cursor === idx}
                    onHover={() => setCursor(idx)} onPick={() => run({ t: 'questionnaire', docPath: qPath, label: qq.respondent_label || '问卷' })}>
                    <b>问卷·{qq.respondent_label}</b><span>读原卷</span>
                  </CkHit>
                );
              })}
            </>
          ) : null}
        </div>
        <footer className="ck-foot"><span>↑↓ 选择</span><span>Enter 打开</span><span>Esc 关闭</span><span>? 快捷键</span></footer>
      </div>
    </div>
  );
}
