import { useEffect, useRef } from 'react';
import { animate, stagger } from 'animejs';
import { api, type Overview } from '../api';
import { evidenceLabel as labelOf } from '../evidenceKind';

/**
 * Σ9 证据灯塔 · 事实纪律的守夜塔
 * 塔身 = 五类证据徽章总览；塔灯 = 最新一次全库审计（扫描/入库/隔离/掩码）；
 * 塔基 = 三份运行台账的去处。一切陈列可回溯，一切存疑必标注。
 * 证据分级标签表已抽到 ../evidenceKind.ts，与 Σ7 档案馆检查器共用同一份。
 */

export function Lighthouse({ overview }: { overview: Overview | null }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const audit = overview?.audit ?? null;
  const ev = overview?.evidence ?? [];
  /* 证据总数接数据源（原先硬编码「488 条」，实际 484——台账一增删文案就过期） */
  const evTotal = ev.reduce((s, e) => s + e.n, 0);
  /* 私密层份数：优先取库内真实计数（overview.secretDocs），退回首审记录的隔离数 */
  const privCount = overview?.secretDocs ?? audit?.excluded_private ?? 0;

  useEffect(() => {
    const root = rootRef.current;
    if (!root || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    animate(root.querySelectorAll('.lh-badge'), {
      opacity: [0, 1], translateY: [18, 0], delay: stagger(90, { start: 300 }), duration: 620, ease: 'outExpo',
    });
    animate(root.querySelector('.lh-beam')!, {
      opacity: [0, 1], duration: 1400, delay: 500, ease: 'outExpo',
    });
  }, [overview]);

  return (
    <div className="lh" ref={rootRef}>
      <header className="lh-head">
        <p className="greek lh-kicker">ΦΑΡΟΣ · Σ9</p>
        <h2>证据灯塔</h2>
        <p className="lh-sub">{evTotal} 条证据片段与最新一轮全库审计——这座建筑的事实守夜人。</p>
      </header>

      <div className="lh-tower">
        <div className="lh-beam" aria-hidden />
        <div className="lh-body">
          <div className="lh-lamp" />
          <div className="lh-stripes" aria-hidden><i /><i /><i /></div>
        </div>
        <div className="lh-base" />
      </div>

      <div className="lh-panel">
        <section className="lh-badges">
          <h4>证据分级 · 共 {evTotal} 条</h4>
          {ev.map(e => {
            const lb = labelOf(e.kind);
            return (
              <div key={e.kind} className="lh-badge glass" title={lb.desc}>
                <b>{e.n}</b>
                <span><i>{lb.name}</i>{lb.desc}</span>
              </div>
            );
          })}
        </section>

        <section className="lh-audit glass">
          <h4>最新审计</h4>
          {audit ? (
            <dl>
              <div><dt>完成时刻</dt><dd>{new Date(audit.finished_at || audit.started_at).toLocaleString('zh-CN')}</dd></div>
              <div><dt>扫描</dt><dd>{audit.scanned?.toLocaleString()} 项</dd></div>
              <div><dt>入库</dt><dd>{audit.ingested?.toLocaleString()} 份</dd></div>
              {/* v8 修订：原文案「（零读取）」与实现矛盾——v4 起私密层 md 以 is_private=1 入
                  documents（加密门禁后展示），并非零提取。改为按实际治理口径陈述。 */}
              <div><dt>私密层</dt><dd>{privCount.toLocaleString()} 份（加密门禁保护 · 未解锁不可读）</dd></div>
              <div><dt>系统排除</dt><dd>{audit.excluded_system?.toLocaleString()} 份</dd></div>
              <div><dt>脱敏掩码</dt><dd>{audit.masked} 处</dd></div>
            </dl>
          ) : <p className="lh-none">暂无审计记录。</p>}
          <p className="lh-note">台账现行版：项目管理 · 全库缺口与审计总台账（2026-09-04）。</p>
        </section>
      </div>
    </div>
  );
}
