import { DEFAULT_MIN_GAP_MINUTES } from './types.js';

export interface MinuteInterval {
  startMin: number;
  endMin: number;
}

export interface DayGap {
  startMin: number;
  endMin: number;
  durationMin: number;
}

/**
 * 合并当日时间区间，并找出相邻两段之间 >= minGapMinutes 的空档。
 * 首段之前与末段之后绝不返回空档。
 */
export function computeDayGaps(
  intervals: MinuteInterval[],
  minGapMinutes = DEFAULT_MIN_GAP_MINUTES,
): DayGap[] {
  const valid = intervals
    .map((iv) => ({
      startMin: Math.max(0, Math.min(1440, iv.startMin)),
      endMin: Math.max(0, Math.min(1440, iv.endMin)),
    }))
    .filter((iv) => iv.endMin > iv.startMin)
    .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);

  if (valid.length < 2) {
    return [];
  }

  const gaps: DayGap[] = [];
  let currentEnd = valid[0].endMin;

  for (let i = 1; i < valid.length; i += 1) {
    const iv = valid[i];
    const diff = iv.startMin - currentEnd;
    if (diff >= minGapMinutes - 1e-6) {
      gaps.push({
        startMin: currentEnd,
        endMin: iv.startMin,
        durationMin: Math.round(diff),
      });
    }
    if (iv.endMin > currentEnd) {
      currentEnd = iv.endMin;
    }
  }

  return gaps;
}
