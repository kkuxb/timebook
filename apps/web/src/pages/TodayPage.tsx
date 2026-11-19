import { useEffect, useState, type FormEvent } from 'react';
import {
  addDays,
  computeDayGaps,
  computeTodayModuleOverview,
  formatClockMs,
  formatDurationMs,
  formatMinutes,
  formatMonthDay,
  formatShanghaiTime,
  getAllPendingTodos,
  getTodayTodos,
  getWeekdayLabel,
  minutesToHm,
  splitSessionByDay,
  toShanghaiDateStr,
  type SessionEntity,
  type TodoEntity,
} from '@timebook/core';
import { ulid } from 'ulid';
import {
  buildEditorFromSession,
  SessionEditorModal,
  type SessionEditorInitial,
} from '../components/SessionEditorModal.js';
import { TagPickerModal } from '../components/TagPickerModal.js';
import { TodoEditorModal } from '../components/TodoEditorModal.js';
import { buildTagLookup, formatSessionDisplayTitle, getTagStyle } from '../lib/labels.js';
import { useAppStore } from '../store/useAppStore.js';

export function TodayPage() {
  const modules = useAppStore((s) => s.modules);
  const tags = useAppStore((s) => s.tags);
  const sessions = useAppStore((s) => s.sessions);
  const todos = useAppStore((s) => s.todos);
  const todoChecks = useAppStore((s) => s.todoChecks);
  const nowMs = useAppStore((s) => s.nowMs);

  const startTimer = useAppStore((s) => s.startTimer);
  const updateSession = useAppStore((s) => s.updateSession);
  const endTimer = useAppStore((s) => s.endTimer);
  const cancelRunningTimer = useAppStore((s) => s.cancelRunningTimer);
  const upsertTodo = useAppStore((s) => s.upsertTodo);
  const toggleTodoDone = useAppStore((s) => s.toggleTodoDone);

  const [nowTick, setNowTick] = useState(() => nowMs());
  const [todoView, setTodoView] = useState<'today' | 'all'>('today');
  const [draftTodo, setDraftTodo] = useState('');
  const [viewDate, setViewDate] = useState(() => toShanghaiDateStr(nowMs()));
  const [pickerSessionId, setPickerSessionId] = useState<string | null>(null);
  const [sessionEditor, setSessionEditor] = useState<SessionEditorInitial | null>(null);
  const [editingTodo, setEditingTodo] = useState<TodoEntity | null>(null);
  const [editingTimerTitleId, setEditingTimerTitleId] = useState<string | null>(null);
  const [timerTitleDraft, setTimerTitleDraft] = useState('');

  useEffect(() => {
    const iv = setInterval(() => setNowTick(nowMs()), 1000);
    return () => clearInterval(iv);
  }, [nowMs]);

  const todayStr = toShanghaiDateStr(nowTick);
  const lookup = buildTagLookup(modules, tags);
  const overview = computeTodayModuleOverview(sessions, tags, modules, todayStr, nowTick);

  // 进行中计时
  const runningTimers = sessions
    .filter((s) => s.deleted_at === null && s.end_at === null)
    .sort((a, b) => a.start_at - b.start_at);

  // 待办视图
  const todayTodoResult = getTodayTodos(todos, todoChecks, sessions, todayStr, nowTick);
  const todoItems =
    todoView === 'today'
      ? todayTodoResult.items
      : getAllPendingTodos(todos, todoChecks, sessions, todayStr, nowTick);

  const handleStartFocus = async () => {
    const newId = await startTimer({ tagId: null, title: null });
    setPickerSessionId(newId);
  };

  const handleAddTodo = async (e: FormEvent) => {
    e.preventDefault();
    const title = draftTodo.trim();
    if (!title) return;
    const ts = nowMs();
    await upsertTodo({
      id: ulid(),
      title,
      tag_id: null,
      plan_date: todayStr,
      due_date: null,
      recur: null,
      done_at: null,
      sort: 0,
      created_at: ts,
      updated_at: ts,
      deleted_at: null,
    });
    setDraftTodo('');
  };

  // 时间线计算（按北京自然日切分，今天包含进行中计时）
  interface TimelineSeg {
    kind: 'rec' | 'run';
    session: SessionEntity;
    startMin: number;
    endMin: number;
    durationMs: number;
  }
  const daySegments: TimelineSeg[] = [];
  for (const s of sessions) {
    if (s.deleted_at !== null) continue;
    const isRunning = s.end_at === null;
    if (isRunning && viewDate !== todayStr) continue;
    const segs = splitSessionByDay(s, isRunning ? nowTick : undefined);
    for (const seg of segs) {
      if (seg.date !== viewDate) continue;
      daySegments.push({
        kind: isRunning ? 'run' : 'rec',
        session: s,
        startMin: seg.startMin,
        endMin: seg.endMin,
        durationMs: seg.durationMs,
      });
    }
  }

  const gaps = computeDayGaps(
    daySegments.map((seg) => ({ startMin: seg.startMin, endMin: seg.endMin })),
    20,
  );

  type TimelineRow =
    | { kind: 'seg'; key: string; sortKey: number; seg: TimelineSeg }
    | { kind: 'gap'; key: string; sortKey: number; startMin: number; endMin: number; durationMin: number };

  const rows: TimelineRow[] = [
    ...daySegments.map((seg, idx) => ({
      kind: 'seg' as const,
      key: `seg-${seg.session.id}-${idx}`,
      sortKey: seg.startMin,
      seg,
    })),
    ...gaps.map((g, idx) => ({
      kind: 'gap' as const,
      key: `gap-${idx}-${g.startMin}`,
      sortKey: g.startMin + 0.5,
      startMin: g.startMin,
      endMin: g.endMin,
      durationMin: g.durationMin,
    })),
  ].sort((a, b) => b.sortKey - a.sortKey);

  const relLabel =
    viewDate === todayStr
      ? '今天'
      : viewDate === addDays(todayStr, -1)
        ? '昨天'
        : viewDate === addDays(todayStr, -2)
          ? '前天'
          : '‹ › 切换日期';

  const openGapModal = (startMin: number, endMin: number) => {
    setSessionEditor({
      mode: 'new',
      date: viewDate,
      startHm: minutesToHm(startMin),
      endHm: minutesToHm(endMin >= 1440 ? 1439 : endMin),
      tagId: null,
      title: '',
    });
  };

  const openNewManual = () => {
    const lastGap = gaps.length > 0 ? gaps[gaps.length - 1] : null;
    if (lastGap) {
      openGapModal(lastGap.startMin, lastGap.endMin);
    } else {
      setSessionEditor({
        mode: 'new',
        date: viewDate,
        startHm: '',
        endHm: '',
        tagId: null,
        title: '',
      });
    }
  };

  const pickerTargetSession = pickerSessionId
    ? sessions.find((s) => s.id === pickerSessionId)
    : undefined;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 36 }}>
      {/* 今日概览 */}
      <section
        aria-label="今日概览"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: 20,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <h1 style={{ margin: 0, fontSize: 42, lineHeight: 1.1, fontWeight: 800, letterSpacing: '-0.02em' }}>
            {getWeekdayLabel(todayStr)}{' '}
            <span
              style={{
                background: 'linear-gradient(transparent 60%, #FFD43B 60%, #FFD43B 90%, transparent 90%)',
                padding: '0 3px',
              }}
            >
              {formatMonthDay(todayStr, true)}
            </span>
          </h1>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {overview.modules.map((m) => (
              <div
                key={m.moduleId}
                className="card lift"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  borderRadius: 14,
                  padding: '10px 14px',
                }}
              >
                <span style={{ width: 10, height: 10, borderRadius: 3, background: m.color }} />
                <span style={{ fontSize: 14, fontWeight: 700, color: '#4B5263' }}>{m.name}</span>
                <span className="tnum" style={{ fontSize: 15, fontWeight: 800 }}>
                  {formatDurationMs(m.durationMs)}
                </span>
              </div>
            ))}
            {overview.unclassifiedMs > 0 && (
              <div
                className="card lift"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  borderRadius: 14,
                  padding: '10px 14px',
                }}
              >
                <span style={{ width: 10, height: 10, borderRadius: 3, background: '#B8BDC9' }} />
                <span style={{ fontSize: 14, fontWeight: 700, color: '#4B5263' }}>未分类</span>
                <span className="tnum" style={{ fontSize: 15, fontWeight: 800 }}>
                  {formatDurationMs(overview.unclassifiedMs)}
                </span>
              </div>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={() => void handleStartFocus()}
          className="btn primary"
          style={{ height: 56, padding: '0 30px', borderRadius: 16, fontSize: 17 }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M7 4.5v15a1 1 0 0 0 1.5.9l12-7.5a1 1 0 0 0 0-1.8l-12-7.5A1 1 0 0 0 7 4.5z" />
          </svg>
          开始专注
        </button>
      </section>

      {/* 待办区 */}
      <section aria-label="待办" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 14,
          }}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>待办</h2>
            <span className="count tnum">
              {todayTodoResult.doneCount} / {todayTodoResult.totalCount}
            </span>
            <div
              className="seg"
              style={{ background: '#EEF0F5', padding: 3, borderRadius: 11 }}
              role="tablist"
              aria-label="待办视图切换"
            >
              {(
                [
                  ['today', '今日'],
                  ['all', '全部未完成'],
                ] as const
              ).map(([k, lbl]) => {
                const active = todoView === k;
                return (
                  <button
                    key={k}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setTodoView(k)}
                    className="btn"
                    style={{
                      height: 30,
                      padding: '0 12px',
                      borderRadius: 8,
                      fontSize: 12,
                      background: active ? '#FFFFFF' : 'transparent',
                      color: active ? '#111827' : '#6B7280',
                      boxShadow: active ? '0 1px 3px rgba(17,24,39,.12)' : 'none',
                    }}
                  >
                    {lbl}
                  </button>
                );
              })}
            </div>
          </div>

          <form
            onSubmit={(e) => void handleAddTodo(e)}
            className="card"
            style={{ display: 'flex', alignItems: 'center', gap: 6, borderRadius: 14, padding: 4 }}
          >
            <input
              aria-label="新待办"
              value={draftTodo}
              onChange={(e) => setDraftTodo(e.target.value)}
              placeholder="记一件要做的事…"
              style={{
                width: 220,
                maxWidth: '50vw',
                height: 40,
                border: 0,
                background: 'transparent',
                fontSize: 14,
                fontWeight: 600,
                color: '#111827',
                padding: '0 12px',
                outline: 'none',
              }}
            />
            <button
              type="submit"
              className="btn dark"
              style={{ height: 40, padding: '0 18px', borderRadius: 10, fontSize: 14 }}
            >
              添加
            </button>
          </form>
        </div>

        {todoItems.length === 0 ? (
          <div
            style={{
              border: '1.5px dashed #CDD1DC',
              borderRadius: 20,
              padding: 28,
              textAlign: 'center',
              color: '#6B7280',
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            {todoView === 'today' ? '今天还没有待办，右上角输入标题回车即可快速添加。' : '目前没有未完成的待办。'}
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))',
              gap: 14,
            }}
          >
            {todoItems.map((item) => {
              const td = item.todo;
              const style = getTagStyle(td.tag_id, lookup);
              const metaParts: string[] = [];
              if (item.recurLabel) metaParts.push(item.recurLabel);
              else if (td.plan_date === todayStr) metaParts.push('今天');
              else if (td.plan_date) metaParts.push(`计划 ${formatMonthDay(td.plan_date)}`);
              else metaParts.push('随时');

              return (
                <div
                  key={td.id}
                  className="card lift rise"
                  style={{
                    padding: 18,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                    opacity: item.done ? 0.55 : 1,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                    <span className="chip" style={{ background: style.tint, color: style.ink }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: style.color }} />
                      {style.tagName}
                    </span>
                    <button
                      type="button"
                      onClick={() => void toggleTodoDone(td, todayStr, !item.done)}
                      className="btn"
                      aria-label={`${item.done ? '标为未完成' : '标为完成'}：${td.title}`}
                      aria-pressed={item.done}
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: 9,
                        padding: 0,
                        background: item.done ? '#111827' : '#FFFFFF',
                        boxShadow: item.done ? 'none' : 'inset 0 0 0 2px #CDD1DC',
                      }}
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="#FFFFFF"
                        strokeWidth="3.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                        style={{ opacity: item.done ? 1 : 0 }}
                      >
                        <path d="M5 12l5 5 9-10" />
                      </svg>
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => setEditingTodo(td)}
                    style={{
                      border: 0,
                      padding: 0,
                      background: 'transparent',
                      textAlign: 'left',
                      color: '#111827',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 18,
                        fontWeight: 800,
                        lineHeight: 1.35,
                        textDecoration: item.done ? 'line-through' : 'none',
                      }}
                    >
                      {td.title}
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        alignItems: 'center',
                        gap: 6,
                        fontSize: 13,
                        fontWeight: 600,
                        color: '#6B7280',
                      }}
                    >
                      <span>{metaParts.join(' · ')}</span>
                      {item.dueLabel && (
                        <>
                          <span style={{ width: 3, height: 3, borderRadius: '50%', background: '#C3C7D1' }} />
                          <span style={{ color: item.dueOverdue ? '#C8203E' : '#9A3A0A', fontWeight: 700 }}>
                            {item.dueLabel}
                          </span>
                        </>
                      )}
                      <span style={{ width: 3, height: 3, borderRadius: '50%', background: '#C3C7D1' }} />
                      <span className="tnum">已投入 {formatDurationMs(item.spentMs)}</span>
                    </div>
                  </button>

                  <button
                    type="button"
                    className="btn soft go"
                    onClick={() =>
                      void startTimer({ tagId: td.tag_id, title: td.title, todoId: td.id })
                    }
                    style={{ marginTop: 4, height: 42, borderRadius: 12, fontSize: 14 }}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M7 4.5v15a1 1 0 0 0 1.5.9l12-7.5a1 1 0 0 0 0-1.8l-12-7.5A1 1 0 0 0 7 4.5z" />
                    </svg>
                    开始这件事
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 专注区 + 时间线 */}
      <section
        id="focus-section"
        aria-label="专注"
        style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>专注</h2>
          <span className="count tnum">{runningTimers.length} 个进行中</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#6B7280' }}>可以同时开多个</span>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' }}>
          {/* 进行中计时卡列 */}
          <div style={{ flex: '1 1 380px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
            {runningTimers.length === 0 ? (
              <div
                style={{
                  border: '1.5px dashed #CDD1DC',
                  borderRadius: 20,
                  padding: 36,
                  textAlign: 'center',
                  color: '#6B7280',
                  fontSize: 15,
                  fontWeight: 600,
                }}
              >
                现在没有进行中的计时。点「开始专注」，或待办上的「开始这件事」。
              </div>
            ) : (
              runningTimers.map((t) => {
                const st = getTagStyle(t.tag_id, lookup);
                const hasTag = !!st.tag;
                const displayTitle = t.title?.trim() || (st.tag ? st.tag.name : '新的专注');
                const isEditingTitle = editingTimerTitleId === t.id;

                return (
                  <div
                    key={t.id}
                    className="card lift rise"
                    style={{
                      background: hasTag ? st.tint : '#FFFFFF',
                      border: hasTag ? `1px solid ${st.line}` : '1.5px dashed #CDD1DC',
                      padding: 22,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 14,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                        <span
                          className="live"
                          style={{ color: hasTag ? st.color : '#9CA3AF' }}
                        />
                        <span
                          className="chip"
                          style={{
                            background: '#FFFFFF',
                            color: hasTag ? st.ink : '#4B5263',
                            boxShadow: `inset 0 0 0 1px ${hasTag ? st.line : '#E1E4EC'}`,
                          }}
                        >
                          {hasTag ? `${st.moduleName} · ${st.tagName}` : '还没选标签'}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => setPickerSessionId(t.id)}
                        className="btn"
                        style={{
                          height: 32,
                          padding: '0 10px',
                          borderRadius: 9,
                          background: 'transparent',
                          color: '#4B5263',
                          fontSize: 13,
                        }}
                      >
                        {hasTag ? '换标签' : '选标签'}
                      </button>
                    </div>

                    {isEditingTitle ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          void updateSession({ ...t, title: timerTitleDraft.trim() || null });
                          setEditingTimerTitleId(null);
                        }}
                        style={{ display: 'flex', gap: 8 }}
                      >
                        <input
                          autoFocus
                          className="tin"
                          value={timerTitleDraft}
                          onChange={(e) => setTimerTitleDraft(e.target.value)}
                          placeholder="输入具体内容（可选）"
                          style={{ height: 38, fontSize: 15 }}
                        />
                        <button
                          type="submit"
                          className="btn dark"
                          style={{ height: 38, padding: '0 14px', borderRadius: 10, fontSize: 13 }}
                        >
                          确定
                        </button>
                      </form>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ fontSize: 17, fontWeight: 800 }}>{displayTitle}</div>
                        <button
                          type="button"
                          aria-label="编辑具体内容"
                          onClick={() => {
                            setEditingTimerTitleId(t.id);
                            setTimerTitleDraft(t.title ?? '');
                          }}
                          className="btn tiny"
                          style={{ width: 28, height: 28 }}
                        >
                          ✎
                        </button>
                      </div>
                    )}

                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
                      <div
                        className="tnum"
                        style={{ fontSize: 52, fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1 }}
                      >
                        {formatClockMs(nowTick - t.start_at)}
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#6B7280' }}>
                        {formatShanghaiTime(t.start_at)} 开始
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: 10 }}>
                      <button
                        type="button"
                        className="btn dark"
                        onClick={() => void endTimer(t.id)}
                        style={{ flex: 1, height: 46, borderRadius: 12, fontSize: 15 }}
                      >
                        结束
                      </button>
                      <button
                        type="button"
                        className="btn ghost"
                        onClick={() => void cancelRunningTimer(t.id)}
                        style={{ height: 46, padding: '0 20px', borderRadius: 12, fontSize: 15 }}
                      >
                        取消
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* 时间线卡 */}
          <div
            className="card"
            style={{
              flex: '1.35 1 460px',
              minWidth: 0,
              padding: 22,
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
            }}
          >
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => setViewDate((d) => addDays(d, -1))}
                  className="btn ghost icon"
                  aria-label="前一天"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M15 5l-7 7 7 7" />
                  </svg>
                </button>
                <div style={{ minWidth: 120, textAlign: 'center' }}>
                  <div style={{ fontSize: 16, fontWeight: 800 }}>
                    {formatMonthDay(viewDate)} {getWeekdayLabel(viewDate)}
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#6B7280' }}>{relLabel}</div>
                </div>
                <button
                  type="button"
                  disabled={viewDate >= todayStr}
                  onClick={() => viewDate < todayStr && setViewDate((d) => addDays(d, 1))}
                  className="btn ghost icon"
                  aria-label="后一天"
                  style={{ opacity: viewDate >= todayStr ? 0.35 : 1 }}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>

              <button
                type="button"
                onClick={openNewManual}
                className="btn primary"
                style={{ height: 40, padding: '0 16px', borderRadius: 12, fontSize: 14 }}
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
                补记录
              </button>
            </div>

            {/* 0-24h 比例条 */}
            <div>
              <div
                style={{
                  position: 'relative',
                  height: 28,
                  borderRadius: 8,
                  background: '#F0F1F5',
                  overflow: 'hidden',
                }}
              >
                {gaps.map((g, idx) => (
                  <button
                    key={`g-${idx}`}
                    type="button"
                    onClick={() => openGapModal(g.startMin, g.endMin)}
                    className="gapseg"
                    aria-label={`没有记录 ${minutesToHm(g.startMin)}–${minutesToHm(g.endMin)}，点击补上`}
                    title={`没有记录 ${minutesToHm(g.startMin)}–${minutesToHm(g.endMin)}，点击补上`}
                    style={{
                      position: 'absolute',
                      top: 0,
                      bottom: 0,
                      left: `${((g.startMin / 1440) * 100).toFixed(2)}%`,
                      width: `${(((g.endMin - g.startMin) / 1440) * 100).toFixed(2)}%`,
                      borderRadius: 4,
                    }}
                  />
                ))}
                {daySegments.map((seg, idx) => {
                  const st = getTagStyle(seg.session.tag_id, lookup);
                  const wPct = Math.max(0.5, ((seg.endMin - seg.startMin) / 1440) * 100);
                  return (
                    <div
                      key={`s-${idx}`}
                      title={`${formatSessionDisplayTitle(seg.session, lookup)} ${minutesToHm(seg.startMin)}–${minutesToHm(seg.endMin)}`}
                      className={seg.kind === 'run' ? 'runseg' : undefined}
                      style={{
                        position: 'absolute',
                        top: 0,
                        bottom: 0,
                        left: `${((seg.startMin / 1440) * 100).toFixed(2)}%`,
                        width: `${wPct.toFixed(2)}%`,
                        backgroundColor: st.color,
                        borderRadius: 4,
                        pointerEvents: 'none',
                      }}
                    />
                  );
                })}
              </div>
              <div
                className="tnum"
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginTop: 6,
                  fontSize: 11,
                  fontWeight: 700,
                  color: '#9CA3AF',
                }}
              >
                <span>0</span>
                <span>6</span>
                <span>12</span>
                <span>18</span>
                <span>24</span>
              </div>
            </div>

            {/* 列表 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {rows.length === 0 ? (
                <button
                  type="button"
                  onClick={openNewManual}
                  className="gap"
                  style={{ padding: 24, textAlign: 'center', fontSize: 14, fontWeight: 700, color: '#9A3A0A' }}
                >
                  这天还没有记录 · 点这里补一条
                </button>
              ) : (
                rows.map((r) => {
                  if (r.kind === 'gap') {
                    return (
                      <button
                        key={r.key}
                        type="button"
                        onClick={() => openGapModal(r.startMin, r.endMin)}
                        className="gap"
                        style={{
                          width: '100%',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 12,
                          padding: '9px 12px',
                          textAlign: 'left',
                          color: '#111827',
                        }}
                      >
                        <span
                          style={{
                            width: 10,
                            height: 10,
                            borderRadius: 3,
                            border: '1.5px dashed #F2711C',
                            flex: 'none',
                          }}
                        />
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ display: 'block', fontSize: 14, fontWeight: 700, color: '#9A3A0A' }}>
                            没有记录 · {formatMinutes(r.durationMin)}
                          </span>
                          <span
                            className="tnum"
                            style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#B9693E' }}
                          >
                            {minutesToHm(r.startMin)} – {minutesToHm(r.endMin)}
                          </span>
                        </span>
                        <span style={{ fontSize: 13, fontWeight: 800, color: '#C2410C' }}>+ 补上</span>
                      </button>
                    );
                  }

                  const seg = r.seg;
                  const st = getTagStyle(seg.session.tag_id, lookup);
                  const isRun = seg.kind === 'run';
                  const displayTitle = formatSessionDisplayTitle(seg.session, lookup);
                  const rangeText = `${minutesToHm(seg.startMin)} – ${
                    isRun ? '现在' : seg.endMin >= 1440 ? '24:00' : minutesToHm(seg.endMin)
                  }`;

                  return (
                    <button
                      key={r.key}
                      type="button"
                      onClick={() => {
                        if (!isRun) setSessionEditor(buildEditorFromSession(seg.session));
                      }}
                      className="row"
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        padding: '9px 12px',
                        textAlign: 'left',
                        color: '#111827',
                      }}
                    >
                      <span
                        className={isRun ? 'live' : undefined}
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: 3,
                          background: st.color,
                          color: st.color,
                          flex: 'none',
                        }}
                      />
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'block', fontSize: 14, fontWeight: 700 }}>
                          {displayTitle}
                          {isRun ? ' · 进行中' : ''}
                        </span>
                        <span
                          className="tnum"
                          style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#6B7280' }}
                        >
                          {rangeText}
                        </span>
                      </span>
                      <span className="tnum" style={{ fontSize: 14, fontWeight: 800 }}>
                        {formatDurationMs(seg.durationMs)}
                      </span>
                      <svg
                        width="15"
                        height="15"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="#9CA3AF"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                        style={{ opacity: isRun ? 0 : 1 }}
                      >
                        <path d="M4 20h4L19 9l-4-4L4 16z" />
                      </svg>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </section>

      {/* 手机端底部迷你计时条 */}
      {runningTimers.length > 0 && (
        <button
          type="button"
          className="tb-mini-bar"
          aria-label={`${runningTimers.length} 个进行中计时，${formatSessionDisplayTitle(runningTimers[0], lookup)}，已运行 ${formatClockMs(nowTick - runningTimers[0].start_at)}，点击定位到专注区`}
          onClick={() => {
            document.getElementById('focus-section')?.scrollIntoView({ behavior: 'smooth' });
          }}
          style={{
            border: '1px solid #C9D5FF',
            background: '#111827',
            color: '#FFFFFF',
            textAlign: 'left',
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span className="live" style={{ color: '#FFD43B' }} />
            <span style={{ fontSize: 13, fontWeight: 800 }}>
              {runningTimers.length} 个进行中 · {formatSessionDisplayTitle(runningTimers[0], lookup)}
            </span>
          </span>
          <span style={{ width: 6, flex: 'none' }} aria-hidden="true"> </span>
          <span className="tnum" style={{ fontSize: 15, fontWeight: 800, color: '#FFD43B' }}>
            {formatClockMs(nowTick - runningTimers[0].start_at)}
          </span>
        </button>
      )}

      <TagPickerModal
        open={!!pickerSessionId && !!pickerTargetSession}
        onPick={(tagId) => {
          if (pickerTargetSession) {
            void updateSession({ ...pickerTargetSession, tag_id: tagId });
          }
          setPickerSessionId(null);
        }}
        onSkip={() => setPickerSessionId(null)}
      />

      <SessionEditorModal
        initial={sessionEditor}
        onClose={() => setSessionEditor(null)}
        onSaved={(d) => setViewDate(d)}
      />

      <TodoEditorModal todo={editingTodo} onClose={() => setEditingTodo(null)} />
    </div>
  );
}
