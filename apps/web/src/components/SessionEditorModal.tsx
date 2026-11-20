import { useEffect, useState } from 'react';
import {
  addDays,
  formatMinutes,
  formatMonthDay,
  formatShanghaiTime,
  getPaletteEntry,
  hmToMinutes,
  isTagDisabled,
  minutesToHm,
  shanghaiDateTimeToUtcMs,
  splitSessionByDay,
  toShanghaiDateStr,
  type SessionEntity,
} from '@timebook/core';
import { ulid } from 'ulid';
import { buildTagLookup, formatSessionDisplayTitle } from '../lib/labels.js';
import { useAppStore } from '../store/useAppStore.js';

export interface SessionEditorInitial {
  mode: 'new' | 'edit';
  session?: SessionEntity;
  date: string;
  startHm: string;
  endHm: string;
  tagId: string | null;
  title?: string;
}

interface SessionEditorModalProps {
  initial: SessionEditorInitial | null;
  onClose: () => void;
  onSaved?: (dateStr: string) => void;
}

export function SessionEditorModal({ initial, onClose, onSaved }: SessionEditorModalProps) {
  const modules = useAppStore((s) => s.modules);
  const tags = useAppStore((s) => s.tags);
  const sessions = useAppStore((s) => s.sessions);
  const nowMs = useAppStore((s) => s.nowMs);
  const updateSession = useAppStore((s) => s.updateSession);
  const deleteSession = useAppStore((s) => s.deleteSession);

  const [tagId, setTagId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [startHm, setStartHm] = useState('');
  const [endHm, setEndHm] = useState('');

  useEffect(() => {
    if (!initial) return;
    setTagId(initial.tagId);
    setTitle(initial.title ?? '');
    setDate(initial.date);
    setStartHm(initial.startHm);
    setEndHm(initial.endHm);
  }, [initial]);

  if (!initial) return null;

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

  const sm = hmToMinutes(startHm);
  const em = hmToMinutes(endHm);
  const isCrossDay = sm !== null && em !== null && em < sm;
  const durationMin =
    sm !== null && em !== null && em !== sm ? (em > sm ? em - sm : em + 1440 - sm) : 0;
  const valid = sm !== null && em !== null && durationMin > 0 && durationMin <= 1440 && !!date;

  const startAtMs = valid ? shanghaiDateTimeToUtcMs(date, sm!) : null;
  const endAtMs = valid ? shanghaiDateTimeToUtcMs(date, em! > sm! ? em! : em! + 1440) : null;

  // 重叠检测
  const overlaps: string[] = [];
  if (startAtMs !== null && endAtMs !== null) {
    for (const s of sessions) {
      if (s.deleted_at !== null || s.end_at === null) continue;
      if (initial.session && s.id === initial.session.id) continue;
      if (s.start_at < endAtMs && s.end_at > startAtMs) {
        overlaps.push(
          `${formatSessionDisplayTitle(s, lookup)} ${formatShanghaiTime(s.start_at)}–${formatShanghaiTime(s.end_at)}`,
        );
      }
    }
  }

  const shiftTime = (which: 'start' | 'end', deltaMin: number) => {
    const curStr = which === 'start' ? startHm : endHm;
    const curMin = hmToMinutes(curStr);
    const fallback = Math.round((nowMs() % 86400_000) / 60000);
    const nextHm = minutesToHm((curMin ?? fallback) + deltaMin);
    if (which === 'start') setStartHm(nextHm);
    else setEndHm(nextHm);
  };

  const handleSave = async () => {
    if (!valid || startAtMs === null || endAtMs === null) return;
    const now = nowMs();
    const cleanTitle = title.trim() || null;
    if (initial.mode === 'edit' && initial.session) {
      await updateSession({
        ...initial.session,
        tag_id: tagId,
        title: cleanTitle,
        start_at: startAtMs,
        end_at: endAtMs,
      });
    } else {
      await updateSession({
        id: ulid(),
        tag_id: tagId,
        todo_id: null,
        title: cleanTitle,
        start_at: startAtMs,
        end_at: endAtMs,
        source: 'manual',
        import_batch: null,
        created_at: now,
        updated_at: now,
        deleted_at: null,
      });
    }
    onSaved?.(date);
    onClose();
  };

  const handleDelete = async () => {
    if (initial.mode === 'edit' && initial.session) {
      await deleteSession(initial.session.id);
      onClose();
    }
  };

  const UNSEL = 'inset 0 0 0 1.5px #E1E4EC';

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        role="dialog"
        aria-label={initial.mode === 'edit' ? '编辑记录' : '补一条记录'}
        className="card modal-panel"
        style={{ maxWidth: 600, display: 'flex', flexDirection: 'column', gap: 20 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: 24, fontWeight: 800 }}>
            {initial.mode === 'edit' ? '编辑记录' : '补一条记录'}
          </h2>
          <div style={{ marginTop: 4, fontSize: 14, fontWeight: 600, color: '#6B7280' }}>
            {initial.mode === 'edit'
              ? '改标签、具体内容、日期或起止时间都可以，统计会跟着更新'
              : '忘了点开始也没关系，把那段时间补上就好'}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#4B5263' }}>做的是什么</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 44, fontSize: 12, fontWeight: 700, color: '#9CA3AF' }}>无标签</span>
            <button
              type="button"
              className="btn"
              onClick={() => setTagId(null)}
              aria-pressed={tagId === null}
              style={{
                height: 36,
                padding: '0 12px',
                borderRadius: 10,
                background: tagId === null ? '#F2F3F7' : '#FFFFFF',
                boxShadow: tagId === null ? 'inset 0 0 0 2px #111827' : UNSEL,
                color: tagId === null ? '#111827' : '#6B7280',
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              <span
                style={{ width: 7, height: 7, borderRadius: '50%', background: '#B8BDC9' }}
              />
              未分类
            </button>
          </div>
          {selectedDisabledTag && selectedDisabledPal && (
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 44, fontSize: 12, fontWeight: 700, color: '#9CA3AF' }}>已停用</span>
              <button
                type="button"
                className="btn"
                onClick={() => setTagId(selectedDisabledTag.id)}
                aria-pressed={true}
                style={{
                  height: 36,
                  padding: '0 12px',
                  borderRadius: 10,
                  background: selectedDisabledPal.tint,
                  boxShadow: `inset 0 0 0 2px ${selectedDisabledPal.color}`,
                  color: selectedDisabledPal.ink,
                  fontSize: 13,
                  fontWeight: 700,
                }}
              >
                <span
                  style={{ width: 7, height: 7, borderRadius: '50%', background: selectedDisabledPal.color }}
                />
                {selectedDisabledMod ? `${selectedDisabledMod.name} · ` : ''}
                {selectedDisabledTag.name}（已停用）
              </button>
            </div>
          )}
          {lookup.activeModules.map((mod) => {
            const pal = getPaletteEntry(mod.color_key);
            const mTags = lookup.enabledTags.filter((t) => t.module_id === mod.id);
            if (mTags.length === 0) return null;
            return (
              <div
                key={mod.id}
                style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}
              >
                <span style={{ width: 44, fontSize: 12, fontWeight: 700, color: '#9CA3AF' }}>
                  {mod.name}
                </span>
                {mTags.map((t) => {
                  const sel = tagId === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      className="btn"
                      onClick={() => setTagId(t.id)}
                      aria-pressed={sel}
                      style={{
                        height: 36,
                        padding: '0 12px',
                        borderRadius: 10,
                        background: sel ? pal.tint : '#FFFFFF',
                        boxShadow: sel ? `inset 0 0 0 2px ${pal.color}` : UNSEL,
                        color: sel ? pal.ink : '#374151',
                        fontSize: 13,
                        fontWeight: 700,
                      }}
                    >
                      <span
                        style={{ width: 7, height: 7, borderRadius: '50%', background: pal.color }}
                      />
                      {t.name}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label htmlFor="edTitleInput" style={{ fontSize: 13, fontWeight: 800, color: '#4B5263' }}>
            具体内容（可选）
          </label>
          <input
            id="edTitleInput"
            className="tin"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="具体内容（可选，如：谷米开发）"
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#4B5263' }}>哪一天</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
            {[
              { d: todayStr, lbl: '今天' },
              { d: addDays(todayStr, -1), lbl: '昨天' },
              { d: addDays(todayStr, -2), lbl: '前天' },
            ].map((q) => {
              const sel = date === q.d;
              return (
                <button
                  key={q.d}
                  type="button"
                  className="btn"
                  onClick={() => setDate(q.d)}
                  style={{
                    height: 38,
                    padding: '0 14px',
                    borderRadius: 10,
                    background: sel ? '#111827' : '#FFFFFF',
                    color: sel ? '#FFFFFF' : '#111827',
                    boxShadow: sel ? 'none' : UNSEL,
                    fontSize: 13,
                  }}
                >
                  {q.lbl} {formatMonthDay(q.d)}
                </button>
              );
            })}
            <input
              type="date"
              aria-label="日期"
              className="field"
              value={date}
              onChange={(e) => e.target.value && setDate(e.target.value)}
              style={{ height: 38, fontSize: 14, width: 170 }}
            />
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#4B5263' }}>从几点到几点</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label htmlFor="edStartInput" style={{ fontSize: 12, fontWeight: 700, color: '#9CA3AF' }}>
                开始
              </label>
              <input
                id="edStartInput"
                type="time"
                className="field"
                value={startHm}
                onChange={(e) => setStartHm(e.target.value)}
                style={{ width: 160 }}
              />
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  type="button"
                  className="btn soft"
                  onClick={() => shiftTime('start', -15)}
                  style={{ flex: 1, height: 32, borderRadius: 9, fontSize: 12 }}
                >
                  −15 分
                </button>
                <button
                  type="button"
                  className="btn soft"
                  onClick={() => shiftTime('start', 15)}
                  style={{ flex: 1, height: 32, borderRadius: 9, fontSize: 12 }}
                >
                  +15 分
                </button>
              </div>
            </div>

            <div style={{ paddingTop: 36, color: '#C3C7D1' }}>
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label htmlFor="edEndInput" style={{ fontSize: 12, fontWeight: 700, color: '#9CA3AF' }}>
                结束 {isCrossDay ? '· 次日' : ''}
              </label>
              <input
                id="edEndInput"
                type="time"
                className="field"
                value={endHm}
                onChange={(e) => setEndHm(e.target.value)}
                style={{ width: 160 }}
              />
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  type="button"
                  className="btn soft"
                  onClick={() => shiftTime('end', -15)}
                  style={{ flex: 1, height: 32, borderRadius: 9, fontSize: 12 }}
                >
                  −15 分
                </button>
                <button
                  type="button"
                  className="btn soft"
                  onClick={() => shiftTime('end', 15)}
                  style={{ flex: 1, height: 32, borderRadius: 9, fontSize: 12 }}
                >
                  +15 分
                </button>
              </div>
            </div>

            <div style={{ marginLeft: 'auto', paddingTop: 22, textAlign: 'right' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#9CA3AF' }}>时长</div>
              <div className="tnum" style={{ fontSize: 24, fontWeight: 800 }}>
                {valid ? formatMinutes(durationMin) : '—'}
              </div>
            </div>
          </div>

          {overlaps.length > 0 && (
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: '#4B5263',
                background: '#F5F6FA',
                borderRadius: 12,
                padding: '10px 12px',
              }}
            >
              和「{overlaps.join('、')}」有重叠。可以照常保存，同一时间本来就能做两件事。
            </div>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 10,
            paddingTop: 14,
            borderTop: '1px solid #EEF0F5',
          }}
        >
          {initial.mode === 'edit' && (
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
              删除这条
            </button>
          )}
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

export function buildEditorFromSession(session: SessionEntity): SessionEditorInitial {
  const segs = splitSessionByDay(session);
  const firstDate = segs[0]?.date ?? toShanghaiDateStr(session.start_at);
  return {
    mode: 'edit',
    session,
    date: firstDate,
    startHm: formatShanghaiTime(session.start_at),
    endHm: session.end_at ? formatShanghaiTime(session.end_at) : '',
    tagId: session.tag_id,
    title: session.title ?? '',
  };
}
