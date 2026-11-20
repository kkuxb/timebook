import { z } from 'zod';

export const COLOR_KEY_SCHEMA = z.enum([
  'blue',
  'violet',
  'teal',
  'rose',
  'amber',
  'sky',
  'green',
  'pink',
]);

export const SESSION_SOURCE_SCHEMA = z.enum(['timer', 'manual', 'import']);

export const TODO_RECUR_SCHEMA = z.discriminatedUnion('freq', [
  z.object({ freq: z.literal('daily') }),
  z.object({ freq: z.literal('weekly'), days: z.array(z.number().int().min(1).max(7)).min(1) }),
  z.object({
    freq: z.literal('monthly'),
    monthDays: z.array(z.number().int().min(1).max(31)).min(1),
  }),
]);

export type TodoRecur = z.infer<typeof TODO_RECUR_SCHEMA>;

export const MODULE_SCHEMA = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  color_key: COLOR_KEY_SCHEMA,
  sort: z.number().int(),
  created_at: z.number().int(),
  updated_at: z.number().int(),
  deleted_at: z.number().int().nullable(),
});

export type ModuleEntity = z.infer<typeof MODULE_SCHEMA>;

export const TAG_SCHEMA = z.object({
  id: z.string().min(1),
  module_id: z.string().min(1),
  name: z.string().min(1),
  sort: z.number().int(),
  created_at: z.number().int(),
  updated_at: z.number().int(),
  deleted_at: z.number().int().nullable(),
  disabled_at: z.number().int().nullable().optional(),
});

export type TagEntity = z.infer<typeof TAG_SCHEMA>;

/**
 * 判断事项标签是否处于停用状态（兼容旧数据缺失 disabled_at 为 undefined 的情况）。
 */
export function isTagDisabled(
  tag: Pick<TagEntity, 'disabled_at'> | null | undefined,
): boolean {
  return typeof tag?.disabled_at === 'number';
}

export const SESSION_SCHEMA = z.object({
  id: z.string().min(1),
  tag_id: z.string().min(1).nullable(),
  todo_id: z.string().min(1).nullable(),
  title: z.string().nullable(),
  start_at: z.number().int(),
  end_at: z.number().int().nullable(),
  source: SESSION_SOURCE_SCHEMA,
  import_batch: z.string().min(1).nullable(),
  created_at: z.number().int(),
  updated_at: z.number().int(),
  deleted_at: z.number().int().nullable(),
});

export type SessionEntity = z.infer<typeof SESSION_SCHEMA>;

export const TODO_SCHEMA = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  tag_id: z.string().min(1).nullable(),
  plan_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  recur: z.string().nullable(),
  done_at: z.number().int().nullable(),
  import_batch: z.string().min(1).nullable().optional(),
  sort: z.number().int(),
  created_at: z.number().int(),
  updated_at: z.number().int(),
  deleted_at: z.number().int().nullable(),
});

export type TodoEntity = z.infer<typeof TODO_SCHEMA>;

export const TODO_CHECK_SCHEMA = z.object({
  todo_id: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  done_at: z.number().int(),
  updated_at: z.number().int(),
  deleted_at: z.number().int().nullable(),
});

export type TodoCheckEntity = z.infer<typeof TODO_CHECK_SCHEMA>;

export const MUTATION_ITEM_SCHEMA = z.discriminatedUnion('type', [
  z.object({
    mutation_id: z.string().min(1),
    type: z.literal('module.upsert'),
    payload: z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      color_key: COLOR_KEY_SCHEMA,
      sort: z.number().int().optional(),
      created_at: z.number().int().optional(),
    }),
  }),
  z.object({
    mutation_id: z.string().min(1),
    type: z.literal('module.delete'),
    payload: z.object({
      id: z.string().min(1),
      mode: z.enum(['move', 'drop']),
      targetModuleId: z.string().min(1).optional(),
    }),
  }),
  z.object({
    mutation_id: z.string().min(1),
    type: z.literal('tag.upsert'),
    payload: z.object({
      id: z.string().min(1),
      module_id: z.string().min(1),
      name: z.string().min(1),
      sort: z.number().int().optional(),
      created_at: z.number().int().optional(),
      disabled_at: z.number().int().nullable().optional(),
    }),
  }),
  z.object({
    mutation_id: z.string().min(1),
    type: z.literal('tag.delete'),
    payload: z.object({
      id: z.string().min(1),
      mode: z.enum(['move', 'drop']),
      targetTagId: z.string().min(1).optional(),
    }),
  }),
  z.object({
    mutation_id: z.string().min(1),
    type: z.literal('session.upsert'),
    payload: z.object({
      id: z.string().min(1),
      tag_id: z.string().min(1).nullable(),
      todo_id: z.string().min(1).nullable().optional(),
      title: z.string().nullable().optional(),
      start_at: z.number().int(),
      end_at: z.number().int().nullable(),
      source: SESSION_SOURCE_SCHEMA.optional(),
      import_batch: z.string().min(1).nullable().optional(),
      created_at: z.number().int().optional(),
    }),
  }),
  z.object({
    mutation_id: z.string().min(1),
    type: z.literal('session.cancel_running'),
    payload: z.object({
      id: z.string().min(1),
    }),
  }),
  z.object({
    mutation_id: z.string().min(1),
    type: z.literal('session.delete'),
    payload: z.object({
      id: z.string().min(1),
    }),
  }),
  z.object({
    mutation_id: z.string().min(1),
    type: z.literal('todo.upsert'),
    payload: z.object({
      id: z.string().min(1),
      title: z.string().min(1),
      tag_id: z.string().min(1).nullable(),
      plan_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
      due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
      recur: z.string().nullable(),
      done_at: z.number().int().nullable(),
      sort: z.number().int().optional(),
      created_at: z.number().int().optional(),
    }),
  }),
  z.object({
    mutation_id: z.string().min(1),
    type: z.literal('todo.delete'),
    payload: z.object({
      id: z.string().min(1),
    }),
  }),
  z.object({
    mutation_id: z.string().min(1),
    type: z.literal('todo_check.toggle'),
    payload: z.object({
      todo_id: z.string().min(1),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      done: z.boolean(),
      done_at: z.number().int().optional(),
    }),
  }),
]);

export type MutationItem = z.infer<typeof MUTATION_ITEM_SCHEMA>;

export const MUTATIONS_REQUEST_SCHEMA = z.object({
  mutations: z.array(MUTATION_ITEM_SCHEMA),
});

export interface SyncResponse {
  cursor: number;
  serverTime: number;
  modules: ModuleEntity[];
  tags: TagEntity[];
  sessions: SessionEntity[];
  todos: TodoEntity[];
  todoChecks: TodoCheckEntity[];
}

export type PeriodType = 'day' | 'week' | 'month' | 'year';
export type StatsDimension = 'mod' | 'tag';

export const MAX_SESSION_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_MIN_GAP_MINUTES = 20;
export const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
