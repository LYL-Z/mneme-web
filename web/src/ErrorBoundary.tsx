/**
 * ΜΝΗΜΗ · 错误边界
 *
 * 为什么需要：全站原先没有任何 ErrorBoundary——任一空间组件抛异常，
 * 整页白屏且没有任何提示，用户只能刷新碰运气。
 * 现在把异常收在空间容器内，给出「此空间加载失败 + 重试」，其余导航仍可用。
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { notify } from './toast';
import { isStaleChunk, reloadOnce } from './lazySpace';

interface Props {
  children: ReactNode;
  /** 变化时自动重置边界（例如路由切换） */
  resetKey?: string;
  /** 出错时的兜底标题 */
  label?: string;
}

interface State { error: Error | null }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State { return { error }; }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    /* 留一份到控制台便于排查；同时给用户一个可见反馈 */
    console.error('[mneme] 渲染异常', error, info.componentStack);
    if (isStaleChunk(error) && reloadOnce()) return;
    notify(`${this.props.label || '此空间'}加载失败，可重试`, 'error');
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="eb-panel" role="alert">
        <p className="eb-title">{this.props.label || '此空间'}加载失败</p>
        <p className="eb-desc">页面渲染时发生异常，其余内容仍可正常浏览。</p>
        <p className="eb-detail">{String(this.state.error.message || this.state.error).slice(0, 180)}</p>
        <div className="eb-actions">
          <button type="button" onClick={() => this.setState({ error: null })}>重试</button>
          <button type="button" className="eb-ghost" onClick={() => location.reload()}>刷新页面</button>
        </div>
      </div>
    );
  }
}
