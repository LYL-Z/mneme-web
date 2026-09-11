import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import ErrorBoundary from './ErrorBoundary';
import Toaster from './Toaster';
import { watchVitals } from './vitals';
import { maybeWarmCjkSerif } from './fontsCjk';
import latinSerif from '@fontsource/noto-serif-sc/files/noto-serif-sc-latin-400-normal.woff2?url';
import './styles/fonts.css';
import './styles/tokens.css';
import './styles/liquid-glass.css';
import './styles/app.css';

const preloadFont = (href: string) => {
  const l = document.createElement('link');
  l.rel = 'preload';
  l.as = 'font';
  l.type = 'font/woff2';
  l.crossOrigin = 'anonymous';
  l.href = href;
  document.head.appendChild(l);
};
preloadFont(latinSerif);
maybeWarmCjkSerif();

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* 无 SW 时站点仍可用 */ });
  });
}
watchVitals();

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/* 顶层错误边界：兜住 App 自身的渲染异常，避免整页白屏 */}
    <ErrorBoundary label="ΜΝΗΜΗ">
      <App />
    </ErrorBoundary>
    {/* 轻提示挂在边界之外：即使 App 崩溃，错误提示仍然可见 */}
    <Toaster />
  </React.StrictMode>,
);
