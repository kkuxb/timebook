import {
  COLOR_KEYS,
  MAX_SESSION_MS,
  SHANGHAI_OFFSET_MS,
  splitSessionByDay,
  toShanghaiDateStr,
  type ColorKey,
  type ModuleEntity,
  type TagEntity,
} from '@timebook/core';
import { parseCsv } from './csv.js';

export type NotionFileType = 'tags' | 'sessions' | 'todos' | 'unknown';

export interface ParsedModuleDraft {
  name: string;
  color_key: ColorKey;
}

export interface ParsedTagDraft {
  moduleName: string;
  name: string;
}

export interface ParsedSessionDraft {
  tagName: string | null;
  moduleName: string | null;
  title: string | null;
  start_at: number;
  end_at: number;
}

export interface ParsedTodoDraft {
  title: string;
  tagName: string | null;
  plan_date: string | null;
  due_date: string | null;
}

export type IssueReason =
  | 'missing_end'
  | 'end_before_start'
  | 'over_24h'
  | 'missing_tag'
  | 'module_only'
  | 'unknown_tag'
  | 'invalid_start';

export interface ImportIssue {
  issueId: string;
  fileName: string;
  rowNumber: number;
  rawTitle: string;
  rawTag: string;
  rawStart: string;
  rawEnd: string;
  start_at: number | null;
  end_at: number | null;
  resolvedTitle: string | null;
  reasons: IssueReason[];
  resolution: {
    action: 'skip' | 'unclassified' | 'assign_tag';
    tagKey?: string; // `${moduleName}::${tagName}` 或 tagId
    manualEndAt?: number | null;
  };
}

export interface NotionImportPreview {
  detectedFiles: Array<{ name: string; type: NotionFileType; rowCount: number }>;
  modules: ParsedModuleDraft[];
  tags: ParsedTagDraft[];
  validSessions: ParsedSessionDraft[];
  validTodos: ParsedTodoDraft[];
  issues: ImportIssue[];
  skippedCancelledSessions: number;
  skippedDoneTodos: number;
  moduleTotals: Array<{ moduleName: string; totalMinutes: number; totalHours: number }>;
  unclassifiedMinutes: number;
  dateRange: { startDate: string | null; endDate: string | null };
}

const DEFAULT_COLOR_BY_NAME: Record<string, ColorKey> = {
  工作: 'blue',
  学习: 'violet',
  游戏: 'teal',
  锻炼: 'rose',
};

const MONTH_MAP: Record<string, number> = {
  january: 1, jan: 1,
  february: 2, feb: 2,
  march: 3, mar: 3,
  april: 4, apr: 4,
  may: 5,
  june: 6, jun: 6,
  july: 7, jul: 7,
  august: 8, aug: 8,
  september: 9, sep: 9, sept: 9,
  october: 10, oct: 10,
  november: 11, nov: 11,
  december: 12, dec: 12,
};

/**
 * 剥离 Notion CSV 关联列中的 " (https://www.notion.so/...)" 链接后缀。
 */
export function stripNotionLink(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw
    .replace(/\s*\(https?:\/\/[^)]*\)\s*/gi, '')
    .trim();
}

function shanghaiLocalToUtc(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): number {
  return Date.UTC(year, month - 1, day, hour, minute, second, 0) - SHANGHAI_OFFSET_MS;
}

/**
 * 解析 Notion 导出的多种日期时间格式，无时区后缀按北京时间（Asia/Shanghai）解析。
 */
export function parseNotionDateTime(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;

  // 1. 中文格式：2026年11月18日 12:05(:30) 或 2026年11月18日
  let m = s.match(
    /^(\d{4})年(\d{1,2})月(\d{1,2})日(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/,
  );
  if (m) {
    return shanghaiLocalToUtc(
      parseInt(m[1], 10),
      parseInt(m[2], 10),
      parseInt(m[3], 10),
      m[4] ? parseInt(m[4], 10) : 0,
      m[5] ? parseInt(m[5], 10) : 0,
      m[6] ? parseInt(m[6], 10) : 0,
    );
  }

  // 2. 斜杠/短横线无时区格式：2026/11/18 12:05(:30) 或 2026-11-18 12:05(:30)
  m = s.match(
    /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:[T\s]+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/,
  );
  if (m) {
    return shanghaiLocalToUtc(
      parseInt(m[1], 10),
      parseInt(m[2], 10),
      parseInt(m[3], 10),
      m[4] ? parseInt(m[4], 10) : 0,
      m[5] ? parseInt(m[5], 10) : 0,
      m[6] ? parseInt(m[6], 10) : 0,
    );
  }

  // 3. 英文 Notion 导出格式：November 18, 2026 12:05 PM (GMT+8) / November 18, 2026 12:05 PM
  m = s.match(
    /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?\s*(AM|PM)?)?(?:\s*\((?:GMT|UTC)([+-]\d{1,2}(?::\d{2})?)\))?$/i,
  );
  if (m) {
    const mon = MONTH_MAP[m[1].toLowerCase()];
    if (mon) {
      let hour = m[4] ? parseInt(m[4], 10) : 0;
      const minute = m[5] ? parseInt(m[5], 10) : 0;
      const second = m[6] ? parseInt(m[6], 10) : 0;
      const ampm = m[7]?.toUpperCase();
      if (ampm === 'PM' && hour < 12) hour += 12;
      if (ampm === 'AM' && hour === 12) hour = 0;

      let offsetMs = SHANGHAI_OFFSET_MS;
      if (m[8]) {
        const tzMatch = m[8].match(/^([+-])(\d{1,2})(?::(\d{2}))?$/);
        if (tzMatch) {
          const sign = tzMatch[1] === '-' ? -1 : 1;
          const tzH = parseInt(tzMatch[2], 10);
          const tzM = tzMatch[3] ? parseInt(tzMatch[3], 10) : 0;
          offsetMs = sign * (tzH * 60 + tzM) * 60000;
        }
      }
      return Date.UTC(parseInt(m[3], 10), mon - 1, parseInt(m[2], 10), hour, minute, second, 0) - offsetMs;
    }
  }

  // 4. 明确带时区的 ISO 8601
  if (/([zZ]|[+-]\d{2}:?\d{2})$/.test(s)) {
    const ts = Date.parse(s);
    if (!Number.isNaN(ts)) return ts;
  }

  return null;
}

export function parseNotionDateOnly(raw: string | null | undefined): string | null {
  const ts = parseNotionDateTime(raw);
  if (ts === null) return null;
  return toShanghaiDateStr(ts);
}

export function detectNotionCsvType(headers: string[]): NotionFileType {
  const set = new Set(headers.map((h) => h.trim()));
  if (set.has('标签') && set.has('一级标签')) {
    return 'tags';
  }
  if (set.has('开始') && set.has('结束')) {
    return 'sessions';
  }
  if (set.has('事项') && (set.has('执行日期') || set.has('截止日期'))) {
    return 'todos';
  }
  return 'unknown';
}

function pickColorForModule(name: string, usedColors: Set<ColorKey>): ColorKey {
  const preferred = DEFAULT_COLOR_BY_NAME[name];
  if (preferred) {
    usedColors.add(preferred);
    return preferred;
  }
  const free = COLOR_KEYS.find((k) => !usedColors.has(k)) ?? COLOR_KEYS[usedColors.size % COLOR_KEYS.length];
  usedColors.add(free);
  return free;
}

export function parseNotionFiles(
  files: Array<{ name: string; content: string }>,
  existingModules: ModuleEntity[] = [],
  existingTags: TagEntity[] = [],
): NotionImportPreview {
  const detectedFiles: NotionImportPreview['detectedFiles'] = [];
  const parsedTables: Array<{ name: string; type: NotionFileType; rows: Array<Record<string, string>> }> = [];

  for (const f of files) {
    const parsed = parseCsv(f.content);
    const type = detectNotionCsvType(parsed.headers);
    detectedFiles.push({ name: f.name, type, rowCount: parsed.rows.length });
    parsedTables.push({ name: f.name, type, rows: parsed.rows });
  }

  const usedColors = new Set<ColorKey>();
  const moduleMap = new Map<string, ParsedModuleDraft>();

  for (const m of existingModules) {
    if (m.deleted_at !== null) continue;
    moduleMap.set(m.name, { name: m.name, color_key: m.color_key });
    usedColors.add(m.color_key);
  }

  const ensureModule = (name: string): ParsedModuleDraft => {
    const existing = moduleMap.get(name);
    if (existing) return existing;
    const created: ParsedModuleDraft = { name, color_key: pickColorForModule(name, usedColors) };
    moduleMap.set(name, created);
    return created;
  };

  // 建立已有二级标签索引
  const moduleById = new Map<string, ModuleEntity>(
    existingModules.filter((m) => m.deleted_at === null).map((m) => [m.id, m]),
  );
  const tagByName = new Map<string, ParsedTagDraft>();
  const tagKeySet = new Set<string>();

  for (const t of existingTags) {
    if (t.deleted_at !== null) continue;
    const mod = moduleById.get(t.module_id);
    if (!mod) continue;
    const draft: ParsedTagDraft = { moduleName: mod.name, name: t.name };
    tagKeySet.add(`${mod.name}::${t.name}`);
    if (!tagByName.has(t.name)) {
      tagByName.set(t.name, draft);
    }
  }

  // 1. 解析时间标签表
  for (const tbl of parsedTables) {
    if (tbl.type !== 'tags') continue;
    // 先过一遍顶级模块行
    for (const r of tbl.rows) {
      const name = stripNotionLink(r['标签']);
      const parent = stripNotionLink(r['一级标签']);
      if (name && !parent) {
        ensureModule(name);
      }
    }
    // 再过一遍二级事项行
    for (const r of tbl.rows) {
      const name = stripNotionLink(r['标签']);
      const parent = stripNotionLink(r['一级标签']);
      if (!name || !parent) continue;
      ensureModule(parent);
      const key = `${parent}::${name}`;
      if (!tagKeySet.has(key)) {
        const draft: ParsedTagDraft = { moduleName: parent, name };
        tagKeySet.add(key);
        if (!tagByName.has(name)) {
          tagByName.set(name, draft);
        }
      }
    }
  }

  const validSessions: ParsedSessionDraft[] = [];
  const issues: ImportIssue[] = [];
  let skippedCancelledSessions = 0;

  // 2. 解析专注记录表
  for (const tbl of parsedTables) {
    if (tbl.type !== 'sessions') continue;
    tbl.rows.forEach((r, idx) => {
      const status = (r['状态'] ?? '').trim();
      if (status === '已取消' || status === '未开始') {
        skippedCancelledSessions += 1;
        return;
      }

      const rowNumber = idx + 2;
      const rawTag = stripNotionLink(r['标签']);
      const rawStart = (r['开始'] ?? '').trim();
      const rawEnd = (r['结束'] ?? '').trim();
      const calendarTitle = (r['日历标题'] ?? '').trim();
      const todoTitle = stripNotionLink(r['待办']);

      const startAt = parseNotionDateTime(rawStart);
      const endAt = parseNotionDateTime(rawEnd);

      const reasons: IssueReason[] = [];
      if (startAt === null) {
        reasons.push('invalid_start');
      }
      if (!rawEnd || endAt === null) {
        reasons.push('missing_end');
      } else if (startAt !== null) {
        if (endAt <= startAt) {
          reasons.push('end_before_start');
        } else if (endAt - startAt > MAX_SESSION_MS) {
          reasons.push('over_24h');
        }
      }

      let matchedTag: ParsedTagDraft | undefined;
      if (!rawTag) {
        reasons.push('missing_tag');
      } else {
        matchedTag = tagByName.get(rawTag);
        if (!matchedTag) {
          if (moduleMap.has(rawTag)) {
            reasons.push('module_only');
          } else {
            reasons.push('unknown_tag');
          }
        }
      }

      let resolvedTitle: string | null = calendarTitle || todoTitle || null;
      if (resolvedTitle && matchedTag && resolvedTitle === matchedTag.name) {
        resolvedTitle = null;
      }

      if (reasons.length > 0) {
        issues.push({
          issueId: `${tbl.name}#${rowNumber}`,
          fileName: tbl.name,
          rowNumber,
          rawTitle: calendarTitle || todoTitle,
          rawTag,
          rawStart,
          rawEnd,
          start_at: startAt,
          end_at: endAt,
          resolvedTitle,
          reasons,
          resolution: {
            action: reasons.every((re) => re === 'missing_tag' || re === 'unknown_tag' || re === 'module_only')
              ? 'unclassified'
              : 'skip',
            manualEndAt: endAt,
          },
        });
        return;
      }

      validSessions.push({
        tagName: matchedTag!.name,
        moduleName: matchedTag!.moduleName,
        title: resolvedTitle,
        start_at: startAt!,
        end_at: endAt!,
      });
    });
  }

  // 3. 解析待办表
  const validTodos: ParsedTodoDraft[] = [];
  let skippedDoneTodos = 0;
  for (const tbl of parsedTables) {
    if (tbl.type !== 'todos') continue;
    for (const r of tbl.rows) {
      const title = (r['事项'] ?? '').trim();
      if (!title) continue;
      const status = (r['状态'] ?? '').trim().toLowerCase();
      if (status === 'done' || status === '已完成') {
        skippedDoneTodos += 1;
        continue;
      }
      const rawTag = stripNotionLink(r['标签']);
      const matchedTag = rawTag ? tagByName.get(rawTag) : undefined;
      validTodos.push({
        title,
        tagName: matchedTag ? matchedTag.name : null,
        plan_date: parseNotionDateOnly(r['执行日期']),
        due_date: parseNotionDateOnly(r['截止日期']),
      });
    }
  }

  // 4. 汇总对账统计
  const modMinutesMap = new Map<string, number>();
  for (const m of moduleMap.values()) {
    modMinutesMap.set(m.name, 0);
  }
  let unclassifiedMinutes = 0;
  let minStartDate: string | null = null;
  let maxEndDate: string | null = null;

  for (const s of validSessions) {
    const segs = splitSessionByDay({ id: 'tmp', start_at: s.start_at, end_at: s.end_at });
    for (const seg of segs) {
      if (!minStartDate || seg.date < minStartDate) minStartDate = seg.date;
      if (!maxEndDate || seg.date > maxEndDate) maxEndDate = seg.date;
    }
    const mins = (s.end_at - s.start_at) / 60000;
    if (s.moduleName) {
      modMinutesMap.set(s.moduleName, (modMinutesMap.get(s.moduleName) ?? 0) + mins);
    } else {
      unclassifiedMinutes += mins;
    }
  }

  const moduleTotals = Array.from(modMinutesMap.entries()).map(([moduleName, totalMin]) => ({
    moduleName,
    totalMinutes: Math.round(totalMin),
    totalHours: Number((totalMin / 60).toFixed(1)),
  }));

  const tags: ParsedTagDraft[] = [];
  for (const key of tagKeySet) {
    const [moduleName, name] = key.split('::');
    tags.push({ moduleName, name });
  }

  return {
    detectedFiles,
    modules: Array.from(moduleMap.values()),
    tags,
    validSessions,
    validTodos,
    issues,
    skippedCancelledSessions,
    skippedDoneTodos,
    moduleTotals,
    unclassifiedMinutes: Math.round(unclassifiedMinutes),
    dateRange: { startDate: minStartDate, endDate: maxEndDate },
  };
}
