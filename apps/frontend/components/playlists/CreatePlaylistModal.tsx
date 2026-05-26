'use client';

import { useState } from 'react';
import { X, ListVideo } from 'lucide-react';
import { useCreatePlaylist } from '@/hooks/usePlaylists';

interface Props {
  channelId: string;
  onClose: () => void;
}

export function CreatePlaylistModal({ channelId, onClose }: Props) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [loopMode, setLoopMode] = useState('LOOP_ALL');
  const create = useCreatePlaylist();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    await create.mutateAsync({ channelId, name: name.trim(), description, loopMode });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md bg-surface-800 border border-white/10 rounded-2xl shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-brand-600/20 flex items-center justify-center">
              <ListVideo className="w-4 h-4 text-brand-400" />
            </div>
            <h2 className="text-base font-semibold text-white">Nueva playlist</h2>
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
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">
              Nombre <span className="text-red-400">*</span>
            </label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: Contenido principal"
              maxLength={100}
              className="w-full px-3 py-2 rounded-lg text-sm bg-surface-700 border border-white/10 text-white placeholder-slate-500
                         focus:outline-none focus:ring-1 focus:ring-brand-500/50 focus:border-brand-500 transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">
              Descripción
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Descripción opcional..."
              rows={2}
              maxLength={500}
              className="w-full px-3 py-2 rounded-lg text-sm bg-surface-700 border border-white/10 text-white placeholder-slate-500
                         focus:outline-none focus:ring-1 focus:ring-brand-500/50 focus:border-brand-500 transition-colors resize-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">
              Modo de reproducción
            </label>
            <select
              value={loopMode}
              onChange={(e) => setLoopMode(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-sm bg-surface-700 border border-white/10 text-white
                         focus:outline-none focus:ring-1 focus:ring-brand-500/50 focus:border-brand-500 transition-colors"
            >
              <option value="LOOP_ALL">Repetir toda la lista</option>
              <option value="LOOP_ONE">Repetir video actual</option>
              <option value="SEQUENTIAL">Reproducir una vez</option>
            </select>
          </div>

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
              disabled={!name.trim() || create.isPending}
              className="flex-1 px-4 py-2 rounded-lg text-sm font-medium bg-brand-600 hover:bg-brand-500 text-white transition-colors
                         disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {create.isPending ? 'Creando...' : 'Crear playlist'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
