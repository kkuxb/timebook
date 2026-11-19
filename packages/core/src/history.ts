import { addDays, DAY_MS, getPeriodRange, shanghaiDateStartMs, toShanghaiDateStr } from './time.js';
import type { ModuleEntity, SessionEntity, TagEntity } from './types.js';

export type HistoryTimePreset =
  | 'all'
  | 'today'
  | 'yesterday'
  | 'this_week'
  | 'last_week'
  | 'this_month'
  | 'last_month'
  | 'custom';

export type HistoryTagFilter =
  | { kind: 'all' }
  | { kind: 'unclassified' }
  | { kind: 'module'; moduleId: string }
  | { kind: 'tag'; tagId: string };

export interface HistoryFilterInput {
  preset: HistoryTimePreset;
  todayStr: string;
  customStart?: string;
  customEnd?: string;
  tagFilter: HistoryTagFilter;
  query: string;
}

export interface HistoryFilterResult {
  items: SessionEntity[];
  totalCount: number;
  totalDurationMs: number;
  rangeStartMs: number | null;
  rangeEndMs: number | null;
}

function isValidDateStr(dateStr?: string): dateStr is string {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const ms = shanghaiDateStartMs(dateStr);
  if (!Number.isFinite(ms)) return false;
  return toShanghaiDateStr(ms) === dateStr;
}

/**
 * 解析历史筛选的时间范围（半开区间 [rangeStartMs, rangeEndMs)，固定北京时间）。
 */
export function resolveHistoryTimeRange(
  preset: HistoryTimePreset,
  todayStr: string,
  customStart?: string,
  customEnd?: string,
): { rangeStartMs: number | null; rangeEndMs: number | null } {
  switch (preset) {
    case 'all':
      return { rangeStartMs: null, rangeEndMs: null };
    case 'today': {
      const startMs = shanghaiDateStartMs(todayStr);
      return { rangeStartMs: startMs, rangeEndMs: startMs + DAY_MS };
    }
    case 'yesterday': {
      const yStr = addDays(todayStr, -1);
      const startMs = shanghaiDateStartMs(yStr);
      return { rangeStartMs: startMs, rangeEndMs: startMs + DAY_MS };
    }
    case 'this_week': {
      const range = getPeriodRange('week', todayStr, 0);
      return { rangeStartMs: range.startMs, rangeEndMs: range.endMs };
    }
    case 'last_week': {
      const range = getPeriodRange('week', todayStr, -1);
      return { rangeStartMs: range.startMs, rangeEndMs: range.endMs };
    }
    case 'this_month': {
      const range = getPeriodRange('month', todayStr, 0);
      return { rangeStartMs: range.startMs, rangeEndMs: range.endMs };
    }
    case 'last_month': {
      const range = getPeriodRange('month', todayStr, -1);
      return { rangeStartMs: range.startMs, rangeEndMs: range.endMs };
    }
    case 'custom': {
      const startValid = isValidDateStr(customStart);
      const endValid = isValidDateStr(customEnd);
      if (startValid && endValid) {
        const minDate = customStart <= customEnd ? customStart : customEnd;
        const maxDate = customStart <= customEnd ? customEnd : customStart;
        return {
          rangeStartMs: shanghaiDateStartMs(minDate),
          rangeEndMs: shanghaiDateStartMs(maxDate) + DAY_MS,
        };
      }
      if (startValid) {
        return { rangeStartMs: shanghaiDateStartMs(customStart), rangeEndMs: null };
      }
      if (endValid) {
        return { rangeStartMs: null, rangeEndMs: shanghaiDateStartMs(customEnd) + DAY_MS };
      }
      return { rangeStartMs: null, rangeEndMs: null };
    }
  }
}

/**
 * 对已结束且未软删除的专注记录执行多维时间、标签与多词检索筛选，并实时汇总条数与总时长。
 */
export function filterHistorySessions(
  sessions: ReadonlyArray<SessionEntity>,
  tags: ReadonlyArray<TagEntity>,
  modules: ReadonlyArray<ModuleEntity>,
  input: HistoryFilterInput,
): HistoryFilterResult {
  const { rangeStartMs, rangeEndMs } = resolveHistoryTimeRange(
    input.preset,
    input.todayStr,
    input.customStart,
    input.customEnd,
  );

  const activeModuleMap = new Map<string, ModuleEntity>();
  for (const m of modules) {
    if (m.deleted_at === null) {
      activeModuleMap.set(m.id, m);
    }
  }

  const activeTagMap = new Map<string, TagEntity>();
  const tagSearchTextMap = new Map<string, string>();
  for (const t of tags) {
    if (t.deleted_at === null) {
      const mod = activeModuleMap.get(t.module_id);
      if (mod) {
        activeTagMap.set(t.id, t);
        tagSearchTextMap.set(t.id, `${t.name.toLowerCase()} ${mod.name.toLowerCase()}`);
      }
    }
  }

  const rawQuery = input.query.trim().toLowerCase();
  const tokens = rawQuery ? rawQuery.split(/\s+/).filter(Boolean) : [];
  const tagFilter = input.tagFilter;

  const items: SessionEntity[] = [];
  let totalDurationMs = 0;

  for (let i = 0; i < sessions.length; i += 1) {
    const s = sessions[i];
    if (s.deleted_at !== null || s.end_at === null) continue;

    // 跨零点交集判定：end_at > rangeStartMs && start_at < rangeEndMs
    if (rangeStartMs !== null && s.end_at <= rangeStartMs) continue;
    if (rangeEndMs !== null && s.start_at >= rangeEndMs) continue;

    const activeTag = s.tag_id !== null ? activeTagMap.get(s.tag_id) : undefined;

    if (tagFilter.kind === 'unclassified') {
      if (activeTag !== undefined) continue;
    } else if (tagFilter.kind === 'module') {
      if (!activeTag || activeTag.module_id !== tagFilter.moduleId) continue;
    } else if (tagFilter.kind === 'tag') {
      if (!activeTag || activeTag.id !== tagFilter.tagId) continue;
    }

    if (tokens.length > 0) {
      const tagText = activeTag ? tagSearchTextMap.get(activeTag.id)! : '未分类';
      const titleText = s.title ? s.title.toLowerCase() : '';
      const hay = titleText ? `${titleText} ${tagText}` : tagText;
      let matched = true;
      for (let tIdx = 0; tIdx < tokens.length; tIdx += 1) {
        if (!hay.includes(tokens[tIdx])) {
          matched = false;
          break;
        }
      }
      if (!matched) continue;
    }

    items.push(s);
    totalDurationMs += Math.max(0, s.end_at - s.start_at);
  }

  items.sort((a, b) => b.start_at - a.start_at || (b.end_at ?? 0) - (a.end_at ?? 0));

  return {
    items,
    totalCount: items.length,
    totalDurationMs,
    rangeStartMs,
    rangeEndMs,
  };
}
