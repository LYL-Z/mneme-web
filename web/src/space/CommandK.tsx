import { useEffect, useRef, useState } from 'react';
import { animate } from 'animejs';
import { api, apiErrorMessage, type SearchGroups } from '../api';
import { notify } from '../toast';

/**
 * ⌘K / Ctrl+K 全局检索 · 六分组全部可达（v3.2）
 * 文档→Σ7 · 人物→Σ3 · 时间线→Σ2 定位 · 意象→Σ6 聚焦 · 卷章→Σ4 开卷/读章 · 问卷→Σ7 原卷
 * 防抖 250ms + 过期响应守卫；中文输入法组词期不触发 Enter/方向键。
 */
type Act =
  | { t: 'doc'; path: string; label: string }
  | { t: 'person'; id: number; label: string }
  | { t: 'river'; year: number; eventId: number; label: string }
  | { t: 'imagery'; id: number; label: string }
  | { t: 'chapter'; code: string; seq: number | null; docPath: string | null; label: string }
  | { t: 'questionnaire'; docPath: string; label: string }
  /* v8 · 3.4 检索历史（v3 §3.3 要求）：空输入时列出最近检索词，↑↓ 选择、Enter 回填重检 */
  | { t: 'hist'; q: string; label: string };

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

export function CommandK({ open, onClose, onOpenDoc, onOpenPerson, onOpenRiver, onOpenImagery, onOpenVolume, onOpenChapter }: {
  open: boolean;
  onClose: () => void;
  onOpenDoc: (path: string) => void;
  onOpenPerson: (id: number) => void;
  onOpenRiver: (year?: number, eventId?: number) => void;
  onOpenImagery: (id: number) => void;
  onOpenVolume: (code: string) => void;
  onOpenChapter: (code: string, seq: number) => void;
}) {
  const [q, setQ] = useState('');
  const [groups, setGroups] = useState<SearchGroups | null>(null);
  const [cursor, setCursor] = useState(0);
  const [hist, setHist] = useState<string[]>(loadHist);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const seqRef = useRef(0);
  const triggerRef = useRef<HTMLElement | null>(null); // 打开时的触发点：关闭后归还焦点

  /* 统一出口：先归焦，再交给调用方导航 */
  const close = () => {
    const t = triggerRef.current;
    triggerRef.current = null;
    onClose();
    if (t && document.contains(t)) t.focus({ preventScroll: true });
    else (document.querySelector('.nav-space.on') as HTMLElement | null)?.focus({ preventScroll: true });
  };

  useEffect(() => {
    if (!open) return;
    if (!triggerRef.current) {
      const el = document.activeElement as HTMLElement | null;
      if (el && el !== document.body) triggerRef.current = el; // ⌘K 唤起自按钮/链接时记住
      else triggerRef.current = document.querySelector('.ck-hint'); // 键盘唤起无触发点 → 归给常驻入口
    }
    setQ(''); setGroups(null); setCursor(0);
    setTimeout(() => inputRef.current?.focus(), 30);
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
  /* 空输入 → 最近检索（同样可 ↑↓ / Enter） */
  if (!q.trim()) hist.forEach(h => flat.push({ t: 'hist', q: h, label: h }));
  if (groups) {
    (groups.doc ?? []).slice(0, 6).forEach(d => flat.push({ t: 'doc', path: d.path, label: d.title }));
    (groups.person ?? []).slice(0, 4).forEach(p => flat.push({ t: 'person', id: p.id, label: `${p.display_name}（${p.relation_group}·${p.mention_count}次）` }));
    (groups.timeline ?? []).slice(0, 3).forEach(t => flat.push({ t: 'river', year: t.year, eventId: t.id, label: `${t.year} ${t.title}` }));
    (groups.imagery ?? []).slice(0, 2).forEach(i => flat.push({ t: 'imagery', id: i.id, label: `意象·${i.name}` }));
    (groups.volume ?? []).slice(0, 3).forEach(v => flat.push({
      t: 'chapter', code: v.code,
      seq: v.typ === 'chapter' ? (v.seq ?? null) : null,
      docPath: v.doc_path ?? null,
      label: `${v.typ === 'chapter' ? '章节' : '卷'}·${v.title}`,
    }));
    (groups.questionnaire ?? []).slice(0, 2).forEach(qq => flat.push({ t: 'questionnaire', docPath: qq.doc_path, label: `问卷·${qq.respondent_label}` }));
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
    remember(q);
    close();
    if (a.t === 'doc') onOpenDoc(a.path);
    else if (a.t === 'person') onOpenPerson(a.id);
    else if (a.t === 'river') onOpenRiver(a.year, a.eventId);
    else if (a.t === 'imagery') onOpenImagery(a.id);
    else if (a.t === 'chapter') {
      if (a.seq != null) onOpenChapter(a.code, a.seq);      // 章节命中 → 直达材料链面板
      else if (a.docPath) onOpenDoc(a.docPath);             // 无 seq 的兜底（不应出现）
      else onOpenVolume(a.code);                            // 卷命中 → 五卷书房开卷
    }
    else if (a.t === 'questionnaire') onOpenDoc(a.docPath);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // 中文输入法组词/确认候选阶段：不拦截任何键（Enter 属于选字，不执行命令）
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Escape') {
        e.stopPropagation(); // 捕获阶段拦截：Esc 只关检索，不穿透关闭底层章节面板
        close();
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
    <div className="ck-mask" onMouseDown={close}>
      <div className="ck glass" onMouseDown={e => e.stopPropagation()}>
        <input
          ref={inputRef} className="ck-input" value={q}
          placeholder="检索全库：文档 · 人物 · 时间线 · 意象 · 卷章 · 问卷"
          onChange={e => setQ(e.target.value)}
        />
        <div className="ck-list" ref={listRef}>
          {!q.trim() && hist.length > 0 && (
            <>
              <p className="ck-gname">
                <span className="greek">ΑΝΑΜΝΗΣΙΣ</span>最近检索
                <button className="ck-clear" onClick={() => { setHist([]); saveHist([]); setCursor(0); }}>清除</button>
              </p>
              {hist.map((h, i) => (
                <button key={h} className={`ck-item ${cursor === i ? 'on' : ''}`}
                  onMouseEnter={() => setCursor(i)} onClick={() => run({ t: 'hist', q: h, label: h })}>
                  <b>{h}</b><span>重新检索</span>
                </button>
              ))}
            </>
          )}
          {!q.trim() && hist.length === 0 && <p className="ck-empty">输入以检索全库 · 六类线索均可直达</p>}
          {q.trim() && flat.length === 0 && groups && <p className="ck-empty">无所检出。</p>}
          {groups?.doc?.length ? <Group name="文档" greek="ΓΡΑΦΗ" /> : null}
          {groups?.doc?.slice(0, 6).map(d => {
            idx += 1;
            return (
              <button key={d.path} className={`ck-item ${cursor === idx ? 'on' : ''}`}
                onMouseEnter={() => setCursor(idx)} onClick={() => run({ t: 'doc', path: d.path, label: d.title })}>
                <b>{d.title}</b><span>{d.domain} · {d.stage}</span>
              </button>
            );
          })}
          {groups?.person?.length ? <Group name="人物" greek="ΠΡΟΣΩΠΑ" /> : null}
          {groups?.person?.slice(0, 4).map(p => {
            idx += 1;
            return (
              <button key={p.id} className={`ck-item ${cursor === idx ? 'on' : ''}`}
                onMouseEnter={() => setCursor(idx)} onClick={() => run({ t: 'person', id: p.id, label: p.display_name })}>
                <b>{p.display_name}</b><span>{p.relation_group} · 提及 {p.mention_count}</span>
              </button>
            );
          })}
          {groups?.timeline?.length ? <Group name="时间线" greek="ΧΡΟΝΟΣ" /> : null}
          {groups?.timeline?.slice(0, 3).map(t => {
            idx += 1;
            return (
              <button key={t.id} className={`ck-item ${cursor === idx ? 'on' : ''}`}
                onMouseEnter={() => setCursor(idx)} onClick={() => run({ t: 'river', year: t.year, eventId: t.id, label: t.title })}>
                <b>{t.year} {t.title}</b><span>{t.stage} · 河上定位</span>
              </button>
            );
          })}
          {(groups?.imagery?.length || groups?.volume?.length || groups?.questionnaire?.length) ? (
            <>
              <Group name="其余线索" greek="ΙΧΝΟΣ" />
              {groups?.imagery?.slice(0, 2).map(i => {
                idx += 1;
                return <button key={`im${i.id}`} className={`ck-item ${cursor === idx ? 'on' : ''}`} onMouseEnter={() => setCursor(idx)} onClick={() => run({ t: 'imagery', id: i.id, label: i.name })}><b>意象·{i.name}</b><span>{i.occ} 处登场 · 直达展柜</span></button>;
              })}
              {groups?.volume?.slice(0, 3).map((v, i2) => {
                idx += 1;
                const isCh = v.typ === 'chapter';
                return <button key={`vo${v.typ}-${v.code}-${i2}`} className={`ck-item ${cursor === idx ? 'on' : ''}`} onMouseEnter={() => setCursor(idx)} onClick={() => run({ t: 'chapter', code: v.code, seq: isCh ? (v.seq ?? null) : null, docPath: v.doc_path ?? null, label: v.title })}><b>{isCh ? '章节' : '卷'}·{v.title}</b><span>{isCh ? '开材料链' : '开卷 · 五卷书房'}</span></button>;
              })}
              {groups?.questionnaire?.slice(0, 2).map(qq => {
                idx += 1;
                return <button key={`qu${qq.id}`} className={`ck-item ${cursor === idx ? 'on' : ''}`} onMouseEnter={() => setCursor(idx)} onClick={() => run({ t: 'questionnaire', docPath: qq.doc_path, label: qq.respondent_label })}><b>问卷·{qq.respondent_label}</b><span>读原卷</span></button>;
              })}
            </>
          ) : null}
        </div>
        <footer className="ck-foot"><span>↑↓ 选择</span><span>Enter 打开</span><span>Esc 关闭</span></footer>
      </div>
    </div>
  );
}
