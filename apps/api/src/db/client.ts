import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { DEFAULT_MODULE_SEEDS } from '@timebook/core';
import { ulid } from 'ulid';
import * as schema from './schema.js';

export interface DbContext {
  sqlite: Database.Database;
  db: BetterSQLite3Database<typeof schema>;
  dataDir: string;
  dbPath: string;
  nextCursor: () => number;
  getLastCursor: () => number;
  close: () => void;
}

const INIT_SQL = `
CREATE TABLE IF NOT EXISTS modules (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  color_key   TEXT NOT NULL,
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER
);

CREATE TABLE IF NOT EXISTS tags (
  id          TEXT PRIMARY KEY,
  module_id   TEXT NOT NULL,
  name        TEXT NOT NULL,
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS tags_module_name ON tags(module_id, name) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,
  tag_id       TEXT,
  todo_id      TEXT,
  title        TEXT,
  start_at     INTEGER NOT NULL,
  end_at       INTEGER,
  source       TEXT NOT NULL,
  import_batch TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  deleted_at   INTEGER
);
CREATE INDEX IF NOT EXISTS sessions_start ON sessions(start_at);
CREATE INDEX IF NOT EXISTS sessions_running ON sessions(end_at) WHERE end_at IS NULL;
CREATE INDEX IF NOT EXISTS sessions_batch ON sessions(import_batch) WHERE import_batch IS NOT NULL;

CREATE TABLE IF NOT EXISTS todos (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  tag_id       TEXT,
  plan_date    TEXT,
  due_date     TEXT,
  recur        TEXT,
  done_at      INTEGER,
  import_batch TEXT,
  sort         INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  deleted_at   INTEGER
);

CREATE TABLE IF NOT EXISTS todo_checks (
  todo_id     TEXT NOT NULL,
  date        TEXT NOT NULL,
  done_at     INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER,
  PRIMARY KEY (todo_id, date)
);

CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS heartbeat (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  at          INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS applied_mutations (
  mutation_id TEXT PRIMARY KEY,
  applied_at  INTEGER NOT NULL
);
`;

export function createDatabase(dataDirInput?: string): DbContext {
  const dataDir = path.resolve(dataDirInput || process.env.DATA_DIR || './workspace-data/dev-db');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(path.join(dataDir, 'backups'), { recursive: true });

  const dbPath = path.join(dataDir, 'timebook.sqlite');
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');

  sqlite.exec(INIT_SQL);

  // 升级兼容：存量数据库自动补齐 todos.import_batch 列并建索引
  const todoCols = sqlite.prepare('PRAGMA table_info(todos)').all() as Array<{ name: string }>;
  if (!todoCols.some((c) => c.name === 'import_batch')) {
    sqlite.exec('ALTER TABLE todos ADD COLUMN import_batch TEXT');
  }
  sqlite.exec(
    'CREATE INDEX IF NOT EXISTS todos_batch ON todos(import_batch) WHERE import_batch IS NOT NULL',
  );

  // 初始化游标为全表最大 updated_at
  const maxRow = sqlite
    .prepare(
      `SELECT MAX(ts) AS max_ts FROM (
        SELECT MAX(updated_at) AS ts FROM modules
        UNION ALL SELECT MAX(updated_at) AS ts FROM tags
        UNION ALL SELECT MAX(updated_at) AS ts FROM sessions
        UNION ALL SELECT MAX(updated_at) AS ts FROM todos
        UNION ALL SELECT MAX(updated_at) AS ts FROM todo_checks
      )`,
    )
    .get() as { max_ts: number | null } | undefined;

  let lastCursor = maxRow?.max_ts ?? 0;

  const nextCursor = (): number => {
    lastCursor = Math.max(Date.now(), lastCursor + 1);
    return lastCursor;
  };

  // 空数据库首次初始化时写入默认 4 个基础模块
  const countRow = sqlite.prepare('SELECT COUNT(*) AS cnt FROM modules').get() as { cnt: number };
  if (countRow.cnt === 0) {
    const insertMod = sqlite.prepare(
      'INSERT INTO modules (id, name, color_key, sort, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, NULL)',
    );
    const seedTx = sqlite.transaction(() => {
      for (const seed of DEFAULT_MODULE_SEEDS) {
        const ts = nextCursor();
        insertMod.run(ulid(), seed.name, seed.colorKey, seed.sort, ts, ts);
      }
    });
    seedTx();
  }

  const db = drizzle(sqlite, { schema });

  return {
    sqlite,
    db,
    dataDir,
    dbPath,
    nextCursor,
    getLastCursor: () => lastCursor,
    close: () => sqlite.close(),
  };
}
