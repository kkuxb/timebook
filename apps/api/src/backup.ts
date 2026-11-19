import fs from 'node:fs';
import path from 'node:path';
import { getWeekday1To7, SHANGHAI_OFFSET_MS, toShanghaiDateStr } from '@timebook/core';
import type { DbContext } from './db/client.js';
import { exportDatabaseJson } from './import-export.js';

export interface BackupStatus {
  lastBackupAt: number | null;
  lastBackupFile: string | null;
  lastBackupDate: string | null;
}

export function getBackupStatus(ctx: DbContext): BackupStatus {
  const row = ctx.sqlite
    .prepare("SELECT value FROM settings WHERE key = 'backup_status'")
    .get() as { value: string } | undefined;
  if (!row) {
    return { lastBackupAt: null, lastBackupFile: null, lastBackupDate: null };
  }
  try {
    return JSON.parse(row.value) as BackupStatus;
  } catch {
    return { lastBackupAt: null, lastBackupFile: null, lastBackupDate: null };
  }
}

export async function runDailyBackup(
  ctx: DbContext,
  nowMs = Date.now(),
): Promise<{ sqlitePath: string; weeklyJsonPath: string | null }> {
  const backupsDir = path.join(ctx.dataDir, 'backups');
  fs.mkdirSync(backupsDir, { recursive: true });

  const dateStr = toShanghaiDateStr(nowMs);
  const sqliteFile = `timebook-${dateStr}.sqlite`;
  const sqlitePath = path.join(backupsDir, sqliteFile);

  await ctx.sqlite.backup(sqlitePath);

  // 保留最近 30 份日备
  const dailyFiles = fs
    .readdirSync(backupsDir)
    .filter((f) => /^timebook-\d{4}-\d{2}-\d{2}\.sqlite$/.test(f))
    .sort()
    .reverse();
  for (const oldFile of dailyFiles.slice(30)) {
    fs.rmSync(path.join(backupsDir, oldFile), { force: true });
  }

  let weeklyJsonPath: string | null = null;
  if (getWeekday1To7(dateStr) === 1) {
    const weeklyFile = `timebook-weekly-${dateStr}.json`;
    weeklyJsonPath = path.join(backupsDir, weeklyFile);
    const snapshot = exportDatabaseJson(ctx);
    fs.writeFileSync(weeklyJsonPath, JSON.stringify(snapshot, null, 2), 'utf8');

    const weeklyFiles = fs
      .readdirSync(backupsDir)
      .filter((f) => /^timebook-weekly-\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .sort()
      .reverse();
    for (const oldFile of weeklyFiles.slice(12)) {
      fs.rmSync(path.join(backupsDir, oldFile), { force: true });
    }
  }

  const status: BackupStatus = {
    lastBackupAt: nowMs,
    lastBackupFile: sqliteFile,
    lastBackupDate: dateStr,
  };
  ctx.sqlite
    .prepare(
      "INSERT INTO settings (key, value, updated_at) VALUES ('backup_status', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
    .run(JSON.stringify(status), nowMs);

  return { sqlitePath, weeklyJsonPath };
}

export function startBackupScheduler(ctx: DbContext): () => void {
  const check = () => {
    const nowMs = Date.now();
    const shanghaiHour = new Date(nowMs + SHANGHAI_OFFSET_MS).getUTCHours();
    if (shanghaiHour < 3) return;
    const todayStr = toShanghaiDateStr(nowMs);
    const status = getBackupStatus(ctx);
    const targetFile = path.join(ctx.dataDir, 'backups', `timebook-${todayStr}.sqlite`);
    if (status.lastBackupDate !== todayStr || !fs.existsSync(targetFile)) {
      runDailyBackup(ctx, nowMs).catch((err) => {
        console.error('[timebook] 自动备份失败:', err);
      });
    }
  };

  // 启动后延迟 5 秒检查一次，之后每小时检查一次
  const initTimer = setTimeout(check, 5000);
  const intervalTimer = setInterval(check, 60 * 60 * 1000);
  if (typeof initTimer.unref === 'function') initTimer.unref();
  if (typeof intervalTimer.unref === 'function') intervalTimer.unref();

  return () => {
    clearTimeout(initTimer);
    clearInterval(intervalTimer);
  };
}
