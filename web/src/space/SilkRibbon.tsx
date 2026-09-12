import { useEffect, useState } from 'react';
import { api, apiErrorMessage, type QueueItem } from '../api';
import { notify } from '../toast';
import { timeAgo } from '../history';
import {
  loadPublicCatalog,
  markCollectDone,
  nextChapterHint,
  pickTodayCollect,
  readSilk,
  type PublicChapterHint,
  type SilkState,
} from '../silk';

export function SilkRibbon({
  book,
  onOpenChapter,
  onOpenDoc,
  onOpenPerson,
  onOpenImagery,
}: {
  book?: string | null;
  onOpenChapter: (code: string, seq: number) => void;
  onOpenDoc: (path: string) => void;
  onOpenPerson: (id: number) => void;
  onOpenImagery: (id: number) => void;
}) {
  const [silk, setSilk] = useState<SilkState>(() => readSilk());
  const [hint, setHint] = useState<PublicChapterHint | null>(null);
  const [collect, setCollect] = useState<QueueItem | null>(null);

  useEffect(() => {
    const sync = () => setSilk(readSilk());
    sync();
    window.addEventListener('mneme:silk', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('mneme:silk', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  useEffect(() => {
    let dead = false;
    loadPublicCatalog().then(cat => {
      if (!dead) setHint(nextChapterHint(silk.chapter, cat));
    });
    return () => { dead = true; };
  }, [silk.chapter?.code, silk.chapter?.seq]);

  useEffect(() => {
    let dead = false;
    api.queue().then(q => {
      if (!dead) setCollect(pickTodayCollect(q));
    }).catch(e => notify(apiErrorMessage(e), 'error'));
    const on = () => {
      api.queue().then(q => setCollect(pickTodayCollect(q))).catch(() => {});
    };
    window.addEventListener('mneme:silk', on);
    window.addEventListener('mneme:unlocked', on);
    return () => {
      dead = true;
      window.removeEventListener('mneme:silk', on);
      window.removeEventListener('mneme:unlocked', on);
    };
  }, []);

  const resume = () => {
    const r = silk.resume;
    if (!r) {
      if (hint) onOpenChapter(hint.code, hint.seq);
      else onOpenChapter('P0', 1);
      return;
    }
    if (r.kind === 'chapter') onOpenChapter(r.code, r.seq);
    else onOpenDoc(r.path);
  };

  const lit = (code: string) => (book || silk.book) === code;

  return (
    <div className="silk" aria-label="续读丝带">
      <button type="button" className="silk-resume glass chrome" onClick={resume}>
        <span className="silk-k">丝带</span>
        <b>
          {silk.chapter
            ? silk.chapter.title
            : silk.doc
              ? silk.doc.title
              : hint
                ? hint.title
                : '从序翻起'}
        </b>
        <em>
          {silk.chapter
            ? `${silk.chapter.volume} · ${timeAgo(silk.chapter.t)}`
            : silk.doc
              ? timeAgo(silk.doc.t)
              : '按昨天停的地方往下翻'}
        </em>
      </button>
      <span className="silk-rings" aria-hidden>
        {(['B1', 'B2', 'B3', 'B4', 'B5', 'B6'] as const).map(code => (
          <i key={code} className={`silk-ring ${lit(code) ? 'on' : ''}`} data-vol={code} />
        ))}
      </span>
      {hint && (
        <button
          type="button"
          className="silk-chip"
          title="按昨天停的地方往下翻"
          onClick={() => onOpenChapter(hint.code, hint.seq)}
        >
          今日该读 · {hint.title}
        </button>
      )}
      {silk.person && (
        <button type="button" className="silk-chip dim" onClick={() => onOpenPerson(silk.person!.id)}>
          {silk.person.name}
        </button>
      )}
      {silk.imagery && (
        <button type="button" className="silk-chip dim" onClick={() => onOpenImagery(silk.imagery!.id)}>
          {silk.imagery.name}
        </button>
      )}
      {collect && (
        <button
          type="button"
          className="silk-chip"
          onClick={() => {
            markCollectDone(collect.id);
            onOpenDoc(collect.path);
          }}
        >
          今日一张待采
        </button>
      )}
    </div>
  );
}
