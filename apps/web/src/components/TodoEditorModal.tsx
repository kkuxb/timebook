import { useEffect, useState } from 'react';
import {
  addDays,
  getPaletteEntry,
  isTagDisabled,
  parseTodoRecur,
  toShanghaiDateStr,
  type TodoEntity,
  type TodoRecur,
} from '@timebook/core';
import { buildTagLookup } from '../lib/labels.js';
import { useAppStore } from '../store/useAppStore.js';

interface TodoEditorModalProps {
  todo: TodoEntity | null;
  onClose: () => void;
}

type RecurFreq = 'none' | 'daily' | 'weekly' | 'monthly';

const WEEKDAYS = [
  { d: 1, label: '一' },
  { d: 2, label: '二' },
  { d: 3, label: '三' },
  { d: 4, label: '四' },
  { d: 5, label: '五' },
  { d: 6, label: '六' },
  { d: 7, label: '日' },
];

export function TodoEditorModal({ todo, onClose }: TodoEditorModalProps) {
  const modules = useAppStore((s) => s.modules);
  const tags = useAppStore((s) => s.tags);
  const nowMs = useAppStore((s) => s.nowMs);
  const upsertTodo = useAppStore((s) => s.upsertTodo);
  const deleteTodo = useAppStore((s) => s.deleteTodo);

  const [title, setTitle] = useState('');
  const [tagId, setTagId] = useState<string | null>(null);
  const [planDate, setPlanDate] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [freq, setFreq] = useState<RecurFreq>('none');
  const [weekDays, setWeekDays] = useState<number[]>([1, 3, 5]);
  const [monthDays, setMonthDays] = useState<number[]>([1]);

  useEffect(() => {
    if (!todo) return;
    setTitle(todo.title);
    setTagId(todo.tag_id);
    setPlanDate(todo.plan_date);
    setDueDate(todo.due_date);
    const parsed = parseTodoRecur(todo.recur);
    if (!parsed) {
      setFreq('none');
      setWeekDays([1, 3, 5]);
      setMonthDays([1]);
    } else if (parsed.freq === 'daily') {
      setFreq('daily');
    } else if (parsed.freq === 'weekly') {
      setFreq('weekly');
      setWeekDays(parsed.days);
    } else {
      setFreq('monthly');
      setMonthDays(parsed.monthDays);
    }
  }, [todo]);

  if (!todo) return null;

  const todayStr = toShanghaiDateStr(nowMs());
  const lookup = buildTagLookup(modules, tags);
  const selectedTag = tagId ? lookup.tagById.get(tagId) : undefined;
  const selectedDisabledTag = selectedTag && isTagDisabled(selectedTag) ? selectedTag : undefined;
  const selectedDisabledMod = selectedDisabledTag
    ? lookup.moduleById.get(selectedDisabledTag.module_id)
    : undefined;
  const selectedDisabledPal = selectedDisabledMod
    ? getPaletteEntry(selectedDisabledMod.color_key)
    : null;
  const UNSEL = 'inset 0 0 0 1.5px #E1E4EC';

  const toggleWeekDay = (d: number) => {
    setWeekDays((prev) =>
      prev.includes(d)
        ? prev.length > 1
          ? prev.filter((x) => x !== d)
          : prev
        : [...prev, d].sort((a, b) => a - b),
    );
  };

  const toggleMonthDay = (d: number) => {
    setMonthDays((prev) =>
      prev.includes(d)
        ? prev.length > 1
          ? prev.filter((x) => x !== d)
          : prev
        : [...prev, d].sort((a, b) => a - b),
    );
  };

  const cleanTitle = title.trim();
  const valid = cleanTitle.length > 0;

  const handleSave = async () => {
    if (!valid) return;
    let recurObj: TodoRecur | null = null;
    if (freq === 'daily') recurObj = { freq: 'daily' };
    else if (freq === 'weekly') recurObj = { freq: 'weekly', days: weekDays };
    else if (freq === 'monthly') recurObj = { freq: 'monthly', monthDays };

    await upsertTodo({
      ...todo,
      title: cleanTitle,
      tag_id: tagId,
      plan_date: planDate,
      due_date: dueDate,
      recur: recurObj ? JSON.stringify(recurObj) : null,
    });
    onClose();
  };

  const handleDelete = async () => {
    await deleteTodo(todo.id);
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        role="dialog"
        aria-label="编辑待办"
        className="card modal-panel"
        style={{ maxWidth: 580, display: 'flex', flexDirection: 'column', gap: 18 }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ margin: 0, fontSize: 24, fontWeight: 800 }}>编辑待办</h2>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label htmlFor="todoTitleInput" style={{ fontSize: 13, fontWeight: 800, color: '#4B5263' }}>
            待办标题
          </label>
          <input
            id="todoTitleInput"
            className="tin"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="要做什么事…"
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#4B5263' }}>关联标签</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <button
              type="button"
              className="btn"
              onClick={() => setTagId(null)}
              style={{
                height: 34,
                padding: '0 12px',
                borderRadius: 10,
                fontSize: 13,
                background: tagId === null ? '#F2F3F7' : '#FFFFFF',
                color: tagId === null ? '#111827' : '#6B7280',
                boxShadow: tagId === null ? 'inset 0 0 0 2px #111827' : UNSEL,
              }}
            >
              未分类
            </button>
            {selectedDisabledTag && selectedDisabledPal && (
              <button
                type="button"
                className="btn"
                onClick={() => setTagId(selectedDisabledTag.id)}
                style={{
                  height: 34,
                  padding: '0 12px',
                  borderRadius: 10,
                  fontSize: 13,
                  background: selectedDisabledPal.tint,
                  color: selectedDisabledPal.ink,
                  boxShadow: `inset 0 0 0 2px ${selectedDisabledPal.color}`,
                }}
              >
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: selectedDisabledPal.color }} />
                {selectedDisabledTag.name}（已停用）
              </button>
            )}
            {lookup.enabledTags.map((t) => {
              const mod = lookup.moduleById.get(t.module_id)!;
              const pal = getPaletteEntry(mod.color_key);
              const sel = tagId === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  className="btn"
                  onClick={() => setTagId(t.id)}
                  style={{
                    height: 34,
                    padding: '0 12px',
                    borderRadius: 10,
                    fontSize: 13,
                    background: sel ? pal.tint : '#FFFFFF',
                    color: sel ? pal.ink : '#374151',
                    boxShadow: sel ? `inset 0 0 0 2px ${pal.color}` : UNSEL,
                  }}
                >
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: pal.color }} />
                  {t.name}
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#4B5263' }}>计划日期（哪天做）</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                className="btn soft"
                onClick={() => setPlanDate(todayStr)}
                style={{ height: 32, padding: '0 10px', borderRadius: 9, fontSize: 12 }}
              >
                今天
              </button>
              <button
                type="button"
                className="btn soft"
                onClick={() => setPlanDate(addDays(todayStr, 1))}
                style={{ height: 32, padding: '0 10px', borderRadius: 9, fontSize: 12 }}
              >
                明天
              </button>
              <button
                type="button"
                className="btn soft"
                onClick={() => setPlanDate(null)}
                style={{ height: 32, padding: '0 10px', borderRadius: 9, fontSize: 12 }}
              >
                清除
              </button>
            </div>
            <input
              type="date"
              aria-label="计划日期"
              className="field"
              value={planDate ?? ''}
              onChange={(e) => setPlanDate(e.target.value || null)}
              style={{ height: 40, fontSize: 14 }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#4B5263' }}>截止日期（可选）</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                className="btn soft"
                onClick={() => setDueDate(todayStr)}
                style={{ height: 32, padding: '0 10px', borderRadius: 9, fontSize: 12 }}
              >
                今天截止
              </button>
              <button
                type="button"
                className="btn soft"
                onClick={() => setDueDate(null)}
                style={{ height: 32, padding: '0 10px', borderRadius: 9, fontSize: 12 }}
              >
                清除
              </button>
            </div>
            <input
              type="date"
              aria-label="截止日期"
              className="field"
              value={dueDate ?? ''}
              onChange={(e) => setDueDate(e.target.value || null)}
              style={{ height: 40, fontSize: 14 }}
            />
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#4B5263' }}>重复规则</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {(
              [
                ['none', '不重复'],
                ['daily', '每天'],
                ['weekly', '每周几'],
                ['monthly', '每月几号'],
              ] as Array<[RecurFreq, string]>
            ).map(([k, lbl]) => (
              <button
                key={k}
                type="button"
                className="btn"
                onClick={() => setFreq(k)}
                style={{
                  height: 36,
                  padding: '0 14px',
                  borderRadius: 10,
                  fontSize: 13,
                  background: freq === k ? '#111827' : '#F2F3F7',
                  color: freq === k ? '#FFFFFF' : '#111827',
                }}
              >
                {lbl}
              </button>
            ))}
          </div>

          {freq === 'weekly' && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
              {WEEKDAYS.map((w) => {
                const on = weekDays.includes(w.d);
                return (
                  <button
                    key={w.d}
                    type="button"
                    className="btn"
                    onClick={() => toggleWeekDay(w.d)}
                    style={{
                      width: 38,
                      height: 36,
                      borderRadius: 10,
                      fontSize: 13,
                      background: on ? '#FFD43B' : '#FFFFFF',
                      color: '#111827',
                      boxShadow: on ? 'none' : UNSEL,
                    }}
                  >
                    周{w.label}
                  </button>
                );
              })}
            </div>
          )}

          {freq === 'monthly' && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => {
                const on = monthDays.includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    className="btn tnum"
                    onClick={() => toggleMonthDay(d)}
                    style={{
                      width: 32,
                      height: 30,
                      borderRadius: 8,
                      fontSize: 12,
                      background: on ? '#FFD43B' : '#FFFFFF',
                      color: '#111827',
                      boxShadow: on ? 'none' : UNSEL,
                    }}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            paddingTop: 14,
            borderTop: '1px solid #EEF0F5',
          }}
        >
          <button
            type="button"
            onClick={() => void handleDelete()}
            className="btn"
            style={{
              height: 44,
              padding: '0 8px',
              background: 'transparent',
              color: '#D02246',
              fontSize: 14,
            }}
          >
            删除待办
          </button>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            onClick={onClose}
            className="btn ghost"
            style={{ height: 46, padding: '0 20px', borderRadius: 12, fontSize: 15 }}
          >
            取消
          </button>
          <button
            type="button"
            disabled={!valid}
            onClick={() => void handleSave()}
            className="btn primary"
            style={{
              height: 46,
              padding: '0 28px',
              borderRadius: 12,
              fontSize: 15,
              opacity: valid ? 1 : 0.45,
            }}
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
