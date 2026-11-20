import {
  diffDays,
  getWeekday1To7,
  splitSessionByDay,
  toShanghaiDateStr,
} from './time.js';
import {
  TODO_RECUR_SCHEMA,
  type SessionEntity,
  type TodoCheckEntity,
  type TodoEntity,
  type TodoRecur,
} from './types.js';

export function parseTodoRecur(recurJson: string | null | undefined): TodoRecur | null {
  if (!recurJson) return null;
  try {
    const parsed = JSON.parse(recurJson);
    const res = TODO_RECUR_SCHEMA.safeParse(parsed);
    return res.success ? res.data : null;
  } catch {
    return null;
  }
}

export function formatRecurLabel(recurJson: string | null | undefined): string | null {
  const recur = parseTodoRecur(recurJson);
  if (!recur) return null;
  if (recur.freq === 'daily') return '每天重复';
  if (recur.freq === 'weekly') {
    const names = ['', '一', '二', '三', '四', '五', '六', '日'];
    const sorted = [...new Set(recur.days)].sort((a, b) => a - b);
    return `每周${sorted.map((d) => names[d]).join('、')}`;
  }
  const sorted = [...new Set(recur.monthDays)].sort((a, b) => a - b);
  return `每月 ${sorted.join('、')} 号`;
}

/**
 * 判断重复待办在指定北京自然日是否应当出现；非重复待办返回 false。
 */
export function isTodoScheduledOn(todo: TodoEntity, dateStr: string): boolean {
  const recur = parseTodoRecur(todo.recur);
  if (!recur) return false;
  if (todo.plan_date && dateStr < todo.plan_date) return false;

  if (recur.freq === 'daily') return true;
  if (recur.freq === 'weekly') {
    const wd = getWeekday1To7(dateStr);
    return recur.days.includes(wd);
  }
  const dayOfMonth = parseInt(dateStr.slice(8, 10), 10);
  return recur.monthDays.includes(dayOfMonth);
}

export function isTodoDoneOn(
  todo: TodoEntity,
  dateStr: string,
  todoChecks: TodoCheckEntity[],
): boolean {
  const recur = parseTodoRecur(todo.recur);
  if (!recur) {
    return todo.done_at !== null;
  }
  return todoChecks.some(
    (c) => c.todo_id === todo.id && c.date === dateStr && c.deleted_at === null,
  );
}

export interface TodoViewItem {
  todo: TodoEntity;
  done: boolean;
  isRecurring: boolean;
  recurLabel: string | null;
  dueLabel: string | null;
  dueOverdue: boolean;
  spentMs: number;
}

/**
 * 统一待办视图排序比较器：
 * 1. 未完成在前、已完成沉底；
 * 2. 有截止日期在前、无截止日期在后；
 * 3. 截止日期由近到远（YYYY-MM-DD 升序）；
 * 4. 同截止日期或均无截止日期按最新创建在前，再用 id 保持确定性。
 */
export function compareTodoViewItems(a: TodoViewItem, b: TodoViewItem): number {
  if (a.done !== b.done) return a.done ? 1 : -1;
  const da = a.todo.due_date;
  const db = b.todo.due_date;
  if (da !== db) {
    if (da === null) return 1;
    if (db === null) return -1;
    return da.localeCompare(db);
  }
  if (a.todo.created_at !== b.todo.created_at) {
    return b.todo.created_at - a.todo.created_at;
  }
  return a.todo.id.localeCompare(b.todo.id);
}

export function getDueLabel(
  dueDate: string | null,
  todayStr: string,
): { label: string | null; overdue: boolean } {
  if (!dueDate) return { label: null, overdue: false };
  const diff = diffDays(todayStr, dueDate);
  if (diff === 0) return { label: '截止 今天', overdue: false };
  if (diff > 0) return { label: `还剩 ${diff} 天`, overdue: false };
  return { label: `已过期 ${Math.abs(diff)} 天`, overdue: true };
}

/**
 * 计算待办已投入时长：
 * - 一次性待办：累加全部关联未删专注记录时长（含进行中）
 * - 重复待办：仅统计北京时间今日这一轮落在 todayStr 的时长（含进行中）
 */
export function computeTodoSpentMs(
  todo: TodoEntity,
  sessions: SessionEntity[],
  todayStr: string,
  nowMs: number,
): number {
  const isRecurring = parseTodoRecur(todo.recur) !== null;
  let total = 0;

  for (const s of sessions) {
    if (s.deleted_at !== null || s.todo_id !== todo.id) continue;
    if (!isRecurring) {
      const end = s.end_at ?? nowMs;
      if (end > s.start_at) total += end - s.start_at;
    } else {
      const segs = splitSessionByDay(s, nowMs);
      for (const seg of segs) {
        if (seg.date === todayStr) total += seg.durationMs;
      }
    }
  }

  return total;
}

export function getTodayTodos(
  todos: TodoEntity[],
  todoChecks: TodoCheckEntity[],
  sessions: SessionEntity[],
  todayStr: string,
  nowMs: number,
): { items: TodoViewItem[]; doneCount: number; totalCount: number } {
  const items: TodoViewItem[] = [];

  for (const todo of todos) {
    if (todo.deleted_at !== null) continue;
    const recur = parseTodoRecur(todo.recur);

    let include = false;
    let done = false;

    if (recur) {
      if (isTodoScheduledOn(todo, todayStr)) {
        include = true;
        done = isTodoDoneOn(todo, todayStr, todoChecks);
      }
    } else {
      if (todo.done_at !== null) {
        if (toShanghaiDateStr(todo.done_at) === todayStr) {
          include = true;
          done = true;
        }
      } else if (!todo.plan_date || todo.plan_date <= todayStr) {
        include = true;
        done = false;
      }
    }

    if (!include) continue;
    const due = getDueLabel(todo.due_date, todayStr);
    items.push({
      todo,
      done,
      isRecurring: recur !== null,
      recurLabel: formatRecurLabel(todo.recur),
      dueLabel: due.label,
      dueOverdue: due.overdue,
      spentMs: computeTodoSpentMs(todo, sessions, todayStr, nowMs),
    });
  }

  items.sort(compareTodoViewItems);

  const doneCount = items.filter((it) => it.done).length;
  return { items, doneCount, totalCount: items.length };
}

export function getAllPendingTodos(
  todos: TodoEntity[],
  todoChecks: TodoCheckEntity[],
  sessions: SessionEntity[],
  todayStr: string,
  nowMs: number,
): TodoViewItem[] {
  const items: TodoViewItem[] = [];

  for (const todo of todos) {
    if (todo.deleted_at !== null) continue;
    const recur = parseTodoRecur(todo.recur);
    if (!recur && todo.done_at !== null) continue;

    const done = recur ? isTodoDoneOn(todo, todayStr, todoChecks) : false;
    const due = getDueLabel(todo.due_date, todayStr);
    items.push({
      todo,
      done,
      isRecurring: recur !== null,
      recurLabel: formatRecurLabel(todo.recur),
      dueLabel: due.label,
      dueOverdue: due.overdue,
      spentMs: computeTodoSpentMs(todo, sessions, todayStr, nowMs),
    });
  }

  items.sort(compareTodoViewItems);

  return items;
}
