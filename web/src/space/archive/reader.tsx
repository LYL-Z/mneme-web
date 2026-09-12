export type ReaderFs = 17 | 19 | 21;
export type ReaderMw = 'n' | 'm' | 'w';
export interface ReaderCfg {
  fs: ReaderFs;
  mw: ReaderMw;
  ff: 'serif' | 'sans';
  sync: boolean;
}

export const READER_KEY = 'mneme-reader';
export const READER_MW: Record<ReaderMw, string> = { n: '32em', m: '36em', w: '40em' };

export function migrateFs(n: unknown): ReaderFs {
  const v = Number(n);
  if (v >= 20) return 21;
  if (v === 19) return 19;
  if (v === 18) return 21;
  return 17;
}

export function defaultMw(): ReaderMw {
  if (typeof document === 'undefined') return 'm';
  return document.documentElement.dataset.shell === 'phone' ? 'n' : 'm';
}

export const remainLabel = (body: string, ratio: number) => {
  const n = body.replace(/\s+/g, '').length;
  if (n < 80) return '不足一分钟';
  const total = Math.max(1, Math.round(n / 400));
  const left = Math.max(0, Math.round(total * (1 - ratio)));
  const pct = Math.round(Math.min(1, Math.max(0, ratio)) * 100);
  if (left <= 0) return `已读完 · ${n.toLocaleString()} 字`;
  return `已读 ${pct}% · 剩余约 ${left} 分钟 · ${n.toLocaleString()} 字`;
};

export const loadReader = (): ReaderCfg => {
  try {
    const v = JSON.parse(localStorage.getItem(READER_KEY) || '');
    if (v && ['n', 'm', 'w'].includes(v.mw) && ['serif', 'sans'].includes(v.ff)) {
      return { fs: migrateFs(v.fs), mw: v.mw, ff: v.ff, sync: v.sync !== false };
    }
  } catch { /* 首访/损坏 → 默认 */ }
  return { fs: 17, mw: defaultMw(), ff: 'serif', sync: true };
};

export function ReaderSettings({ cfg, onChange }: { cfg: ReaderCfg; onChange: (c: ReaderCfg) => void }) {
  const seg = <T extends string | number>(opts: { v: T; label: string }[], cur: T, set: (v: T) => void) => (
    <div className="rs-seg">
      {opts.map(o => (
        <button key={String(o.v)} className={`rs-btn ${cur === o.v ? 'on' : ''}`} onClick={() => set(o.v)}>{o.label}</button>
      ))}
    </div>
  );
  return (
    <div className="rs surface" role="dialog" aria-label="阅读器设置">
      <p className="rs-row"><span>字号</span>{seg([{ v: 17 as const, label: '小' }, { v: 19 as const, label: '中' }, { v: 21 as const, label: '大' }], cfg.fs, fs => onChange({ ...cfg, fs }))}</p>
      <p className="rs-row"><span>行宽</span>{seg([{ v: 'n' as const, label: '窄' }, { v: 'm' as const, label: '适中' }, { v: 'w' as const, label: '宽' }], cfg.mw, mw => onChange({ ...cfg, mw }))}</p>
      <p className="rs-row"><span>字体</span>{seg([{ v: 'serif' as const, label: '宋体' }, { v: 'sans' as const, label: '黑体' }], cfg.ff, ff => onChange({ ...cfg, ff }))}</p>
      <p className="rs-row"><span>对照同步滚</span>{seg([{ v: 1 as const, label: '开' }, { v: 0 as const, label: '关' }], cfg.sync ? 1 : 0, v => onChange({ ...cfg, sync: !!v }))}</p>
    </div>
  );
}

