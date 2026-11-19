import type { PeriodType, SessionEntity } from './types.js';

export const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;

const WEEKDAYS_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * 将 UTC 毫秒时间戳转换为北京时间自然日 YYYY-MM-DD（固定 UTC+8，无夏令时）。
 */
export function toShanghaiDateStr(utcMs: number): string {
  const d = new Date(utcMs + SHANGHAI_OFFSET_MS);
  const y = d.getUTCFullYear();
  const m = pad2(d.getUTCMonth() + 1);
  const day = pad2(d.getUTCDate());
  return `${y}-${m}-${day}`;
}

/**
 * 返回北京时间自然日 YYYY-MM-DD 零点对应的 UTC 毫秒时间戳。
 */
export function shanghaiDateStartMs(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map((x) => parseInt(x, 10));
  return Date.UTC(y, m - 1, d, 0, 0, 0, 0) - SHANGHAI_OFFSET_MS;
}

/**
 * 将北京日期字符串和当天分钟数转为 UTC 毫秒（支持 minutesFromMidnight >= 1440 表示次日）。
 */
export function shanghaiDateTimeToUtcMs(dateStr: string, minutesFromMidnight: number): number {
  return shanghaiDateStartMs(dateStr) + Math.round(minutesFromMidnight * 60 * 1000);
}

/**
 * 获取某 UTC 时间在北京时间当天的 HH:MM 文本。
 */
export function formatShanghaiTime(utcMs: number): string {
  const d = new Date(utcMs + SHANGHAI_OFFSET_MS);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

/**
 * 获取某 UTC 时间在北京时间当天的分钟偏移 [0, 1440)。
 */
export function getMinutesInShanghaiDay(utcMs: number): number {
  const start = shanghaiDateStartMs(toShanghaiDateStr(utcMs));
  return (utcMs - start) / 60000;
}

export function addDays(dateStr: string, deltaDays: number): string {
  const [y, m, d] = dateStr.split('-').map((x) => parseInt(x, 10));
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays, 12, 0, 0));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

export function diffDays(startDateStr: string, endDateStr: string): number {
  const a = shanghaiDateStartMs(startDateStr);
  const b = shanghaiDateStartMs(endDateStr);
  return Math.round((b - a) / DAY_MS);
}

/**
 * 返回 1..7（1=周一 ... 7=周日）。
 */
export function getWeekday1To7(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map((x) => parseInt(x, 10));
  const jsDay = new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay();
  return jsDay === 0 ? 7 : jsDay;
}

export function getWeekdayLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map((x) => parseInt(x, 10));
  const jsDay = new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay();
  return WEEKDAYS_CN[jsDay];
}

export function formatMonthDay(dateStr: string, padDay = false): string {
  const m = parseInt(dateStr.slice(5, 7), 10);
  const d = parseInt(dateStr.slice(8, 10), 10);
  return `${m}.${padDay ? pad2(d) : d}`;
}

export function getWeekStart(dateStr: string): string {
  const wd = getWeekday1To7(dateStr);
  return addDays(dateStr, -(wd - 1));
}

export function getDaysInMonth(year: number, month1To12: number): number {
  return new Date(Date.UTC(year, month1To12, 0)).getUTCDate();
}

export interface PeriodRange {
  startDate: string;
  endDate: string;
  startMs: number;
  endMs: number;
  label: string;
  daysInPeriod: number;
  year: number;
  month: number;
}

export function getPeriodRange(
  period: PeriodType,
  anchorDateStr: string,
  offset = 0,
): PeriodRange {
  if (period === 'day') {
    const d = addDays(anchorDateStr, offset);
    const y = parseInt(d.slice(0, 4), 10);
    const m = parseInt(d.slice(5, 7), 10);
    return {
      startDate: d,
      endDate: d,
      startMs: shanghaiDateStartMs(d),
      endMs: shanghaiDateStartMs(d) + DAY_MS,
      label: `${formatMonthDay(d)} ${getWeekdayLabel(d)}`,
      daysInPeriod: 1,
      year: y,
      month: m,
    };
  }
  if (period === 'week') {
    const startDate = addDays(getWeekStart(anchorDateStr), offset * 7);
    const endDate = addDays(startDate, 6);
    const y = parseInt(startDate.slice(0, 4), 10);
    const m = parseInt(startDate.slice(5, 7), 10);
    return {
      startDate,
      endDate,
      startMs: shanghaiDateStartMs(startDate),
      endMs: shanghaiDateStartMs(endDate) + DAY_MS,
      label: `${formatMonthDay(startDate)} – ${formatMonthDay(endDate)}`,
      daysInPeriod: 7,
      year: y,
      month: m,
    };
  }
  if (period === 'month') {
    let year = parseInt(anchorDateStr.slice(0, 4), 10);
    let month = parseInt(anchorDateStr.slice(5, 7), 10) + offset;
    while (month < 1) {
      month += 12;
      year -= 1;
    }
    while (month > 12) {
      month -= 12;
      year += 1;
    }
    const dim = getDaysInMonth(year, month);
    const startDate = `${year}-${pad2(month)}-01`;
    const endDate = `${year}-${pad2(month)}-${pad2(dim)}`;
    return {
      startDate,
      endDate,
      startMs: shanghaiDateStartMs(startDate),
      endMs: shanghaiDateStartMs(endDate) + DAY_MS,
      label: `${year} 年 ${month} 月`,
      daysInPeriod: dim,
      year,
      month,
    };
  }
  const year = parseInt(anchorDateStr.slice(0, 4), 10) + offset;
  const startDate = `${year}-01-01`;
  const endDate = `${year}-12-31`;
  return {
    startDate,
    endDate,
    startMs: shanghaiDateStartMs(startDate),
    endMs: shanghaiDateStartMs(endDate) + DAY_MS,
    label: `${year} 年`,
    daysInPeriod: diffDays(startDate, endDate) + 1,
    year,
    month: 1,
  };
}

export interface DaySegment {
  sessionId: string;
  date: string;
  startAt: number;
  endAt: number;
  startMin: number;
  endMin: number;
  durationMs: number;
}

/**
 * 将专注记录按北京时间 00:00 零点精确切分为跨天自然日片段。
 */
export function splitSessionByDay(
  session: Pick<SessionEntity, 'id' | 'start_at' | 'end_at'>,
  effectiveEndAt?: number,
): DaySegment[] {
  const startAt = session.start_at;
  const endAt = session.end_at ?? effectiveEndAt;
  if (endAt === undefined || endAt === null || endAt <= startAt) {
    return [];
  }

  const segments: DaySegment[] = [];
  let cursor = startAt;
  let currentDate = toShanghaiDateStr(startAt);
  let dayStart = shanghaiDateStartMs(currentDate);

  while (cursor < endAt) {
    const nextDayStart = dayStart + DAY_MS;
    const segEnd = Math.min(endAt, nextDayStart);
    const durationMs = segEnd - cursor;
    if (durationMs > 0) {
      segments.push({
        sessionId: session.id,
        date: currentDate,
        startAt: cursor,
        endAt: segEnd,
        startMin: (cursor - dayStart) / 60000,
        endMin: (segEnd - dayStart) / 60000,
        durationMs,
      });
    }
    cursor = segEnd;
    dayStart = nextDayStart;
    currentDate = addDays(currentDate, 1);
  }

  return segments;
}

export function formatMinutes(minutes: number): string {
  const rounded = Math.max(0, Math.round(minutes));
  if (rounded >= 60) {
    const h = Math.floor(rounded / 60);
    const m = rounded % 60;
    return `${h} h ${m} min`;
  }
  return `${rounded} min`;
}

export function formatDurationMs(ms: number): string {
  return formatMinutes(ms / 60000);
}

export function formatDurationLarge(ms: number): string {
  const minutes = Math.round(Math.max(0, ms) / 60000);
  if (minutes >= 600) {
    return `${Math.round(minutes / 60).toLocaleString('en-US')} h`;
  }
  return formatMinutes(minutes);
}

export function formatClockMs(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
}

export function minutesToHm(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

export function hmToMinutes(hm: string): number | null {
  if (!hm || !/^\d{1,2}:\d{2}$/.test(hm)) return null;
  const [h, m] = hm.split(':').map((x) => parseInt(x, 10));
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

export interface TodayTimelineAxis {
  startMin: number;
  endMin: 1440;
  spanMin: number;
  ticks: number[];
  hasEarlyExtension: boolean;
  earlyBoundaryMin: 480;
}

/**
 * 根据当日专注片段自动计算今日页时间横条的起点与整点刻度：
 * - 默认（无早于 08:00 的记录或空记录日）：08:00–24:00，刻度 [8, 12, 16, 20, 24]
 * - 早起（06:00–07:59 有记录）：06:00–24:00，刻度 [6, 12, 18, 24]
 * - 凌晨（00:00–05:59 有记录）：00:00–24:00，刻度 [0, 6, 12, 18, 24]
 */
export function resolveTodayTimelineAxis(
  segments: ReadonlyArray<{ startMin: number; endMin: number }>,
): TodayTimelineAxis {
  let minStartMin = Infinity;
  for (const seg of segments) {
    if (seg.endMin > seg.startMin) {
      const clampedStart = Math.max(0, seg.startMin);
      if (clampedStart < minStartMin) {
        minStartMin = clampedStart;
      }
    }
  }

  if (minStartMin === Infinity || minStartMin >= 480) {
    return {
      startMin: 480,
      endMin: 1440,
      spanMin: 960,
      ticks: [8, 12, 16, 20, 24],
      hasEarlyExtension: false,
      earlyBoundaryMin: 480,
    };
  }

  if (minStartMin >= 360) {
    return {
      startMin: 360,
      endMin: 1440,
      spanMin: 1080,
      ticks: [6, 12, 18, 24],
      hasEarlyExtension: true,
      earlyBoundaryMin: 480,
    };
  }

  return {
    startMin: 0,
    endMin: 1440,
    spanMin: 1440,
    ticks: [0, 6, 12, 18, 24],
    hasEarlyExtension: true,
    earlyBoundaryMin: 480,
  };
}
