import { useEffect, useState } from 'react';
import { api, apiErrorMessage } from '../../api';
import { getRecentDocs, isPublicPath } from '../../history';
import { notify } from '../../toast';

export function SecPicker({ onPick, suggested }: { onPick: (path: string) => void; suggested?: { path: string; label: string } | null }) {
  const [q, setQ] = useState('');
  const [docs, setDocs] = useState<{ path: string; title: string; domain: string }[]>([]);
  useEffect(() => {
    const query = q.trim();
    if (!query) { setDocs([]); return; }
    const t = setTimeout(() => {
      api.search(query)
        .then(r => setDocs((r.groups.doc ?? []).filter(d => !d.locked && isPublicPath(d.path)).slice(0, 8)))
        .catch(e => { setDocs([]); notify(apiErrorMessage(e), 'error'); });
    }, 300);
    return () => clearTimeout(t);
  }, [q]);
  const recents = getRecentDocs().filter(d => isPublicPath(d.path)).slice(0, 6);
  return (
    <div className="ar-picker glass">
      <h2>对照阅读 · 选择右栏文档</h2>
      {suggested && isPublicPath(suggested.path) && (
        <button className="ar-pick-sug" onClick={() => onPick(suggested.path)} title={suggested.path}>
          <b>本部章稿 · {suggested.label}</b>
          <span>默认对照：章节设计 ⇄ 原文逐段核对</span>
        </button>
      )}
      <input className="ar-picker-q" value={q} onChange={e => setQ(e.target.value)} placeholder="检索文档标题/正文…" aria-label="检索对照文档" />
      {q.trim() && (docs.length > 0 ? (
        <div className="ar-picker-list">
          {docs.map(d => <button key={d.path} onClick={() => onPick(d.path)}><b>{d.title}</b><span>{d.domain}</span></button>)}
        </div>
      ) : <p className="ar-picker-none">无所检出。</p>)}
      {!q.trim() && recents.length > 0 && (
        <div className="ar-picker-list">
          {recents.map(d => <button key={d.path} onClick={() => onPick(d.path)}><b>{d.title}</b><span>{d.domain}</span></button>)}
        </div>
      )}
      <p className="ar-picker-hint">典型用法：左栏开章节设计，右栏开对应原文，逐段核对。</p>
    </div>
  );
}
