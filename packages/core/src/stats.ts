import { getPaletteEntry, mixWithWhite, UNCLASSIFIED_STYLE } from './palette.js';
import {
  addDays,
  diffDays,
  formatMonthDay,
  getDaysInMonth,
  getPeriodRange,
  getWeekdayLabel,
  splitSessionByDay,
} from './time.js';
import type {
  ModuleEntity,
  PeriodType,
  SessionEntity,
  StatsDimension,
  TagEntity,
} from './types.js';

export interface TodayModuleOverviewItem {
  moduleId: string;
  name: string;
  colorKey: string;
  color: string;
  durationMs: number;
}

export interface TodayOverviewResult {
  modules: TodayModuleOverviewItem[];
  unclassifiedMs: number;
  totalMs: number;
}

export function computeTodayModuleOverview(
  sessions: SessionEntity[],
  tags: TagEntity[],
  modules: ModuleEntity[],
  todayStr: string,
  nowMs: number,
): TodayOverviewResult {
  const activeModules = modules
    .filter((m) => m.deleted_at === null)
    .sort((a, b) => a.sort - b.sort || a.created_at - b.created_at);
  const activeTagsMap = new Map<string, TagEntity>();
  for (const t of tags) {
    if (t.deleted_at === null) {
      activeTagsMap.set(t.id, t);
    }
  }

  const moduleTotals = new Map<string, number>();
  for (const m of activeModules) {
    moduleTotals.set(m.id, 0);
  }
  let unclassifiedMs = 0;
  let totalMs = 0;

  for (const s of sessions) {
    if (s.deleted_at !== null) continue;
    const segs = splitSessionByDay(s, nowMs);
    for (const seg of segs) {
      if (seg.date !== todayStr) continue;
      totalMs += seg.durationMs;
      const tag = s.tag_id ? activeTagsMap.get(s.tag_id) : undefined;
      if (tag && moduleTotals.has(tag.module_id)) {
        moduleTotals.set(tag.module_id, (moduleTotals.get(tag.module_id) ?? 0) + seg.durationMs);
      } else {
        unclassifiedMs += seg.durationMs;
      }
    }
  }

  return {
    modules: activeModules.map((m) => ({
      moduleId: m.id,
      name: m.name,
      colorKey: m.color_key,
      color: getPaletteEntry(m.color_key).color,
      durationMs: moduleTotals.get(m.id) ?? 0,
    })),
    unclassifiedMs,
    totalMs,
  };
}

export interface BreakdownItem {
  id: string;
  name: string;
  subLabel: string;
  subInk: string;
  color: string;
  durationMs: number;
  pct: number;
}

export interface TrendBucketPart {
  moduleId: string;
  name: string;
  color: string;
  durationMs: number;
}

export interface TrendBucket {
  label: string;
  title: string;
  date?: string;
  isToday?: boolean;
  totalMs: number;
  parts: TrendBucketPart[];
}

export interface PeriodStatsResult {
  period: PeriodType;
  rangeLabel: string;
  prevPeriodLabel: string;
  startDate: string;
  endDate: string;
  totalMs: number;
  prevTotalMs: number;
  diffMs: number;
  hasPrevData: boolean;
  dayCount: number;
  dailyAvgMs: number;
  focusCount: number;
  avgPerSessionMs: number;
  topItem: BreakdownItem | null;
  items: BreakdownItem[];
  trendTitle: string;
  trendMaxMs: number;
  buckets: TrendBucket[];
}

const PREV_PERIOD_LABEL: Record<PeriodType, string> = {
  day: '前一天',
  week: '上周',
  month: '上月',
  year: '去年',
};

export function computePeriodStats(
  sessions: SessionEntity[],
  tags: TagEntity[],
  modules: ModuleEntity[],
  period: PeriodType,
  anchorDateStr: string,
  todayStr: string,
  dim: StatsDimension,
  offset = 0,
): PeriodStatsResult {
  const activeModules = modules
    .filter((m) => m.deleted_at === null)
    .sort((a, b) => a.sort - b.sort || a.created_at - b.created_at);
  const moduleMap = new Map<string, ModuleEntity>(activeModules.map((m) => [m.id, m]));
  const tagMap = new Map<string, TagEntity>();
  for (const t of tags) {
    if (t.deleted_at === null && moduleMap.has(t.module_id)) {
      tagMap.set(t.id, t);
    }
  }

  const R = getPeriodRange(period, anchorDateStr, offset);
  const P = getPeriodRange(period, anchorDateStr, offset - 1);

  const byModMs = new Map<string, number>();
  const byTagMs = new Map<string, number>();
  let unclassifiedMs = 0;
  let totalMs = 0;
  let prevTotalMs = 0;
  const distinctSessionIds = new Set<string>();

  interface MutableBucket {
    label: string;
    title: string;
    date?: string;
    isToday?: boolean;
    modMs: Map<string, number>;
    unclassifiedMs: number;
  }

  const buckets: MutableBucket[] = [];
  const bucketByDate = new Map<string, MutableBucket>();
  let trendTitle = '';

  if (period === 'day') {
    trendTitle = '每小时';
    for (let h = 0; h < 24; h += 1) {
      buckets.push({
        label: h % 6 === 0 ? String(h) : '',
        title: `${h}:00`,
        modMs: new Map(),
        unclassifiedMs: 0,
      });
    }
  } else if (period === 'year') {
    trendTitle = '每月';
    for (let m = 1; m <= 12; m += 1) {
      buckets.push({
        label: `${m}月`,
        title: `${R.year} 年 ${m} 月`,
        modMs: new Map(),
        unclassifiedMs: 0,
      });
    }
  } else {
    trendTitle = '每天';
    const n = period === 'week' ? 7 : getDaysInMonth(R.year, R.month);
    for (let i = 0; i < n; i += 1) {
      const d = addDays(R.startDate, i);
      const label =
        period === 'week'
          ? getWeekdayLabel(d).slice(1)
          : (i + 1) % 5 === 0 || i === 0
            ? String(i + 1)
            : '';
      const b: MutableBucket = {
        label,
        title: `${formatMonthDay(d)} ${getWeekdayLabel(d)}`,
        date: d,
        isToday: d === todayStr,
        modMs: new Map(),
        unclassifiedMs: 0,
      };
      buckets.push(b);
      bucketByDate.set(d, b);
    }
  }

  for (const s of sessions) {
    // 统计页严禁包含进行中（end_at === null）或已软删除记录
    if (s.deleted_at !== null || s.end_at === null) continue;
    // 快速粗剪，避免对完全在两个周期范围外的记录切分
    if (s.end_at <= P.startMs || s.start_at >= R.endMs) continue;

    const segs = splitSessionByDay(s);
    const tag = s.tag_id ? tagMap.get(s.tag_id) : undefined;
    const mod = tag ? moduleMap.get(tag.module_id) : undefined;

    for (const seg of segs) {
      if (seg.date >= R.startDate && seg.date <= R.endDate) {
        totalMs += seg.durationMs;
        distinctSessionIds.add(s.id);

        if (tag && mod) {
          byModMs.set(mod.id, (byModMs.get(mod.id) ?? 0) + seg.durationMs);
          byTagMs.set(tag.id, (byTagMs.get(tag.id) ?? 0) + seg.durationMs);
        } else {
          unclassifiedMs += seg.durationMs;
        }

        if (period === 'day') {
          const a = seg.startMin;
          const b = Math.min(seg.endMin, 1440);
          for (let h = Math.floor(a / 60); h < Math.ceil(b / 60) && h < 24; h += 1) {
            const overlapMin = Math.min(b, (h + 1) * 60) - Math.max(a, h * 60);
            if (overlapMin > 0) {
              const overlapMs = overlapMin * 60000;
              if (mod) {
                buckets[h].modMs.set(mod.id, (buckets[h].modMs.get(mod.id) ?? 0) + overlapMs);
              } else {
                buckets[h].unclassifiedMs += overlapMs;
              }
            }
          }
        } else if (period === 'year') {
          const mIdx = parseInt(seg.date.slice(5, 7), 10) - 1;
          const b = buckets[mIdx];
          if (b) {
            if (mod) {
              b.modMs.set(mod.id, (b.modMs.get(mod.id) ?? 0) + seg.durationMs);
            } else {
              b.unclassifiedMs += seg.durationMs;
            }
          }
        } else {
          const b = bucketByDate.get(seg.date);
          if (b) {
            if (mod) {
              b.modMs.set(mod.id, (b.modMs.get(mod.id) ?? 0) + seg.durationMs);
            } else {
              b.unclassifiedMs += seg.durationMs;
            }
          }
        }
      } else if (seg.date >= P.startDate && seg.date <= P.endDate) {
        prevTotalMs += seg.durationMs;
      }
    }
  }

  let dayCount = R.daysInPeriod;
  if (R.startDate <= todayStr && todayStr <= R.endDate) {
    dayCount = Math.max(1, diffDays(R.startDate, todayStr) + 1);
  } else if (R.startDate > todayStr) {
    dayCount = 1;
  }

  const rawItems: Array<Omit<BreakdownItem, 'pct'>> = [];
  if (dim === 'mod') {
    for (const m of activeModules) {
      const ms = byModMs.get(m.id) ?? 0;
      if (ms > 0) {
        rawItems.push({
          id: m.id,
          name: m.name,
          subLabel: '',
          subInk: '#9CA3AF',
          color: getPaletteEntry(m.color_key).color,
          durationMs: ms,
        });
      }
    }
  } else {
    for (const m of activeModules) {
      const pal = getPaletteEntry(m.color_key);
      const mTags = tags
        .filter((t) => t.deleted_at === null && t.module_id === m.id && (byTagMs.get(t.id) ?? 0) > 0)
        .sort((a, b) => (byTagMs.get(b.id) ?? 0) - (byTagMs.get(a.id) ?? 0));
      mTags.forEach((t, idx) => {
        const ms = byTagMs.get(t.id) ?? 0;
        const mixRatio = (idx % 4) * 0.22;
        rawItems.push({
          id: t.id,
          name: t.name,
          subLabel: m.name,
          subInk: pal.ink,
          color: mixWithWhite(pal.color, mixRatio),
          durationMs: ms,
        });
      });
    }
  }

  if (unclassifiedMs > 0) {
    rawItems.push({
      id: 'unclassified',
      name: '未分类',
      subLabel: '',
      subInk: '#6B7280',
      color: UNCLASSIFIED_STYLE.color,
      durationMs: unclassifiedMs,
    });
  }

  rawItems.sort((a, b) => b.durationMs - a.durationMs);
  const items: BreakdownItem[] = rawItems.map((it) => ({
    ...it,
    pct: totalMs > 0 ? Math.round((it.durationMs / totalMs) * 100) : 0,
  }));

  const finalBuckets: TrendBucket[] = buckets.map((b) => {
    const parts: TrendBucketPart[] = [];
    let bucketTotal = 0;
    for (const m of activeModules) {
      const ms = b.modMs.get(m.id) ?? 0;
      if (ms > 0) {
        bucketTotal += ms;
        parts.push({
          moduleId: m.id,
          name: m.name,
          color: getPaletteEntry(m.color_key).color,
          durationMs: ms,
        });
      }
    }
    if (b.unclassifiedMs > 0) {
      bucketTotal += b.unclassifiedMs;
      parts.push({
        moduleId: 'unclassified',
        name: '未分类',
        color: UNCLASSIFIED_STYLE.color,
        durationMs: b.unclassifiedMs,
      });
    }
    return {
      label: b.label,
      title: b.title,
      date: b.date,
      isToday: b.isToday,
      totalMs: bucketTotal,
      parts,
    };
  });

  const trendMaxMs = Math.max(1, ...finalBuckets.map((b) => b.totalMs));
  const focusCount = distinctSessionIds.size;

  return {
    period,
    rangeLabel: R.label,
    prevPeriodLabel: PREV_PERIOD_LABEL[period],
    startDate: R.startDate,
    endDate: R.endDate,
    totalMs,
    prevTotalMs,
    diffMs: totalMs - prevTotalMs,
    hasPrevData: prevTotalMs > 0,
    dayCount,
    dailyAvgMs: Math.round(totalMs / Math.max(1, dayCount)),
    focusCount,
    avgPerSessionMs: focusCount > 0 ? Math.round(totalMs / focusCount) : 0,
    topItem: items[0] ?? null,
    items,
    trendTitle,
    trendMaxMs,
    buckets: finalBuckets,
  };
}
