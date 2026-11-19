import { describe, expect, it } from 'vitest';
import {
  filterHistorySessions,
  resolveHistoryTimeRange,
  shanghaiDateStartMs,
  shanghaiDateTimeToUtcMs,
  type ModuleEntity,
  type SessionEntity,
  type TagEntity,
} from '../src/index.js';

const MODULES: ModuleEntity[] = [
  { id: 'm1', name: '工作', color_key: 'blue', sort: 0, created_at: 1, updated_at: 1, deleted_at: null },
  { id: 'm2', name: '学习', color_key: 'violet', sort: 1, created_at: 1, updated_at: 1, deleted_at: null },
  { id: 'm3', name: '游戏', color_key: 'teal', sort: 2, created_at: 1, updated_at: 1, deleted_at: null },
  { id: 'm_del', name: '旧模块', color_key: 'rose', sort: 3, created_at: 1, updated_at: 1, deleted_at: 1000 },
];

const TAGS: TagEntity[] = [
  { id: 't1', module_id: 'm1', name: '淘教', sort: 0, created_at: 1, updated_at: 1, deleted_at: null },
  { id: 't2', module_id: 'm1', name: '个人工作', sort: 1, created_at: 1, updated_at: 1, deleted_at: null },
  { id: 't3', module_id: 'm2', name: 'Python', sort: 0, created_at: 1, updated_at: 1, deleted_at: null },
  { id: 't4', module_id: 'm3', name: '原神', sort: 0, created_at: 1, updated_at: 1, deleted_at: null },
  { id: 't_del', module_id: 'm1', name: '已删事项', sort: 2, created_at: 1, updated_at: 1, deleted_at: 1000 },
];

function makeSession(
  id: string,
  tagId: string | null,
  startAt: number,
  endAt: number | null,
  title: string | null = null,
  deletedAt: number | null = null,
): SessionEntity {
  return {
    id,
    tag_id: tagId,
    todo_id: null,
    title,
    start_at: startAt,
    end_at: endAt,
    source: 'import',
    import_batch: 'legacy-b1',
    created_at: startAt,
    updated_at: startAt,
    deleted_at: deletedAt,
  };
}

describe('@timebook/core history filter', () => {
  const todayStr = '2026-11-19'; // 周四

  it('resolves all 8 time presets including swapped custom range in Asia/Shanghai', () => {
    const rToday = resolveHistoryTimeRange('today', todayStr);
    expect(rToday.rangeStartMs).toBe(shanghaiDateStartMs('2026-11-19'));
    expect(rToday.rangeEndMs).toBe(shanghaiDateStartMs('2026-11-20'));

    const rYest = resolveHistoryTimeRange('yesterday', todayStr);
    expect(rYest.rangeStartMs).toBe(shanghaiDateStartMs('2026-11-18'));
    expect(rYest.rangeEndMs).toBe(shanghaiDateStartMs('2026-11-19'));

    // 2026-11-19 周四，本周为 11-16 (周一) ~ 11-22 (周日)
    const rWeek = resolveHistoryTimeRange('this_week', todayStr);
    expect(rWeek.rangeStartMs).toBe(shanghaiDateStartMs('2026-11-16'));
    expect(rWeek.rangeEndMs).toBe(shanghaiDateStartMs('2026-11-23'));

    const rLastWeek = resolveHistoryTimeRange('last_week', todayStr);
    expect(rLastWeek.rangeStartMs).toBe(shanghaiDateStartMs('2026-11-09'));
    expect(rLastWeek.rangeEndMs).toBe(shanghaiDateStartMs('2026-11-16'));

    const rMonth = resolveHistoryTimeRange('this_month', todayStr);
    expect(rMonth.rangeStartMs).toBe(shanghaiDateStartMs('2026-11-01'));
    expect(rMonth.rangeEndMs).toBe(shanghaiDateStartMs('2026-12-01'));

    const rLastMonth = resolveHistoryTimeRange('last_month', todayStr);
    expect(rLastMonth.rangeStartMs).toBe(shanghaiDateStartMs('2026-10-01'));
    expect(rLastMonth.rangeEndMs).toBe(shanghaiDateStartMs('2026-11-01'));

    // 反填日期容错
    const rSwapped = resolveHistoryTimeRange('custom', todayStr, '2026-11-15', '2026-11-10');
    expect(rSwapped.rangeStartMs).toBe(shanghaiDateStartMs('2026-11-10'));
    expect(rSwapped.rangeEndMs).toBe(shanghaiDateStartMs('2026-11-16'));

    // 单边区间
    const rStartOnly = resolveHistoryTimeRange('custom', todayStr, '2026-11-10', '');
    expect(rStartOnly.rangeStartMs).toBe(shanghaiDateStartMs('2026-11-10'));
    expect(rStartOnly.rangeEndMs).toBeNull();
  });

  it('filters cross-midnight intersection, tag hierarchy, unclassified, multi-token query and excludes running/deleted', () => {
    const sCross = makeSession(
      's_cross',
      't1',
      shanghaiDateTimeToUtcMs('2026-11-18', 23 * 60),
      shanghaiDateTimeToUtcMs('2026-11-19', 90),
      '深夜上线',
    ); // 150 min
    const sToday = makeSession(
      's_today',
      't2',
      shanghaiDateTimeToUtcMs('2026-11-19', 10 * 60),
      shanghaiDateTimeToUtcMs('2026-11-19', 11 * 60),
      '需求评审',
    ); // 60 min
    const sUnclassified = makeSession(
      's_un',
      null,
      shanghaiDateTimeToUtcMs('2026-11-12', 14 * 60),
      shanghaiDateTimeToUtcMs('2026-11-12', 15 * 60),
      '杂务处理',
    ); // 60 min
    const sOrphanTag = makeSession(
      's_orphan',
      't_del',
      shanghaiDateTimeToUtcMs('2026-10-20', 9 * 60),
      shanghaiDateTimeToUtcMs('2026-10-20', 9 * 60 + 30),
      '归档事项记录',
    ); // 30 min -> 标签已删，应归为未分类
    const sRunning = makeSession(
      's_run',
      't3',
      shanghaiDateTimeToUtcMs('2026-11-19', 16 * 60),
      null,
      '进行中',
    );
    const sDeleted = makeSession(
      's_del',
      't3',
      shanghaiDateTimeToUtcMs('2026-11-19', 8 * 60),
      shanghaiDateTimeToUtcMs('2026-11-19', 9 * 60),
      '已删',
      9999,
    );

    const allSessions = [sOrphanTag, sUnclassified, sToday, sCross, sRunning, sDeleted];

    // 全部时间：排除 running 与 deleted，共 4 条，按 start_at 倒序
    const resAll = filterHistorySessions(allSessions, TAGS, MODULES, {
      preset: 'all',
      todayStr,
      tagFilter: { kind: 'all' },
      query: '',
    });
    expect(resAll.items.map((x) => x.id)).toEqual(['s_today', 's_cross', 's_un', 's_orphan']);
    expect(resAll.totalCount).toBe(4);
    expect(resAll.totalDurationMs).toBe((60 + 150 + 60 + 30) * 60000);

    // 今日：跨零点记录 sCross 交集命中今天，且保留原始完整时长 150 分钟
    const resToday = filterHistorySessions(allSessions, TAGS, MODULES, {
      preset: 'today',
      todayStr,
      tagFilter: { kind: 'all' },
      query: '',
    });
    expect(resToday.items.map((x) => x.id)).toEqual(['s_today', 's_cross']);
    expect(resToday.totalDurationMs).toBe(210 * 60000);

    // 昨日：跨零点记录 sCross 同样命中昨天
    const resYest = filterHistorySessions(allSessions, TAGS, MODULES, {
      preset: 'yesterday',
      todayStr,
      tagFilter: { kind: 'all' },
      query: '',
    });
    expect(resYest.items.map((x) => x.id)).toEqual(['s_cross']);

    // 一级模块筛选「工作」(m1)
    const resMod = filterHistorySessions(allSessions, TAGS, MODULES, {
      preset: 'all',
      todayStr,
      tagFilter: { kind: 'module', moduleId: 'm1' },
      query: '',
    });
    expect(resMod.items.map((x) => x.id)).toEqual(['s_today', 's_cross']);

    // 二级事项筛选「淘教」(t1)
    const resTag = filterHistorySessions(allSessions, TAGS, MODULES, {
      preset: 'all',
      todayStr,
      tagFilter: { kind: 'tag', tagId: 't1' },
      query: '',
    });
    expect(resTag.items.map((x) => x.id)).toEqual(['s_cross']);

    // 未分类筛选（包含无 tag_id 和引用已删标签的记录）
    const resUn = filterHistorySessions(allSessions, TAGS, MODULES, {
      preset: 'all',
      todayStr,
      tagFilter: { kind: 'unclassified' },
      query: '',
    });
    expect(resUn.items.map((x) => x.id)).toEqual(['s_un', 's_orphan']);

    // 多词搜索：「工作 上线」同时匹配模块名与标题
    const resQuery = filterHistorySessions(allSessions, TAGS, MODULES, {
      preset: 'all',
      todayStr,
      tagFilter: { kind: 'all' },
      query: '工作 上线',
    });
    expect(resQuery.items.map((x) => x.id)).toEqual(['s_cross']);

    // 搜「未分类」命中未分类记录
    const resQueryUn = filterHistorySessions(allSessions, TAGS, MODULES, {
      preset: 'all',
      todayStr,
      tagFilter: { kind: 'all' },
      query: '未分类 杂务',
    });
    expect(resQueryUn.items.map((x) => x.id)).toEqual(['s_un']);
  });

  it('filters 3,750 sessions in under 50ms', () => {
    const base = shanghaiDateStartMs('2026-01-01');
    const sessions: SessionEntity[] = [];
    for (let i = 0; i < 3750; i += 1) {
      const start = base + i * 3600_000;
      const tagId = i % 10 === 0 ? null : TAGS[i % 4].id;
      sessions.push(makeSession(`h_${i}`, tagId, start, start + 1800_000, `记录项 ${i % 50}`));
    }

    const t0 = performance.now();
    const res = filterHistorySessions(sessions, TAGS, MODULES, {
      preset: 'all',
      todayStr: '2026-11-19',
      tagFilter: { kind: 'module', moduleId: 'm1' },
      query: '工作 记录项',
    });
    const elapsed = performance.now() - t0;

    expect(res.totalCount).toBeGreaterThan(1000);
    expect(elapsed).toBeLessThan(50);
  });
});
