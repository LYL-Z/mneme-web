import { useEffect, useRef, useState } from 'react';
import { animate, stagger } from 'animejs';
import { api, apiErrorMessage, type Overview, type Questionnaire } from '../api';
import { notify } from '../toast';

/**
 * Σ8 他者之声 · v7.3 全量收录 + 绝密分级
 * V1–V3 三轮作答全文全部陈列（服务端按父母卷分级：父母卷公开，
 * 其余均为绝密档案——未解锁时服务端即不给答案，卡片占位 + 弹管理员密码门）。
 * 解锁（mneme:unlocked）后自动重取全量。
 * v4 · A5：回收总数走服务端核账口径（overview.surveyTotal），前端不再硬编码；
 * 密码入口收敛——公开界面不出现「管理员密码」明示，按钮只说「解锁此卷」。
 */
const ROUND_ORDER = ['V1', 'V2', 'V3'];
export function Voices({ onOpenDoc, overview }: { onOpenDoc: (path: string) => void; overview: Overview | null }) {
  const [items, setItems] = useState<Questionnaire[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);

  const load = () => { api.questionnaires().then(setItems).catch(e => notify(apiErrorMessage(e), 'error')); };
  useEffect(() => { load(); }, []);
  useEffect(() => {
    const onUnlocked = () => load();
    window.addEventListener('mneme:unlocked', onUnlocked);
    return () => window.removeEventListener('mneme:unlocked', onUnlocked);
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    animate(root.querySelectorAll('.vo-card'), {
      opacity: [0, 1], translateY: [24, 0], delay: stagger(40), duration: 640, ease: 'outExpo',
    });
  }, [items.length]);

  const lockedCount = items.filter(q => q.locked).length;
  const openDoc = (q: Questionnaire) => {
    if (q.locked) { window.dispatchEvent(new CustomEvent('mneme:locked')); return; }
    onOpenDoc(q.doc_path);
  };

  const rounds = ROUND_ORDER.filter(r => items.some(q => (q.round || 'V1') === r));

  return (
    <div className="vo" ref={rootRef}>
      <header className="vo-head">
        <p className="greek vo-kicker">ΦΩΝΕΣ · Σ8</p>
        <h2>他者之声</h2>
        <p className="vo-sub">
          累计回收问卷已达 <b className="vo-big">{overview?.surveyTotal ? `${overview.surveyTotal}+` : '—'}</b> 份（V1–V3 三轮采集 · 作者口径）·
          本馆已收入 <b className="vo-big">{items.length}</b> 份作答全文——
          除父母卷外均为<b className="vo-secret">绝密档案</b>
          {lockedCount > 0 ? `（待解锁 ${lockedCount} 份）` : ''}。
        </p>
      </header>
      {rounds.map(rd => (
        <section key={rd} className="vo-round">
          <h3 className="vo-round-title"><span className="greek">{rd}</span> 第 {ROUND_ORDER.indexOf(rd) + 1} 轮 · {items.filter(q => (q.round || 'V1') === rd).length} 份</h3>
          <div className="vo-grid">
            {items.filter(q => (q.round || 'V1') === rd).map(q => (
              <article key={q.id} className={`vo-card glass ${q.locked ? 'locked' : ''}`}>
                <header className="vo-card-head">
                  <b>{q.respondent_label}</b>
                  {q.relation_label && q.relation_label !== q.respondent_label && <i>{q.relation_label}</i>}
                  {q.locked && <i className="vo-lock">🔒 绝密</i>}
                </header>
                {q.locked ? (
                  <div className="vo-locked">
                    <p>此卷为绝密档案。</p>
                    <button className="vo-read" onClick={() => openDoc(q)}>解锁此卷 →</button>
                  </div>
                ) : (
                  <>
                    <dl className="vo-answers">
                      {(q.answers || []).slice(0, 6).map(it => (
                        <div key={it.n} className="vo-qa" title={it.q}>
                          <dt>{it.n}</dt>
                          <dd><i>{it.q}</i>{it.a}</dd>
                        </div>
                      ))}
                    </dl>
                    <button className="vo-read" onClick={() => openDoc(q)}>读作答全文 →</button>
                  </>
                )}
              </article>
            ))}
          </div>
        </section>
      ))}
      {/* 云海归档：更多问卷沉入云端（叙事收尾） */}
      <div className="vo-clouds" aria-hidden>
        <p className="vo-cloud-note">……更多作答沉入云端，待后续批次逐一启封。受系统限制，只能显示这些部分。</p>
        <i className="cl c1" /><i className="cl c2" /><i className="cl c3" /><i className="cl c4" /><i className="cl c5" />
      </div>
    </div>
  );
}
