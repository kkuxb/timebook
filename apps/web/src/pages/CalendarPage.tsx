import { useEffect, useRef, useState, type MouseEvent } from 'react';
import {
  addDays,
  formatDurationMs,
  formatMonthDay,
  getMinutesInShanghaiDay,
  getPaletteEntry,
  getWeekdayLabel,
  getWeekStart,
  minutesToHm,
  splitSessionByDay,
  toShanghaiDateStr,
  type SessionEntity,
} from '@timebook/core';
import {
  buildEditorFromSession,
  SessionEditorModal,
  type SessionEditorInitial,
} from '../components/SessionEditorModal.js';
import { buildTagLookup, formatSessionDisplayTitle, getTagStyle } from '../lib/labels.js';
import { useAppStore } from '../store/useAppStore.js';

const H0 = 6 * 60;
const H1 = 24 * 60;
const PX_PER_HOUR = 44;
const GRID_HEIGHT = ((H1 - H0) / 60) * PX_PER_HOUR;

function yFromMin(m: number): number {
  return ((Math.max(H0, Math.min(H1, m)) - H0) / 60) * PX_PER_HOUR;
}

function snapMinutes(py: number): number {
  const raw = H0 + Math.round(((py / PX_PER_HOUR) * 60) / 15) * 15;
  return Math.max(H0, Math.min(H1, raw));
}

interface CalSegmentItem {
  session: SessionEntity;
  startMin: number;
  endMin: number;
  durationMs: number;
}

interface EarlyPopupState {
  date: string;
  items: CalSegmentItem[];
}

export function CalendarPage() {
  const modules = useAppStore((s) => s.modules);
  const tags = useAppStore((s) => s.tags);
  const sessions = useAppStore((s) => s.sessions);
  const nowMs = useAppStore((s) => s.nowMs);

  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 767px)').matches : false,
  );
  const [mobileDaysMode, setMobileDaysMode] = useState<3 | 1>(3);
  const [anchorStart, setAnchorStart] = useState(() => {
    const t = toShanghaiDateStr(nowMs());
    const mobileInit =
      typeof window !== 'undefined' ? window.matchMedia('(max-width: 767px)').matches : false;
    return mobileInit ? addDays(t, -2) : getWeekStart(t);
  });
  const [drag, setDrag] = useState<{ date: string; a: number; b: number } | null>(null);
  const [editor, setEditor] = useState<SessionEditorInitial | null>(null);
  const [earlyPopup, setEarlyPopup] = useState<EarlyPopupState | null>(null);
  const [nowTick, setNowTick] = useState(() => nowMs());
  const dragColRectRef = useRef<DOMRect | null>(null);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const onChange = () => {
      const mobile = mq.matches;
      setIsMobile(mobile);
      const t = toShanghaiDateStr(nowMs());
      setAnchorStart(mobile ? addDays(t, -(mobileDaysMode - 1)) : getWeekStart(t));
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [mobileDaysMode, nowMs]);

  useEffect(() => {
    const iv = setInterval(() => setNowTick(nowMs()), 30000);
    return () => clearInterval(iv);
  }, [nowMs]);

  const todayStr = toShanghaiDateStr(nowTick);
  const nowMin = getMinutesInShanghaiDay(nowTick);
  const lookup = buildTagLookup(modules, tags);

  const numCols = isMobile ? mobileDaysMode : 7;
  const currentWeekStart = getWeekStart(todayStr);

  // 当切到手机 3 天或 1 天模式时确保锚点合理
  const visibleStart = isMobile
    ? anchorStart > todayStr
      ? addDays(todayStr, -(numCols - 1))
      : anchorStart
    : anchorStart;

  const visibleDates = Array.from({ length: numCols }, (_, i) => addDays(visibleStart, i));
  const rangeEnd = visibleDates[visibleDates.length - 1];

  // 按天汇总所有已结束记录的切分片段（严禁包含进行中计时）
  const segsByDate = new Map<string, CalSegmentItem[]>();
  for (const d of visibleDates) segsByDate.set(d, []);

  for (const s of sessions) {
    if (s.deleted_at !== null || s.end_at === null) continue;
    const segs = splitSessionByDay(s);
    for (const seg of segs) {
      const arr = segsByDate.get(seg.date);
      if (arr) {
        arr.push({
          session: s,
          startMin: seg.startMin,
          endMin: seg.endMin,
          durationMs: seg.durationMs,
        });
      }
    }
  }

  let periodTotalMs = 0;
  const days = visibleDates.map((date) => {
    const allSegs = segsByDate.get(date) ?? [];
    const dayTotalMs = allSegs.reduce((acc, x) => acc + x.durationMs, 0);
    periodTotalMs += dayTotalMs;

    const earlyItems = allSegs
      .filter((x) => x.startMin < H0)
      .sort((a, b) => a.startMin - b.startMin);

    const gridItems = allSegs
      .filter((x) => x.endMin > H0)
      .map((x) => ({
        ...x,
        s: Math.max(H0, x.startMin),
        e2: Math.min(H1, x.endMin),
        lane: 0,
        lanes: 1,
      }))
      .sort((a, b) => a.s - b.s || b.e2 - a.e2);

    // 重叠分列算法
    const positioned: typeof gridItems = [];
    let cluster: typeof gridItems = [];
    let clusterEnd = -1;
    const flushCluster = () => {
      const lanesEnd: number[] = [];
      for (const item of cluster) {
        let lane = lanesEnd.findIndex((endT) => endT <= item.s);
        if (lane < 0) {
          lane = lanesEnd.length;
          lanesEnd.push(0);
        }
        lanesEnd[lane] = item.e2;
        item.lane = lane;
      }
      for (const item of cluster) {
        item.lanes = lanesEnd.length;
        positioned.push(item);
      }
      cluster = [];
    };

    for (const item of gridItems) {
      if (item.s >= clusterEnd && cluster.length > 0) {
        flushCluster();
      }
      cluster.push(item);
      clusterEnd = Math.max(clusterEnd, item.e2);
    }
    if (cluster.length > 0) flushCluster();

    const isToday = date === todayStr;
    const isFuture = date > todayStr;
    const dmin = drag && drag.date === date ? Math.min(drag.a, drag.b) : 0;
    const dmax = drag && drag.date === date ? Math.max(drag.a, drag.b) : 0;

    return {
      date,
      wk: getWeekdayLabel(date),
      md: formatMonthDay(date),
      isToday,
      isFuture,
      dayTotalMs,
      earlyItems,
      positioned,
      dmin,
      dmax,
    };
  });

  const endDrag = () => {
    if (!drag) return;
    const a = Math.min(drag.a, drag.b);
    let b = Math.max(drag.a, drag.b);
    if (b - a < 15) b = a + 60;
    const targetDate = drag.date;
    dragColRectRef.current = null;
    setDrag(null);
    setEditor({
      mode: 'new',
      date: targetDate,
      startHm: minutesToHm(a),
      endHm: minutesToHm(Math.min(b, 1439)),
      tagId: null,
      title: '',
    });
  };

  const canGoNext = isMobile ? rangeEnd < todayStr : visibleStart < currentWeekStart;

  const hours = Array.from({ length: 17 }, (_, i) => {
    const h = i + 7;
    return {
      h,
      top: ((h * 60 - H0) / 60) * PX_PER_HOUR,
      label: `${h < 10 ? '0' : ''}${h}:00`,
    };
  });

  return (
    <div
      onMouseUp={endDrag}
      onMouseLeave={endDrag}
      style={{ display: 'flex', flexDirection: 'column', gap: 20 }}
    >
      <section
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: 16,
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 34, lineHeight: 1.15, fontWeight: 800, letterSpacing: '-0.02em' }}>
            日历
          </h1>
          <div style={{ marginTop: 6, fontSize: 14, fontWeight: 600, color: '#6B7280' }}>
            {isMobile
              ? '仅显示已结束记录 · 点击色块可编辑，点「补记录」新增'
              : '仅显示已结束记录 · 在空白处按住往下拖可补记录；点色块可以修改'}
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 14 }}>
          {!isMobile && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              {lookup.activeModules.map((m) => (
                <span
                  key={m.id}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, color: '#4B5263' }}
                >
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 3,
                      background: getPaletteEntry(m.color_key).color,
                    }}
                  />
                  {m.name}
                </span>
              ))}
            </div>
          )}

          {isMobile && (
            <div className="seg" style={{ background: '#EEF0F5', padding: 3, borderRadius: 11 }}>
              {([3, 1] as const).map((cnt) => (
                <button
                  key={cnt}
                  type="button"
                  onClick={() => {
                    setMobileDaysMode(cnt);
                    setAnchorStart(addDays(todayStr, -(cnt - 1)));
                  }}
                  className="btn"
                  style={{
                    height: 30,
                    padding: '0 10px',
                    borderRadius: 8,
                    fontSize: 12,
                    background: mobileDaysMode === cnt ? '#FFFFFF' : 'transparent',
                    color: mobileDaysMode === cnt ? '#111827' : '#6B7280',
                  }}
                >
                  {cnt === 3 ? '3 天' : '单日'}
                </button>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              onClick={() => setAnchorStart(addDays(visibleStart, isMobile ? -numCols : -7))}
              className="btn ghost icon"
              aria-label="上一周期"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M15 5l-7 7 7 7" />
              </svg>
            </button>
            <div style={{ minWidth: 112, textAlign: 'center' }}>
              <div className="tnum" style={{ fontSize: 15, fontWeight: 800 }}>
                {numCols === 1 ? formatMonthDay(visibleStart) : `${formatMonthDay(visibleStart)} – ${formatMonthDay(rangeEnd)}`}
              </div>
              <div className="tnum" style={{ fontSize: 12, fontWeight: 600, color: '#6B7280' }}>
                合计 {formatDurationMs(periodTotalMs)}
              </div>
            </div>
            <button
              type="button"
              disabled={!canGoNext}
              onClick={() => canGoNext && setAnchorStart(addDays(visibleStart, isMobile ? numCols : 7))}
              className="btn ghost icon"
              aria-label="下一周期"
              style={{ opacity: canGoNext ? 1 : 0.35 }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 5l7 7-7 7" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() =>
                setAnchorStart(isMobile ? addDays(todayStr, -(numCols - 1)) : currentWeekStart)
              }
              className="btn soft"
              style={{ height: 40, padding: '0 14px', borderRadius: 12, fontSize: 14 }}
            >
              {isMobile ? '今天' : '本周'}
            </button>
            {isMobile && (
              <button
                type="button"
                onClick={() =>
                  setEditor({
                    mode: 'new',
                    date: todayStr,
                    startHm: '10:00',
                    endHm: '11:00',
                    tagId: null,
                    title: '',
                  })
                }
                className="btn primary"
                style={{ height: 40, padding: '0 14px', borderRadius: 12, fontSize: 13 }}
              >
                + 补记录
              </button>
            )}
          </div>
        </div>
      </section>

      <div className="card" style={{ overflow: 'hidden' }}>
        {/* 日期表头 */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `56px repeat(${numCols}, minmax(0, 1fr))`,
            borderBottom: '1px solid #EEF0F5',
          }}
        >
          <div />
          {days.map((d) => (
            <div
              key={d.date}
              data-cal-col={d.date}
              style={{
                padding: '10px 4px 8px',
                textAlign: 'center',
                borderLeft: '1px solid #EEF0F5',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 700, color: '#6B7280' }}>{d.wk}</div>
              <div
                className="tnum"
                style={{
                  display: 'inline-block',
                  padding: '2px 10px',
                  borderRadius: 10,
                  fontSize: 16,
                  fontWeight: 800,
                  background: d.isToday ? '#FFD43B' : 'transparent',
                }}
              >
                {d.md}
              </div>
              <div className="tnum" style={{ fontSize: 12, fontWeight: 700, color: '#4B5263' }}>
                {d.dayTotalMs > 0 ? formatDurationMs(d.dayTotalMs) : '—'}
              </div>
              {d.earlyItems.length > 0 && (
                <button
                  type="button"
                  onClick={() => setEarlyPopup({ date: d.date, items: d.earlyItems })}
                  className="btn"
                  style={{
                    height: 22,
                    padding: '0 8px',
                    borderRadius: 999,
                    fontSize: 11,
                    fontWeight: 700,
                    background: '#FFF7F1',
                    color: '#9A3A0A',
                    boxShadow: 'inset 0 0 0 1px #FFB38A',
                  }}
                >
                  06:00 前 · {d.earlyItems.length} 条
                </button>
              )}
            </div>
          ))}
        </div>

        {/* 主时间网格 06:00-24:00 */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `56px repeat(${numCols}, minmax(0, 1fr))`,
          }}
        >
          <div style={{ position: 'relative', height: GRID_HEIGHT }}>
            {hours.map((h) => (
              <div
                key={h.h}
                className="tnum"
                style={{
                  position: 'absolute',
                  right: 10,
                  top: h.top,
                  transform: 'translateY(-50%)',
                  fontSize: 11,
                  fontWeight: 700,
                  color: '#9CA3AF',
                }}
              >
                {h.label}
              </div>
            ))}
          </div>

          {days.map((d) => {
            const handleMouseDown = (e: MouseEvent<HTMLDivElement>) => {
              if (isMobile || d.isFuture) return;
              if ((e.target as HTMLElement)?.closest('[data-block="1"]')) return;
              e.preventDefault();
              const rect = e.currentTarget.getBoundingClientRect();
              dragColRectRef.current = rect;
              const m = snapMinutes(e.clientY - rect.top);
              setDrag({ date: d.date, a: m, b: Math.min(H1, m + 15) });
            };

            const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
              if (!drag || drag.date !== d.date || !dragColRectRef.current) return;
              const m = snapMinutes(e.clientY - dragColRectRef.current.top);
              if (m !== drag.b) {
                setDrag({ ...drag, b: m });
              }
            };

            return (
              <div
                key={d.date}
                className="col"
                data-cal-grid-date={d.date}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                style={{
                  position: 'relative',
                  height: GRID_HEIGHT,
                  borderLeft: '1px solid #EEF0F5',
                  backgroundColor: d.isToday ? '#FFFDF2' : d.isFuture ? '#FAFAFC' : '#FFFFFF',
                  backgroundImage: `repeating-linear-gradient(to bottom,#EEF0F5 0 1px,transparent 1px ${PX_PER_HOUR}px)`,
                  cursor: d.isFuture ? 'not-allowed' : isMobile ? 'default' : 'crosshair',
                }}
              >
                {d.positioned.map((item, idx) => {
                  const st = getTagStyle(item.session.tag_id, lookup);
                  const h = yFromMin(item.e2) - yFromMin(item.s);
                  const label = formatSessionDisplayTitle(item.session, lookup);
                  const rangeStr = `${minutesToHm(item.startMin)}–${
                    item.endMin >= 1440 ? '24:00' : minutesToHm(item.endMin)
                  }`;
                  return (
                    <button
                      key={`${item.session.id}-${idx}`}
                      type="button"
                      data-block="1"
                      onClick={() => setEditor(buildEditorFromSession(item.session))}
                      className="blk"
                      aria-label={`${label} ${rangeStr}，点击编辑`}
                      title={`${label} ${rangeStr}`}
                      style={{
                        position: 'absolute',
                        top: yFromMin(item.s) + 1,
                        height: Math.max(h - 2, 18),
                        left: `calc(${((item.lane / item.lanes) * 100).toFixed(2)}% + 3px)`,
                        width: `calc(${(100 / item.lanes).toFixed(2)}% - 6px)`,
                        background: st.tint,
                        border: 0,
                        borderLeft: `3px solid ${st.color}`,
                        borderRadius: 8,
                        color: st.ink,
                        textAlign: 'left',
                        padding: h < 24 ? '0 6px' : '3px 6px',
                        zIndex: 1,
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: h < 24 ? 'center' : 'flex-start',
                        alignItems: 'stretch',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 800,
                          lineHeight: '16px',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {label}
                      </div>
                      {h >= 34 && (
                        <div className="tnum" style={{ fontSize: 11, fontWeight: 600, lineHeight: 1.3, whiteSpace: 'nowrap' }}>
                          {rangeStr}
                        </div>
                      )}
                    </button>
                  );
                })}

                {/* 今日当前时刻指示线 */}
                {d.isToday && nowMin >= H0 && nowMin <= H1 && (
                  <div
                    style={{
                      position: 'absolute',
                      left: 0,
                      right: 0,
                      top: yFromMin(nowMin),
                      height: 2,
                      background: '#111827',
                      zIndex: 2,
                      pointerEvents: 'none',
                    }}
                  >
                    <span
                      style={{
                        position: 'absolute',
                        left: -5,
                        top: -4,
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        background: '#111827',
                      }}
                    />
                  </div>
                )}

                {/* 拖拽补录预览框 */}
                {drag && drag.date === d.date && (
                  <div
                    className="tnum"
                    style={{
                      position: 'absolute',
                      left: 3,
                      right: 3,
                      top: yFromMin(d.dmin),
                      height: Math.max(yFromMin(d.dmax) - yFromMin(d.dmin), 18),
                      border: '1.5px dashed #F2711C',
                      background: 'rgba(255, 239, 227, 0.92)',
                      borderRadius: 8,
                      zIndex: 4,
                      pointerEvents: 'none',
                      padding: '4px 6px',
                      fontSize: 12,
                      fontWeight: 800,
                      color: '#9A3A0A',
                    }}
                  >
                    {minutesToHm(d.dmin)} – {minutesToHm(Math.max(d.dmax, d.dmin + 15))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 06:00 前记录列表弹窗 */}
      {earlyPopup && (
        <div className="modal-backdrop" onClick={() => setEarlyPopup(null)}>
          <div
            role="dialog"
            aria-label="06:00 前记录"
            className="card modal-panel"
            style={{ maxWidth: 440, display: 'flex', flexDirection: 'column', gap: 14 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>
                {formatMonthDay(earlyPopup.date)} 06:00 前的记录
              </h2>
              <button
                type="button"
                onClick={() => setEarlyPopup(null)}
                className="btn ghost icon"
                aria-label="关闭"
              >
                ✕
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {earlyPopup.items.map((item, idx) => {
                const st = getTagStyle(item.session.tag_id, lookup);
                return (
                  <button
                    key={`${item.session.id}-${idx}`}
                    type="button"
                    className="row"
                    onClick={() => {
                      setEarlyPopup(null);
                      setEditor(buildEditorFromSession(item.session));
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '10px 12px',
                      textAlign: 'left',
                    }}
                  >
                    <span style={{ width: 10, height: 10, borderRadius: 3, background: st.color }} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 14, fontWeight: 700 }}>
                        {formatSessionDisplayTitle(item.session, lookup)}
                      </span>
                      <span className="tnum" style={{ display: 'block', fontSize: 12, color: '#6B7280' }}>
                        {minutesToHm(item.startMin)} – {minutesToHm(item.endMin)}
                      </span>
                    </span>
                    <span className="tnum" style={{ fontSize: 14, fontWeight: 800 }}>
                      {formatDurationMs(item.durationMs)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <SessionEditorModal
        initial={editor}
        onClose={() => setEditor(null)}
        onSaved={(d) => {
          setAnchorStart(isMobile ? d : getWeekStart(d));
        }}
      />
    </div>
  );
}
