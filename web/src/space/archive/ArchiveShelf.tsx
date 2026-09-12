import { useEffect, useState } from 'react';
import { api, apiErrorMessage, type Shelf } from '../../api';
import { getRecentDocs } from '../../history';
import { notify } from '../../toast';
import { askUnlock } from '../../unlock';

const VOL_NAME: Record<string, string> = {
  P0: '序', B1: '空格', B2: '亲爱的', B3: '桌上', B4: '西侧', B5: '十七天', B6: '保存', AX: '附录',
};

function fmtMtime(m: number | string | undefined) {
  if (m == null || m === '') return '';
  const n = typeof m === 'number' ? m : Date.parse(String(m));
  if (!Number.isFinite(n)) return String(m).slice(0, 10);
  const ms = n < 1e12 ? n * 1000 : n;
  return new Date(ms).toLocaleDateString('zh-CN');
}

export function ArchiveShelf({
  onOpenDoc, onOpenVolume, onOpenDomain, onOpenStage,
}: {
  onOpenDoc: (path: string) => void;
  onOpenVolume?: (code: string) => void;
  onOpenDomain?: (name: string) => void;
  onOpenStage?: (stage: string) => void;
}) {
  const [shelf, setShelf] = useState<Shelf | null>(null);
  const [fail, setFail] = useState('');
  const local = getRecentDocs();

  const load = () => {
    setFail('');
    api.shelf().then(setShelf).catch(e => {
      setFail(apiErrorMessage(e) || '书架未能打开');
      notify(apiErrorMessage(e) || '书架未能打开', 'warn');
    });
  };
  useEffect(() => { load(); }, []);

  return (
    <div className="shelf">
      <header className="shelf-head">
        <p className="greek shelf-kicker">ΑΡΧΕΙΟΝ · 书架</p>
        <h1>档案馆</h1>
        <p className="shelf-sub">先选架，再开篇。检索不是进馆的唯一路。</p>
      </header>

      {fail && (
        <p className="shelf-fail" role="alert">
          {fail}
          <button type="button" className="ar-chip" onClick={load}>重试</button>
        </p>
      )}

      {local.length > 0 && (
        <section className="shelf-sec">
          <h2>本机续读</h2>
          <ul className="shelf-list">
            {local.slice(0, 8).map(d => (
              <li key={d.path}>
                <button type="button" className="shelf-line" onClick={() => onOpenDoc(d.path)}>
                  <b>{d.title}</b>
                  <span>{d.domain}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!!shelf?.volumes.length && (
        <section className="shelf-sec">
          <h2>六部与附录</h2>
          <div className="shelf-chips">
            {shelf.volumes.map(v => (
              <button key={v.code} type="button" className="shelf-chip" onClick={() => onOpenVolume?.(v.code)}>
                {VOL_NAME[v.code] || v.name}<em>{v.docs}</em>
              </button>
            ))}
          </div>
        </section>
      )}

      {!!shelf?.domains.length && (
        <section className="shelf-sec">
          <h2>十域</h2>
          <div className="shelf-chips">
            {shelf.domains.map(d => (
              <button key={d.domain} type="button" className="shelf-chip" onClick={() => onOpenDomain?.(d.domain)}>
                {d.domain}<em>{d.n}</em>
              </button>
            ))}
          </div>
        </section>
      )}

      {!!shelf?.stages.length && (
        <section className="shelf-sec">
          <h2>学段</h2>
          <div className="shelf-chips">
            {shelf.stages.map(s => (
              <button key={s.stage} type="button" className="shelf-chip" onClick={() => onOpenStage?.(s.stage)}>
                {s.stage}<em>{s.n}</em>
              </button>
            ))}
          </div>
        </section>
      )}

      {!!shelf?.recent.length && (
        <section className="shelf-sec">
          <h2>最近公开篇</h2>
          <ul className="shelf-list">
            {shelf.recent.map(d => (
              <li key={d.path}>
                <button type="button" className="shelf-line" onClick={() => d.locked ? askUnlock() : onOpenDoc(d.path)}>
                  <b>{d.title}{d.locked ? ' · 锁' : ''}</b>
                  <span>{[d.domain, d.stage, fmtMtime(d.mtime)].filter(Boolean).join(' · ')}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
