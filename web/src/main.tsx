import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import ErrorBoundary from './ErrorBoundary';
import Toaster from './Toaster';
import './styles/tokens.css';
import './styles/liquid-glass.css';
import './styles/app.css';

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
