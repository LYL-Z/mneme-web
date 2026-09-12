import type { ReactNode } from 'react';

export type SpaceLoad = 'loading' | 'ok' | 'empty' | 'fail';

/** 六空间共用：骨架 / 未收录 / 网络失败，不与「无所检出」混用。 */
export function SpaceFrame({
  status, onRetry, empty = '此处尚未收录。', children,
}: {
  status: SpaceLoad;
  onRetry?: () => void;
  empty?: string;
  children: ReactNode;
}) {
  if (status === 'loading') {
    return (
      <div className="ar-skel" aria-busy="true" aria-label="载入中">
        <i /><i /><i /><i /><i />
      </div>
    );
  }
  if (status === 'fail') {
    return (
      <p className="space-fail" role="alert">
        网络未能打开此空间。
        {onRetry ? <button type="button" className="ar-chip" onClick={onRetry}>重试</button> : null}
      </p>
    );
  }
  if (status === 'empty') return <p className="space-empty">{empty}</p>;
  return <>{children}</>;
}
