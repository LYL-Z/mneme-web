import { useEffect, useRef, useState } from 'react';
import { animate, stagger } from 'animejs';
import { ApiError, api, apiErrorMessage, type Volume, type VolumeDetail } from '../api';
import { notify } from '../toast';

/** 卷详情证据标签的中文映射（与 Σ9 灯塔同口径） */
const EV_LABEL: Record<string, string> = {
  pending: '待核', conflict: '冲突', inferred: '推断', confirmed: '确证',
  literary: '文学', perspective: '视角', retrospect: '回顾',
};

/**
 * Σ4 五卷书房 · 六门线形纹理 + 伏应证据热力
 * 序章与五卷各占一门，门楣饰以该卷的线形隐喻纹样；
 * 开门入卷：章节骨架（样章可直达 Σ7）、伏应证据密度条、【待采】计数。
 */
const TEXTURE: Record<string, JSX.Element> = {
  puzzle: (
    <svg viewBox="0 0 120 24" className="study-tex">
      <path d="M0 12h14a6 6 0 1 1 12 0h14v0a6 6 0 1 0 12 0h14a6 6 0 1 1 12 0h14a6 6 0 1 0 12 0h14" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  ),
  knot: (
    <svg viewBox="0 0 120 24" className="study-tex">
      <path d="M6 18C18 4 30 4 42 18S66 32 78 18 102 4 114 18" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="42" cy="18" r="2.6" fill="currentColor" /><circle cx="78" cy="18" r="2.6" fill="currentColor" />
    </svg>
  ),
  ellipsis: (
    <svg viewBox="0 0 120 24" className="study-tex">
      {[14, 38, 62, 86, 108].map((x, i) => <circle key={x} cx={x} cy="12" r={i === 4 ? 2 : 3.2} fill="currentColor" opacity={i === 4 ? 0.45 : 1} />)}
    </svg>
  ),
  model: (
    <svg viewBox="0 0 120 24" className="study-tex">
      <path d="M0 6h120M0 18h120M20 0v24M50 0v24M80 0v24M100 0v24" stroke="currentColor" strokeWidth="0.8" fill="none" />
      <circle cx="50" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  ),
  ticket: (
    <svg viewBox="0 0 120 24" className="study-tex">
      <rect x="8" y="4" width="104" height="16" rx="3" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="16" cy="12" r="2.2" fill="currentColor" />
      <path d="M26 4v16M30 4v16" stroke="currentColor" strokeWidth="0.8" strokeDasharray="2 3" />
    </svg>
  ),
  manual: (
    <svg viewBox="0 0 120 24" className="study-tex">
      <path d="M10 4h100M10 9h100M10 14h72M10 19h52" stroke="currentColor" strokeWidth="1.2" fill="none" />
    </svg>
  ),
};

const texOf = (metaphor: string) => {
  if (/拼图/.test(metaphor)) return TEXTURE.puzzle;
  if (/结绳|绳/.test(metaphor)) return TEXTURE.knot;
  if (/省略/.test(metaphor)) return TEXTURE.ellipsis;
  if (/建模|模型/.test(metaphor)) return TEXTURE.model;
  if (/车票|票/.test(metaphor)) return TEXTURE.ticket;
  return TEXTURE.manual;
};

export function Study({ onOpenDoc, onOpenPerson, onOpenImagery, onOpenChapter, focusVolume }: {
  onOpenDoc: (path: string, anchor?: string) => void;
  onOpenPerson: (id: number) => void;
  onOpenImagery: (id: number) => void;
  onOpenChapter: (code: string, seq: number) => void;
  focusVolume?: string | null;
}) {
  const [vols, setVols] = useState<Volume[]>([]);
  const [cur, setCur] = useState<VolumeDetail | null>(null);
  const [docsOpen, setDocsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => { api.volumes().then(setVols).catch(e => notify(apiErrorMessage(e), 'error')); }, []);
  const openVol = (code: string) => {
    setDocsOpen(false);
    api.volume(code).then(setCur).catch((e: unknown) => {
      if (e instanceof ApiError && e.status === 403) {
        pendingVol.current = code;
        window.dispatchEvent(new CustomEvent('mneme:locked')); // 绝密卷：弹管理员密码
        return;
      }
      notify(apiErrorMessage(e), 'error'); // 网络/服务端异常：不再静默失败
    });
  };
  const pendingVol = useRef<string | null>(null);

  /* 解锁后自动打开刚才被锁的卷 */
  useEffect(() => {
    const onUnlocked = () => { if (pendingVol.current) { const c = pendingVol.current; pendingVol.current = null; openVol(c); } };
    window.addEventListener('mneme:unlocked', onUnlocked);
    return () => window.removeEventListener('mneme:unlocked', onUnlocked);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ⌘K 卷章命中 →直接开卷 */
  useEffect(() => {
    if (focusVolume) { openVol(focusVolume); rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusVolume]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    animate(root.querySelectorAll('.study-door'), {
      opacity: [0, 1], translateY: [26, 0], delay: stagger(90), duration: 700, ease: 'outExpo',
    });
  }, [vols.length]);

  return (
    <div className="study" ref={rootRef}>
      <header className="study-head">
        <p className="greek study-kicker">ΒΙΒΛΙΑ · Σ4</p>
        <h1>五卷书房</h1>
        <p className="study-sub">六扇门，六种线的走法——这是全书的骨架房。</p>
      </header>

      <div className="study-doors">
        {vols.map(v => (
          <button
            key={v.code}
            className={`study-door surface ${cur?.code === v.code ? 'on' : ''}`}
            style={{ ['--vc' as string]: v.color_token }}
            data-secret={v.code === 'V2' || v.code === 'V3' ? '1' : undefined}
            onClick={() => openVol(v.code)}
          >
            <span className="study-door-tex">{texOf(v.line_metaphor || '')}</span>
            <b>{v.name}{v.code === 'V2' || v.code === 'V3' ? <i className="study-lock" aria-hidden>🔒</i> : null}</b>
            <i>{v.years}</i>
            <em>{v.line_metaphor}</em>
            <span className="study-door-n">{v.chapters} 章 · {v.docs} 份素材</span>
          </button>
        ))}
      </div>

      {cur && (
        <section className="study-detail surface" style={{ ['--vc' as string]: cur.color_token }}>
          <div className="study-detail-head">
            <div>
              <h2>{cur.name}</h2>
              <p>{cur.years} · {cur.line_metaphor} · {cur.mood} · 目标 {cur.word_target}</p>
              <p className="study-progress-line">
                <span className="study-progress" aria-hidden>
                  {cur.chapterStats.map(s => (
                    <i key={s.s} className={s.s.includes('已成') ? 'done' : 'plan'} style={{ flex: s.n }} />
                  ))}
                </span>
                <em>
                  骨架 {cur.chapters.filter(c => !c.is_sample).length} 章
                  {cur.words > 0 && <> · 成稿 {cur.words.toLocaleString()} 字</>}
                  {cur.docs.length > 0 && <> · 挂档 {cur.docs.length} 份</>}
                </em>
              </p>
            </div>
            <div className="study-ev">
              {cur.pendingCollect > 0 && <span className="study-pend">【待采】{cur.pendingCollect}</span>}
              {cur.foreshadow.filter(f => f.kind !== 'pendingCollect').map(f => (
                <span key={f.kind} className="study-ev-tag"><i>{EV_LABEL[f.kind] || f.kind}</i>{f.n}</span>
              ))}
            </div>
          </div>

          {/* v3.1 书房内容化：卷内人物 × 意象 × 档案 三向互链 */}
          {(cur.topPersons.length > 0 || cur.topImagery.length > 0) && (
            <div className="study-links">
              {cur.topPersons.length > 0 && (
                <div className="study-linkrow">
                  <h3>本卷人物</h3>
                  <div className="study-chips">
                    {cur.topPersons.map(p => (
                      <button key={p.id} onClick={() => onOpenPerson(p.id)} title={`${p.relation_group} · 被提及 ${p.hits} 次`}>
                        {p.display_name}<em>{p.hits}</em>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {cur.topImagery.length > 0 && (
                <div className="study-linkrow">
                  <h3>本卷意象</h3>
                  <div className="study-chips">
                    {cur.topImagery.map(im => (
                      <button key={im.id} onClick={() => onOpenImagery(im.id)}>
                        {im.name.replace(/\*\*/g, '')}<em>{im.occ}</em>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {cur.docs.length > 0 && (
            <div className="study-docs">
              <button className="study-docs-toggle" onClick={() => setDocsOpen(v => !v)}>
                本卷档案（{cur.docs.length}）{docsOpen ? '▴' : '▾'}
              </button>
              {docsOpen && (
                <ul className="study-docs-list">
                  {cur.docs.map(d => (
                    <li key={d.path}>
                      <button onClick={() => onOpenDoc(d.path)}>
                        <b>{d.title}</b><span>{d.doc_type}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <ol className="study-chapters">
            {cur.chapters.map(c => (
              <li key={`${c.volume_code}-${c.seq}`} className={c.is_sample ? 'sample' : ''}>
                <i>{String(c.seq).padStart(2, '0')}</i>
                <button
                  className="study-chap"
                  onClick={() => onOpenChapter(c.volume_code, c.seq)}
                  title="打开章节材料链：提纲 · 正文 · 支撑材料 · 待核队列"
                >
                  <span>{c.title}</span>
                  {c.est_words && <em>{c.est_words}</em>}
                  <em className="study-chap-sec">{c.status || ''} · 材料链 →</em>
                </button>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
