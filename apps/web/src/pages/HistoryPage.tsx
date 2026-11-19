import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import {
  filterHistorySessions,
  formatDurationMs,
  formatMinutes,
  formatShanghaiTime,
  getPaletteEntry,
  getWeekdayLabel,
  hmToMinutes,
  shanghaiDateTimeToUtcMs,
  toShanghaiDateStr,
  type HistoryTagFilter,
  type HistoryTimePreset,
  type SessionEntity,
} from '@timebook/core';
import {
  SessionEditorModal,
  type SessionEditorInitial,
} from '../components/SessionEditorModal.js';
import { buildTagLookup, getTagStyle, type TagLookup } from '../lib/labels.js';
import { useAppStore } from '../store/useAppStore.js';

const PAGE_SIZE = 50;

const TIME_PRESETS: ReadonlyArray<{ key: HistoryTimePreset; label: string }> = [
  { key: 'all', label: '全部时间' },
  { key: 'today', label: '今日' },
  { key: 'yesterday', label: '昨日' },
  { key: 'this_week', label: '本周' },
  { key: 'last_week', label: '上周' },
  { key: 'this_month', label: '本月' },
  { key: 'last_month', label: '上月' },
  { key: 'custom', label: '自选范围' },
];

function encodeTagFilter(f: HistoryTagFilter): string {
  if (f.kind === 'all') return 'all';
  if (f.kind === 'unclassified') return 'unclassified';
  if (f.kind === 'module') return `module:${f.moduleId}`;
  return `tag:${f.tagId}`;
}

function decodeTagFilter(val: string): HistoryTagFilter {
  if (val === 'all') return { kind: 'all' };
  if (val === 'unclassified') return { kind: 'unclassified' };
  if (val.startsWith('module:')) return { kind: 'module', moduleId: val.slice(7) };
  if (val.startsWith('tag:')) return { kind: 'tag', tagId: val.slice(4) };
  return { kind: 'all' };
}

interface TagHierarchyPopoverProps {
  lookup: TagLookup;
  currentTagId?: string | null;
  unclassifiedLabel: string;
  onSelect: (tagId: string | null) => void;
  testId?: string;
}

function TagHierarchyMenu({
  lookup,
  currentTagId,
  unclassifiedLabel,
  onSelect,
  testId,
}: TagHierarchyPopoverProps) {
  return (
    <div
      data-testid={testId}
      role="listbox"
      aria-label="选择标签"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        maxHeight: 280,
        overflowY: 'auto',
      }}
    >
      <button
        type="button"
        onClick={() => onSelect(null)}
        data-testid="tag-menu-unclassified"
        className="btn"
        style={{
          justifyContent: 'flex-start',
          height: 32,
          padding: '0 10px',
          borderRadius: 9,
          fontSize: 12,
          background: currentTagId === null ? '#F2F3F7' : '#FFFFFF',
          boxShadow: currentTagId === null ? 'inset 0 0 0 1.5px #111827' : 'inset 0 0 0 1px #E8EAF1',
          color: '#4B5263',
        }}
      >
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#B8BDC9' }} />
        {unclassifiedLabel}
      </button>

      {lookup.activeModules.map((mod) => {
        const pal = getPaletteEntry(mod.color_key);
        const mTags = lookup.activeTags.filter((t) => t.module_id === mod.id);
        if (mTags.length === 0) return null;
        return (
          <div key={mod.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#9CA3AF', paddingLeft: 2 }}>
              {mod.name}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {mTags.map((t) => {
                const selected = currentTagId === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => onSelect(t.id)}
                    data-testid={`tag-menu-item-${t.id}`}
                    className="btn"
                    style={{
                      height: 30,
                      padding: '0 10px',
                      borderRadius: 999,
                      fontSize: 12,
                      background: pal.tint,
                      color: pal.ink,
                      boxShadow: selected ? `inset 0 0 0 1.5px ${pal.color}` : 'none',
                    }}
                  >
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: pal.color }} />
                    {t.name}
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

export function HistoryPage() {
  const modules = useAppStore((s) => s.modules);
  const tags = useAppStore((s) => s.tags);
  const sessions = useAppStore((s) => s.sessions);
  const nowMs = useAppStore((s) => s.nowMs);
  const updateSession = useAppStore((s) => s.updateSession);
  const deleteSession = useAppStore((s) => s.deleteSession);
  const batchUpdateSessions = useAppStore((s) => s.batchUpdateSessions);
  const batchDeleteSessions = useAppStore((s) => s.batchDeleteSessions);

  const todayStr = toShanghaiDateStr(nowMs());
  const lookup = useMemo(() => buildTagLookup(modules, tags), [modules, tags]);

  // 筛选与搜索状态
  const [preset, setPreset] = useState<HistoryTimePreset>('all');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [tagFilter, setTagFilter] = useState<HistoryTagFilter>({ kind: 'all' });
  const [query, setQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // 新建弹窗
  const [newEditor, setNewEditor] = useState<SessionEditorInitial | null>(null);

  // 行内直改态
  const [inlineTagRowId, setInlineTagRowId] = useState<string | null>(null);
  const [editingTitleRowId, setEditingTitleRowId] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState('');
  const titleCommittedRef = useRef(false);

  const [editingTimeRowId, setEditingTimeRowId] = useState<string | null>(null);
  const [timeDateDraft, setTimeDateDraft] = useState('');
  const [timeStartDraft, setTimeStartDraft] = useState('');
  const [timeEndDraft, setTimeEndDraft] = useState('');

  // 多选与批量操作态
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const lastClickedIndexRef = useRef<number | null>(null);
  const [batchMenu, setBatchMenu] = useState<'none' | 'tag' | 'title' | 'delete'>('none');
  const [batchTitleDraft, setBatchTitleDraft] = useState('');
  const [batchBusy, setBatchBusy] = useState(false);

  const popoverHostRef = useRef<HTMLDivElement | null>(null);

  const filterResult = useMemo(
    () =>
      filterHistorySessions(sessions, tags, modules, {
        preset,
        todayStr,
        customStart,
        customEnd,
        tagFilter,
        query,
      }),
    [sessions, tags, modules, preset, todayStr, customStart, customEnd, tagFilter, query],
  );

  const visibleItems = useMemo(
    () => filterResult.items.slice(0, visibleCount),
    [filterResult.items, visibleCount],
  );

  // 筛选条件变化时重置分页，并移除不再命中的选中 ID
  const filterKey = `${preset}|${customStart}|${customEnd}|${encodeTagFilter(tagFilter)}|${query}`;
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
    lastClickedIndexRef.current = null;
  }, [filterKey]);

  useEffect(() => {
    if (selectedIds.size === 0) return;
    const validSet = new Set(filterResult.items.map((x) => x.id));
    let changed = false;
    const next = new Set<string>();
    for (const id of selectedIds) {
      if (validSet.has(id)) {
        next.add(id);
      } else {
        changed = true;
      }
    }
    if (changed) {
      setSelectedIds(next);
    }
  }, [filterResult.items]);

  // 点击外部或按 Esc 自动关闭标签/批量浮层
  useEffect(() => {
    if (!inlineTagRowId && batchMenu === 'none') return;
    const onMouseDown = (e: globalThis.MouseEvent) => {
      const target = e.target as Node | null;
      if (target && popoverHostRef.current && popoverHostRef.current.contains(target)) {
        return;
      }
      if (target && (target as HTMLElement).closest?.('[data-history-popover="1"]')) {
        return;
      }
      setInlineTagRowId(null);
      setBatchMenu('none');
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setInlineTagRowId(null);
        setBatchMenu('none');
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [inlineTagRowId, batchMenu]);

  const hasActiveFilters =
    preset !== 'all' || tagFilter.kind !== 'all' || query.trim() !== '';

  const resetFilters = () => {
    setPreset('all');
    setCustomStart('');
    setCustomEnd('');
    setTagFilter({ kind: 'all' });
    setQuery('');
  };

  const allPageSelected =
    visibleItems.length > 0 && visibleItems.every((s) => selectedIds.has(s.id));
  const allFilteredSelected =
    filterResult.totalCount > 0 && filterResult.items.every((s) => selectedIds.has(s.id));

  const toggleSelectRow = (rowIndex: number, id: string, e: MouseEvent<HTMLInputElement>) => {
    const next = new Set(selectedIds);
    const shouldCheck = !next.has(id);

    if (e.shiftKey && lastClickedIndexRef.current !== null) {
      const start = Math.min(lastClickedIndexRef.current, rowIndex);
      const end = Math.max(lastClickedIndexRef.current, rowIndex);
      for (let i = start; i <= end; i += 1) {
        const item = visibleItems[i];
        if (!item) continue;
        if (shouldCheck) next.add(item.id);
        else next.delete(item.id);
      }
    } else if (shouldCheck) {
      next.add(id);
    } else {
      next.delete(id);
    }

    lastClickedIndexRef.current = rowIndex;
    setSelectedIds(next);
  };

  const toggleSelectPage = () => {
    const next = new Set(selectedIds);
    if (allPageSelected) {
      for (const item of visibleItems) next.delete(item.id);
    } else {
      for (const item of visibleItems) next.add(item.id);
    }
    setSelectedIds(next);
  };

  const selectAllFiltered = () => {
    setSelectedIds(new Set(filterResult.items.map((x) => x.id)));
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
    setBatchMenu('none');
  };

  const beginEditTitle = (s: SessionEntity) => {
    setInlineTagRowId(null);
    setEditingTimeRowId(null);
    setEditingTitleRowId(s.id);
    setTitleDraft(s.title ?? '');
    titleCommittedRef.current = false;
  };

  const commitTitleEdit = async (s: SessionEntity) => {
    if (titleCommittedRef.current) return;
    titleCommittedRef.current = true;
    setEditingTitleRowId(null);
    const nextTitle = titleDraft.trim() || null;
    const prevTitle = s.title?.trim() || null;
    if (nextTitle !== prevTitle) {
      await updateSession({ ...s, title: nextTitle });
    }
  };

  const cancelTitleEdit = () => {
    titleCommittedRef.current = true;
    setEditingTitleRowId(null);
  };

  const beginEditTime = (s: SessionEntity) => {
    setInlineTagRowId(null);
    setEditingTitleRowId(null);
    setEditingTimeRowId(s.id);
    setTimeDateDraft(toShanghaiDateStr(s.start_at));
    setTimeStartDraft(formatShanghaiTime(s.start_at));
    setTimeEndDraft(formatShanghaiTime(s.end_at!));
  };

  const timeDraftValidation = (() => {
    const sm = hmToMinutes(timeStartDraft);
    const em = hmToMinutes(timeEndDraft);
    const isCrossDay = sm !== null && em !== null && em < sm;
    const durationMin =
      sm !== null && em !== null && em !== sm ? (em > sm ? em - sm : em + 1440 - sm) : 0;
    const valid = !!timeDateDraft && sm !== null && em !== null && durationMin > 0 && durationMin <= 1440;
    return { sm, em, isCrossDay, durationMin, valid };
  })();

  const commitTimeEdit = async (s: SessionEntity) => {
    const { sm, em, valid } = timeDraftValidation;
    if (!valid || sm === null || em === null) return;
    const startAt = shanghaiDateTimeToUtcMs(timeDateDraft, sm);
    const endAt = shanghaiDateTimeToUtcMs(timeDateDraft, em > sm ? em : em + 1440);
    setEditingTimeRowId(null);
    if (startAt !== s.start_at || endAt !== s.end_at) {
      await updateSession({ ...s, start_at: startAt, end_at: endAt });
    }
  };

  const handleBatchTag = async (tagId: string | null) => {
    if (selectedIds.size === 0 || batchBusy) return;
    setBatchBusy(true);
    try {
      await batchUpdateSessions(Array.from(selectedIds), { tag_id: tagId });
      setBatchMenu('none');
    } finally {
      setBatchBusy(false);
    }
  };

  const handleBatchTitle = async (newTitle: string | null) => {
    if (selectedIds.size === 0 || batchBusy) return;
    setBatchBusy(true);
    try {
      await batchUpdateSessions(Array.from(selectedIds), { title: newTitle });
      setBatchMenu('none');
      setBatchTitleDraft('');
    } finally {
      setBatchBusy(false);
    }
  };

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0 || batchBusy) return;
    setBatchBusy(true);
    try {
      await batchDeleteSessions(Array.from(selectedIds));
      clearSelection();
    } finally {
      setBatchBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, paddingBottom: selectedIds.size > 0 ? 88 : 0 }}>
      {/* 页头区 */}
      <section
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 14,
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
          <h1 style={{ margin: 0, fontSize: 34, lineHeight: 1.15, fontWeight: 800, letterSpacing: '-0.02em' }}>
            历史
          </h1>
          <span className="count tnum" data-testid="history-summary">
            共 {filterResult.totalCount.toLocaleString('en-US')} 条 · 合计{' '}
            {formatDurationMs(filterResult.totalDurationMs)}
          </span>
        </div>

        <button
          type="button"
          data-testid="history-add-btn"
          onClick={() =>
            setNewEditor({
              mode: 'new',
              date: todayStr,
              startHm: '',
              endHm: '',
              tagId: null,
              title: '',
            })
          }
          className="btn primary"
          style={{ height: 44, padding: '0 20px', borderRadius: 12, fontSize: 14 }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          新增记录
        </button>
      </section>

      {/* 筛选与搜索工具卡 */}
      <section className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 4,
              background: '#F2F3F7',
              padding: 4,
              borderRadius: 12,
            }}
            role="group"
            aria-label="时间范围筛选"
          >
            {TIME_PRESETS.map((p) => {
              const active = preset === p.key;
              return (
                <button
                  key={p.key}
                  type="button"
                  data-testid={`history-preset-${p.key}`}
                  aria-pressed={active}
                  onClick={() => setPreset(p.key)}
                  className="btn"
                  style={{
                    height: 32,
                    padding: '0 12px',
                    borderRadius: 9,
                    fontSize: 13,
                    background: active ? '#111827' : 'transparent',
                    color: active ? '#FFFFFF' : '#4B5263',
                  }}
                >
                  {p.label}
                </button>
              );
            })}
          </div>

          {preset === 'custom' && (
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
              <input
                type="date"
                aria-label="开始日期"
                data-testid="history-custom-start"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="tin"
                style={{ height: 38, width: 152, fontSize: 13 }}
              />
              <span style={{ fontSize: 13, fontWeight: 700, color: '#6B7280' }}>至</span>
              <input
                type="date"
                aria-label="结束日期"
                data-testid="history-custom-end"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="tin"
                style={{ height: 38, width: 152, fontSize: 13 }}
              />
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
          <select
            aria-label="按标签筛选"
            data-testid="history-tag-filter"
            value={encodeTagFilter(tagFilter)}
            onChange={(e) => setTagFilter(decodeTagFilter(e.target.value))}
            className="tin"
            style={{ width: 210, maxWidth: '100%', height: 40, fontSize: 13 }}
          >
            <option value="all">全部标签</option>
            <option value="unclassified">未分类</option>
            {lookup.activeModules.map((mod) => {
              const mTags = lookup.activeTags.filter((t) => t.module_id === mod.id);
              return (
                <optgroup key={mod.id} label={mod.name}>
                  <option value={`module:${mod.id}`}>模块：{mod.name}（全部）</option>
                  {mTags.map((t) => (
                    <option key={t.id} value={`tag:${t.id}`}>
                      · {t.name}
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </select>

          <div style={{ position: 'relative', flex: '1 1 240px', minWidth: 0 }}>
            <input
              type="text"
              aria-label="搜索历史记录"
              data-testid="history-search-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索标题、事项或模块…"
              className="tin"
              style={{ height: 40, fontSize: 13, paddingRight: query ? 36 : 14 }}
            />
            {query && (
              <button
                type="button"
                aria-label="清空搜索"
                data-testid="history-search-clear"
                onClick={() => setQuery('')}
                className="btn tiny"
                style={{
                  position: 'absolute',
                  right: 6,
                  top: 4,
                  width: 30,
                  height: 30,
                  fontSize: 12,
                }}
              >
                ✕
              </button>
            )}
          </div>

          {hasActiveFilters && (
            <button
              type="button"
              data-testid="history-reset-btn"
              onClick={resetFilters}
              className="btn ghost"
              style={{ height: 40, padding: '0 14px', borderRadius: 10, fontSize: 13 }}
            >
              重置筛选
            </button>
          )}
        </div>
      </section>

      {/* 列表卡 */}
      <section className="card" style={{ display: 'flex', flexDirection: 'column' }}>
        {/* 表头 */}
        <div className="tb-history-head">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <input
              type="checkbox"
              aria-label="全选本页"
              data-testid="history-select-page"
              checked={allPageSelected}
              disabled={visibleItems.length === 0}
              onChange={toggleSelectPage}
            />
          </div>
          <span>日期</span>
          <span>标签</span>
          <span>内容（点击直改）</span>
          <span>起止时间</span>
          <span style={{ textAlign: 'right' }}>时长</span>
          <span style={{ textAlign: 'right' }}>操作</span>
        </div>

        {/* 手机端快捷全选行 */}
        {visibleItems.length > 0 && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
              padding: '8px 16px',
              background: '#F9FAFC',
              borderBottom: '1px solid #EEF0F5',
              fontSize: 12,
              fontWeight: 700,
              color: '#4B5263',
            }}
          >
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={allPageSelected}
                onChange={toggleSelectPage}
              />
              <span>全选当前已加载的 {visibleItems.length} 条</span>
            </label>
            {selectedIds.size > 0 && (
              <span className="tnum" style={{ color: '#111827' }}>
                已选 {selectedIds.size} 条
              </span>
            )}
          </div>
        )}

        {/* 跨页全选横幅 */}
        {filterResult.totalCount > visibleItems.length && allPageSelected && (
          <div
            data-testid="history-select-all-banner"
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              padding: '9px 16px',
              background: '#FFFBEB',
              borderBottom: '1px solid #FDE68A',
              fontSize: 13,
              fontWeight: 700,
              color: '#111827',
            }}
          >
            {!allFilteredSelected ? (
              <>
                <span>已勾选当前展示的 {visibleItems.length} 条记录 ·</span>
                <button
                  type="button"
                  data-testid="history-select-all-filtered"
                  onClick={selectAllFiltered}
                  className="btn"
                  style={{
                    height: 28,
                    padding: '0 10px',
                    borderRadius: 8,
                    background: '#111827',
                    color: '#FFFFFF',
                    fontSize: 12,
                  }}
                >
                  全选筛选出的全部 {filterResult.totalCount.toLocaleString('en-US')} 条记录
                </button>
              </>
            ) : (
              <>
                <span>
                  已全选当前筛选出的全部 {filterResult.totalCount.toLocaleString('en-US')} 条记录 ·
                </span>
                <button
                  type="button"
                  onClick={clearSelection}
                  className="btn ghost"
                  style={{ height: 28, padding: '0 10px', borderRadius: 8, fontSize: 12 }}
                >
                  取消全选
                </button>
              </>
            )}
          </div>
        )}

        {/* 数据行 */}
        {visibleItems.length === 0 ? (
          <div
            data-testid="history-empty"
            style={{
              padding: '44px 20px',
              textAlign: 'center',
              fontSize: 14,
              fontWeight: 600,
              color: '#6B7280',
            }}
          >
            {hasActiveFilters
              ? '当前筛选条件下没有找到专注记录，试试调整时间范围或清空搜索词。'
              : '还没有已结束的专注记录，点右上角「新增记录」即可补记。'}
          </div>
        ) : (
          <div>
            {visibleItems.map((s, idx) => {
              const startDate = toShanghaiDateStr(s.start_at);
              const endDate = toShanghaiDateStr(s.end_at!);
              const crossDay = endDate !== startDate;
              const st = getTagStyle(s.tag_id, lookup);
              const isSelected = selectedIds.has(s.id);
              const isEditingTag = inlineTagRowId === s.id;
              const isEditingTitle = editingTitleRowId === s.id;
              const isEditingTime = editingTimeRowId === s.id;
              const durationMs = Math.max(0, s.end_at! - s.start_at);

              return (
                <div
                  key={s.id}
                  data-testid={`history-row-${s.id}`}
                  className={`tb-history-row${isSelected ? ' is-selected' : ''}`}
                >
                  {/* 复选框 */}
                  <div className="tb-h-chk" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <input
                      type="checkbox"
                      aria-label={`选择记录 ${startDate} ${st.tagName}`}
                      data-testid={`history-row-check-${s.id}`}
                      checked={isSelected}
                      onClick={(e) => toggleSelectRow(idx, s.id, e)}
                      onChange={() => undefined}
                    />
                  </div>

                  {/* 日期与星期 */}
                  <button
                    type="button"
                    onClick={() => beginEditTime(s)}
                    title="点击修改日期与时间"
                    className="tb-h-date tnum"
                    style={{
                      border: 0,
                      padding: 0,
                      background: 'transparent',
                      textAlign: 'left',
                      fontSize: 13,
                      fontWeight: 700,
                      color: '#4B5263',
                    }}
                  >
                    {startDate} {getWeekdayLabel(startDate)}
                  </button>

                  {/* 标签胶囊 + 行内浮层 */}
                  <div className="tb-h-tag" style={{ position: 'relative' }}>
                    <button
                      type="button"
                      data-testid={`history-row-tag-${s.id}`}
                      onClick={() => {
                        setEditingTitleRowId(null);
                        setEditingTimeRowId(null);
                        setInlineTagRowId(isEditingTag ? null : s.id);
                      }}
                      className="chip"
                      title="点击直改标签"
                      style={{
                        background: st.tint,
                        color: st.ink,
                        border: `1px solid ${st.line}`,
                        maxWidth: '100%',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      <span
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: '50%',
                          background: st.color,
                          flex: 'none',
                        }}
                      />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {st.tag ? `${st.moduleName} · ${st.tagName}` : '未分类'}
                      </span>
                    </button>

                    {isEditingTag && (
                      <div
                        data-history-popover="1"
                        className="card"
                        style={{
                          position: 'absolute',
                          top: 'calc(100% + 6px)',
                          left: 0,
                          width: 280,
                          maxWidth: '82vw',
                          padding: 12,
                          zIndex: 25,
                          boxShadow: '0 16px 36px -8px rgba(17, 24, 39, 0.24)',
                        }}
                      >
                        <TagHierarchyMenu
                          lookup={lookup}
                          currentTagId={s.tag_id}
                          unclassifiedLabel="设为未分类"
                          testId="history-inline-tag-popover"
                          onSelect={(tagId) => {
                            setInlineTagRowId(null);
                            if (tagId !== s.tag_id) {
                              void updateSession({ ...s, tag_id: tagId });
                            }
                          }}
                        />
                      </div>
                    )}
                  </div>

                  {/* 标题内容 */}
                  <div className="tb-h-title" style={{ minWidth: 0 }}>
                    {isEditingTitle ? (
                      <input
                        autoFocus
                        type="text"
                        data-testid="history-inline-title-input"
                        value={titleDraft}
                        onChange={(e) => setTitleDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                            e.preventDefault();
                            void commitTitleEdit(s);
                          } else if (e.key === 'Escape') {
                            e.preventDefault();
                            cancelTitleEdit();
                          }
                        }}
                        onBlur={() => void commitTitleEdit(s)}
                        placeholder="填写具体内容，留空保存则清空独立标题"
                        className="tin"
                        style={{ height: 34, fontSize: 13 }}
                      />
                    ) : (
                      <button
                        type="button"
                        data-testid={`history-row-title-${s.id}`}
                        onClick={() => beginEditTitle(s)}
                        title="点击填写或修改具体内容"
                        style={{
                          width: '100%',
                          border: 0,
                          padding: '4px 6px',
                          margin: '-4px -6px',
                          borderRadius: 8,
                          background: 'transparent',
                          textAlign: 'left',
                          fontSize: 14,
                          fontWeight: s.title?.trim() ? 700 : 600,
                          color: s.title?.trim() ? '#111827' : '#9CA3AF',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {s.title?.trim() ? s.title : `${st.tagName} · 点击填写具体内容`}
                      </button>
                    )}
                  </div>

                  {/* 起止时间（或行内编辑组） */}
                  <div className="tb-h-time" style={{ position: 'relative' }}>
                    {isEditingTime ? (
                      <div
                        data-testid="history-inline-time-editor"
                        className="card"
                        style={{
                          position: 'relative',
                          padding: 10,
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 6,
                          background: '#FFFFFF',
                          zIndex: 10,
                        }}
                      >
                        <input
                          type="date"
                          aria-label="修改日期"
                          data-testid="inline-time-date"
                          value={timeDateDraft}
                          onChange={(e) => setTimeDateDraft(e.target.value)}
                          className="tin"
                          style={{ height: 32, fontSize: 12, padding: '0 8px' }}
                        />
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <input
                            type="time"
                            aria-label="修改开始时间"
                            data-testid="inline-time-start"
                            value={timeStartDraft}
                            onChange={(e) => setTimeStartDraft(e.target.value)}
                            className="tin"
                            style={{ height: 32, fontSize: 12, padding: '0 6px' }}
                          />
                          <span style={{ fontSize: 12, color: '#9CA3AF' }}>–</span>
                          <input
                            type="time"
                            aria-label="修改结束时间"
                            data-testid="inline-time-end"
                            value={timeEndDraft}
                            onChange={(e) => setTimeEndDraft(e.target.value)}
                            className="tin"
                            style={{ height: 32, fontSize: 12, padding: '0 6px' }}
                          />
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                          <span className="tnum" style={{ fontSize: 11, fontWeight: 700, color: timeDraftValidation.valid ? '#6B7280' : '#C8203E' }}>
                            {timeDraftValidation.valid
                              ? `${timeDraftValidation.isCrossDay ? '次日 · ' : ''}${formatMinutes(timeDraftValidation.durationMin)}`
                              : '时间无效'}
                          </span>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button
                              type="button"
                              onClick={() => setEditingTimeRowId(null)}
                              className="btn ghost"
                              style={{ height: 26, padding: '0 8px', borderRadius: 7, fontSize: 11 }}
                            >
                              取消
                            </button>
                            <button
                              type="button"
                              disabled={!timeDraftValidation.valid}
                              data-testid="inline-time-save"
                              onClick={() => void commitTimeEdit(s)}
                              className="btn primary"
                              style={{ height: 26, padding: '0 10px', borderRadius: 7, fontSize: 11 }}
                            >
                              保存
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        data-testid={`history-row-time-${s.id}`}
                        onClick={() => beginEditTime(s)}
                        title="点击行内修改日期与起止时间"
                        className="tnum"
                        style={{
                          border: 0,
                          padding: '4px 6px',
                          margin: '-4px -6px',
                          borderRadius: 8,
                          background: 'transparent',
                          textAlign: 'left',
                          fontSize: 13,
                          fontWeight: 700,
                          color: '#4B5263',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {formatShanghaiTime(s.start_at)} – {formatShanghaiTime(s.end_at!)}
                        {crossDay && (
                          <span
                            style={{
                              marginLeft: 4,
                              fontSize: 11,
                              fontWeight: 800,
                              color: '#9A3A0A',
                              background: '#FFF7F1',
                              padding: '1px 5px',
                              borderRadius: 6,
                            }}
                          >
                            +1天
                          </span>
                        )}
                      </button>
                    )}
                  </div>

                  {/* 时长 */}
                  <div
                    className="tb-h-dur tnum"
                    style={{
                      fontSize: 14,
                      fontWeight: 800,
                      color: '#111827',
                      textAlign: 'right',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {formatDurationMs(durationMs)}
                  </div>

                  {/* 单行删除 */}
                  <div className="tb-h-act" style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      aria-label="删除记录"
                      title="删除记录（可在回收站恢复）"
                      data-testid={`history-row-delete-${s.id}`}
                      onClick={() => {
                        if (selectedIds.has(s.id)) {
                          const next = new Set(selectedIds);
                          next.delete(s.id);
                          setSelectedIds(next);
                        }
                        void deleteSession(s.id);
                      }}
                      className="btn tiny del"
                    >
                      <svg
                        width="15"
                        height="15"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.1"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M3 6h18" />
                        <path d="M8 6V4h8v2" />
                        <path d="M19 6l-1 14H6L5 6" />
                      </svg>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* 分页底栏 */}
        {filterResult.totalCount > 0 && (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
              padding: '12px 16px',
              borderTop: '1px solid #EEF0F5',
            }}
          >
            <span className="tnum" style={{ fontSize: 13, fontWeight: 700, color: '#6B7280' }}>
              已显示 {visibleItems.length.toLocaleString('en-US')} / 共{' '}
              {filterResult.totalCount.toLocaleString('en-US')} 条
            </span>

            {visibleItems.length < filterResult.totalCount && (
              <button
                type="button"
                data-testid="history-load-more"
                onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                className="btn soft"
                style={{ height: 36, padding: '0 16px', borderRadius: 10, fontSize: 13 }}
              >
                加载更多（+50 条）
              </button>
            )}
          </div>
        )}
      </section>

      {/* 底部悬浮批量操作栏 */}
      {selectedIds.size > 0 && (
        <div
          ref={popoverHostRef}
          data-history-popover="1"
          data-testid="history-batch-bar"
          className="tb-history-batch-bar"
          style={{
            background: '#111827',
            color: '#FFFFFF',
            borderRadius: 18,
            padding: '12px 16px',
            boxShadow: '0 18px 40px -10px rgba(17, 24, 39, 0.45)',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          {/* 批量弹出子面板 */}
          {batchMenu === 'tag' && (
            <div
              data-testid="batch-tag-popover"
              className="card"
              style={{
                padding: 14,
                color: '#111827',
                background: '#FFFFFF',
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 10 }}>
                将选中的 {selectedIds.size} 条记录统一改为：
              </div>
              <TagHierarchyMenu
                lookup={lookup}
                unclassifiedLabel="设为未分类"
                testId="batch-tag-menu"
                onSelect={(tagId) => void handleBatchTag(tagId)}
              />
            </div>
          )}

          {batchMenu === 'title' && (
            <div
              data-testid="batch-title-popover"
              className="card"
              style={{
                padding: 14,
                color: '#111827',
                background: '#FFFFFF',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 800 }}>
                批量修改选中 {selectedIds.size} 条记录的独立标题
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <input
                  autoFocus
                  type="text"
                  data-testid="batch-title-input"
                  value={batchTitleDraft}
                  onChange={(e) => setBatchTitleDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      void handleBatchTitle(batchTitleDraft.trim() || null);
                    }
                  }}
                  placeholder="输入新的标题内容（留空点应用则清空）"
                  className="tin"
                  style={{ flex: '1 1 200px', height: 38, fontSize: 13 }}
                />
                <button
                  type="button"
                  disabled={batchBusy}
                  data-testid="batch-title-apply"
                  onClick={() => void handleBatchTitle(batchTitleDraft.trim() || null)}
                  className="btn primary"
                  style={{ height: 38, padding: '0 14px', borderRadius: 10, fontSize: 13 }}
                >
                  应用修改
                </button>
                <button
                  type="button"
                  disabled={batchBusy}
                  data-testid="batch-title-clear"
                  onClick={() => void handleBatchTitle(null)}
                  className="btn soft"
                  style={{ height: 38, padding: '0 14px', borderRadius: 10, fontSize: 13 }}
                >
                  清空独立标题
                </button>
              </div>
            </div>
          )}

          {batchMenu === 'delete' && (
            <div
              data-testid="batch-delete-confirm-box"
              style={{
                background: 'rgba(255, 255, 255, 0.08)',
                borderRadius: 12,
                padding: '10px 12px',
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 10,
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 700, color: '#FDE68A' }}>
                确定删除选中的 {selectedIds.size} 条专注记录？删除后 30 天内可在设置回收站恢复。
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => setBatchMenu('none')}
                  className="btn"
                  style={{
                    height: 32,
                    padding: '0 12px',
                    borderRadius: 9,
                    background: 'rgba(255, 255, 255, 0.14)',
                    color: '#FFFFFF',
                    fontSize: 12,
                  }}
                >
                  取消
                </button>
                <button
                  type="button"
                  disabled={batchBusy}
                  data-testid="batch-delete-confirm-btn"
                  onClick={() => void handleBatchDelete()}
                  className="btn"
                  style={{
                    height: 32,
                    padding: '0 14px',
                    borderRadius: 9,
                    background: '#E11D48',
                    color: '#FFFFFF',
                    fontSize: 12,
                  }}
                >
                  {batchBusy ? '正在删除…' : '确认删除'}
                </button>
              </div>
            </div>
          )}

          {/* 主工具行 */}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="tnum" style={{ fontSize: 14, fontWeight: 800 }}>
                已选 {selectedIds.size.toLocaleString('en-US')} 条
              </span>
              <button
                type="button"
                data-testid="batch-clear-btn"
                onClick={clearSelection}
                className="btn"
                style={{
                  height: 30,
                  padding: '0 10px',
                  borderRadius: 8,
                  background: 'rgba(255, 255, 255, 0.12)',
                  color: '#E5E7EB',
                  fontSize: 12,
                }}
              >
                取消选择
              </button>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <button
                type="button"
                disabled={batchBusy}
                data-testid="batch-tag-btn"
                onClick={() => setBatchMenu((m) => (m === 'tag' ? 'none' : 'tag'))}
                className="btn"
                style={{
                  height: 36,
                  padding: '0 14px',
                  borderRadius: 10,
                  background: batchMenu === 'tag' ? '#FFD43B' : '#FFFFFF',
                  color: '#111827',
                  fontSize: 13,
                }}
              >
                批量改标签
              </button>
              <button
                type="button"
                disabled={batchBusy}
                data-testid="batch-title-btn"
                onClick={() => setBatchMenu((m) => (m === 'title' ? 'none' : 'title'))}
                className="btn"
                style={{
                  height: 36,
                  padding: '0 14px',
                  borderRadius: 10,
                  background: batchMenu === 'title' ? '#FFD43B' : '#FFFFFF',
                  color: '#111827',
                  fontSize: 13,
                }}
              >
                批量改标题
              </button>
              <button
                type="button"
                disabled={batchBusy}
                data-testid="batch-delete-btn"
                onClick={() => setBatchMenu((m) => (m === 'delete' ? 'none' : 'delete'))}
                className="btn"
                style={{
                  height: 36,
                  padding: '0 14px',
                  borderRadius: 10,
                  background: '#E11D48',
                  color: '#FFFFFF',
                  fontSize: 13,
                }}
              >
                批量删除
              </button>
            </div>
          </div>
        </div>
      )}

      <SessionEditorModal
        initial={newEditor}
        onClose={() => setNewEditor(null)}
      />
    </div>
  );
}
