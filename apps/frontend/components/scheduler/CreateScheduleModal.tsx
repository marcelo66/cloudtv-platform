'use client';

import { useState, useMemo } from 'react';
import { X, CalendarClock, Clapperboard, Clock, Info } from 'lucide-react';
import { useCreateSchedule, useUpdateSchedule, Schedule } from '@/hooks/useSchedules';
import { usePlaylists } from '@/hooks/usePlaylists';
import { useAdBlocks } from '@/hooks/useAdBlocks';
import { cn } from '@/lib/utils';

interface Props {
  channelId: string;
  initialStart?: string;   // solo para creación
  schedule?:    Schedule;  // si viene → modo edición
  onClose: () => void;
}

const RECURRENCE_OPTIONS = [
  { value: 'ONCE',     label: 'Una vez' },
  { value: 'DAILY',    label: 'Todos los días' },
  { value: 'WEEKLY',   label: 'Semanal (mismo día)' },
  { value: 'WEEKDAYS', label: 'Lunes a viernes' },
  { value: 'WEEKENDS', label: 'Fines de semana' },
];

function toLocalDatetimeValue(iso?: string): string {
  if (!iso) {
    const d = new Date();
    d.setMinutes(0, 0, 0);
    d.setHours(d.getHours() + 1);
    return d.toISOString().slice(0, 16);
  }
  // Convertir ISO → datetime-local en hora local
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Formatea segundos como "2h 30m" o "45m" */
function formatDur(seconds: number): string {
  const totalMin = Math.round(Math.max(0, seconds) / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** Duración del bloque en segundos a partir de dos strings datetime-local */
function slotSeconds(start: string, end: string): number {
  if (!start || !end) return 0;
  return Math.max(0, (new Date(end).getTime() - new Date(start).getTime()) / 1000);
}

export function CreateScheduleModal({ channelId, initialStart, schedule, onClose }: Props) {
  const isEdit = !!schedule;

  const create = useCreateSchedule();
  const update = useUpdateSchedule();
  const { data: playlists = [] } = usePlaylists(channelId);
  const { data: adBlocks = [] } = useAdBlocks(channelId);

  // Valores iniciales: del schedule existente (edit) o defaults (create)
  const defaultStart = toLocalDatetimeValue(schedule?.startTime ?? initialStart);
  const defaultEnd   = schedule?.endTime
    ? toLocalDatetimeValue(schedule.endTime)
    : (() => {
        const d = new Date(defaultStart);
        d.setHours(d.getHours() + 1);
        return d.toISOString().slice(0, 16);
      })();

  const [name,         setName]         = useState(schedule?.name ?? '');
  const [playlistId,   setPlaylistId]   = useState(schedule?.playlistId ?? '');
  const [startTime,    setStartTime]    = useState(defaultStart);
  const [endTime,      setEndTime]      = useState(defaultEnd);
  type Recurrence = 'ONCE' | 'DAILY' | 'WEEKLY' | 'WEEKDAYS' | 'WEEKENDS';
  const [recurrence,   setRecurrence]   = useState<Recurrence>((schedule?.recurrence as Recurrence) ?? 'ONCE');
  const [priority,     setPriority]     = useState(schedule?.priority ?? 0);
  const [preAdBlockId, setPreAdBlockId] = useState(schedule?.preAdBlockId ?? '');
  const [postAdBlockId,setPostAdBlockId]= useState(schedule?.postAdBlockId ?? '');

  // ── Duración del bloque ──────────────────────────────────────────────────────
  const slotSec = useMemo(() => slotSeconds(startTime, endTime), [startTime, endTime]);
  const slotLabel = slotSec > 0 ? formatDur(slotSec) : '—';
  const slotValid = slotSec > 0;

  // ── Comparación playlist vs. slot ───────────────────────────────────────────
  const selectedPlaylist = playlists.find(p => p.id === playlistId);
  const plDuration = selectedPlaylist?.totalDuration ?? null;

  const fitInfo = useMemo(() => {
    if (!plDuration || !slotValid) return null;
    const diff = plDuration - slotSec;
    if (Math.abs(diff) < 60)
      return { color: 'text-green-400', bg: 'bg-green-500/10 border-green-500/20', icon: '✓', text: 'Encaja perfectamente con el bloque' };
    if (diff < 0)
      return { color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20', icon: '↺', text: `${formatDur(-diff)} más corta que el bloque — se repetirá en loop` };
    return { color: 'text-orange-400', bg: 'bg-orange-500/10 border-orange-500/20', icon: '✂', text: `${formatDur(diff)} más larga que el bloque — se cortará al finalizar` };
  }, [plDuration, slotSec, slotValid]);

  // ── Submit ───────────────────────────────────────────────────────────────────
  const isLoading = create.isPending || update.isPending;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !slotValid) return;

    const payload = {
      name:          name.trim(),
      playlistId:    playlistId || undefined,
      startTime:     new Date(startTime).toISOString(),
      endTime:       new Date(endTime).toISOString(),
      recurrence,
      priority,
      preAdBlockId:  preAdBlockId  || undefined,
      postAdBlockId: postAdBlockId || undefined,
    };

    if (isEdit) {
      await update.mutateAsync({ id: schedule!.id, data: payload });
    } else {
      await create.mutateAsync({ channelId, ...payload });
    }
    onClose();
  };

  const inputClass =
    'w-full px-3 py-2 rounded-lg text-sm bg-surface-700 border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-brand-500/50 focus:border-brand-500 transition-colors';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md bg-surface-800 border border-white/10 rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto">

        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-white/10 sticky top-0 bg-surface-800 z-10">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-brand-600/20 flex items-center justify-center">
              <CalendarClock className="w-4 h-4 text-brand-400" />
            </div>
            <h2 className="text-base font-semibold text-white">
              {isEdit ? 'Editar programación' : 'Nueva programación'}
            </h2>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">

          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">
              Nombre <span className="text-red-400">*</span>
            </label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: Bloque de noticias"
              maxLength={100}
              className={inputClass}
            />
          </div>

          {/* Start / End + slot duration */}
          <div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">
                  Inicio <span className="text-red-400">*</span>
                </label>
                <input
                  type="datetime-local"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">
                  Fin <span className="text-red-400">*</span>
                </label>
                <input
                  type="datetime-local"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className={inputClass}
                />
              </div>
            </div>

            {/* Slot duration pill */}
            <div className={cn(
              'mt-2 flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs',
              slotValid && slotSec > 0
                ? 'bg-brand-500/10 border-brand-500/20 text-brand-300'
                : 'bg-surface-700 border-white/10 text-slate-500',
            )}>
              <Clock className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="font-medium">Duración del bloque:</span>
              <span className="font-bold">{slotLabel}</span>
              {!slotValid && startTime && endTime && (
                <span className="text-red-400 ml-1">— el fin debe ser posterior al inicio</span>
              )}
            </div>
          </div>

          {/* Playlist + fit indicator */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">
              Playlist <span className="text-slate-600">(opcional)</span>
            </label>
            <select
              value={playlistId}
              onChange={(e) => setPlaylistId(e.target.value)}
              className={inputClass}
            >
              <option value="">— Sin playlist —</option>
              {playlists.map((pl) => (
                <option key={pl.id} value={pl.id}>
                  {pl.name}
                  {pl.totalDuration ? ` (${formatDur(pl.totalDuration)})` : ''}
                </option>
              ))}
            </select>

            {/* Fit indicator */}
            {fitInfo && (
              <div className={cn(
                'mt-2 flex items-start gap-2 px-3 py-2 rounded-lg border text-xs',
                fitInfo.bg,
              )}>
                <span className={cn('text-base leading-none mt-0.5 flex-shrink-0', fitInfo.color)}>
                  {fitInfo.icon}
                </span>
                <div>
                  <span className={cn('font-medium', fitInfo.color)}>{fitInfo.text}</span>
                  {plDuration && (
                    <span className="text-slate-500 ml-1">
                      (playlist: {formatDur(plDuration)})
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Sin playlist seleccionada pero con duración de bloque */}
            {!playlistId && slotValid && playlists.length > 0 && (
              <p className="mt-1.5 text-[11px] text-slate-600 flex items-center gap-1">
                <Info className="w-3 h-3" />
                Seleccioná una playlist para ver si encaja en el bloque de {slotLabel}
              </p>
            )}
          </div>

          {/* Recurrence */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Repetición</label>
            <select
              value={recurrence}
              onChange={(e) => setRecurrence(e.target.value)}
              className={inputClass}
            >
              {RECURRENCE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* Priority */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">
              Prioridad <span className="text-slate-600">(mayor número = mayor prioridad)</span>
            </label>
            <input
              type="number"
              min={0}
              max={100}
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value))}
              className={inputClass}
            />
          </div>

          {/* Publicidad del programa */}
          {adBlocks.length > 0 && (
            <div className="rounded-xl border border-white/8 bg-surface-700/30 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Clapperboard className="w-3.5 h-3.5 text-amber-400" />
                <span className="text-xs font-semibold text-slate-300">Publicidad del programa</span>
                <span className="text-[10px] text-slate-600 ml-auto">opcional</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-medium text-slate-500 mb-1">Tanda al inicio</label>
                  <select value={preAdBlockId} onChange={(e) => setPreAdBlockId(e.target.value)} className={inputClass}>
                    <option value="">— Sin tanda —</option>
                    {adBlocks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-500 mb-1">Tanda al final</label>
                  <select value={postAdBlockId} onChange={(e) => setPostAdBlockId(e.target.value)} className={inputClass}>
                    <option value="">— Sin tanda —</option>
                    {adBlocks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
              </div>
              <p className="text-[10px] text-slate-600 leading-relaxed">
                La tanda al inicio se emite justo antes de que arranque el programa.
                La del final, inmediatamente después.
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 rounded-lg text-sm text-slate-400 hover:text-white border border-white/10 hover:border-white/20 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!name.trim() || !slotValid || isLoading}
              className="flex-1 px-4 py-2 rounded-lg text-sm font-medium bg-brand-600 hover:bg-brand-500 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? 'Guardando...' : isEdit ? 'Guardar cambios' : 'Crear'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
