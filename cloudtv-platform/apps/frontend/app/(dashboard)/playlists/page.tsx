'use client';

import { useState, useEffect } from 'react';
import { ListVideo, Plus, Trash2, Star, MoreHorizontal } from 'lucide-react';
import { Header } from '@/components/dashboard/Header';
import { CreatePlaylistModal } from '@/components/playlists/CreatePlaylistModal';
import { PlaylistDetail } from '@/components/playlists/PlaylistDetail';
import { usePlaylists, useDeletePlaylist, useUpdatePlaylist } from '@/hooks/usePlaylists';
import { formatDuration } from '@/lib/utils';
import apiClient from '@/lib/api-client';

const LOOP_LABELS: Record<string, string> = {
  LOOP_ALL: 'Repetir lista',
  LOOP_ONE: 'Repetir uno',
  SEQUENTIAL: 'Una vez',
};

export default function PlaylistsPage() {
  const [channelId, setChannelId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);

  useEffect(() => {
    apiClient.get('/channels').then(({ data }) => {
      if (data.length > 0) setChannelId(data[0].id);
    });
  }, []);

  const { data: playlists = [], isLoading } = usePlaylists(channelId);
  const deletePlaylist = useDeletePlaylist();
  const updatePlaylist = useUpdatePlaylist();

  const handleDelete = (id: string) => {
    if (!confirm('¿Eliminar esta playlist?')) return;
    deletePlaylist.mutate(id);
    if (selectedId === id) setSelectedId(null);
  };

  const handleSetDefault = (id: string) => {
    updatePlaylist.mutate({ id, data: { isDefault: true } });
    setMenuId(null);
  };

  // Vista de detalle de una playlist
  if (selectedId && channelId) {
    return (
      <div className="flex flex-col flex-1">
        <Header title="Playlists" subtitle="Organizá el contenido de tu canal" />
        <div className="flex-1 p-6 overflow-y-auto">
          <PlaylistDetail
            playlistId={selectedId}
            channelId={channelId}
            onBack={() => setSelectedId(null)}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1">
      <Header title="Playlists" subtitle="Organizá el contenido de tu canal" />

      <div className="flex-1 p-6 space-y-5 overflow-y-auto">
        {/* Toolbar */}
        <div className="flex justify-end">
          <button
            onClick={() => setShowCreate(true)}
            disabled={!channelId}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-brand-600 hover:bg-brand-500 text-white transition-colors disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />
            Nueva playlist
          </button>
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="glass-card h-32 animate-pulse" />
            ))}
          </div>
        ) : playlists.length === 0 ? (
          <div className="glass-card p-16 text-center">
            <div className="w-16 h-16 rounded-2xl bg-surface-700 flex items-center justify-center mx-auto mb-4">
              <ListVideo className="w-8 h-8 text-slate-600" />
            </div>
            <h3 className="text-base font-semibold text-white mb-2">No hay playlists</h3>
            <p className="text-sm text-slate-500 mb-6">
              Creá playlists para organizar tus videos y programar la emisión 24/7.
            </p>
            <button
              onClick={() => setShowCreate(true)}
              disabled={!channelId}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium text-sm bg-brand-600 hover:bg-brand-500 text-white transition-colors"
            >
              <Plus className="w-4 h-4" />
              Crear primera playlist
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {playlists.map((pl) => (
              <div
                key={pl.id}
                className="glass-card p-4 hover:border-white/10 transition-all cursor-pointer group"
                onClick={() => setSelectedId(pl.id)}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-brand-600/20 flex items-center justify-center flex-shrink-0">
                      <ListVideo className="w-4 h-4 text-brand-400" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-medium text-white truncate">{pl.name}</p>
                        {pl.isDefault && (
                          <Star className="w-3 h-3 text-yellow-400 fill-yellow-400 flex-shrink-0" />
                        )}
                      </div>
                      <p className="text-xs text-slate-500">{LOOP_LABELS[pl.loopMode]}</p>
                    </div>
                  </div>

                  {/* Menu */}
                  <div
                    className="relative flex-shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      onClick={() => setMenuId(menuId === pl.id ? null : pl.id)}
                      className="w-7 h-7 flex items-center justify-center rounded text-slate-500 hover:text-white hover:bg-white/10 transition-colors opacity-0 group-hover:opacity-100"
                    >
                      <MoreHorizontal className="w-4 h-4" />
                    </button>
                    {menuId === pl.id && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setMenuId(null)} />
                        <div className="absolute right-0 top-8 z-20 w-40 rounded-lg border border-white/10 bg-surface-600 shadow-xl overflow-hidden">
                          {!pl.isDefault && (
                            <button
                              onClick={() => handleSetDefault(pl.id)}
                              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-300 hover:bg-white/5 hover:text-white transition-colors"
                            >
                              <Star className="w-3.5 h-3.5" />
                              Marcar default
                            </button>
                          )}
                          <button
                            onClick={() => handleDelete(pl.id)}
                            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            Eliminar
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3 text-xs text-slate-500">
                  <span>{pl._count?.items ?? 0} videos</span>
                  {pl.totalDuration ? (
                    <span>· {formatDuration(pl.totalDuration)}</span>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showCreate && channelId && (
        <CreatePlaylistModal
          channelId={channelId}
          onClose={() => setShowCreate(false)}
        />
      )}
    </div>
  );
}
