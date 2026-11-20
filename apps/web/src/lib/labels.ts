import {
  getPaletteEntry,
  isTagDisabled,
  UNCLASSIFIED_STYLE,
  type ModuleEntity,
  type SessionEntity,
  type TagEntity,
} from '@timebook/core';

export interface TagLookup {
  activeModules: ModuleEntity[];
  allTags: TagEntity[];
  enabledTags: TagEntity[];
  disabledTags: TagEntity[];
  activeTags: TagEntity[];
  moduleById: Map<string, ModuleEntity>;
  tagById: Map<string, TagEntity>;
}

export function buildTagLookup(modules: ModuleEntity[], tags: TagEntity[]): TagLookup {
  const activeModules = modules
    .filter((m) => m.deleted_at === null)
    .sort((a, b) => a.sort - b.sort || a.created_at - b.created_at);
  const moduleById = new Map(activeModules.map((m) => [m.id, m]));
  const allTags = tags
    .filter((t) => t.deleted_at === null && moduleById.has(t.module_id))
    .sort((a, b) => a.sort - b.sort || a.created_at - b.created_at);
  const enabledTags = allTags.filter((t) => !isTagDisabled(t));
  const disabledTags = allTags.filter((t) => isTagDisabled(t));
  const tagById = new Map(allTags.map((t) => [t.id, t]));
  return {
    activeModules,
    allTags,
    enabledTags,
    disabledTags,
    activeTags: enabledTags,
    moduleById,
    tagById,
  };
}

export function getTagStyle(tagId: string | null | undefined, lookup: TagLookup) {
  const tag = tagId ? lookup.tagById.get(tagId) : undefined;
  const mod = tag ? lookup.moduleById.get(tag.module_id) : undefined;
  if (!tag || !mod) {
    return {
      tag: null,
      mod: null,
      tagName: '未分类',
      moduleName: '未分类',
      ...UNCLASSIFIED_STYLE,
    };
  }
  const pal = getPaletteEntry(mod.color_key);
  return {
    tag,
    mod,
    tagName: tag.name,
    moduleName: mod.name,
    color: pal.color,
    tint: pal.tint,
    ink: pal.ink,
    line: pal.line,
  };
}

/**
 * 记录展示标题统一格式：
 * - 若 title 非空且与事项标签名不同：显示「事项名 · title」（未分类时显示「未分类 · title」）
 * - 否则直接显示事项名（未分类显示「未分类」）
 */
export function formatSessionDisplayTitle(
  session: Pick<SessionEntity, 'tag_id' | 'title'>,
  lookup: TagLookup,
): string {
  const info = getTagStyle(session.tag_id, lookup);
  const rawTitle = session.title?.trim();
  if (rawTitle && (!info.tag || rawTitle !== info.tag.name)) {
    return `${info.tagName} · ${rawTitle}`;
  }
  return info.tagName;
}
