import { useEffect, useRef } from 'react';
import { animate, stagger } from 'animejs';
import type { Overview } from '../api';
import { SignatureWall } from './SignatureWall';
import { DailySky } from './DailySky';
import { readPrefs } from './Wellness';
import { getLastChapter, getRecentDocs, timeAgo } from '../history';

/**
 * Σ1 记忆恒星 · 大厅
 * 中央主恒星（刘佑林）+ 五卷轨道星团 + 全库真实统计 + 数字丰碑展板。
 * 完整人物星图在 Σ3——此处是进入各空间的门厅。
 */
/** 数字丰碑 · 库藏地位口径（用户口径 + 站内实时数并存；不改动知识库内容）
 *  v8：note 中的「已入馆」数字改为读 overview.docs，避免台账增删后文案过期（原硬编码 637，实际 646）。 */
const MONUMENT: { n: string | null; u: string; label: string; note: string }[] = [
  { n: '近 700', u: '份', label: '库藏档案', note: '公开层已入馆 {{docs}}' },
  { n: '近 300', u: '万字', label: '总文字体量', note: '百万字长篇正在其上生长' },
  { n: '46,000+', u: '份', label: '图片与影像附件', note: '相册 · 截图 · 扫描件' },
  { n: '1 亿+', u: '条', label: '微信 / QQ 记录封存', note: '原料级语料，只读封存' },
  { n: '10,000+', u: '字', label: '作者亲笔自撰', note: '百万长文已破万字真迹' },
  { n: null, u: '位', label: '留名星尘', note: '名录中被记住的名字（站内实时统计）' },
];

function Monument({ stardust, docs }: { stardust: number | null; docs: number | null }) {
  return (
    <section className="monument st-atom">
      <div className="monument-head">
        <p className="greek monument-kicker">ΜΝΗΜΟΝΕΥΜΑ · 数字丰碑</p>
        <h3>一座仍在生长的记忆基建</h3>
        <p className="monument-sub">
          这不是一份普通的笔记，而是一座以数字人文标准修建的私人记忆建筑：
          每一份材料可溯源、每一条存疑被标注、私密层加密门禁保护（未解锁不可读）。
        </p>
      </div>
      <div className="monument-grid">
        {MONUMENT.map(m => (
          <div key={m.label} className="monument-item glass">
            <b>{m.n ?? (stardust != null ? stardust.toLocaleString() : '—')}<i>{m.u}</i></b>
            <span>{m.label}</span>
            <em>{m.note.replace('{{docs}}', docs != null ? docs.toLocaleString() : '—')}</em>
          </div>
        ))}
      </div>
      <div className="monument-method glass">
        <h4>成书方法</h4>
        <p>
          下一代大模型起草 —— <b>Claude Fable 5.1</b> · <b>GPT-6 Astra</b> · <b>Gemini 3.1 Pro</b> ——
          再由作者逐字润色补充；全程采用行业最领先的隐私安全实践：
          私密层加密门禁（未解锁不可读）、证据分级陈列、事实存疑必标【待核】。
        </p>
        <p className="monument-note">
          口径说明：库藏规模为 2026-09 作者口径；「已入馆 {docs != null ? docs.toLocaleString() : '—'}」与留名星尘为站内公开层实时统计。
          统计只反映体量，不代表任何人的重要性与亲疏。
        </p>
      </div>
    </section>
  );
}
/** 审计时间格式化（防御性：ISO 或 'YYYY-MM-DD HH:mm:ss' 均可） */
const fmtAudit = (s: string | null | undefined): string | null => {
  if (!s) return null;
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T'));
  if (Number.isNaN(+d)) return s.length > 16 ? s.slice(0, 16) : s;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/**
 * 工作台（v3.4.2 · 首屏真实工作入口，置于星图展陈之前）
 * 继续上次章节（直达材料链面板）· 最近材料 · 待核队列入口 · 数据快照时间。
 * 数据全部真实存在：本机阅读轨迹 + overview 实时统计；无轨迹时如实留白，不放假按钮。
 */
function Workbench({ overview, onOpenChapter, onOpenDoc, onEnterLighthouse }: {
  overview: Overview | null;
  onOpenChapter: (code: string, seq: number) => void;
  onOpenDoc: (path: string) => void;
  onEnterLighthouse: () => void;
}) {
  const lastCh = getLastChapter();
  const recents = getRecentDocs().slice(0, 5);
  const pend = (overview?.evidence ?? [])
    .filter(e => e.kind === 'pending' || e.kind === 'pendingCollect')
    .reduce((s, e) => s + e.n, 0);
  const snap = fmtAudit(overview?.audit?.finished_at ?? null);
  const ingested = overview?.audit?.ingested ?? null;

  return (
    <section className="wb st-atom">
      <p className="greek wb-kicker">ΕΡΓΑ · 工作台</p>
      <div className="wb-main">
        {lastCh ? (
          <button className="wb-continue glass" onClick={() => onOpenChapter(lastCh.code, lastCh.seq)}>
            <span className="wb-label">继续上次章节</span>
            <b>{lastCh.title}</b>
            <span className="wb-meta">{lastCh.volume} · {timeAgo(lastCh.t)}</span>
            <span className="wb-go">打开材料链 →</span>
          </button>
        ) : (
          <div className="wb-continue idle glass">
            <span className="wb-label">继续上次章节</span>
            <p className="wb-none">尚无章节轨迹——五卷书房的每一辑都开着材料链的门。</p>
          </div>
        )}
        <div className="wb-recent glass">
          <h4>最近材料</h4>
          {recents.length > 0 ? recents.map(d => (
            <button key={d.path} className="wb-doc" onClick={() => onOpenDoc(d.path)} title={d.path}>
              <b>{d.title}</b>
              <span>{d.domain} · {timeAgo(d.t)}</span>
            </button>
          )) : (
            <p className="wb-none">尚无最近材料——从时间之河或 ⌘K 检索开始。</p>
          )}
        </div>
      </div>
      <div className="wb-status">
        <button className="wb-chip" onClick={onEnterLighthouse}>待核工作队列 {pend.toLocaleString()} 项 →</button>
        {snap && (
          <span className="wb-chip dim">数据快照 {snap}{overview?.docs != null ? ` · 公开层 ${overview.docs} 篇` : ''}</span>
        )}
      </div>
    </section>
  );
}

export function Stars({ overview, theme, onEnterRiver, onOpenChapter, onOpenDoc, onEnterLighthouse, onOpenPerson }: {
  overview: Overview | null;
  theme: 'paper' | 'night';
  onEnterRiver: () => void;
  onOpenChapter: (code: string, seq: number) => void;
  onOpenDoc: (path: string) => void;
  onEnterLighthouse: () => void;
  onOpenPerson: (id: number) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current!;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || !readPrefs().motion) return;
    animate(root.querySelectorAll('.st-atom'), {
      opacity: [0, 1], translateY: [26, 0],
      delay: stagger(110, { start: 160 }), duration: 760, ease: 'outExpo',
    });
    animate(root.querySelectorAll('.orbit'), {
      opacity: [0, 1], scale: [0.86, 1],
      delay: stagger(120, { start: 420 }), duration: 980, ease: 'outExpo',
    });
  }, []);

  const stats = overview ? [
    { n: overview.docs, label: '文档' },
    { n: overview.entities, label: '人物' },
    { n: overview.edges, label: '关联' },
    { n: overview.stardust, label: '留名星尘' },
    { n: overview.anchors, label: '纪年锚点' },
    { n: overview.chapters, label: '章节骨架' },
  ] : [];

  return (
    <div className="st" ref={rootRef}>
      <SignatureWall />
      <section className="st-hero st-atom">
        <p className="st-kicker greek st-atom">ΜΝΗΜΗ · Σ1</p>
        <h1 className="st-title">记忆恒星</h1>
        <p className="st-quote">
          「补写的手册」翻开之后，所有记忆围绕一颗恒星运转——<br />
          这座建筑里的每一份文件，都是它的光。
        </p>
      </section>

      <div className="st-orbitry st-atom" aria-hidden>
        <div className="star-core" />
        <div className="star-halo" />
        {[92, 152, 212, 272].map((d, i) => (
          <div key={d} className={`orbit orbit-${i}`} style={{ width: d, height: d }}>
            <span className="orbit-star" style={{ background: ['var(--vol1)', 'var(--vol2)', 'var(--vol3)', 'var(--vol4)', 'var(--vol5)'][i] }} />
          </div>
        ))}
      </div>

      <Workbench
        overview={overview}
        onOpenChapter={onOpenChapter}
        onOpenDoc={onOpenDoc}
        onEnterLighthouse={onEnterLighthouse}
      />

      {/* v4 · C2 每日星座：今天的天空记住今天 */}
      <DailySky theme={theme} onOpenPerson={onOpenPerson} />

      <section className="st-stats st-atom">
        {stats.map(s => (
          <div key={s.label} className="stat glass">
            <b>{s.n.toLocaleString()}</b>
            <span>{s.label}</span>
          </div>
        ))}
      </section>

      <Monument stardust={overview?.stardust ?? null} docs={overview?.docs ?? null} />

      <section className="st-volumes st-atom">
        {(overview?.volumes ?? []).slice(0, 5).map(v => (
          <div key={v.code} className="vol glass" style={{ ['--vc' as string]: v.color_token }}>
            <i className="vol-dot" />
            <div>
              <b>{v.name}</b>
              <span>{v.years} · {v.line_metaphor} · {v.chapters}章</span>
            </div>
          </div>
        ))}
      </section>

      <button className="st-enter glass" onClick={onEnterRiver}>
        顺流而下 · 进入时间之河 →
      </button>
    </div>
  );
}
