import { useEffect, useRef, useState } from 'react';
import { ApiError, api, headingSlug, type Chapter, type ChapterDetail } from '../api';
import { recordChapter } from '../history';
import { emitSilk } from '../silk';
import { ensureCjkSerif } from '../fontsCjk';

/**
 * Σ4 · 章节材料链面板（v3.4 · P3 只读闭环）
 * 章节状态 → 提纲/正文 → 支撑材料 → 待核队列 → 回到章节。
 * 数据全部来自 /api/chapter（服务端运行时解析卷章节设计文档）；
 * 面板本身是路由驱动（/chapter/B3/26），关闭 = 回书房，浏览器返回键同样成立。
 * 赵纲密章未解锁时服务端 403，本面板走 lock 态并弹出绝密门。
 * 待核条数不等于不可信程度；正文未建立就如实写未建立，不造进度。
 */
type PanelState =
  | { s: 'loading' }
  | { s: 'ok'; d: ChapterDetail }
  | { s: 'miss' }
  | { s: 'net' }
  | { s: 'lock' };

const KIND_LABEL: Record<string, string> = { 待采: '待采', 待核: '待核' };

function SibNav({ sibs, seq, code, onOpenChapter }: {
  sibs: Chapter[]; seq: number; code: string;
  onOpenChapter: (code: string, seq: number) => void;
}) {
  const i = sibs.findIndex(c => c.seq === seq);
  const prev = i > 0 ? sibs[i - 1] : null;
  const next = i >= 0 && i < sibs.length - 1 ? sibs[i + 1] : null;
  if (!prev && !next) return null;
  return (
    <div className="cp-sibs">
      {prev ? <button type="button" className="cp-sib" onClick={() => onOpenChapter(code, prev.seq)}>上一题 · {prev.title}</button> : <span />}
      {next ? <button type="button" className="cp-sib" onClick={() => onOpenChapter(code, next.seq)}>下一题 · {next.title}</button> : <span />}
    </div>
  );
}

export function ChapterPanel({ code, seq, onClose, onOpenDoc, onOpenImagery, onOpenChapter }: {
  code: string;
  seq: number;
  onClose: () => void;
  onOpenDoc: (path: string, anchor?: string) => void;
  onOpenImagery: (id: number) => void;
  onOpenChapter: (code: string, seq: number) => void;
}) {
  const [st, setSt] = useState<PanelState>({ s: 'loading' });
  const [retry, setRetry] = useState(0);
  const [sibs, setSibs] = useState<Chapter[]>([]);
  const [volMeta, setVolMeta] = useState<{ name: string; color: string } | null>(null);
  const seqRef = useRef(0);
  useEffect(() => { ensureCjkSerif(); }, []);

  useEffect(() => {
    const my = ++seqRef.current;
    setSt({ s: 'loading' });
    api.chapter(code, seq).then(d => {
      if (my !== seqRef.current) return; // 过期响应丢弃
      if (d) {
        setSt({ s: 'ok', d });
        document.title = `${d.chapter.title} · ΜΝΗΜΗ`;
        recordChapter({ code: d.chapter.code, seq: d.chapter.seq, title: d.chapter.title, volume: d.volume.name });
        emitSilk();
      } else setSt({ s: 'miss' });
    }).catch((e: unknown) => {
      if (my !== seqRef.current) return;
      if (e instanceof ApiError && e.status === 403) { setSt({ s: 'lock' }); window.dispatchEvent(new CustomEvent('mneme:locked')); return; }
      const net = e instanceof ApiError && (e.status === 0 || e.status >= 500);
      setSt(net ? { s: 'net' } : { s: 'miss' });
    });
  }, [code, seq, retry]);
  useEffect(() => {
    api.volume(code).then(v => {
      setSibs((v?.chapters || []).filter(c => !c.is_sample));
      setVolMeta(v ? { name: v.name, color: v.color_token } : null);
    }).catch(() => { setSibs([]); setVolMeta(null); });
  }, [code, retry]);

  /* 解锁后自动重载当前章节链 */
  useEffect(() => {
    const onUnlocked = () => setRetry(n => n + 1);
    window.addEventListener('mneme:unlocked', onUnlocked);
    return () => window.removeEventListener('mneme:unlocked', onUnlocked);
  }, []);

  /* Esc 关闭；[ ] 走公开目录上下题（密章标题可见，正文仍 403） */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key !== '[' && e.key !== ']') return;
      const i = sibs.findIndex(c => c.seq === seq);
      const t = e.key === '[' ? sibs[i - 1] : sibs[i + 1];
      if (!t) return;
      e.preventDefault();
      onOpenChapter(code, t.seq);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, sibs, seq, code, onOpenChapter]);

  const openOutline = (d: ChapterDetail) => {
    if (!d.outline?.path) return;
    onOpenDoc(d.outline.path, d.outline.anchor ? headingSlug(d.outline.anchor) : undefined);
  };

  return (
    <div className="cp-mask" onMouseDown={onClose}>
      <aside
        className="cp glass" role="dialog" aria-label="章节材料链"
        style={{ ['--vc' as string]: st.s === 'ok' ? st.d.volume.color_token : (volMeta?.color || undefined) }}
        onMouseDown={e => e.stopPropagation()}
      >
        {st.s === 'loading' && <div className="cp-loading">正在展开材料链…</div>}
        {st.s === 'miss' && (
          <div className="cp-miss">
            <p className="greek">ΜΗ ΕΥΡΕΘΗΚΕ</p>
            <h1>未找到该章节</h1>
            <p>它可能不在当前卷章骨架中，或编号有误。</p>
          </div>
        )}
        {st.s === 'lock' && (() => {
          const lockTitle = sibs.find(c => c.seq === seq)?.title;
          return (
          <>
          <div className="cp-miss">
            <p className="greek">ΑΠΟΡΡΗΤΟΝ</p>
            {volMeta && <p className="cp-vol">{volMeta.name}</p>}
            <h1>{lockTitle ? `《${lockTitle}》` : '此为绝密档案'}</h1>
            <p>目录公开。开启本章材料链需要管理员密码。</p>
          </div>
          <footer className="cp-foot">
            <SibNav sibs={sibs} seq={seq} code={code} onOpenChapter={onOpenChapter} />
            <button className="cp-back" onClick={onClose}>← 回书房</button>
          </footer>
          </>
          );
        })()}
        {st.s === 'net' && (
          <div className="cp-miss">
            <p className="greek">ΔΙΚΤΥΟ</p>
            <h1>网络异常</h1>
            <button className="cp-back" onClick={() => setRetry(n => n + 1)}>重新加载 →</button>
          </div>
        )}

        {st.s === 'ok' && (() => {
          const d = st.d;
          const ch = d.chapter;
          const allPending = [
            ...d.pending.map(p => ({ ...p, scope: '本章' })),
            ...d.volumePending.map(p => ({ ...p, scope: '本部' })),
          ];
          return (
            <>
              <header className="cp-head">
                <p className="cp-vol">
                  <i className="cp-vol-dot" />
                  {d.volume.name}
                  <em>{d.volume.years} · {d.volume.line_metaphor}</em>
                </p>
                <button className="cp-x" onClick={onClose} aria-label="关闭">×</button>
                <h1 className="cp-title">
                  <span className="cp-no">{ch.is_sample ? '样章' : ch.kind === 'interlude' ? '间' : ch.kind === 'appendix' ? '附录' : ch.kind === 'preface' ? '序' : `章 ${String(ch.seq).padStart(2, '0')}`}</span>
                  {ch.title}
                </h1>
                <p className="cp-meta">
                  <span className={`cp-badge ${ch.is_sample ? 'ok' : ''}`}>{ch.status || '设计'}</span>
                  {ch.est_chapters != null && <span>约 {ch.est_chapters} 章</span>}
                  {ch.est_words && <span>{ch.est_words}字</span>}
                  {allPending.length > 0 && <span className="cp-badge wait">待办 {allPending.length}</span>}
                </p>
              </header>

              <div className="cp-body">
                {/* 正文 / 样章 —— 实际存在的才列出 */}
                <section className="cp-sec">
                  <h2>正文</h2>
                  {d.body ? (
                    <button className="cp-row primary" onClick={() => onOpenDoc(d.body!.path)}>
                      <b>{d.body.title}</b><span>读正文 →</span>
                    </button>
                  ) : d.volumeSamples.length > 0 ? (
                    d.volumeSamples.map(s => (
                      <button key={s.doc_path} className="cp-row" onClick={() => onOpenDoc(s.doc_path)}>
                        <b>{s.title}</b><span>本部样章 →</span>
                      </button>
                    ))
                  ) : (
                    <p className="cp-none">正文未建立——本章尚未成稿。</p>
                  )}
                </section>

                <section className="cp-sec">
                  <h2>提纲</h2>
                  {d.outline ? (
                    <>
                      {d.outline.path ? (
                        <button className="cp-row" onClick={() => openOutline(d)}>
                          <b>{d.outline.title}{d.outline.anchor ? ' · 本章' : ''}</b><span>定位 →</span>
                        </button>
                      ) : (
                        <p className="cp-none">章稿与密章同卷，未解锁前只给本节摘句。</p>
                      )}
                      {d.outline.excerpt && <p className="cp-excerpt">{d.outline.excerpt}…</p>}
                    </>
                  ) : <p className="cp-none">提纲未建立——本部暂无章稿。</p>}
                  {(ch.sections && ch.sections.length > 0) && (
                    <ul className="cp-secs">
                      {ch.sections.map(s => <li key={s}>{s}</li>)}
                    </ul>
                  )}
                </section>

                {/* 支撑材料：本部核心稿 + 手册台账 */}
                {(d.drafts.length > 0 || d.ledgers.length > 0) && (
                  <section className="cp-sec">
                    <h2>支撑材料</h2>
                    {d.drafts.map(dr => (
                      <button key={dr.path} className="cp-row" onClick={() => onOpenDoc(dr.path)}>
                        <b>{dr.title}</b><span>核心完稿 →</span>
                      </button>
                    ))}
                    {d.ledgers.map(l => (
                      <button key={l.path} className="cp-row" onClick={() => onOpenDoc(l.path)}>
                        <b>{l.title}</b><span>{l.role} →</span>
                      </button>
                    ))}
                  </section>
                )}

                {/* 待核工作队列 —— 条数不等于可信度 */}
                <section className="cp-sec">
                  <h2>待核工作队列</h2>
                  {allPending.length === 0 ? (
                    <p className="cp-none">本章与本部清单暂无【待采】【待核】标记。</p>
                  ) : (
                    <ul className="cp-pend">
                      {allPending.slice(0, 18).map((p, i) => (
                        <li key={i}>
                          <button onClick={() => openOutline(d)} title="定位到章节设计中的出处">
                            <i className={p.kind === '待采' ? 'collect' : 'verify'}>{KIND_LABEL[p.kind] || p.kind}</i>
                            <em>{p.scope}</em>
                            <span>{p.text}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                {/* 本部意象 */}
                {d.imagery.length > 0 && (
                  <section className="cp-sec">
                    <h2>本部意象</h2>
                    <div className="cp-chips">
                      {d.imagery.map(im => (
                        <button key={im.id} onClick={() => onOpenImagery(im.id)}>
                          {im.name.replace(/\*\*/g, '')}<em>{im.occ}</em>
                        </button>
                      ))}
                    </div>
                  </section>
                )}
              </div>

              <footer className="cp-foot">
                <SibNav sibs={sibs} seq={seq} code={code} onOpenChapter={onOpenChapter} />
                <button className="cp-back" onClick={onClose}>← 回书房</button>
                <span className="cp-note">只读材料链 · Obsidian 为事实来源 · [ ] 上下题</span>
              </footer>
            </>
          );
        })()}
      </aside>
    </div>
  );
}
