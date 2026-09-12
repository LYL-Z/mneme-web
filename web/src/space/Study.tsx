import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { animate, stagger } from 'animejs';
import { ApiError, api, apiErrorMessage, type Chapter, type Volume, type VolumeDetail } from '../api';
import { notify } from '../toast';
import { getLastChapter } from '../history';
import { askUnlock } from '../unlock';

/** 卷详情证据标签的中文映射（与 Σ9 灯塔同口径） */
const EV_LABEL: Record<string, string> = {
  pending: '待核', conflict: '冲突', inferred: '推断', confirmed: '确证',
  literary: '文学', perspective: '视角', retrospect: '回顾',
};

const AX_STEM = ['', '甲', '乙', '丙', '丁'];

/**
 * Σ4 书房 · 《补写的手册》
 * 八扇门：序 · 六部 · 附录。开门后按辑分组，间章作飞鸟行。
 * 赵纲密章标题公开，点开走绝密弹窗——不从目录消失，也不整部上锁。
 */
const TEXTURE: Record<string, JSX.Element> = {
  paper: (
    <svg viewBox="0 0 120 24" className="study-tex">
      <path d="M10 4h100M10 9h100M10 14h72M10 19h52" stroke="currentColor" strokeWidth="1.2" fill="none" />
    </svg>
  ),
  grid: (
    <svg viewBox="0 0 120 24" className="study-tex">
      <path d="M0 6h120M0 18h120M20 0v24M50 0v24M80 0v24M100 0v24" stroke="currentColor" strokeWidth="0.8" fill="none" />
      <rect x="48" y="4" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  ),
  letter: (
    <svg viewBox="0 0 120 24" className="study-tex">
      <rect x="18" y="4" width="84" height="16" rx="2" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M18 6l42 8 42-8" fill="none" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  ),
  desk: (
    <svg viewBox="0 0 120 24" className="study-tex">
      {[14, 38, 62, 86, 108].map((x, i) => <circle key={x} cx={x} cy="12" r={i === 2 ? 3.4 : 2.4} fill="currentColor" opacity={i === 2 ? 1 : 0.45} />)}
    </svg>
  ),
  lamp: (
    <svg viewBox="0 0 120 24" className="study-tex">
      <path d="M20 20h80M60 20V8M44 8h32" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M44 8c4-6 28-6 32 0" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  ),
  seal: (
    <svg viewBox="0 0 120 24" className="study-tex">
      <rect x="8" y="4" width="104" height="16" rx="3" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="16" cy="12" r="2.2" fill="currentColor" />
      <path d="M26 4v16M30 4v16" stroke="currentColor" strokeWidth="0.8" strokeDasharray="2 3" />
    </svg>
  ),
  cursor: (
    <svg viewBox="0 0 120 24" className="study-tex">
      <path d="M18 5h84M18 12h54M18 19h70" stroke="currentColor" strokeWidth="1.2" fill="none" />
      <path d="M76 8l8 10-6 1 2 5-3 1-2-5-5 3z" fill="currentColor" />
    </svg>
  ),
  walk: (
    <svg viewBox="0 0 120 24" className="study-tex">
      <path d="M6 18C18 4 30 4 42 18S66 32 78 18 102 4 114 18" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="78" cy="18" r="2.6" fill="currentColor" />
    </svg>
  ),
};

const texOf = (metaphor: string) => {
  if (/格子|空格/.test(metaphor)) return TEXTURE.grid;
  if (/信|笔|封/.test(metaphor)) return TEXTURE.letter;
  if (/桌/.test(metaphor)) return TEXTURE.desk;
  if (/门|灯/.test(metaphor)) return TEXTURE.lamp;
  if (/键|光标/.test(metaphor)) return TEXTURE.cursor;
  if (/走/.test(metaphor)) return TEXTURE.walk;
  if (/票/.test(metaphor)) return TEXTURE.seal;
  return TEXTURE.paper;
};

const chapNo = (c: Chapter) => {
  if (c.kind === 'preface') return '序';
  if (c.kind === 'interlude') return '间';
  if (c.kind === 'appendix') return AX_STEM[c.seq] || String(c.seq);
  return String(c.seq).padStart(2, '0');
};

type CatalogRow =
  | { t: 'fasc'; name: string }
  | { t: 'ch'; c: Chapter };

function catalogRows(chapters: Chapter[]): CatalogRow[] {
  const out: CatalogRow[] = [];
  let lastFasc = '';
  for (const c of chapters) {
    if (c.kind === 'interlude') {
      out.push({ t: 'ch', c });
      continue;
    }
    if (c.fascicle && c.fascicle !== lastFasc) {
      lastFasc = c.fascicle;
      out.push({ t: 'fasc', name: c.fascicle });
    }
    out.push({ t: 'ch', c });
  }
  return out;
}

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
  const lastCh = getLastChapter();
  const rootRef = useRef<HTMLDivElement>(null);
  const pendingVol = useRef<string | null>(null);
  const booted = useRef(false);

  useEffect(() => { api.volumes().then(setVols).catch(e => notify(apiErrorMessage(e), 'error')); }, []);
  const openVol = (code: string) => {
    setDocsOpen(false);
    api.volume(code).then(setCur).catch((e: unknown) => {
      if (e instanceof ApiError && e.status === 403) {
        pendingVol.current = code;
        window.dispatchEvent(new CustomEvent('mneme:locked'));
        return;
      }
      notify(apiErrorMessage(e), 'error');
    });
  };

  useEffect(() => {
    const onUnlocked = () => { if (pendingVol.current) { const c = pendingVol.current; pendingVol.current = null; openVol(c); } };
    window.addEventListener('mneme:unlocked', onUnlocked);
    return () => window.removeEventListener('mneme:unlocked', onUnlocked);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (focusVolume) { booted.current = true; openVol(focusVolume); rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusVolume]);

  useEffect(() => {
    if (booted.current || focusVolume || !vols.length) return;
    const last = getLastChapter();
    if (last?.code && vols.some(v => v.code === last.code)) {
      booted.current = true;
      openVol(last.code);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vols.length, focusVolume]);

  useEffect(() => {
    if (!cur) return;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const detail = rootRef.current?.querySelector('.study-detail');
    detail?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'nearest' });
    if (lastCh && lastCh.code === cur.code) {
      const row = rootRef.current?.querySelector('.study-chap.last');
      row?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
    }
  }, [cur?.code]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    animate(root.querySelectorAll('.study-door'), {
      opacity: [0, 1], translateY: [26, 0], delay: stagger(70), duration: 700, ease: 'outExpo',
    });
  }, [vols.length]);

  const onDoorKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End') return;
    const doors = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('.study-door')];
    if (!doors.length) return;
    if (e.key === 'Home') { e.preventDefault(); doors[0].focus(); return; }
    if (e.key === 'End') { e.preventDefault(); doors[doors.length - 1].focus(); return; }
    const i = doors.indexOf(document.activeElement as HTMLButtonElement);
    const next = doors[i + (e.key === 'ArrowRight' ? 1 : -1)];
    if (next) { e.preventDefault(); next.focus(); }
  };
  const onCatKey = (e: KeyboardEvent<HTMLOListElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    const rows = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('.study-chap')];
    if (!rows.length) return;
    if (e.key === 'Home') { e.preventDefault(); rows[0].focus(); return; }
    if (e.key === 'End') { e.preventDefault(); rows[rows.length - 1].focus(); return; }
    const i = rows.indexOf(document.activeElement as HTMLButtonElement);
    const next = rows[i + (e.key === 'ArrowDown' ? 1 : -1)];
    if (next) { e.preventDefault(); next.focus(); }
  };

  const skeleton = cur ? cur.chapters.filter(c => c.kind !== 'interlude' && !c.is_sample).length : 0;
  const lockedN = cur ? cur.chapters.filter(c => c.locked).length : 0;

  return (
    <div className="study" ref={rootRef}>
      <header className="study-head">
        <p className="greek study-kicker">ΒΙΒΛΙΑ · Σ4</p>
        <h1>《补写的手册》</h1>
        <p className="study-sub">序与六部、二十辑、六十章。目录公开；加密度章点开才走绝密档案。</p>
      </header>

      <div className="study-doors" onKeyDown={onDoorKey}>
        {vols.map(v => (
          <button
            key={v.code}
            className={`study-door surface ${cur?.code === v.code ? 'on' : ''}`}
            style={{ ['--vc' as string]: v.color_token }}
            onClick={() => openVol(v.code)}
            onPointerEnter={() => { void api.volume(v.code); }}
          >
            <span className="study-door-tex">{texOf(v.line_metaphor || '')}</span>
            <b>{v.name}</b>
            <i>{v.years}</i>
            <em>{v.line_metaphor}</em>
            <span className="study-door-n">{v.chapters} 题 · {v.docs} 份素材</span>
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
                  目录 {skeleton} 章
                  {lockedN > 0 && <> · 密章 {lockedN}</>}
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

          {(cur.topPersons.length > 0 || cur.topImagery.length > 0) && (
            <div className="study-links">
              {cur.topPersons.length > 0 && (
                <div className="study-linkrow">
                  <h3>本部人物</h3>
                  <div className="study-chips">
                    {cur.topPersons.map(p => (
                      <button
                        key={p.id}
                        onClick={() => p.locked ? askUnlock() : onOpenPerson(p.id)}
                        title={p.locked ? '绝密档案 · 需管理员密码' : `${p.relation_group} · 被提及 ${p.hits} 次`}
                      >
                        {p.display_name}{p.locked ? <i className="study-lock" aria-hidden>🔒</i> : <em>{p.hits}</em>}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {cur.topImagery.length > 0 && (
                <div className="study-linkrow">
                  <h3>本部意象</h3>
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
                本部档案（{cur.docs.length}）{docsOpen ? '▴' : '▾'}
              </button>
              {docsOpen && (
                <ul className="study-docs-list">
                  {cur.docs.map(d => (
                    <li key={d.path}>
                      <button onClick={() => onOpenDoc(d.path)}>
                        <b>{d.title}{d.locked ? <i className="study-lock" aria-hidden>🔒</i> : null}</b>
                        <span>{d.locked ? '绝密档案' : d.doc_type}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <ol className="study-chapters study-catalog" onKeyDown={onCatKey}>
            {catalogRows(cur.chapters).map((row, i) => {
              if (row.t === 'fasc') {
                return <li key={`fasc-${row.name}-${i}`} className="study-fasc"><span>{row.name}</span></li>;
              }
              const c = row.c;
              const isLast = !!(lastCh && lastCh.code === c.volume_code && lastCh.seq === c.seq);
              const inter = c.kind === 'interlude';
              return (
                <li key={`${c.volume_code}-${c.seq}`} className={`${c.is_sample ? 'sample' : ''}${isLast ? ' last' : ''}${inter ? ' study-inter' : ''}${c.locked ? ' locked' : ''}`}>
                  <i>{chapNo(c)}</i>
                  <button
                    className={`study-chap${isLast ? ' last' : ''}`}
                    onClick={() => onOpenChapter(c.volume_code, c.seq)}
                    aria-label={c.locked ? `${c.title} · 绝密档案` : c.title}
                    title={c.locked ? '绝密档案 · 需管理员密码' : isLast ? '上次读到这里 · 打开材料链' : '打开章节材料链'}
                  >
                    <span>{c.title}</span>
                    {c.locked && <i className="study-lock" aria-hidden>🔒</i>}
                    {c.est_words && !c.locked && <em>{c.est_words}</em>}
                    <em className="study-chap-sec">
                      {c.locked ? '绝密档案 →' : isLast ? '续读 · 材料链 →' : inter ? '间章 →' : `${c.status || ''} · 材料链 →`}
                    </em>
                  </button>
                </li>
              );
            })}
          </ol>
        </section>
      )}
    </div>
  );
}
