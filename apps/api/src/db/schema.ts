import { check, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const modules = sqliteTable('modules', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  color_key: text('color_key').notNull(),
  sort: integer('sort').notNull().default(0),
  created_at: integer('created_at').notNull(),
  updated_at: integer('updated_at').notNull(),
  deleted_at: integer('deleted_at'),
});

export const tags = sqliteTable('tags', {
  id: text('id').primaryKey(),
  module_id: text('module_id').notNull(),
  name: text('name').notNull(),
  sort: integer('sort').notNull().default(0),
  created_at: integer('created_at').notNull(),
  updated_at: integer('updated_at').notNull(),
  deleted_at: integer('deleted_at'),
});

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  tag_id: text('tag_id'),
  todo_id: text('todo_id'),
  title: text('title'),
  start_at: integer('start_at').notNull(),
  end_at: integer('end_at'),
  source: text('source').notNull(),
  import_batch: text('import_batch'),
  created_at: integer('created_at').notNull(),
  updated_at: integer('updated_at').notNull(),
  deleted_at: integer('deleted_at'),
});

export const todos = sqliteTable('todos', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  tag_id: text('tag_id'),
  plan_date: text('plan_date'),
  due_date: text('due_date'),
  recur: text('recur'),
  done_at: integer('done_at'),
  import_batch: text('import_batch'),
  sort: integer('sort').notNull().default(0),
  created_at: integer('created_at').notNull(),
  updated_at: integer('updated_at').notNull(),
  deleted_at: integer('deleted_at'),
});

export const todoChecks = sqliteTable(
  'todo_checks',
  {
    todo_id: text('todo_id').notNull(),
    date: text('date').notNull(),
    done_at: integer('done_at').notNull(),
    updated_at: integer('updated_at').notNull(),
    deleted_at: integer('deleted_at'),
  },
  (t) => [primaryKey({ columns: [t.todo_id, t.date] })],
);

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updated_at: integer('updated_at').notNull(),
});

export const heartbeat = sqliteTable(
  'heartbeat',
  {
    id: integer('id').primaryKey(),
    at: integer('at').notNull(),
  },
  (t) => [check('heartbeat_id_one', sql`${t.id} = 1`)],
);

export const appliedMutations = sqliteTable('applied_mutations', {
  mutation_id: text('mutation_id').primaryKey(),
  applied_at: integer('applied_at').notNull(),
});
