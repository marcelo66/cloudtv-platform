'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  CalendarClock,
  Plus,
  ChevronLeft,
  ChevronRight,
  Trash2,
  List,
  CalendarDays,
  RefreshCw,
  Pencil,
} from 'lucide-react';
import { Header } from '@/components/dashboard/Header';
import { CreateScheduleModal } from '@/components/scheduler/CreateScheduleModal';
import { useSchedules, useDeleteSchedule, Schedule } from '@/hooks/useSchedules';
import apiClient from '@/lib/api-client';
import { cn } from '@/lib/utils';

// ─── helpers ──────────────────────────────────────────────────────────────────

const DAY_LABELS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0 = Sunday
  d.setDate(d.getDate() - day);
  return d;
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function formatDateLabel(d: Date): string {
  return d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
}

/** Returns minutes from midnight for an ISO date */
function minutesFromMidnight(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}

const RECURRENCE_BADGE: Record<string, { label: string; color: string }> = {
  ONCE: { label: 'Una vez', color: 'bg-slate-500/20 text-slate-400' },
  DAILY: { label: 'Diario', color: 'bg-green-500/20 text-green-400' },
  WEEKLY: { label: 'Semanal', color: 'bg-blue-500/20 text-blue-400' },
  WEEKDAYS: { label: 'L–V', color: 'bg-purple-500/20 text-purple-400' },
  WEEKENDS: { label: 'S–D', color: 'bg-orange-500/20 text-orange-400' },
};

/** Returns the colour track for a schedule (by index) */
const TRACK_COLORS = [
  'bg-brand-600/30 border-brand-500/50 text-brand-300',
  'bg-green-600/30 border-green-500/50 text-green-300',
  'bg-purple-600/30 border-purple-500/50 text-purple-300',
  'bg-orange-600/30 border-orange-500/50 text-orange-300',
  'bg-rose-600/30 border-rose-500/50 text-rose-300',
];

// ─── component ────────────────────────────────────────────────────────────────

export default function SchedulerPage() {
  const [channelId, setChannelId] = useState<string | null>(null);
  const [weekStart, setWeekStart] = useState<Date>(() => getWeekStart(new Date()));
  const [view, setView] = useState<'week' | 'list'>('week');
  const [showCreate,    setShowCreate]    = useState(false);
  const [createStart,   setCreateStart]   = useState<string | undefined>();
  const [editSchedule,  setEditSchedule]  = useState<Schedule | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  useEffect(() => {
    apiClient.get('/channels').then(({ data }) => {
      if (data.length > 0) setChannelId(data[0].id);
    });
  }, []);

  const weekEnd = useMemo(() => {
    const d = addDays(weekStart, 6);
    d.setHours(23, 59, 59, 999);
    return d;
  }, [weekStart]);

  const { data: schedules = [], isLoading, refetch } = useSchedules(
    channelId,
    weekStart.toISOString(),
    weekEnd.toISOString(),
  );

  const deleteSchedule = useDeleteSchedule();

  const handleDelete = async (id: string) => {
    await deleteSchedule.mutateAsync(id);
    setConfirmDelete(null);
  };

  const handleCellClick = (dayIndex: number, hour: number) => {
    const d = addDays(weekStart, dayIndex);
    d.setHours(hour, 0, 0, 0);
    setCreateStart(d.toISOString());
    setShowCreate(true);
  };

  // Map schedules to their day column for the week view
  const schedulesByDay: Record<number, Schedule[]> = useMemo(() => {
    const map: Record<number, Schedule[]> = {};
    for (let i = 0; i < 7; i++) map[i] = [];
    schedules.forEach((sch) => {
      const schDay = new Date(sch.startTime);
      for (let i = 0; i < 7; i++) {
        const col = addDays(weekStart, i);
        if (formatDate(schDay) === formatDate(col)) {
          map[i].push(sch);
        }
      }
    });
    return map;
  }, [schedules, weekStart]);

  const weekLabel = useMemo(() => {
    const end = addDays(weekStart, 6);
    if (weekStart.getMonth() === end.getMonth()) {
      return weekStart.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
    }
    return (
      weekStart.toLocaleDateString('es-AR', { month: 'short' }) +
      ' – ' +
      end.toLocaleDateString('es-AR', { month: 'short', year: 'numeric' })
    );
  }, [weekStart]);

  const today = formatDate(new Date());

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <Header
        title="Programación"
        subtitle="Planificá la emisión de tu canal semana a semana"
      />

      <div className="flex-1 flex flex-col p-6 gap-4 overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center justify-between flex-shrink-0">
          {/* Week navigation */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setWeekStart((w) => addDays(w, -7))}
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-white/10 text-slate-400 hover:text-white hover:border-white/20 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => setWeekStart(getWeekStart(new Date()))}
              className="px-3 h-8 text-xs font-medium rounded-lg border border-white/10 text-slate-400 hover:text-white hover:border-white/20 transition-colors capitalize"
            >
              {weekLabel}
            </button>
            <button
              onClick={() => setWeekStart((w) => addDays(w, 7))}
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-white/10 text-slate-400 hover:text-white hover:border-white/20 transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <button
              onClick={() => refetch()}
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-white/10 text-slate-400 hover:text-white hover:border-white/20 transition-colors"
              title="Actualizar"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Right controls */}
          <div className="flex items-center gap-2">
            {/* View toggle */}
            <div className="flex rounded-lg border border-white/10 overflow-hidden">
              <button
                onClick={() => setView('week')}
                className={cn(
                  'px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 transition-colors',
                  view === 'week'
                    ? 'bg-brand-600/20 text-white'
                    : 'text-slate-400 hover:text-white hover:bg-white/5',
                )}
              >
                <CalendarDays className="w-3.5 h-3.5" />
                Semana
              </button>
              <button
                onClick={() => setView('list')}
                className={cn(
                  'px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 transition-colors border-l border-white/10',
                  view === 'list'
                    ? 'bg-brand-600/20 text-white'
                    : 'text-slate-400 hover:text-white hover:bg-white/5',
                )}
              >
                <List className="w-3.5 h-3.5" />
                Lista
              </button>
            </div>

            <button
              onClick={() => { setCreateStart(undefined); setShowCreate(true); }}
              disabled={!channelId}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-brand-600 hover:bg-brand-500 text-white transition-colors disabled:opacity-50"
            >
              <Plus className="w-4 h-4" />
              Nueva
            </button>
          </div>
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="w-8 h-8 border-2 border-brand-500/30 border-t-brand-500 rounded-full animate-spin" />
          </div>
        ) : view === 'week' ? (
          <WeekView
            weekStart={weekStart}
            schedulesByDay={schedulesByDay}
            today={today}
            onCellClick={handleCellClick}
            onEditRequest={setEditSchedule}
            onDeleteRequest={setConfirmDelete}
          />
        ) : (
          <ListView
            schedules={schedules}
            onEditRequest={setEditSchedule}
            onDeleteRequest={setConfirmDelete}
          />
        )}
      </div>

      {/* Modals */}
      {showCreate && channelId && (
        <CreateScheduleModal
          channelId={channelId}
          initialStart={createStart}
          onClose={() => setShowCreate(false)}
        />
      )}

      {editSchedule && channelId && (
        <CreateScheduleModal
          channelId={channelId}
          schedule={editSchedule}
          onClose={() => setEditSchedule(null)}
        />
      )}

      {confirmDelete && (
        <ConfirmDeleteModal
          onConfirm={() => handleDelete(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
          isPending={deleteSchedule.isPending}
        />
      )}
    </div>
  );
}

// ─── Week view ────────────────────────────────────────────────────────────────

const CELL_HEIGHT = 48; // px per hour
const TOTAL_HEIGHT = CELL_HEIGHT * 24;

/** Formatea duración en segundos → "2h 30m" */
function fmtDur(seconds: number): string {
  const m = Math.round(Math.max(0, seconds) / 60);
  const h = Math.floor(m / 60);
  const min = m % 60;
  if (h === 0) return `${min}m`;
  if (min === 0) return `${h}h`;
  return `${h}h ${min}m`;
}

function slotDur(startIso: string, endIso: string): number {
  return Math.max(0, (new Date(endIso).getTime() - new Date(startIso).getTime()) / 1000);
}

function WeekView({
  weekStart,
  schedulesByDay,
  today,
  onCellClick,
  onEditRequest,
  onDeleteRequest,
}: {
  weekStart: Date;
  schedulesByDay: Record<number, Schedule[]>;
  today: string;
  onCellClick: (dayIndex: number, hour: number) => void;
  onEditRequest: (s: Schedule) => void;
  onDeleteRequest: (id: string) => void;
}) {
  return (
    <div className="flex-1 overflow-auto rounded-xl border border-white/10 bg-surface-800">
      {/* Header row */}
      <div className="grid grid-cols-[56px_repeat(7,1fr)] border-b border-white/10 sticky top-0 bg-surface-800 z-10">
        <div className="text-xs text-slate-600 flex items-end justify-center pb-2 border-r border-white/10">
          UTC
        </div>
        {Array.from({ length: 7 }, (_, i) => {
          const d = addDays(weekStart, i);
          const iso = formatDate(d);
          const isToday = iso === today;
          return (
            <div
              key={i}
              className={cn(
                'flex flex-col items-center justify-center py-2 border-r border-white/10 last:border-r-0',
                isToday && 'bg-brand-600/10',
              )}
            >
              <span className="text-xs text-slate-500 uppercase tracking-wider">
                {DAY_LABELS[d.getDay()]}
              </span>
              <span
                className={cn(
                  'text-sm font-semibold mt-0.5',
                  isToday ? 'text-brand-400' : 'text-white',
                )}
              >
                {d.getDate()}
              </span>
              <span className="text-xs text-slate-600">{formatDateLabel(d)}</span>
            </div>
          );
        })}
      </div>

      {/* Time grid */}
      <div className="grid grid-cols-[56px_repeat(7,1fr)]" style={{ height: TOTAL_HEIGHT }}>
        {/* Hour labels */}
        <div className="border-r border-white/10 relative">
          {HOURS.map((h) => (
            <div
              key={h}
              className="absolute w-full flex items-start justify-end pr-2"
              style={{ top: h * CELL_HEIGHT, height: CELL_HEIGHT }}
            >
              <span className="text-xs text-slate-600 leading-none mt-1">
                {String(h).padStart(2, '0')}:00
              </span>
            </div>
          ))}
        </div>

        {/* Day columns */}
        {Array.from({ length: 7 }, (_, dayIdx) => {
          const d = addDays(weekStart, dayIdx);
          const iso = formatDate(d);
          const isToday = iso === today;
          const daySchedules = schedulesByDay[dayIdx] ?? [];

          return (
            <div
              key={dayIdx}
              className={cn(
                'relative border-r border-white/10 last:border-r-0',
                isToday && 'bg-brand-600/5',
              )}
              style={{ height: TOTAL_HEIGHT }}
            >
              {/* Hour cells (click to create) */}
              {HOURS.map((h) => (
                <div
                  key={h}
                  className="absolute w-full border-t border-white/5 cursor-pointer hover:bg-white/[0.02] transition-colors"
                  style={{ top: h * CELL_HEIGHT, height: CELL_HEIGHT }}
                  onClick={() => onCellClick(dayIdx, h)}
                  title={`Nueva programación — ${String(h).padStart(2, '0')}:00`}
                />
              ))}

              {/* Schedule blocks */}
              {daySchedules.map((sch, idx) => {
                const startMin = minutesFromMidnight(sch.startTime);
                const endMin   = minutesFromMidnight(sch.endTime);
                const top      = (startMin / 60) * CELL_HEIGHT;
                const height   = Math.max(((endMin - startMin) / 60) * CELL_HEIGHT, 20);
                const colorClass = TRACK_COLORS[idx % TRACK_COLORS.length];
                const dur = slotDur(sch.startTime, sch.endTime);

                return (
                  <div
                    key={sch.id}
                    className={cn(
                      'absolute left-0.5 right-0.5 rounded border overflow-hidden group',
                      colorClass,
                    )}
                    style={{ top, height }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="px-1.5 pt-1 flex items-start justify-between gap-1">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold leading-tight truncate">{sch.name}</p>
                        {height > 28 && (
                          <p className="text-[10px] opacity-70 truncate leading-tight">
                            {formatTime(sch.startTime)} – {formatTime(sch.endTime)}
                          </p>
                        )}
                        {height > 42 && (
                          <p className="text-[10px] opacity-60 truncate leading-tight">
                            ⏱ {fmtDur(dur)}
                          </p>
                        )}
                      </div>
                      {/* Acciones: editar + eliminar (visibles al hover) */}
                      <div className="flex-shrink-0 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => onEditRequest(sch)}
                          className="p-0.5 rounded hover:bg-white/20 transition-colors"
                          title="Editar"
                        >
                          <Pencil className="w-2.5 h-2.5" />
                        </button>
                        <button
                          onClick={() => onDeleteRequest(sch.id)}
                          className="p-0.5 rounded hover:bg-white/20 transition-colors"
                          title="Eliminar"
                        >
                          <Trash2 className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── List view ────────────────────────────────────────────────────────────────

function ListView({
  schedules,
  onEditRequest,
  onDeleteRequest,
}: {
  schedules: Schedule[];
  onEditRequest: (s: Schedule) => void;
  onDeleteRequest: (id: string) => void;
}) {
  if (schedules.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center">
        <div className="glass-card p-16 text-center max-w-sm mx-auto">
          <div className="w-16 h-16 rounded-2xl bg-surface-700 flex items-center justify-center mx-auto mb-4">
            <CalendarClock className="w-8 h-8 text-slate-600" />
          </div>
          <h3 className="text-base font-semibold text-white mb-2">Sin programación</h3>
          <p className="text-sm text-slate-500">
            No hay programas para esta semana. Usá el botón "Nueva" para agregar uno.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto space-y-2">
      {schedules.map((sch) => {
        const badge = RECURRENCE_BADGE[sch.recurrence] ?? RECURRENCE_BADGE.ONCE;
        const dur   = slotDur(sch.startTime, sch.endTime);
        return (
          <div
            key={sch.id}
            className="glass-card px-4 py-3 flex items-center gap-4 hover:border-white/10 transition-colors group"
          >
            {/* Time block */}
            <div className="flex-shrink-0 w-32 text-center">
              <p className="text-sm font-mono font-semibold text-white">
                {formatTime(sch.startTime)}
              </p>
              <p className="text-xs text-slate-500">
                → {formatTime(sch.endTime)}
              </p>
              <p className="text-xs text-slate-600 mt-0.5">
                {new Date(sch.startTime).toLocaleDateString('es-AR', {
                  weekday: 'short', day: 'numeric', month: 'short',
                })}
              </p>
              {/* Duración del bloque */}
              <p className="text-[11px] text-brand-400 font-medium mt-0.5">⏱ {fmtDur(dur)}</p>
            </div>

            {/* Divider */}
            <div className="w-px h-12 bg-white/10 flex-shrink-0" />

            {/* Info */}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">{sch.name}</p>
              <p className="text-xs text-slate-500 truncate">
                {sch.playlist ? sch.playlist.name : 'Sin playlist asignada'}
              </p>
            </div>

            {/* Badge */}
            <span className={cn('flex-shrink-0 text-xs px-2 py-0.5 rounded-full font-medium', badge.color)}>
              {badge.label}
            </span>

            {/* Priority */}
            {sch.priority > 0 && (
              <span className="flex-shrink-0 text-xs text-slate-600 font-mono">P{sch.priority}</span>
            )}

            {/* Acciones */}
            <div className="flex-shrink-0 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={() => onEditRequest(sch)}
                className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-white/10 transition-colors"
                title="Editar"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => onDeleteRequest(sch.id)}
                className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                title="Eliminar"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Confirm delete modal ─────────────────────────────────────────────────────

function ConfirmDeleteModal({
  onConfirm,
  onCancel,
  isPending,
}: {
  onConfirm: () => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative bg-surface-800 border border-white/10 rounded-2xl shadow-2xl p-6 max-w-sm w-full">
        <h3 className="text-base font-semibold text-white mb-2">¿Eliminar programación?</h3>
        <p className="text-sm text-slate-400 mb-5">Esta acción no se puede deshacer.</p>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2 rounded-lg text-sm text-slate-400 hover:text-white border border-white/10 hover:border-white/20 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            disabled={isPending}
            className="flex-1 px-4 py-2 rounded-lg text-sm font-medium bg-red-600 hover:bg-red-500 text-white transition-colors disabled:opacity-50"
          >
            {isPending ? 'Eliminando...' : 'Eliminar'}
          </button>
        </div>
      </div>
    </div>
  );
}
