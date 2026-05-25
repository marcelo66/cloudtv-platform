'use client';

import { ListVideo, Plus } from 'lucide-react';
import { Header } from '@/components/dashboard/Header';

export default function PlaylistsPage() {
  return (
    <div className="flex flex-col flex-1">
      <Header title="Playlists" subtitle="Organizá el contenido de tu canal" />
      <div className="flex-1 p-6">
        <div className="flex justify-end mb-6">
          <button className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-brand-600 hover:bg-brand-500 text-white transition-colors">
            <Plus className="w-4 h-4" />
            Nueva playlist
          </button>
        </div>
        <div className="glass-card p-16 text-center">
          <div className="w-16 h-16 rounded-2xl bg-surface-700 flex items-center justify-center mx-auto mb-4">
            <ListVideo className="w-8 h-8 text-slate-600" />
          </div>
          <h3 className="text-base font-semibold text-white mb-2">No hay playlists</h3>
          <p className="text-sm text-slate-500">
            Creá playlists para organizar tus videos y programar la emisión 24/7.
          </p>
        </div>
      </div>
    </div>
  );
}
