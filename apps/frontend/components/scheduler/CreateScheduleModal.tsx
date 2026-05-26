'use client';

import { useState } from 'react';
import { X, CalendarClock } from 'lucide-react';
import { useCreateSchedule } from '@/hooks/useSchedules';
import { usePlaylists } from '@/hooks/usePlaylists';

interface Props {
  channelId: string;
  initialStart?: string; // ISO or datetime-local string
  onClose: () => void;
}

const RECURRENCE_OPTIONS = [
  { value: 'ONCE', label: 'Una vez' },
  { value: 'DAILY', label: 'Todos los días' },
  { value: 'WEEKLY', label: 'Semanal (mismo día)' },
  { value: 'WEEKDAYS', label: 'Lunes a viernes' },
  { value: 'WEEKENDS', label: 'Fines de semana' },
];

function toLocalDatetimeValue(iso?: string): string {
  if (!iso) {
    // default: today at next full hour
    const d = new Date();
    d.setMinutes(0, 0, 0);
    d.setHours(d.getHours() + 1);
    return d.toISOString().slice(0, 16);
  }
  return new Date(iso).toISOString().slice(0, 16);
}

export function CreateScheduleModal({ channelId, initialStart, onClose }: Props) {
  const create = useCreateSchedule();
  const { data: playlists = [] } = usePlaylists(channelId);

  const defaultStart = toLocalDatetimeValue(initialStart);
  const defaultEnd = (() => {
    const d = new Date(defaultStart);
    d.setHours(d.getHours() + 1);
    return d.toISOString().slice(0, 16);
  })();

  const [name, setName] = useState('');
  const [playlistId, setPlaylistId] = useState('');
  const [startTime, setStartTime] = useState(defaultStart);
  const [endTime, setEndTime] = useState(defaultEnd);
  const [recurrence, setRecurrence] = useState('ONCE');
  const [priority, setPriority] = useState(0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    await create.mutateAsync({
      channelId,
      name: name.trim(),
      playlistId: playlistId || undefined,
      startTime: new Date(startTime).toISOString(),
      endTime: new Date(endTime).toISOString(),
      recurrence,
      priority,
    });
    onClose();
  };

  const inputClass =
    'w-full px-3 py-2 rounded-lg text-sm bg-surface-700 border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-brand-500/50 focus:border-brand-500 transition-colors';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md bg-surface-800 border border-white/10 rounded-2xl shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-brand-600/20 flex items-center justify-center">
              <CalendarClock className="w-4 h-4 text-brand-400" />
            </div>
            <h2 className="text-base font-semibold text-white">Nueva programación</h2>
          </div>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-white transition-colors"
          >
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

          {/* Playlist */}
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
                </option>
              ))}
            </select>
          </div>

          {/* Start / End */}
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

          {/* Recurrence */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">
              Repetición
            </label>
            <select
              value={recurrence}
              onChange={(e) => setRecurrence(e.target.value)}
              className={inputClass}
            >
              {RECURRENCE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Priority */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">
              Prioridad{' '}
              <span className="text-slate-600">(mayor número = mayor prioridad)</span>
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
              disabled={!name.trim() || !startTime || !endTime || create.isPending}
              className="flex-1 px-4 py-2 rounded-lg text-sm font-medium bg-brand-600 hover:bg-brand-500 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {create.isPending ? 'Guardando...' : 'Crear'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
