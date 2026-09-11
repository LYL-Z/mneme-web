import { useEffect, useMemo, useRef, useState } from 'react';
import { animate, stagger } from 'animejs';
import { api, apiErrorMessage, type Entity, type TimelineEvent } from '../api';
import { notify } from '../toast';
import { STAGE_EPOCH, YEAR_MAX, YEAR_MIN } from '../stages';

/**
 * Σ2 时间之河 · v5.1「无限之河」
 * - 渲染走合成器：strip 用 transform: translate3d 直写（不经 scrollLeft/React state），
 *   指针位移 1:1 贴手，帧间隔恒定——Apple 连续交互准则（流畅性优先于绝对延迟）
 * - 年距 210px（v5.1 自 150 放宽：事件与年份不再拥挤），年份 1990–2032：两翼留白体现河流无限
 * - v5.1 时间之船缓速巡航（0.55px/帧 ≈ 每年约 4.5 秒，渐入无级变速——时间慢慢流转）
 * - v5.1 事件卡扇形错位（同行左右交替逐层外移）+ 栈距 12→18：密集年份不再相互遮挡缺失
 * - 双击河面：时间之船起航自动向右巡航；单击 / 滚轮 / 拖拽随时停靠
 * - 河水双层相位波；家族口径脱敏；诞辰刻度；学段色带
 */
const IS_NARROW = typeof window !== 'undefined' && window.innerWidth < 640;
const COL_W = IS_NARROW ? 172 : 210;
/* 学段区间表收敛到 ../stages（Archive 检查器的「学段」互链共用同一份） */
const Y0 = YEAR_MIN, Y1 = YEAR_MAX;
const EPOCH = STAGE_EPOCH;
const STAGE_COLOR: Record<string, string> = {
  '小学': 'var(--vol1)', '初中': 'var(--vol2)', '高中': 'var(--vol3)',
  '大学': 'var(--vol4)', '跨学段': 'var(--vol5)', '家庭': 'var(--bronze)',
};
const epochColor = (y: number) => {
  const s = EPOCH.find(e => y >= e.from && y <= e.to)?.stage ?? '';
  if (STAGE_COLOR[s]) return STAGE_COLOR[s];
  return s === '学龄前' ? 'color-mix(in srgb, var(--bronze) 45%, transparent)' : 'transparent';
};

/** 家族白名单 + 通用称谓；其余人名从展示文本隐去（库内事实零改动） */
const KIN_RE = /(母亲|父亲|父母|妈妈|爸爸|家人|全家|姑母|姑父|舅舅|外公|外婆|祖父|祖母|爷爷|奶奶|表兄|表姐|表弟|堂|姨)/;
function sanitizeTitle(title: string, nonFamily: string[]): string {
  let t = title;
  for (const name of nonFamily) if (name.length >= 2 && !KIN_RE.test(name)) t = t.split(name).join('');
  return t
    .replace(/([、,，])\s*(?=[、,，）])/g, '')
    .replace(/[（(]\s*[）)]/g, '')
    .replace(/[、,，]\s*$/g, '')
    .replace(/([、,，])\s*（/g, '（')
    .trim();
}

function wavePath(width: number, amp: number, phase: number, baseline: number): string {
  const pts: string[] = [];
  for (let x = -192; x <= width + 192; x += 6) {
    const y = baseline + Math.sin((x + phase) / 48 * Math.PI * 2) * amp
      + Math.sin((x + phase) / 137 * Math.PI * 2) * amp * 0.5;
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return `M${pts.join('L')}`;
}

export function River({ onOpenDoc, focus, onFocusDone }: {
  onOpenDoc: (path: string) => void;
  focus?: { year: number; eventId?: number } | null;
  onFocusDone?: () => void;
}) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [years, setYears] = useState<{ year: number; docs: number }[]>([]);
  const [nonFamily, setNonFamily] = useState<string[]>([]);
  const [cruising, setCruising] = useState(false);
  /* v8 · 3.7 纵向列表替代视图（体验规格 §九个空间：时间之河「纵向列表替代视图」）。
     窄屏默认走列表——横向长河在 390px 下虽有拖拽，但信息密度与可达性都差。 */
  const [listView, setListView] = useState(() => typeof window !== 'undefined' && window.innerWidth < 640);
  const rootRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const boatRef = useRef<HTMLDivElement>(null);

  /* ---------- 航行物理（全部 ref 数值，绕过 React 渲染路径——跟手关键） ---------- */
  const phy = useRef({
    offset: 0, target: 0, max: 0, viewW: 1,
    mode: 'idle' as 'idle' | 'drag' | 'glide' | 'cruise',
    downX: 0, downOffset: 0, lastT: 0, lastV: 0, v: 0,
    raf: 0, lastTap: 0, moved: false, kick: (() => {}) as () => void,
  });

  const apply = () => {
    const p = phy.current;
    if (stripRef.current) stripRef.current.style.transform = `translate3d(${(-p.offset).toFixed(2)}px,0,0)`;
    if (boatRef.current) boatRef.current.style.transform = `translate3d(${(p.offset + p.viewW / 2).toFixed(1)}px,0,0)`;
  };
  const clampOffset = (v: number) => Math.max(0, Math.min(phy.current.max, v));

  /* 主循环：drag 直跟（pointermove 已直写）；wheel lerp；glide 动量衰减；cruise 匀速渐入。
     v5.1 全部速度按 60fps 标准帧折算（ds = 实际帧时长/16.67ms）：高刷屏 120Hz/ProMotion 与
     60Hz 巡航同速——帧率不再偷走时间的慢。 */
  useEffect(() => {
    let lastTick = performance.now();
    const tick = () => {
      const p = phy.current;
      p.raf = 0;
      const now = performance.now();
      const ds = Math.min(3, (now - lastTick) / 16.667); // 帧率无关步长（后台标签页回来不跳变）
      lastTick = now;
      if (p.mode === 'glide') {
        p.offset = clampOffset(p.offset + p.v * ds);
        p.v *= Math.pow(0.94, ds);
        if (Math.abs(p.v) < 0.25) p.mode = 'idle';
      } else if (p.mode === 'cruise') {
        // v5.1 缓速巡航：0.55px/标准帧 封顶（≈33px/s，一年约 4.5 秒），约 1.7 秒渐入——时间慢慢流转
        p.v = Math.min(0.55, p.v + 0.008 * ds);
        p.offset = clampOffset(p.offset + p.v * ds);
        if (p.offset >= p.max - 0.5) { p.mode = 'idle'; p.v = 0; setCruising(false); } // 抵达入海口
      } else if (p.mode !== 'drag' && Math.abs(p.target - p.offset) > 0.5) {
        p.offset += (p.target - p.offset) * (1 - Math.pow(0.78, ds));
      } else if (p.mode !== 'drag') {
        p.offset = p.target;
      }
      apply();
      const busy = p.mode === 'glide' || p.mode === 'cruise' || p.mode === 'drag'
        || Math.abs(p.target - p.offset) > 0.5;
      if (busy && !document.hidden) p.raf = requestAnimationFrame(tick);
    };
    const kick = () => {
      if (phy.current.raf) return;
      lastTick = performance.now();
      phy.current.raf = requestAnimationFrame(tick);
    };
    phy.current.kick = kick;
    kick();
    const onVis = () => { if (!document.hidden) kick(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelAnimationFrame(phy.current.raf);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  /* 尺寸测量（strip 总宽 / 可视宽 / 最大偏移） */
  useEffect(() => {
    const root = rootRef.current!;
    const measure = () => {
      const strip = stripRef.current;
      if (!strip) return;
      const p = phy.current;
      p.viewW = root.clientWidth || 1;
      p.max = Math.max(0, strip.scrollWidth - p.viewW);
      p.offset = clampOffset(p.offset); p.target = clampOffset(p.target);
      apply();
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    return () => ro.disconnect();
  }, [years.length]);

  /* pointermove 原生监听：高频路径直接写 offset，绕过 React 合成 */
  useEffect(() => {
    const el = rootRef.current!;
    const onMove = (e: PointerEvent) => {
      const p = phy.current;
      if (p.mode !== 'drag') return;
      const dx = p.downX - e.clientX; // 向左拖 → 向右航行
      p.offset = clampOffset(p.downOffset + dx);
      p.target = p.offset;
      const now = performance.now();
      const dt = Math.max(8, now - p.lastT);
      p.v = (p.offset - p.lastV) / dt;
      p.lastV = p.offset; p.lastT = now;
      if (Math.abs(dx) > 4) p.moved = true;
      apply();
    };
    el.addEventListener('pointermove', onMove, { passive: true });
    return () => el.removeEventListener('pointermove', onMove);
  }, []);

  useEffect(() => {
    const load = () => {
      api.timeline(1990, 2032).then(setEvents).catch(e => notify(apiErrorMessage(e), 'error'));
      api.yearDensity().then(setYears).catch(e => notify(apiErrorMessage(e), 'error'));
      api.entities(400).then((es: Entity[]) =>
        setNonFamily(es.filter(e => e.relation_group !== '家族亲属').map(e => e.display_name))
      ).catch(e => notify(apiErrorMessage(e), 'error'));
    };
    load();
    window.addEventListener('mneme:unlocked', load);
    return () => window.removeEventListener('mneme:unlocked', load);
  }, []);

  useEffect(() => {
    const root = rootRef.current!;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    animate(root.querySelectorAll('.rv-head > *'), {
      opacity: [0, 1], translateY: [18, 0], delay: stagger(120), duration: 700, ease: 'outExpo',
    });
    animate(root.querySelectorAll('.rv-card'), {
      opacity: [0, 1], translateY: [24, 0], scale: [0.97, 1],
      delay: stagger(30, { start: 300 }), duration: 620, ease: 'outExpo',
    });
  }, [events.length, nonFamily.length]);

  useEffect(() => () => cancelAnimationFrame(phy.current.raf), []);

  const yearList = useMemo(() => {
    const ys: number[] = [];
    for (let y = Y0; y <= Y1; y++) ys.push(y);
    return ys;
  }, []);
  const docsOf = (y: number) => years.find(v => v.year === y)?.docs ?? 0;
  const maxDocs = useMemo(() => Math.max(1, ...years.map(y => y.docs)), [years]);

  const byYear = useMemo(() => {
    const m = new Map<number, TimelineEvent[]>();
    for (const ev of events) {
      const list = m.get(ev.year) || [];
      list.push(ev);
      m.set(ev.year, list);
    }
    for (const [, list] of m) list.sort((a, b) => (a.month ?? 13) - (b.month ?? 13));
    return m;
  }, [events]);

  const sanitized = (ev: TimelineEvent) =>
    nonFamily.length ? sanitizeTitle(ev.title, nonFamily) : ev.title;

  /* 指针：按下打断巡航/滑行；300ms 内两次按下 = 双击起航 */
  const onDown = (e: React.PointerEvent) => {
    const p = phy.current;
    const now = performance.now();
    if (now - p.lastTap < 300 && !p.moved) {
      p.mode = 'cruise'; p.v = 0; setCruising(true); // 时间之船起航
      p.lastTap = 0;
      p.kick();
      return;
    }
    p.lastTap = now;
    if (p.mode === 'cruise' || p.mode === 'glide') { p.mode = 'idle'; p.v = 0; setCruising(false); }
    p.mode = 'drag';
    p.moved = false;
    p.downX = e.clientX; p.downOffset = p.offset; p.lastT = now; p.lastV = p.offset;
    p.kick();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onUp = () => {
    const p = phy.current;
    if (p.mode === 'drag') {
      p.mode = 'glide';
      p.v = Math.max(-2.4, Math.min(2.4, (p.v || 0) * 16)); // 动量投射
      p.kick();
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    const p = phy.current;
    if (p.mode === 'cruise' || p.mode === 'glide') { p.mode = 'idle'; p.v = 0; setCruising(false); }
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    p.target = clampOffset(p.target + d);
    p.kick();
  };
  const onKey = (e: React.KeyboardEvent) => {
    const p = phy.current;
    if (e.key === 'ArrowRight') { p.mode = 'glide'; p.v = 14; p.kick(); }
    if (e.key === 'ArrowLeft') { p.mode = 'glide'; p.v = -14; p.kick(); }
    if (e.key === ' ') { e.preventDefault(); p.mode = cruising ? 'idle' : 'cruise'; p.v = 0; setCruising(!cruising); p.kick(); }
  };

  /* ⌘K 时间线命中 / 检查器「同时间事件」→ 定位（两种视图各走各的定位方式） */
  useEffect(() => {
    if (!focus || events.length === 0) return;
    if (listView) {
      const sel = focus.eventId != null ? `.rv-litem[data-ev="${focus.eventId}"]` : `.rv-lrow[data-year="${focus.year}"]`;
      const el = listRef.current?.querySelector(sel) as HTMLElement | null;
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el?.classList.add('pulse');
      const t = setTimeout(() => { el?.classList.remove('pulse'); onFocusDone?.(); }, 2400);
      return () => clearTimeout(t);
    }
    const p = phy.current;
    p.mode = 'idle'; p.v = 0; setCruising(false);
    p.target = clampOffset((focus.year - Y0) * COL_W - p.viewW / 2 + COL_W / 2);
    p.kick();
    if (focus.eventId != null) {
      stripRef.current?.querySelector(`.rv-card[data-ev="${focus.eventId}"]`)?.classList.add('pulse');
      const t = setTimeout(() => {
        stripRef.current?.querySelector('.rv-card.pulse')?.classList.remove('pulse');
        onFocusDone?.();
      }, 2400);
      return () => clearTimeout(t);
    }
    onFocusDone?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, events.length, listView]);

  /* 入场定位：诞生年（2007）带到视口左 1/4 */
  useEffect(() => {
    if (!years.length) return;
    const p = phy.current;
    if (p.offset !== 0 || p.target !== 0) return;
    p.target = Math.max(0, (2007 - Y0) * COL_W - p.viewW * 0.25);
    p.offset = p.target;
    apply();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [years.length]);

  const stripW = yearList.length * COL_W + 240;
  const BASE = 176;

  return (
    <div className={`rv ${listView ? 'list' : ''}`} ref={rootRef} tabIndex={0}
      onKeyDown={listView ? undefined : onKey}
      onPointerDown={listView ? undefined : onDown}
      onPointerUp={listView ? undefined : onUp}
      onPointerLeave={listView ? undefined : onUp}
      onWheel={listView ? undefined : onWheel}
    >
      <header className="rv-head">
        <p className="greek rv-kicker">ΧΡΟΝΟΣ · Σ2</p>
        <h2>时间之河</h2>
        <p className="rv-hint">
          {listView ? (
            <>按年纵向陈列，点击可直达原文 · 卡片仅陈列家族口径</>
          ) : (
            <>
              拖拽（松手滑行）· 滚轮 · 方向键 · <b>双击河面，时间之船缓缓起航</b>
              {cruising ? <em className="rv-sailing"> · 缓速巡航中（单击停靠）</em> : null} · 卡片仅陈列家族口径
            </>
          )}
        </p>
        <button className="rv-view" onClick={() => setListView(v => !v)}>
          {listView ? '横向长河' : '纵向列表'}
        </button>
      </header>

      {listView ? (
        <div className="rv-list" ref={listRef}>
          {yearList.map(y => {
            const evs = byYear.get(y) ?? [];
            if (!evs.length) return null;
            return (
              <section key={y} className="rv-lrow" data-year={y}>
                <div className="rv-lyear">
                  <span className="rv-epoch" style={{ background: epochColor(y) }} />
                  <b>{y}</b>
                  <span className="rv-ldocs">{docsOf(y)} 份材料</span>
                </div>
                <div className="rv-litems">
                  {evs.map(ev => {
                    const refPath = ev.ref;
                    return (
                      <button key={ev.id} data-ev={ev.id}
                        className={`rv-litem ${ev.kind === 'anchor' ? 'anchor' : 'bg'}`}
                        style={{ ['--sc' as string]: STAGE_COLOR[ev.stage] || 'var(--bronze)' }}
                        title={ev.kind === 'anchor' ? sanitized(ev) : undefined}
                        onClick={() => { if (refPath) onOpenDoc(refPath); }}>
                        <span className="rv-lwhen">{ev.year}{ev.month ? `.${String(ev.month).padStart(2, '0')}` : ''}</span>
                        <span className="rv-ltitle">{sanitized(ev)}</span>
                        <span className="rv-lstage">{ev.stage}{refPath ? ' · 原文 →' : ''}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
          {events.length === 0 && <p className="rv-lempty">暂无时间线事件。</p>}
        </div>
      ) : (
      <div className="rv-flow">
        <div className="rv-strip" ref={stripRef} style={{ width: stripW }}>
          <svg className="rv-water-svg" width={stripW + 384} height={320} viewBox={`0 0 ${stripW + 384} 320`} aria-hidden>
            <defs>
              <linearGradient id="rvw" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="var(--aegean)" stopOpacity="0.14" />
                <stop offset="1" stopColor="var(--aegean)" stopOpacity="0.02" />
              </linearGradient>
            </defs>
            <g className="rv-wave rv-wave-back">
              <path d={`${wavePath(stripW + 384, 7, 0, 320 - BASE)} L${stripW + 384},320 L-192,320 Z`} fill="url(#rvw)" stroke="none" />
            </g>
            <g className="rv-wave rv-wave-front">
              <path d={wavePath(stripW + 384, 5, 24, 320 - BASE + 6)} fill="none" stroke="var(--aegean)" strokeOpacity="0.38" strokeWidth="1.4" />
              <path d={wavePath(stripW + 384, 3.4, 52, 320 - BASE - 5)} fill="none" stroke="var(--bronze)" strokeOpacity="0.22" strokeWidth="1" />
            </g>
          </svg>

          {/* 时间之船：漂在视口中心的河线上（巡航时的叙事主角） */}
          <div className={`rv-boat ${cruising ? 'sail' : ''}`} ref={boatRef} aria-hidden>
            <svg viewBox="0 0 48 32" width="34" height="23">
              <path d="M6 22 Q24 30 42 22 L36 27 Q24 31 12 27 Z" fill="var(--bronze)" opacity="0.9" />
              <path d="M24 20 V4 L36 18 Z" fill="var(--aegean)" opacity="0.75" />
              <path d="M23 20 V7 L14 18 Z" fill="var(--aegean-soft)" opacity="0.6" />
            </svg>
          </div>

          <div className="rv-cols">
            {yearList.map(y => {
              const evs = byYear.get(y) ?? [];
              return (
                <div key={y} className="rv-col" data-year={y}>
                  <div className="rv-colmeta">
                    <span className="rv-epoch" style={{ background: epochColor(y) }} />
                    <span className="rv-ylab">{y}</span>
                  </div>
                  <div className={`rv-stack ${evs.length >= 5 ? 'dense' : ''}`}>
                    {evs.map((ev, i) => {
                      const anchor = ev.kind === 'anchor';
                      const phase = ev.month ? ((ev.month - 1) / 12 - 0.5) * 56 : 0;
                      // v5.1 扇形错位：左右交替、逐层外移（±16→±29→±42…）——密集年份互不遮挡
                      const side = (i % 2 === 0 ? -1 : 1) * (16 + 13 * Math.floor(i / 2));
                      const refPath = ev.ref;
                      return (
                        <button
                          key={ev.id}
                          data-ev={ev.id}
                          className={`rv-card ${anchor ? 'anchor' : 'bg'}`}
                          style={{ ['--sc' as string]: STAGE_COLOR[ev.stage] || 'var(--bronze)', ['--ph' as string]: `${phase}px`, ['--side' as string]: `${side}px` }}
                          title={anchor ? sanitized(ev) : undefined}
                          onPointerDown={e => e.stopPropagation()} // 卡片内按下不触发拖拽，点击直达原文
                          onClick={e => { if (refPath) { e.stopPropagation(); onOpenDoc(refPath); } }}
                        >
                          <span className="rv-pin" />
                          {anchor ? (
                            <span className="rv-body glass">
                              <span className="rv-when">{ev.year}{ev.month ? `·${String(ev.month).padStart(2, '0')}` : ''}</span>
                              <b className="rv-title">{sanitized(ev)}</b>
                              <span className="rv-stage">{ev.stage}{refPath ? ' · 原文 →' : ''}</span>
                            </span>
                          ) : (
                            <span className="rv-ribbon">
                              <span className="rv-when">{ev.year}</span>
                              <span className="rv-title">{sanitized(ev)}</span>
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  <div className="rv-bed" aria-hidden>
                    <div className="rv-bar" style={{ height: `${8 + (docsOf(y) / maxDocs) * 96}px` }} />
                  </div>
                  <span className="rv-bday" aria-hidden title="诞辰 · 11-05" />
                </div>
              );
            })}
          </div>
        </div>
      </div>
      )}
    </div>
  );
}
