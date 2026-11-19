import { describe, expect, it } from 'vitest';
import {
  createDefaultModulesSeed,
  dedupeDuplicateModules,
  ensureSingleDefaultModulesSeed,
  planLocalToRemoteMerge,
  type MergeDataset,
} from '../src/merge.js';

describe('@timebook/core merge', () => {
  it('creates 4 default modules matching server seed order and colors', () => {
    const mods = createDefaultModulesSeed(1_700_000_000_000);
    expect(mods).toHaveLength(4);
    expect(mods.map((m) => [m.name, m.color_key, m.sort])).toEqual([
      ['工作', 'blue', 0],
      ['学习', 'violet', 1],
      ['游戏', 'teal', 2],
      ['锻炼', 'rose', 3],
    ]);
    expect(new Set(mods.map((m) => m.id)).size).toBe(4);
    expect(mods.every((m) => m.deleted_at === null)).toBe(true);
  });

  it('merges local data into fresh remote DB without duplicating default 4 modules', () => {
    const ts = 1_700_000_000_000;
    const localMods = createDefaultModulesSeed(ts);
    const remoteMods = createDefaultModulesSeed(ts + 5000);

    const localWork = localMods[0];
    const remoteWork = remoteMods[0];

    const local: MergeDataset = {
      modules: [
        ...localMods,
        {
          id: 'mod-local-read',
          name: '阅读',
          color_key: 'amber',
          sort: 4,
          created_at: ts + 10,
          updated_at: ts + 10,
          deleted_at: null,
        },
      ],
      tags: [
        {
          id: 'tag-local-a',
          module_id: localWork.id,
          name: '事项A',
          sort: 0,
          created_at: ts + 20,
          updated_at: ts + 20,
          deleted_at: null,
        },
        {
          id: 'tag-local-b',
          module_id: 'mod-local-read',
          name: '事项B',
          sort: 0,
          created_at: ts + 21,
          updated_at: ts + 21,
          deleted_at: null,
        },
      ],
      todos: [
        {
          id: 'todo-local-1',
          title: '整理周报',
          tag_id: 'tag-local-a',
          plan_date: '2026-11-19',
          due_date: null,
          recur: null,
          done_at: null,
          sort: 0,
          created_at: ts + 30,
          updated_at: ts + 30,
          deleted_at: null,
        },
      ],
      todoChecks: [],
      sessions: [
        {
          id: 'sess-done-1',
          tag_id: 'tag-local-a',
          todo_id: 'todo-local-1',
          title: '第一段',
          start_at: ts + 1000,
          end_at: ts + 1801000,
          source: 'timer',
          import_batch: null,
          created_at: ts + 1000,
          updated_at: ts + 1801000,
          deleted_at: null,
        },
        {
          id: 'sess-run-1',
          tag_id: 'tag-local-b',
          todo_id: null,
          title: '正在读',
          start_at: ts + 2000000,
          end_at: null,
          source: 'timer',
          import_batch: null,
          created_at: ts + 2000000,
          updated_at: ts + 2000000,
          deleted_at: null,
        },
      ],
    };

    const remote: MergeDataset = {
      modules: remoteMods,
      tags: [],
      todos: [],
      todoChecks: [],
      sessions: [],
    };

    const plan = planLocalToRemoteMerge(local, remote);

    // 默认四模块自动映射到远端 ID，只新增 1 个「阅读」模块，总数 4 + 1 = 5
    expect(plan.moduleIdMap[localWork.id]).toBe(remoteWork.id);
    expect(plan.remappedLocalState.modules.filter((m) => m.deleted_at === null)).toHaveLength(5);

    const modUps = plan.mutationsToPush.filter((m) => m.type === 'module.upsert');
    expect(modUps).toHaveLength(1);
    expect(modUps[0].payload).toMatchObject({ id: 'mod-local-read', name: '阅读' });

    const tagUps = plan.mutationsToPush.filter((m) => m.type === 'tag.upsert');
    expect(tagUps).toHaveLength(2);
    const tagAUp = tagUps.find((m) => m.payload.id === 'tag-local-a');
    expect(tagAUp?.payload.module_id).toBe(remoteWork.id);

    const sessUps = plan.mutationsToPush.filter((m) => m.type === 'session.upsert');
    expect(sessUps).toHaveLength(2);
    expect(sessUps.find((s) => s.payload.id === 'sess-run-1')?.payload.end_at).toBeNull();

    // 依赖顺序：modules -> tags -> todos -> sessions
    const typesOrder = plan.mutationsToPush.map((m) => m.type);
    expect(typesOrder).toEqual([
      'module.upsert',
      'tag.upsert',
      'tag.upsert',
      'todo.upsert',
      'session.upsert',
      'session.upsert',
    ]);
  });

  it('reuses existing remote tag of same name under mapped module and preserves duration & checks', () => {
    const ts = 1_700_000_000_000;
    const localMods = createDefaultModulesSeed(ts);
    const remoteMods = createDefaultModulesSeed(ts + 9000);

    const local: MergeDataset = {
      modules: localMods,
      tags: [
        {
          id: 'tag-local-dup',
          module_id: localMods[0].id,
          name: '核心研发',
          sort: 0,
          created_at: ts,
          updated_at: ts,
          deleted_at: null,
        },
      ],
      todos: [
        {
          id: 'todo-recur-1',
          title: '每日复盘',
          tag_id: 'tag-local-dup',
          plan_date: null,
          due_date: null,
          recur: JSON.stringify({ freq: 'daily' }),
          done_at: null,
          sort: 0,
          created_at: ts,
          updated_at: ts,
          deleted_at: null,
        },
      ],
      todoChecks: [
        {
          todo_id: 'todo-recur-1',
          date: '2026-11-19',
          done_at: ts + 500,
          updated_at: ts + 500,
          deleted_at: null,
        },
      ],
      sessions: [
        {
          id: 'sess-local-1',
          tag_id: 'tag-local-dup',
          todo_id: null,
          title: '编码',
          start_at: ts + 1000,
          end_at: ts + 3601000,
          source: 'manual',
          import_batch: null,
          created_at: ts + 1000,
          updated_at: ts + 3601000,
          deleted_at: null,
        },
      ],
    };

    const remote: MergeDataset = {
      modules: remoteMods,
      tags: [
        {
          id: 'tag-remote-existing',
          module_id: remoteMods[0].id,
          name: '核心研发',
          sort: 0,
          created_at: ts,
          updated_at: ts,
          deleted_at: null,
        },
      ],
      todos: [],
      todoChecks: [],
      sessions: [
        {
          id: 'sess-remote-old',
          tag_id: 'tag-remote-existing',
          todo_id: null,
          title: '历史工作',
          start_at: ts - 7200000,
          end_at: ts - 3600000,
          source: 'timer',
          import_batch: null,
          created_at: ts - 7200000,
          updated_at: ts - 3600000,
          deleted_at: null,
        },
      ],
    };

    const plan = planLocalToRemoteMerge(local, remote);
    expect(plan.tagIdMap['tag-local-dup']).toBe('tag-remote-existing');
    expect(plan.mutationsToPush.some((m) => m.type === 'tag.upsert')).toBe(false);

    const pushedSess = plan.mutationsToPush.find((m) => m.type === 'session.upsert');
    expect(pushedSess?.type === 'session.upsert' && pushedSess.payload.tag_id).toBe(
      'tag-remote-existing',
    );
    const pushedTodo = plan.mutationsToPush.find((m) => m.type === 'todo.upsert');
    expect(pushedTodo?.type === 'todo.upsert' && pushedTodo.payload.tag_id).toBe(
      'tag-remote-existing',
    );
    expect(plan.mutationsToPush.some((m) => m.type === 'todo_check.toggle')).toBe(true);
    expect(plan.remappedLocalState.sessions).toHaveLength(2);
  });

  it('prevents non-main windows from creating duplicate default module seeds on cold start', () => {
    const ts = 1_700_000_000_000;
    expect(ensureSingleDefaultModulesSeed([], 'widget', ts)).toBeNull();
    expect(ensureSingleDefaultModulesSeed([], 'launcher', ts)).toBeNull();

    const mainSeed = ensureSingleDefaultModulesSeed([], 'main', ts);
    expect(mainSeed).toHaveLength(4);
    expect(ensureSingleDefaultModulesSeed(mainSeed!, 'main', ts + 10)).toBeNull();
  });

  it('deduplicates 12 concurrently seeded default modules back to 4 and remaps tags', () => {
    const ts = 1_700_000_000_000;
    const batch1 = createDefaultModulesSeed(ts);
    const batch2 = createDefaultModulesSeed(ts + 100);
    const batch3 = createDefaultModulesSeed(ts + 200);

    const res = dedupeDuplicateModules(
      [...batch1, ...batch2, ...batch3],
      [
        {
          id: 'tag-on-dup',
          module_id: batch2[0].id,
          name: '核心编码',
          sort: 0,
          created_at: ts + 300,
          updated_at: ts + 300,
          deleted_at: null,
        },
      ],
    );

    expect(res.deduped).toBe(true);
    expect(res.modules).toHaveLength(4);
    expect(res.modules.map((m) => m.id)).toEqual(batch1.map((m) => m.id));
    expect(res.tags[0].module_id).toBe(batch1[0].id);

    // 幂等验证：已清洗的 4 模块再次运行 dedupeDuplicateModules 应不再变更
    const resAgain = dedupeDuplicateModules(res.modules, res.tags);
    expect(resAgain.deduped).toBe(false);
    expect(resAgain.modules).toHaveLength(4);
  });

  it('cleans up legacy 12 duplicate modules with tags spread across batches while preserving custom modules', () => {
    const ts = 1_700_000_000_000;
    const batch1 = createDefaultModulesSeed(ts);
    const batch2 = createDefaultModulesSeed(ts + 50);
    const batch3 = createDefaultModulesSeed(ts + 100);
    const customMod = {
      id: 'mod-custom-1',
      name: '阅读',
      color_key: 'amber' as const,
      sort: 4,
      created_at: ts + 200,
      updated_at: ts + 200,
      deleted_at: null,
    };

    const res = dedupeDuplicateModules(
      [...batch3, ...batch1, customMod, ...batch2],
      [
        {
          id: 't1',
          module_id: batch3[1].id, // 第3份「学习」
          name: '外语',
          sort: 0,
          created_at: ts + 300,
          updated_at: ts + 300,
          deleted_at: null,
        },
        {
          id: 't2',
          module_id: customMod.id,
          name: '精读',
          sort: 0,
          created_at: ts + 301,
          updated_at: ts + 301,
          deleted_at: null,
        },
      ],
    );

    expect(res.deduped).toBe(true);
    expect(res.modules.filter((m) => m.deleted_at === null)).toHaveLength(5);
    expect(res.tags.find((t) => t.id === 't1')?.module_id).toBe(batch1[1].id);
    expect(res.tags.find((t) => t.id === 't2')?.module_id).toBe(customMod.id);
  });
});
