import { getPaletteEntry } from '@timebook/core';
import type { TagLookup } from '../lib/labels.js';

export interface ModuleTagGroupsProps {
  lookup: TagLookup;
  selectedTagId: string | null;
  onSelect: (tagId: string | null) => void;
  compact?: boolean;
  maxHeight?: number | string;
  testIdPrefix?: string;
}

/**
 * 共享时间标签分组选择组件：按一级模块分组展示所有启用中的二级事项标签。
 * 支持标准态与紧凑态、选中高亮以及再次点击已选标签取消选中。
 */
export function ModuleTagGroups({
  lookup,
  selectedTagId,
  onSelect,
  compact = false,
  maxHeight,
  testIdPrefix,
}: ModuleTagGroupsProps) {
  const groups = lookup.activeModules
    .map((mod) => ({
      mod,
      tags: lookup.enabledTags.filter((t) => t.module_id === mod.id),
    }))
    .filter((g) => g.tags.length > 0);

  if (groups.length === 0) {
    return (
      <div style={{ fontSize: 13, fontWeight: 600, color: '#9CA3AF', padding: '6px 0' }}>
        暂无可用时间标签，可留空直接记为「未分类」或前往「标签」页新建启用。
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: compact ? 9 : 12,
        ...(maxHeight !== undefined
          ? { maxHeight, overflowY: 'auto' as const, paddingRight: 2 }
          : {}),
      }}
    >
      {groups.map(({ mod, tags }) => {
        const pal = getPaletteEntry(mod.color_key);
        return (
          <div
            key={mod.id}
            style={{ display: 'flex', flexDirection: 'column', gap: compact ? 6 : 8 }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: compact ? 12 : 13,
                fontWeight: 800,
                color: '#6B7280',
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 3,
                  background: pal.color,
                  flex: 'none',
                }}
              />
              <span>{mod.name}</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: compact ? 7 : 8 }}>
              {tags.map((t) => {
                const active = selectedTagId === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    aria-pressed={active}
                    data-testid={testIdPrefix ? `${testIdPrefix}-${t.id}` : undefined}
                    onClick={() => onSelect(active ? null : t.id)}
                    className="tag-pill-btn"
                    style={{
                      height: compact ? 32 : 38,
                      padding: compact ? '0 12px' : '0 15px',
                      borderRadius: compact ? 10 : 12,
                      background: pal.tint,
                      color: pal.ink,
                      fontSize: compact ? 13 : 14,
                      boxShadow: active
                        ? 'inset 0 0 0 2px #111827'
                        : `inset 0 0 0 1px ${pal.line}`,
                    }}
                  >
                    <span
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: '50%',
                        background: pal.color,
                        flex: 'none',
                      }}
                    />
                    <span>{t.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
