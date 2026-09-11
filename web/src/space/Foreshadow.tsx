import { useEffect, useRef, useState } from 'react';
import { api, apiErrorMessage, type Foreshadow } from '../api';
import { notify } from '../toast';

/**
 * v4 · C4 伏应矩阵：194 章尺度下的伏笔—回收配对可视化。
 * 横轴五卷（等宽列），每条伏笔一行，从「埋设卷」到「回收卷」画跨卷弧线；
 * 等级色：🔴跨卷（红）/青铜（中等级）/淡（低等级质感呼应）。
 * hover 整行显完整台账（素材/埋设/回收/方式/状态）；数据来自 vault 运行台账，埋设即登记。
 */
const VOL_LABELS = ['一卷', '二卷', '三卷', '四卷', '五卷'];
const VOL_COLORS = ['var(--vol1)', 'var(--vol2)', 'var(--vol3)', 'var(--vol4)', 'var(--vol5)'];
const volOf = (s: string): number => {
  const m = s?.match(/[一二三四五]/);
  return m ? VOL_LABELS.indexOf(m[0] + '卷') : -1;
};
const strip = (s: string) => s.replace(/\*\*/g, '').replace(/^\"|\"$/g, '');
const LEVEL_COLOR: Record<string, string> = { '🔴': '#C0392B', '青铜': '#A9864A', '淡': '#8C8371' };
const LEVEL_NAME: Record<string, string> = { '🔴': '跨卷 · 必须回收', '青铜': '中等级', '淡': '低等级 · 质感呼应' };

export function Foreshadow({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<Foreshadow[]>([]);
  const [hover, setHover] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const load = () => api.foreshadow().then(setRows).catch(e => notify(apiErrorMessage(e), 'error'));
    load();
    window.addEventListener('mneme:unlocked', load);
    return () => window.removeEventListener('mneme:unlocked', load);
  }, []);
  useEffect(() => {
    if (!rootRef.current) return;
    rootRef.current.animate?.([{ opacity: 0, translateY: 18 }, { opacity: 1, translateY: 0 }], { duration: 380, easing: 'cubic-bezier(0.22,1,0.36,1)' });
  }, [rows.length]);

  const W = 1000, ROW_H = 44, HEAD = 54, PAD = 16;
  const gridH = rows.length * ROW_H + HEAD + PAD * 2;
  const colX = (v: number) => 320 + v * ((W - 340) / 5) + (W - 340) / 10;
  const point = (row: number, vol: number) => ({ x: colX(vol), y: HEAD + PAD + row * ROW_H + ROW_H / 2 });

  return (
    <div className="fo-mask" onMouseDown={onClose}>
      <div className="fo glass" onMouseDown={e => e.stopPropagation()} ref={rootRef}>
        <header className="fo-head">
          <p className="greek fo-kicker">ΠΡΟΟΠΤΙΚΗ · 伏应矩阵</p>
          <h1>伏笔 — 回收 · 跨卷配对图</h1>
          <p className="fo-sub">
            {rows.length} 条登记 · 数据来自运行台账「埋设即登记，回收时填章」。
            <span className="fo-legend">
              {Object.entries(LEVEL_NAME).map(([k, n]) => (
                <i key={k}><b style={{ background: LEVEL_COLOR[k] }} />{k} {n}</i>
              ))}
            </span>
          </p>
          <button className="gp-sheet-x" onClick={onClose} aria-label="关闭">×</button>
        </header>
        <div className="fo-scroll">
          <svg viewBox={`0 0 ${W} ${gridH}`} width="100%" style={{ minWidth: 760 }} role="img" aria-label="伏应回收矩阵">
            {/* 五卷列头 */}
            {VOL_LABELS.map((lb, v) => (
              <g key={lb}>
                <line x1={colX(v)} y1={HEAD - 12} x2={colX(v)} y2={gridH - PAD} stroke="var(--glass-border)" strokeWidth="1" strokeDasharray="3 5" />
                <circle cx={colX(v)} cy={HEAD - 20} r={7} fill={VOL_COLORS[v]} />
                <text x={colX(v)} y={HEAD + 2} textAnchor="middle" fontSize="14" fill="var(--ink)" fontWeight="600">{lb}</text>
              </g>
            ))}
            {/* 每行：素材 + 弧线 */}
            {rows.map((f, i) => {
              const pv = volOf(f.plant), hv = volOf(f.harvest);
              const a = point(i, Math.max(0, pv)), c = point(i, Math.max(0, hv));
              const hasArc = pv >= 0 && hv >= 0 && pv !== hv;
              const midY = (a.y + c.y) / 2 - 14;
              const color = LEVEL_COLOR[f.level] ?? '#8C8371';
              return (
                <g key={f.id} className={hover === f.id ? 'fo-row on' : 'fo-row'}
                  onMouseEnter={() => setHover(f.id)} onMouseLeave={() => setHover(null)}>
                  <rect x={0} y={a.y - ROW_H / 2} width={W} height={ROW_H} fill={hover === f.id ? 'var(--glass-bg)' : 'transparent'} />
                  <text x={12} y={a.y + 4} fontSize="12.5" fill="var(--ink-soft)">
                    {strip(f.material).slice(0, 34)}{strip(f.material).length > 34 ? '…' : ''}
                  </text>
                  <text x={12} y={a.y + 18} fontSize="10.5" fill="var(--ink-faint)">
                    #{f.id} · 埋设 {f.plant || '—'}{f.status ? ' · ' + f.status : ''}
                  </text>
                  {hasArc ? (
                    <path d={`M ${a.x} ${a.y} C ${a.x} ${midY}, ${c.x} ${midY}, ${c.x} ${c.y}`}
                      fill="none" stroke={color} strokeWidth={hover === f.id ? 2.4 : 1.6} opacity={hover === f.id ? 0.95 : 0.62} />
                  ) : (
                    <circle cx={a.x} cy={a.y} r={3.4} fill={color} opacity={0.8} />
                  )}
                  {hasArc && <circle cx={a.x} cy={a.y} r={3.2} fill={color} />}
                  {hasArc && <circle cx={c.x} cy={c.y} r={3.2} fill="none" stroke={color} strokeWidth={1.6} />}
                </g>
              );
            })}
          </svg>
        </div>
        {hover != null && rows[hover] && (
          <div className="fo-detail">
            <p className="fo-d-line"><b>#{rows[hover].id}</b> <i style={{ color: LEVEL_COLOR[rows[hover].level] }}>{LEVEL_NAME[rows[hover].level]}</i> · 素材状态：{rows[hover].status || '—'}</p>
            <p className="fo-d-line"><b>伏笔</b>：{strip(rows[hover].material)}</p>
            <p className="fo-d-line"><b>埋设</b>：{rows[hover].plant || '—'}　<b>回收</b>：{rows[hover].harvest || '—'}</p>
            {rows[hover].method && <p className="fo-d-line"><b>回收方式</b>：{rows[hover].method}</p>}
          </div>
        )}
        <footer className="fo-foot">台账纪律：埋设即登记 · 回收章留空逾 30 章标红 · 禁止为回收而虚构素材</footer>
      </div>
    </div>
  );
}
