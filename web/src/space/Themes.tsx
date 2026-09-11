import { useEffect, useMemo, useRef, useState } from 'react';
import { animate, stagger } from 'animejs';
import { ApiError, api, apiErrorMessage, type DomainDocs, type DomainStat } from '../api';
import { notify } from '../toast';

/**
 * Σ5 主题域 · v7.2 充实版
 * 域卡（一句话导览 + 全库占比条）→ 域内档案 + 高频人物 + 文体构成 + 学段分布与筛选；
 * 档案行显示文体与所属卷，点击直达 Σ7 原文。域描述为站点导览文案，库内数据不动。
 */
const DOMAIN_META: Record<string, string> = {
  '成长叙事': '从益阳到成都——时间主线的全部证词与回忆',
  '人物谱系': '被记住的名字：家族、师长、同窗的个人档案',
  '审美档案': '审美体系的人物卡片、类型簇与批次总结',
  '背景资料': '舞台的地理、学校、制度与时代底板',
  '写作技法': '写这本书的方法：结构、视角、语言与纪律',
  '长篇创作': '书稿的提纲、卷章设计与三份台账',
  '风格参考': '语料汇编与句法意象研究（版权未核，仅作方法研究）',
  '项目运维': '这座记忆建筑的施工、审计与治理日志',
  '创作规格': '成书约定：体量、口径与使用边界',
};

const STAGE_ORDER = ['小学', '初中', '高中', '大学', '家庭', '跨学段'];
const PAGE = 80;
const HARD_CAP = 500;

export function Themes({ onOpenDoc, onOpenPerson, focusDomain, onFocusDone }: {
  onOpenDoc: (path: string) => void;
  onOpenPerson: (id: number) => void;
  /* v8 · 3.3：档案馆检查器的「域」胶囊跳转进来时，自动展开该主题域 */
  focusDomain?: string | null;
  onFocusDone?: () => void;
}) {
  const [stats, setStats] = useState<DomainStat[]>([]);
  const [cur, setCur] = useState<DomainDocs | null>(null);
  const [stage, setStage] = useState<string>('全部');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'mtime' | 'title' | 'stage'>('mtime');
  const [loading, setLoading] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const load = () => api.domains().then(setStats).catch(e => notify(apiErrorMessage(e), 'error'));
    load();
    window.addEventListener('mneme:unlocked', load);
    return () => window.removeEventListener('mneme:unlocked', load);
  }, []);

  const openDomain = async (name: string) => {
    if (cur?.domain === name) { setCur(null); return; }
    setLoading(true);
    setStage('全部');
    setQ('');
    setSort('mtime');
    const d = await api.domainDocs(name, PAGE, 0).catch((e: unknown) => {
      if (e instanceof ApiError && e.status === 403) window.dispatchEvent(new CustomEvent('mneme:locked'));
      else notify(apiErrorMessage(e), 'error');
      return null;
    });
    setLoading(false);
    if (d) setCur(d);
  };

  const loadMore = async () => {
    if (!cur) return;
    const remain = Math.min(HARD_CAP, cur.total) - cur.docs.length;
    if (remain <= 0) return;
    setLoading(true);
    const more = await api.domainDocs(cur.domain, Math.min(PAGE, remain), cur.docs.length).catch((e: unknown) => {
      if (e instanceof ApiError && e.status === 403) window.dispatchEvent(new CustomEvent('mneme:locked'));
      else notify(apiErrorMessage(e), 'error');
      return null;
    });
    setLoading(false);
    if (more) setCur(prev => {
      if (!prev || prev.domain !== more.domain) return prev;
      return { ...more, docs: [...prev.docs, ...more.docs], topPersons: prev.topPersons };
    });
  };

  /* 跨空间聚焦：等 domains 统计就绪后再展开，避免数据未到就放弃 */
  useEffect(() => {
    if (!focusDomain || stats.length === 0) return;
    if (stats.some(s => s.domain === focusDomain)) openDomain(focusDomain);
    onFocusDone?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusDomain, stats]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    animate(root.querySelectorAll('.th-card'), {
      opacity: [0, 1], scale: [0.96, 1], delay: stagger(45), duration: 560, ease: 'outExpo',
    });
  }, [stats.length]);

  /* 文体构成：从已加载档案聚合（可分页至 500 份） */
  const typeBreak = useMemo(() => {
    if (!cur) return [];
    const m = new Map<string, number>();
    for (const d of cur.docs) m.set(d.doc_type || '未标', (m.get(d.doc_type || '未标') || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [cur]);

  /* 学段分布与筛选（v7.2）：349 份的大域不再是一根平铺列表 */
  const stageBreak = useMemo(() => {
    if (!cur) return [];
    const m = new Map<string, number>();
    for (const d of cur.docs) if (d.stage) m.set(d.stage, (m.get(d.stage) || 0) + 1);
    return STAGE_ORDER.filter(s => m.has(s)).map(s => [s, m.get(s)!] as [string, number]);
  }, [cur]);
  const shownDocs = useMemo(() => {
    if (!cur) return [];
    let list = stage === '全部' ? cur.docs : cur.docs.filter(d => d.stage === stage);
    const needle = q.trim().toLowerCase();
    if (needle) {
      list = list.filter(d =>
        d.title.toLowerCase().includes(needle)
        || (d.doc_type || '').toLowerCase().includes(needle)
        || (d.stage || '').toLowerCase().includes(needle)
        || (d.volume || '').toLowerCase().includes(needle),
      );
    }
    const copy = [...list];
    if (sort === 'title') copy.sort((a, b) => a.title.localeCompare(b.title, 'zh'));
    else if (sort === 'stage') copy.sort((a, b) => (a.stage || '').localeCompare(b.stage || '', 'zh') || a.title.localeCompare(b.title, 'zh'));
    else copy.sort((a, b) => String(b.mtime).localeCompare(String(a.mtime)));
    return copy;
  }, [cur, stage, q, sort]);

  const maxN = Math.max(1, ...stats.map(s => s.n));

  return (
    <div className="th" ref={rootRef}>
      <header className="th-head">
        <p className="greek th-kicker">ΧΩΡΟΙ · Σ5</p>
        <h1>主题域</h1>
        <p className="th-sub">{stats.length} 个域陈列全库 {stats.reduce((s, d) => s + d.n, 0)} 份文档。</p>
      </header>
      <div className="th-grid">
        {stats.map(s => (
          <button
            key={s.domain}
            className={`th-card surface ${cur?.domain === s.domain ? 'on' : ''}`}
            onClick={() => openDomain(s.domain)}
          >
            <b>{s.domain}</b>
            <p className="th-card-desc">{DOMAIN_META[s.domain] || ''}</p>
            <span className="th-card-n">{s.n} 份 <i className="th-card-bar" aria-hidden><i style={{ width: `${Math.round((s.n / maxN) * 100)}%` }} /></i></span>
            {(s.hs > 0 || s.uni > 0) && (
              <i className="th-card-sub">{[s.hs > 0 ? `高中 ${s.hs}` : '', s.uni > 0 ? `大学 ${s.uni}` : ''].filter(Boolean).join(' · ')}</i>
            )}
          </button>
        ))}
      </div>
      {loading && <p className="th-loading">开柜取卷…</p>}
      {cur && (
        <section className="th-detail surface">
          <h2>{cur.domain}<span> · {cur.total} 份（已列 {cur.docs.length}{cur.total > HARD_CAP ? `，最多 ${HARD_CAP}` : ''}）</span></h2>
          {DOMAIN_META[cur.domain] && <p className="th-detail-desc">{DOMAIN_META[cur.domain]}</p>}

          {cur.topPersons.length > 0 && (
            <div className="th-persons">
              <h3>域内高频人物</h3>
              <div className="study-chips">
                {cur.topPersons.map(p => (
                  <button key={p.id} onClick={() => onOpenPerson(p.id)} title={`${p.relation_group} · 被提及 ${p.hits} 次`}>
                    {p.display_name}<em>{p.hits}</em>
                  </button>
                ))}
              </div>
            </div>
          )}

          {typeBreak.length > 0 && (
            <div className="th-types">
              <h3>文体构成</h3>
              <div className="th-typebar" aria-hidden>
                {typeBreak.map(([t, n]) => (
                  <i key={t} title={`${t} · ${n}`} style={{ flex: n }} />
                ))}
              </div>
              <div className="th-typelegend">
                {typeBreak.map(([t, n]) => <span key={t}>{t} <em>{n}</em></span>)}
              </div>
            </div>
          )}

          {stageBreak.length > 0 && (
            <div className="th-types">
              <h3>学段分布 · 点筛</h3>
              <div className="th-typebar" aria-hidden>
                {stageBreak.map(([s2, n]) => <i key={s2} title={`${s2} · ${n}`} style={{ flex: n }} />)}
              </div>
              <div className="th-typelegend">
                <button className={`th-stage-chip ${stage === '全部' ? 'on' : ''}`} onClick={() => setStage('全部')}>全部 <em>{cur.docs.length}</em></button>
                {stageBreak.map(([s2, n]) => (
                  <button key={s2} className={`th-stage-chip ${stage === s2 ? 'on' : ''}`} onClick={() => setStage(s2)}>{s2} <em>{n}</em></button>
                ))}
              </div>
            </div>
          )}

          <div className="th-tools">
            <input
              className="th-q"
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="筛选已列出的标题、文体、学段"
              aria-label="筛选已列出的档案"
            />
            <div className="th-sort" role="group" aria-label="排序">
              <button type="button" className={sort === 'mtime' ? 'on' : ''} onClick={() => setSort('mtime')}>近改</button>
              <button type="button" className={sort === 'title' ? 'on' : ''} onClick={() => setSort('title')}>标题</button>
              <button type="button" className={sort === 'stage' ? 'on' : ''} onClick={() => setSort('stage')}>学段</button>
            </div>
          </div>
          <p className="th-tools-hint">只筛已加载的 {cur.docs.length} 份，不是全库检索。条数不是重要程度。</p>

          <ul className="th-docs">
            {shownDocs.map(d => (
              <li key={d.path}>
                <button onClick={() => onOpenDoc(d.path)}>
                  <b>{d.title}</b>
                  <span>{[d.doc_type, d.stage, d.volume].filter(Boolean).join(' · ')}</span>
                </button>
              </li>
            ))}
          </ul>
          {shownDocs.length === 0 && <p className="th-loading">此筛选下暂无档案。</p>}
          {stage === '全部' && cur.docs.length < Math.min(cur.total, HARD_CAP) && (
            <button className="th-more" onClick={loadMore} disabled={loading}>
              {loading ? '取卷中…' : `继续列出 · 还有 ${Math.min(cur.total, HARD_CAP) - cur.docs.length} 份`}
            </button>
          )}
        </section>
      )}
    </div>
  );
}
