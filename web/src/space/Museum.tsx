import { useEffect, useRef, useState } from 'react';
import { animate, stagger } from 'animejs';
import { ApiError, api, apiErrorMessage, type ImageryItem, type ImageryOcc } from '../api';
import { notify } from '../toast';

/**
 * Σ6 意象博物馆 · v3.1
 * 常设展（主意象鎏金铭牌）与候选素牌分区陈列；展柜展开 =
 * 登场时间线（场景 · 旧义→新义）+ 同卷共展意象互跳 + 台账原文直达。
 */
export function Museum({ focusId, onClearFocus, onOpenDoc }: {
  focusId: number | null;
  onClearFocus: () => void;
  onOpenDoc: (path: string) => void;
}) {
  const [items, setItems] = useState<ImageryItem[]>([]);
  const [cur, setCur] = useState<{ item: ImageryItem; occ: ImageryOcc[]; ledgerPath: string | null; relatedImagery: { id: number; name: string; co: number }[] } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const load = () => api.imagery().then(setItems).catch(e => notify(apiErrorMessage(e), 'error'));
    load();
    window.addEventListener('mneme:unlocked', load);
    return () => window.removeEventListener('mneme:unlocked', load);
  }, []);

  const openCase = async (item: ImageryItem) => {
    if (cur?.item.id === item.id) { setCur(null); return; }
    const one = await api.imageryOne(item.id).catch((e: unknown) => {
      if (e instanceof ApiError && e.status === 403) window.dispatchEvent(new CustomEvent('mneme:locked'));
      else notify(apiErrorMessage(e), 'error');
      return null;
    });
    if (one) setCur({ item, occ: one.occurrences, ledgerPath: one.ledgerPath, relatedImagery: one.relatedImagery ?? [] });
  };

  /* 外部聚焦（书房/主题域的意象互链）：直接展开对应展柜 */
  useEffect(() => {
    if (focusId == null || items.length === 0) return;
    const it = items.find(i => i.id === focusId);
    if (it) openCase(it);
    onClearFocus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, items]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    animate(root.querySelectorAll('.mu-case'), {
      opacity: [0, 1], translateY: [22, 0], delay: stagger(55), duration: 640, ease: 'outExpo',
    });
  }, [items.length]);

  const mains = items.filter(i => !i.candidate);
  const cands = items.filter(i => i.candidate);

  return (
    <div className="mu" ref={rootRef}>
      <header className="mu-head">
        <p className="greek mu-kicker">ΕΙΔΩΛΑ · Σ6</p>
        <h2>意象博物馆</h2>
        <p className="mu-sub">
          {mains.length} 件主意象常设展 · {cands.length} 件候选素牌——
          意象不重复自己，每一次登场都要长出新的意思。
        </p>
      </header>

      <div className="mu-cases">
        {mains.map(it => (
          <button
            key={it.id}
            className={`mu-case glass main ${cur?.item.id === it.id ? 'on' : ''}`}
            onClick={() => openCase(it)}
          >
            <span className="mu-no greek">{String(it.seq).padStart(2, '0')}</span>
            <b>{it.name}</b>
            <i>主意象</i>
            <em>{it.occ} 次登场</em>
          </button>
        ))}
      </div>

      {cands.length > 0 && (
        <>
          <h3 className="mu-zone">候选素牌 · 待定陈列</h3>
          <div className="mu-cases">
            {cands.map(it => (
              <button
                key={it.id}
                className={`mu-case glass cand ${cur?.item.id === it.id ? 'on' : ''}`}
                onClick={() => openCase(it)}
              >
                <span className="mu-no greek">{String(it.seq).padStart(2, '0')}</span>
                <b>{it.name.replace(/\*\*/g, '')}</b>
                <i>候选意象</i>
                <em>{it.occ} 次登记</em>
              </button>
            ))}
          </div>
        </>
      )}

      {cur && (
        <section className="mu-detail glass">
          <h3>{cur.item.name.replace(/\*\*/g, '')}<span> · {cur.occ.length} 次登场轨迹</span></h3>

          {cur.relatedImagery.length > 0 && (
            <div className="mu-related">
              <h4>同卷共展</h4>
              <div className="study-chips">
                {cur.relatedImagery.map(r => (
                  <button key={r.id} onClick={() => {
                    const it = items.find(i => i.id === r.id);
                    if (it) openCase(it);
                  }}>
                    {r.name.replace(/\*\*/g, '')}<em>{r.co}</em>
                  </button>
                ))}
              </div>
            </div>
          )}

          <ol className="mu-timeline">
            {cur.occ.map((o, i) => (
              <li key={i}>
                <i className="mu-dot" />
                <div>
                  <p className="mu-scene">
                    {o.volume_code && <b className="mu-vol">{o.volume_code}</b>}
                    {o.scene || '（场景待补）'}
                  </p>
                  {(o.old_meaning || o.new_meaning) && (
                    <p className="mu-shift">
                      <span>{o.old_meaning || '—'}</span>
                      <em>→</em>
                      <span>{o.new_meaning || '—'}</span>
                    </p>
                  )}
                  {o.source_note && <p className="mu-note">{o.source_note}</p>}
                </div>
              </li>
            ))}
          </ol>
          {cur.ledgerPath && (
            <button className="mu-ledger" onClick={() => onOpenDoc(cur.ledgerPath!)}>意象台账 · 原文 →</button>
          )}
          <p className="mu-hint">登场明细自「意象台账」逐行登记，可回原文档案馆核对。</p>
        </section>
      )}
    </div>
  );
}
