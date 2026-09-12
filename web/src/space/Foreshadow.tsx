import { useEffect, useRef, useState } from 'react';
import { api, apiErrorMessage, type Foreshadow } from '../api';
import { notify } from '../toast';

/**
 * 伏应矩阵：现行《补写的手册》按 1–60 章落入序 / 六部 / 附录。
 * hover 整行显完整台账；未解锁时服务端已滤绝密姓名。
 */
const BOOK_LABELS = ['序', '空格', '亲爱的', '桌上', '西侧', '十七天', '保存', '附录'];
const BOOK_COLORS = ['var(--vol0)', 'var(--vol1)', 'var(--vol2)', 'var(--vol3)', 'var(--vol4)', 'var(--vol5)', 'var(--vol6)', 'var(--vol-ax)'];

const bookOf = (s: string): number => {
  const t = String(s || '');
  if (/附录/.test(t)) return 7;
  if (/第一部|空格/.test(t) && !/\d/.test(t)) return 1;
  const nums = [...t.matchAll(/\d+/g)].map(m => +m[0]);
  const n = nums[0];
  if (!n) return /序/.test(t) ? 0 : -1;
  if (n <= 12) return 1;
  if (n <= 22) return 2;
  if (n <= 32) return 3;
  if (n <= 44) return 4;
  if (n <= 52) return 5;
  if (n <= 60) return 6;
  return /序/.test(t) ? 0 : -1;
};
const strip = (s: string) => s.replace(/\*\*/g, '').replace(/^\"|\"$/g, '');
const LEVEL_COLOR: Record<string, string> = { '🔴': '#C0392B', '青铜': '#A9864A', '淡': '#8C8371' };
const LEVEL_NAME: Record<string, string> = { '🔴': '跨部 · 必须回收', '青铜': '中等级', '淡': '低等级 · 质感呼应' };

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

  const W = 1080, ROW_H = 44, HEAD = 54, PAD = 16;
  const gridH = rows.length * ROW_H + HEAD + PAD * 2;
  const colX = (v: number) => 300 + v * ((W - 320) / 8) + (W - 320) / 16;
  const point = (row: number, vol: number) => ({ x: colX(vol), y: HEAD + PAD + row * ROW_H + ROW_H / 2 });

  return (
    <div className="fo-mask" onMouseDown={onClose}>
      <div className="fo glass chrome" onMouseDown={e => e.stopPropagation()} ref={rootRef}>
        <header className="fo-head">
          <p className="greek fo-kicker">ΠΡΟΟΠΤΙΚΗ · 伏应矩阵</p>
          <h1>伏笔 — 回收 · 六部配对图</h1>
          <p className="fo-sub">
            {rows.length} 条登记 · 按现行 1–60 章落入部。
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
            {BOOK_LABELS.map((lb, v) => (
              <g key={lb}>
                <line x1={colX(v)} y1={HEAD - 12} x2={colX(v)} y2={gridH - PAD} stroke="var(--glass-border)" strokeWidth="1" strokeDasharray="3 5" />
                <circle cx={colX(v)} cy={HEAD - 20} r={7} fill={BOOK_COLORS[v]} />
                <text x={colX(v)} y={HEAD + 2} textAnchor="middle" fontSize="13" fill="var(--ink)" fontWeight="600">{lb}</text>
              </g>
            ))}
            {rows.map((f, i) => {
              const pv = bookOf(f.plant), hv = bookOf(f.harvest);
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
                    #{f.id} · 放出 {f.plant || '—'}{f.status ? ' · ' + f.status : ''}
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
            <p className="fo-d-line"><b>放出</b>：{rows[hover].plant || '—'}　<b>回收</b>：{rows[hover].harvest || '—'}</p>
            {rows[hover].method && <p className="fo-d-line"><b>回收方式</b>：{rows[hover].method}</p>}
          </div>
        )}
        <footer className="fo-foot">台账纪律：写一章核一对 · 禁止为回收而虚构素材</footer>
      </div>
    </div>
  );
}
