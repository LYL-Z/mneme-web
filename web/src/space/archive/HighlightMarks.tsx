import { addHighlight, getHighlights, isPublicPath, removeHighlight, type DocHighlight } from '../../history';
import { copyPermalink } from '../../cite';
import { notify } from '../../toast';
import { focusLocalHighlight, paintLocalHighlights } from '../../highlightSnippet';

export function HighlightPop({
  pop, path, title, onClose, onSaved,
}: {
  pop: { x: number; y: number; text: string; heading: string };
  path: string;
  title: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  return (
    <div
      className="ar-pop surface"
      style={{ left: pop.x, top: pop.y }}
      onMouseDown={e => e.preventDefault()}
    >
      <button type="button" onClick={() => {
        if (!isPublicPath(path)) return;
        addHighlight({ path, title, heading: pop.heading, snippet: pop.text });
        const root = document.querySelector('.ar-pane:not(.sec) .ar-body') as HTMLElement | null;
        if (root) paintLocalHighlights(root, getHighlights(path));
        window.getSelection()?.removeAllRanges();
        onSaved();
        onClose();
        notify('已记下本机划线', 'info');
      }}>划线</button>
      <button type="button" onClick={() => {
        copyPermalink({ title, heading: pop.heading, snippet: pop.text });
        window.getSelection()?.removeAllRanges();
        onClose();
      }}>复制引用</button>
    </div>
  );
}

export function HighlightList({
  path, marks, onChange, onSeek,
}: {
  path: string;
  marks: DocHighlight[];
  onChange: () => void;
  onSeek: (snippet: string) => void;
}) {
  if (marks.length === 0) return null;
  return (
    <section className="ar-card surface">
      <h2>本机划线</h2>
      <p className="ar-ev-note">只存在这台浏览器，不写回知识库。</p>
      {marks.map(h => (
        <div key={h.id} className="ar-hl">
          <button type="button" className="ar-link" onClick={() => {
            const root = document.querySelector('.ar-pane:not(.sec) .ar-body') as HTMLElement | null;
            const el = root ? focusLocalHighlight(root, h.id) : null;
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            else onSeek(h.snippet.slice(0, 48));
          }}>{h.snippet}</button>
          <button type="button" className="ar-hl-x" aria-label="删除划线" onClick={() => {
            removeHighlight(h.id);
            onChange();
            const root = document.querySelector('.ar-pane:not(.sec) .ar-body') as HTMLElement | null;
            if (root) paintLocalHighlights(root, getHighlights(path));
          }}>删</button>
        </div>
      ))}
    </section>
  );
}
