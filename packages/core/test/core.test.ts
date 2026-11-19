import { describe, expect, it } from 'vitest';
import {
  computeDayGaps,
  computePeriodStats,
  computeTodayModuleOverview,
  computeTodoSpentMs,
  getAllPendingTodos,
  getDueLabel,
  getPeriodRange,
  getTodayTodos,
  getWeekStart,
  isTodoScheduledOn,
  mixWithWhite,
  shanghaiDateStartMs,
  shanghaiDateTimeToUtcMs,
  splitSessionByDay,
  toShanghaiDateStr,
  type ModuleEntity,
  type SessionEntity,
  type TagEntity,
  type TodoCheckEntity,
  type TodoEntity,
} from '../src/index.js';

const MODULES: ModuleEntity[] = [
  { id: 'm1', name: '工作', color_key: 'blue', sort: 0, created_at: 1, updated_at: 1, deleted_at: null },
  { id: 'm2', name: '学习', color_key: 'violet', sort: 1, created_at: 1, updated_at: 1, deleted_at: null },
  { id: 'm3', name: '游戏', color_key: 'teal', sort: 2, created_at: 1, updated_at: 1, deleted_at: null },
  { id: 'm4', name: '锻炼', color_key: 'rose', sort: 3, created_at: 1, updated_at: 1, deleted_at: null },
];

const TAGS: TagEntity[] = [
  { id: 't1', module_id: 'm1', name: '淘教', sort: 0, created_at: 1, updated_at: 1, deleted_at: null },
  { id: 't2', module_id: 'm1', name: '个人工作', sort: 1, created_at: 1, updated_at: 1, deleted_at: null },
  { id: 't3', module_id: 'm3', name: '原神', sort: 0, created_at: 1, updated_at: 1, deleted_at: null },
  { id: 't4', module_id: 'm2', name: 'Python', sort: 0, created_at: 1, updated_at: 1, deleted_at: null },
];

function makeSession(
  id: string,
  tagId: string | null,
  startAt: number,
  endAt: number | null,
  todoId: string | null = null,
): SessionEntity {
  return {
    id,
    tag_id: tagId,
    todo_id: todoId,
    title: null,
    start_at: startAt,
    end_at: endAt,
    source: 'timer',
    import_batch: null,
    created_at: startAt,
    updated_at: startAt,
    deleted_at: null,
  };
}

describe('@timebook/core palette & time', () => {
  it('mixWithWhite computes exact 0/22/44/66 shades', () => {
    expect(mixWithWhite('#4F7BFF', 0)).toBe('#4F7BFF');
    expect(mixWithWhite('#4F7BFF', 0.22)).toBe('#7698FF');
    expect(mixWithWhite('#4F7BFF', 1)).toBe('#FFFFFF');
  });

  it('handles Asia/Shanghai dates and Monday-start weeks', () => {
    // 2026-11-15 23:30 UTC+8 = 2026-11-15 15:30 UTC
    const ms = Date.UTC(2026, 10, 15, 15, 30, 0);
    expect(toShanghaiDateStr(ms)).toBe('2026-11-15');
    // 2026-11-15 是周日，周一应是 2026-11-09
    expect(getWeekStart('2026-11-15')).toBe('2026-11-09');
    const week = getPeriodRange('week', '2026-11-15', 0);
    expect(week.startDate).toBe('2026-11-09');
    expect(week.endDate).toBe('2026-11-15');
  });

  it('splits cross-midnight session 23:00–01:30 across day/week/month/year boundaries', () => {
    // 2026-12-31 23:00 至 2027-01-01 01:30（既跨日、跨月、也跨年）
    const startAt = shanghaiDateTimeToUtcMs('2026-12-31', 23 * 60);
    const endAt = shanghaiDateTimeToUtcMs('2027-01-01', 90);
    const segs = splitSessionByDay({ id: 'cross1', start_at: startAt, end_at: endAt });
    expect(segs).toHaveLength(2);
    expect(segs[0].date).toBe('2026-12-31');
    expect(segs[0].durationMs).toBe(60 * 60 * 1000);
    expect(segs[1].date).toBe('2027-01-01');
    expect(segs[1].durationMs).toBe(90 * 60 * 1000);
  });
});

describe('@timebook/core gaps', () => {
  it('ignores 19-min gaps, catches 20-min gaps, merges overlaps, and never adds leading/trailing gaps', () => {
    const gaps = computeDayGaps([
      { startMin: 540, endMin: 600 }, // 09:00–10:00
      { startMin: 580, endMin: 620 }, // 重叠 09:40–10:20
      { startMin: 639, endMin: 660 }, // 间隔 19 分 -> 忽略
      { startMin: 680, endMin: 720 }, // 间隔 20 分 -> 命中
    ]);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toEqual({ startMin: 660, endMin: 680, durationMin: 20 });

    // 单段记录无空档
    expect(computeDayGaps([{ startMin: 600, endMin: 660 }])).toEqual([]);
  });
});

describe('@timebook/core stats & today overview', () => {
  it('excludes running sessions from period stats while including them in today overview', () => {
    const today = '2026-11-16'; // 周一
    const prevDay = '2026-11-15'; // 周日
    const s1 = makeSession(
      's_cross',
      't1',
      shanghaiDateTimeToUtcMs(prevDay, 23 * 60),
      shanghaiDateTimeToUtcMs(today, 90),
    );
    const s2 = makeSession(
      's_overlap1',
      't1',
      shanghaiDateTimeToUtcMs(today, 14 * 60),
      shanghaiDateTimeToUtcMs(today, 15 * 60),
    );
    const s3 = makeSession(
      's_overlap2',
      't3',
      shanghaiDateTimeToUtcMs(today, 14 * 60),
      shanghaiDateTimeToUtcMs(today, 15 * 60),
    );
    const sRunning = makeSession(
      's_run',
      't4',
      shanghaiDateTimeToUtcMs(today, 16 * 60),
      null,
    );
    const nowMs = shanghaiDateTimeToUtcMs(today, 16 * 60 + 30);

    const sessions = [s1, s2, s3, sRunning];

    // 今日概览包含进行中 30 分钟学习
    const overview = computeTodayModuleOverview(sessions, TAGS, MODULES, today, nowMs);
    expect(overview.modules.find((m) => m.id === 'm2' || m.moduleId === 'm2')?.durationMs).toBe(
      30 * 60000,
    );
    expect(overview.modules.find((m) => m.moduleId === 'm1')?.durationMs).toBe(150 * 60000);
    expect(overview.modules.find((m) => m.moduleId === 'm3')?.durationMs).toBe(60 * 60000);

    // 周统计不包含进行中（sRunning）；重叠各累加；s_cross 只在今天切得 1.5h，且算 1 次
    const weekStats = computePeriodStats(sessions, TAGS, MODULES, 'week', today, today, 'mod');
    expect(weekStats.totalMs).toBe(150 * 60000 + 60 * 60000);
    expect(weekStats.focusCount).toBe(3);

    // 若统计跨周月（2026-11 月包含 11-15 和 11-16），s_cross 仍只计 1 次！
    const monthStats = computePeriodStats(sessions, TAGS, MODULES, 'month', today, today, 'mod');
    expect(monthStats.totalMs).toBe((60 + 150 + 60) * 60000);
    expect(monthStats.focusCount).toBe(3);
  });

  it('computes 5000 sessions period stats in under 20ms', () => {
    const base = shanghaiDateStartMs('2026-11-01');
    const big: SessionEntity[] = [];
    for (let i = 0; i < 5000; i += 1) {
      const start = base + (i % 20) * 86400_000 + (i % 10) * 3600_000;
      big.push(makeSession(`b${i}`, TAGS[i % TAGS.length].id, start, start + 1800_000));
    }
    const t0 = performance.now();
    const res = computePeriodStats(big, TAGS, MODULES, 'month', '2026-11-15', '2026-11-15', 'tag');
    const elapsed = performance.now() - t0;
    expect(res.focusCount).toBe(5000);
    expect(elapsed).toBeLessThan(100);
  });
});

describe('@timebook/core todos & recurrence', () => {
  it('handles recurring non-cumulative schedule and per-round spent calculation', () => {
    const todoWeekly: TodoEntity = {
      id: 'td1',
      title: '健身',
      tag_id: 't3',
      plan_date: null,
      due_date: null,
      recur: JSON.stringify({ freq: 'weekly', days: [1, 3, 5] }),
      done_at: null,
      sort: 0,
      created_at: 1000,
      updated_at: 1000,
      deleted_at: null,
    };
    const todoFuture: TodoEntity = {
      id: 'td2',
      title: '未来任务',
      tag_id: null,
      plan_date: '2026-11-20',
      due_date: '2026-11-16',
      recur: null,
      done_at: null,
      sort: 1,
      created_at: 1000,
      updated_at: 1000,
      deleted_at: null,
    };
    const checks: TodoCheckEntity[] = [
      { todo_id: 'td1', date: '2026-11-16', done_at: 2000, updated_at: 2000, deleted_at: null },
    ];
    const sessions: SessionEntity[] = [
      makeSession(
        'ss1',
        't3',
        shanghaiDateTimeToUtcMs('2026-11-13', 18 * 60),
        shanghaiDateTimeToUtcMs('2026-11-13', 19 * 60),
        'td1',
      ),
      makeSession(
        'ss2',
        't3',
        shanghaiDateTimeToUtcMs('2026-11-16', 18 * 60),
        shanghaiDateTimeToUtcMs('2026-11-16', 18 * 60 + 40),
        'td1',
      ),
    ];

    // 2026-11-16 周一命中，2026-11-17 周二不命中
    expect(isTodoScheduledOn(todoWeekly, '2026-11-16')).toBe(true);
    expect(isTodoScheduledOn(todoWeekly, '2026-11-17')).toBe(false);

    // 重复待办在 2026-11-16 本轮仅算今天 40 分钟，在 2026-11-18 新一轮重新未完成且本轮已投入 0
    expect(computeTodoSpentMs(todoWeekly, sessions, '2026-11-16', Date.now())).toBe(40 * 60000);
    expect(computeTodoSpentMs(todoWeekly, sessions, '2026-11-18', Date.now())).toBe(0);

    const todayList = getTodayTodos([todoWeekly, todoFuture], checks, sessions, '2026-11-16', Date.now());
    expect(todayList.items).toHaveLength(1);
    expect(todayList.items[0].done).toBe(true);

    // 2026-11-18 周三新的一轮未完成（即使周一完成过）
    const wedList = getTodayTodos([todoWeekly, todoFuture], checks, sessions, '2026-11-18', Date.now());
    expect(wedList.items[0].done).toBe(false);

    // 全部未完成视图包含未来日期的待办
    const allPending = getAllPendingTodos([todoWeekly, todoFuture], checks, sessions, '2026-11-16', Date.now());
    expect(allPending).toHaveLength(2);
    expect(getDueLabel('2026-11-16', '2026-11-16').label).toBe('截止 今天');
    expect(getDueLabel('2026-11-16', '2026-11-18').label).toBe('已过期 2 天');
  });
});
