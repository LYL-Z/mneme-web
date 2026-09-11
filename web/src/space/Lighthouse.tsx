import { useEffect, useMemo, useRef, useState } from 'react';
import { animate, stagger } from 'animejs';
import { api, apiErrorMessage, type Overview, type QueueItem } from '../api';
import { evidenceLabel as labelOf } from '../evidenceKind';
import { rememberEvidence } from '../highlightSnippet';
import { notify } from '../toast';

/**
 * Σ9 证据灯塔 · 事实纪律的守夜塔
 * 塔身 = 五类证据徽章总览；塔灯 = 最新一次全库审计；
 * 工作队列 = 冲突 / 待核 / 待采，点击直达原文。
 */

type QueueTab = 'all' | 'conflict' | 'pending' | 'pendingCollect';

const TABS: { id: QueueTab; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'conflict', label: '冲突' },
  { id: 'pending', label: '待核' },
  { id: 'pendingCollect', label: '待采' },
];

export function Lighthouse({ overview, onOpenDoc }: {
  overview: Overview | null;
  onOpenDoc: (path: string, h?: string, ev?: number) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [tab, setTab] = useState<QueueTab>('all');
  const audit = overview?.audit ?? null;
  const ev = overview?.evidence ?? [];
  const evTotal = ev.reduce((s, e) => s + e.n, 0);
  const privCount = overview?.secretDocs ?? audit?.excluded_private ?? 0;

  useEffect(() => {
    const load = () => api.queue().then(setQueue).catch(e => notify(apiErrorMessage(e), 'error'));
    load();
    window.addEventListener('mneme:unlocked', load);
    return () => window.removeEventListener('mneme:unlocked', load);
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    animate(root.querySelectorAll('.lh-badge'), {
      opacity: [0, 1], translateY: [18, 0], delay: stagger(90, { start: 300 }), duration: 620, ease: 'outExpo',
    });
    const beam = root.querySelector('.lh-beam');
    if (beam) animate(beam, { opacity: [0, 1], duration: 1400, delay: 500, ease: 'outExpo' });
  }, [overview]);

  const counts = useMemo(() => ({
    all: queue.length,
    conflict: queue.filter(q => q.kind === 'conflict').length,
    pending: queue.filter(q => q.kind === 'pending').length,
    pendingCollect: queue.filter(q => q.kind === 'pendingCollect').length,
  }), [queue]);

  const shown = tab === 'all' ? queue : queue.filter(q => q.kind === tab);

  return (
    <div className="lh" ref={rootRef}>
      <header className="lh-head">
        <p className="greek lh-kicker">ΦΑΡΟΣ · Σ9</p>
        <h1>证据灯塔</h1>
        <p className="lh-sub">{evTotal} 条证据片段与最新一轮全库审计——这座建筑的事实守夜人。</p>
      </header>

      <div className="lh-tower">
        <div className="lh-beam" aria-hidden />
        <div className="lh-body">
          <div className="lh-lamp" />
          <div className="lh-stripes" aria-hidden><i /><i /><i /></div>
        </div>
        <div className="lh-base" />
      </div>

      <div className="lh-panel">
        <section className="lh-badges">
          <h2>证据分级 · 共 {evTotal} 条</h2>
          {ev.map(e => {
            const lb = labelOf(e.kind);
            return (
              <div key={e.kind} className="lh-badge surface" title={lb.desc}>
                <b>{e.n}</b>
                <span><i>{lb.name}</i>{lb.desc}</span>
              </div>
            );
          })}
        </section>

        <section className="lh-audit surface">
          <h2>最新审计</h2>
          {audit ? (
            <dl>
              <div><dt>完成时刻</dt><dd>{new Date(audit.finished_at || audit.started_at).toLocaleString('zh-CN')}</dd></div>
              <div><dt>扫描</dt><dd>{audit.scanned?.toLocaleString()} 项</dd></div>
              <div><dt>入库</dt><dd>{audit.ingested?.toLocaleString()} 份</dd></div>
              <div><dt>私密层</dt><dd>{privCount.toLocaleString()} 份（加密门禁保护 · 未解锁不可读）</dd></div>
              <div><dt>系统排除</dt><dd>{audit.excluded_system?.toLocaleString()} 份</dd></div>
              <div><dt>脱敏掩码</dt><dd>{audit.masked} 处</dd></div>
            </dl>
          ) : <p className="lh-none">暂无审计记录。</p>}
          <p className="lh-note">台账现行版：项目管理 · 全库缺口与审计总台账（2026-09-04）。</p>
        </section>
      </div>

      <section className="lh-queue">
        <h2>待核工作队列 · {queue.length} 条</h2>
        <div className="lh-q-tabs" role="tablist" aria-label="证据队列筛选">
          {TABS.map(t => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className={tab === t.id ? 'on' : ''}
              onClick={() => setTab(t.id)}
            >
              {t.label} {counts[t.id]}
            </button>
          ))}
        </div>
        {shown.length === 0 ? (
          <p className="lh-none">此筛选下暂无待处理条目。</p>
        ) : shown.map(item => {
          const lb = labelOf(item.kind);
          const snip = (item.snippet || '').replace(/\s+/g, ' ').trim().slice(0, 140);
          return (
            <button
              key={item.id}
              className="lh-q-item surface"
              onClick={() => {
                rememberEvidence(item.id, item.snippet);
                onOpenDoc(item.path, undefined, item.id);
              }}
              title={item.path}
            >
              <b>{item.title}</b>
              {snip ? <span>{snip}{item.snippet.length > 140 ? '…' : ''}</span> : null}
              <em>{[lb.name, item.domain, item.stage, item.volume].filter(Boolean).join(' · ')}</em>
            </button>
          );
        })}
      </section>
    </div>
  );
}
