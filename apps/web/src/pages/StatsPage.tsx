import { useState } from 'react';
import {
  computePeriodStats,
  formatDurationLarge,
  formatDurationMs,
  getPaletteEntry,
  toShanghaiDateStr,
  type PeriodType,
  type StatsDimension,
} from '@timebook/core';
import { buildTagLookup } from '../lib/labels.js';
import { useAppStore } from '../store/useAppStore.js';

const PERIODS: Array<{ key: PeriodType; label: string }> = [
  { key: 'day', label: '日' },
  { key: 'week', label: '周' },
  { key: 'month', label: '月' },
  { key: 'year', label: '年' },
];

const DIMS: Array<{ key: StatsDimension; label: string }> = [
  { key: 'mod', label: '模块' },
  { key: 'tag', label: '具体事项' },
];

export function StatsPage() {
  const modules = useAppStore((s) => s.modules);
  const tags = useAppStore((s) => s.tags);
  const sessions = useAppStore((s) => s.sessions);
  const nowMs = useAppStore((s) => s.nowMs);

  const [period, setPeriod] = useState<PeriodType>('week');
  const [offset, setOffset] = useState(0);
  const [dim, setDim] = useState<StatsDimension>('mod');

  const todayStr = toShanghaiDateStr(nowMs());
  const lookup = buildTagLookup(modules, tags);
  const stats = computePeriodStats(sessions, tags, modules, period, todayStr, todayStr, dim, offset);

  const deltaText = !stats.hasPrevData
    ? `比${stats.prevPeriodLabel}：无记录`
    : `比${stats.prevPeriodLabel} ${stats.diffMs >= 0 ? '多' : '少'} ${formatDurationMs(Math.abs(stats.diffMs))}`;

  // 手写 SVG 环形图弧段
  const radius = 80;
  const circumference = 2 * Math.PI * radius;
  let accLen = 0;
  const arcs = stats.items.map((item) => {
    const segLen = stats.totalMs > 0 ? (item.durationMs / stats.totalMs) * circumference : 0;
    const arc = {
      id: item.id,
      color: item.color,
      dash: `${Math.max(segLen - 2, 0).toFixed(2)} ${circumference.toFixed(2)}`,
      offset: (-accLen).toFixed(2),
    };
    accLen += segLen;
    return arc;
  });

  const barGap = stats.buckets.length > 20 ? 3 : 8;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
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
            统计
          </h1>
          <div style={{ marginTop: 6, fontSize: 14, fontWeight: 600, color: '#6B7280' }}>
            自然日 / 自然周（周一开始）/ 自然月 / 年，仅统计已结束记录
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
          <div className="card seg" role="tablist" aria-label="统计周期">
            {PERIODS.map((p) => {
              const on = period === p.key;
              return (
                <button
                  key={p.key}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => {
                    setPeriod(p.key);
                    setOffset(0);
                  }}
                  className="btn"
                  style={{
                    height: 38,
                    padding: '0 18px',
                    borderRadius: 10,
                    fontSize: 14,
                    background: on ? '#111827' : 'transparent',
                    color: on ? '#FFFFFF' : '#4B5263',
                  }}
                >
                  {p.label}
                </button>
              );
            })}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              onClick={() => setOffset((o) => o - 1)}
              className="btn ghost icon"
              aria-label="上一个周期"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M15 5l-7 7 7 7" />
              </svg>
            </button>
            <div className="tnum" style={{ minWidth: 132, textAlign: 'center', fontSize: 16, fontWeight: 800 }}>
              {stats.rangeLabel}
            </div>
            <button
              type="button"
              disabled={offset >= 0}
              onClick={() => offset < 0 && setOffset((o) => o + 1)}
              className="btn ghost icon"
              aria-label="下一个周期"
              style={{ opacity: offset >= 0 ? 0.35 : 1 }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>
      </section>

      {/* 四张核心指标卡 */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 14,
        }}
      >
        <div className="card lift" style={{ padding: '18px 20px' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#6B7280' }}>总时长</div>
          <div className="tnum" style={{ marginTop: 6, fontSize: 28, fontWeight: 800 }}>
            {formatDurationLarge(stats.totalMs)}
          </div>
          <div style={{ marginTop: 4, fontSize: 13, fontWeight: 600, color: '#6B7280' }}>{deltaText}</div>
        </div>

        <div className="card lift" style={{ padding: '18px 20px' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#6B7280' }}>日均</div>
          <div className="tnum" style={{ marginTop: 6, fontSize: 28, fontWeight: 800 }}>
            {formatDurationMs(stats.dailyAvgMs)}
          </div>
          <div style={{ marginTop: 4, fontSize: 13, fontWeight: 600, color: '#6B7280' }}>
            按 {stats.dayCount} 天算
          </div>
        </div>

        <div className="card lift" style={{ padding: '18px 20px' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#6B7280' }}>花得最多</div>
          <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8, fontSize: 28, fontWeight: 800 }}>
            <span
              style={{
                width: 12,
                height: 12,
                borderRadius: 4,
                background: stats.topItem ? stats.topItem.color : '#E1E4EC',
              }}
            />
            <span>{stats.topItem ? stats.topItem.name : '—'}</span>
          </div>
          <div style={{ marginTop: 4, fontSize: 13, fontWeight: 600, color: '#6B7280' }}>
            {stats.topItem
              ? `占 ${stats.topItem.pct}%，${formatDurationLarge(stats.topItem.durationMs)}`
              : '这个周期还没有记录'}
          </div>
        </div>

        <div className="card lift" style={{ padding: '18px 20px' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#6B7280' }}>专注次数</div>
          <div className="tnum" style={{ marginTop: 6, fontSize: 28, fontWeight: 800 }}>
            {stats.focusCount} 次
          </div>
          <div style={{ marginTop: 4, fontSize: 13, fontWeight: 600, color: '#6B7280' }}>
            平均每次 {stats.focusCount > 0 ? formatDurationMs(stats.avgPerSessionMs) : '—'}
          </div>
        </div>
      </div>

      {/* 环形图 + 趋势柱状图 */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' }}>
        <div
          className="card"
          style={{
            flex: '1 1 440px',
            minWidth: 0,
            padding: 22,
            display: 'flex',
            flexDirection: 'column',
            gap: 18,
          }}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>时间花在哪</h2>
            <div className="seg" style={{ background: '#F2F3F7' }} role="tablist" aria-label="统计维度">
              {DIMS.map((d) => {
                const on = dim === d.key;
                return (
                  <button
                    key={d.key}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    onClick={() => setDim(d.key)}
                    className="btn"
                    style={{
                      height: 32,
                      padding: '0 14px',
                      borderRadius: 9,
                      fontSize: 13,
                      background: on ? '#FFFFFF' : 'transparent',
                      color: on ? '#111827' : '#6B7280',
                      boxShadow: on ? '0 1px 3px rgba(17,24,39,.12)' : 'none',
                    }}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 24 }}>
            <div style={{ position: 'relative', width: 200, height: 200, flex: 'none' }}>
              <svg width="200" height="200" viewBox="0 0 200 200" aria-hidden="true" style={{ transform: 'rotate(-90deg)' }}>
                <circle cx="100" cy="100" r="80" fill="none" stroke="#F0F1F5" strokeWidth="26" />
                {arcs.map((a) => (
                  <circle
                    key={a.id}
                    cx="100"
                    cy="100"
                    r="80"
                    fill="none"
                    stroke={a.color}
                    strokeWidth="26"
                    strokeDasharray={a.dash}
                    strokeDashoffset={a.offset}
                  />
                ))}
              </svg>
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 700, color: '#6B7280' }}>合计</div>
                <div className="tnum" style={{ fontSize: 20, fontWeight: 800 }}>
                  {stats.totalMs >= 3600_000 * 10
                    ? `${Math.round(stats.totalMs / 3600_000)} h`
                    : formatDurationMs(stats.totalMs)}
                </div>
              </div>
            </div>

            <div style={{ flex: '1 1 220px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
              {stats.items.length === 0 ? (
                <div style={{ fontSize: 14, fontWeight: 600, color: '#6B7280', padding: 12 }}>
                  这个周期还没有记录
                </div>
              ) : (
                stats.items.map((item) => (
                  <div
                    key={item.id}
                    className="lrow"
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '12px minmax(0,1fr) 92px 40px',
                      alignItems: 'center',
                      gap: 10,
                      padding: '8px 10px',
                    }}
                  >
                    <span style={{ width: 10, height: 10, borderRadius: 3, background: item.color }} />
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          fontSize: 14,
                          fontWeight: 700,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        <span>{item.name}</span>
                        {item.subLabel && (
                          <span style={{ fontSize: 11, fontWeight: 700, color: item.subInk }}>
                            {item.subLabel}
                          </span>
                        )}
                      </div>
                      <div style={{ marginTop: 5, height: 5, borderRadius: 999, background: '#F0F1F5', overflow: 'hidden' }}>
                        <div
                          style={{
                            width: `${item.pct}%`,
                            height: '100%',
                            background: item.color,
                            borderRadius: 999,
                          }}
                        />
                      </div>
                    </div>
                    <div className="tnum" style={{ fontSize: 13, fontWeight: 800, whiteSpace: 'nowrap', textAlign: 'right' }}>
                      {formatDurationLarge(item.durationMs)}
                    </div>
                    <div className="tnum" style={{ fontSize: 13, fontWeight: 700, color: '#6B7280', textAlign: 'right' }}>
                      {item.pct}%
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* 堆叠柱状趋势图 */}
        <div
          className="card"
          style={{
            flex: '1.2 1 460px',
            minWidth: 0,
            padding: 22,
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>{stats.trendTitle}</h2>
            <div className="tnum" style={{ fontSize: 12, fontWeight: 700, color: '#9CA3AF' }}>
              最高 {formatDurationMs(stats.trendMaxMs)}
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'flex-end',
              gap: barGap,
              height: 220,
              paddingTop: 8,
              borderBottom: '1px solid #EEF0F5',
            }}
          >
            {stats.buckets.map((b, idx) => (
              <div
                key={`${b.title}-${idx}`}
                className="bar"
                title={`${b.title}：${b.totalMs > 0 ? formatDurationMs(b.totalMs) : '无记录'}`}
                style={{
                  flex: 1,
                  minWidth: 0,
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column-reverse',
                  gap: 2,
                }}
              >
                {b.parts.map((p) => (
                  <div
                    key={p.moduleId}
                    style={{
                      height: `${((p.durationMs / stats.trendMaxMs) * 100).toFixed(2)}%`,
                      background: p.color,
                      borderRadius: 3,
                      minHeight: 2,
                    }}
                  />
                ))}
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: barGap }}>
            {stats.buckets.map((b, idx) => (
              <div
                key={`lbl-${idx}`}
                className="tnum"
                style={{
                  flex: 1,
                  minWidth: 0,
                  textAlign: 'center',
                  fontSize: 11,
                  fontWeight: 700,
                  color: b.isToday ? '#111827' : '#9CA3AF',
                  whiteSpace: 'nowrap',
                }}
              >
                {b.label}
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, paddingTop: 4 }}>
            {lookup.activeModules.map((m) => (
              <span
                key={m.id}
                style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: '#4B5263' }}
              >
                <span
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: 3,
                    background: getPaletteEntry(m.color_key).color,
                  }}
                />
                {m.name}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
