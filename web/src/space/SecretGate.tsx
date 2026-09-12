import { useEffect, useRef, useState } from 'react';
import { animate } from 'animejs';
import { api, swrInvalidate } from '../api';
import { annihilate, prepareSnapshot } from '../annihilate';
import { skipHeavyFx } from '../immersive';
import { useFocusTrap } from '../focusTrap';
import { clearDailySkyCache } from './DailySky';

/**
 * 绝密档案门 · v4 液态玻璃密码模态（对标 Apple Liquid Glass 材质分层）
 * 触发：任何请求遇 403 locked → window 派发 'mneme:locked'；
 * 解锁成功：服务端下发 HttpOnly cookie → 派发 'mneme:unlocked'（各视图自行重试当前加载）。
 * 密码只走服务端校验，浏览器不落明文。
 */
export function SecretGate() {
  const [open, setOpen] = useState(false);
  const [pwd, setPwd] = useState('');
  const [err, setErr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const closing = useRef(false);

  useEffect(() => {
    const onLocked = () => setOpen(true);
    window.addEventListener('mneme:locked', onLocked);
    return () => window.removeEventListener('mneme:locked', onLocked);
  }, []);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('mneme:secret-gate', { detail: open }));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    closing.current = false;
    setPwd(''); setErr(false); setBusy(false);
    setTimeout(() => inputRef.current?.focus(), 60);
    if (cardRef.current && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      animate(cardRef.current, {
        opacity: [0, 1], scale: [0.92, 1], translateY: [14, 0],
        filter: ['blur(8px)', 'blur(0px)'], duration: 420, ease: 'outExpo',
      });
    }
  }, [open]);

  /** v4 · 沉浸光感：弹窗湮灭——粒子拼图替代卡片后从下往上崩解飘散；播完再卸 React 树 */
  const doClose = () => {
    if (closing.current) return;
    closing.current = true;
    const card = cardRef.current;
    if (card && !skipHeavyFx()) annihilate(card, () => { closing.current = false; setOpen(false); });
    else { closing.current = false; setOpen(false); }
  };
  useFocusTrap(cardRef, open, () => doClose());

  /* v5 · 空闲预采样：快照缓存，关闭零延迟 */
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => { if (cardRef.current) prepareSnapshot(cardRef.current); }, 400);
    return () => clearTimeout(t);
  }, [open]);

  const submit = async () => {
    if (busy || !pwd) return;
    setBusy(true);
    try {
      const ok = await api.unlock(pwd);
      if (ok) {
        swrInvalidate();
        clearDailySkyCache();
        window.dispatchEvent(new CustomEvent('mneme:unlocked'));
        doClose();
      } else {
        setErr(true); setShake(s => s + 1);
        if (cardRef.current && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
          animate(cardRef.current, { translateX: [0, -9, 8, -5, 0], duration: 320, ease: 'outQuad' });
        }
        setPwd('');
        setTimeout(() => inputRef.current?.focus(), 40);
      }
    } catch { setErr(true); }
    setBusy(false);
  };

  if (!open) return null;

  return (
    <div className="sg-mask" onMouseDown={() => doClose()}>
      <div className="sg glass" ref={cardRef} onMouseDown={e => e.stopPropagation()} data-shake={shake} role="dialog" aria-modal="true" aria-labelledby="sg-title">
        <p className="sg-greek greek">ΑΡΧΕΙΟΝ ΑΠΟΡΡΗΤΟΝ</p>
        <h1 id="sg-title">此为绝密档案</h1>
        <p className="sg-sub">需输入管理员密码方可开启。密码持有者：库主本人。</p>
        <div className="sg-row">
          <input
            ref={inputRef}
            className={`sg-input ${err ? 'err' : ''}`}
            type="password" inputMode="text" autoComplete="off"
            placeholder="管理员密码"
            value={pwd}
            onChange={e => { setPwd(e.target.value); setErr(false); }}
            onKeyDown={e => { if (e.nativeEvent.isComposing || e.keyCode === 229) return; if (e.key === 'Enter') submit(); if (e.key === 'Escape') doClose(); }}
          />
          <button className="sg-btn" onClick={submit} disabled={busy || !pwd}>
            {busy ? '校验中…' : '开启'}
          </button>
        </div>
        {err && <p className="sg-err">密码不对——这扇门只认它的主人。</p>}
        <button className="sg-cancel" onClick={doClose}>暂不开启，返回</button>
      </div>
    </div>
  );
}
