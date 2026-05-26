'use client';

import { useState } from 'react';
import { ArrowLeft, Plus, Trash2, Film, GripVertical, RefreshCw, Check } from 'lucide-react';
import { usePlaylist, useAddPlaylistItem, useRemovePlaylistItem } from '@/hooks/usePlaylists';
import { useVideos } from '@/hooks/useVideos';
import { formatDuration } from '@/lib/utils';

interface Props {
  playlistId: string;
  channelId: string;
  onBack: () => void;
}

const LOOP_LABELS: Record<string, string> = {
  LOOP_ALL: 'Repetir lista',
  LOOP_ONE: 'Repetir uno',
  SEQUENTIAL: 'Una vez',
};

export function PlaylistDetail({ playlistId, channelId, onBack }: Props) {
  const [showAddVideo, setShowAddVideo] = useState(false);
  const { data: playlist, isLoading } = usePlaylist(playlistId);
  const { data: allVideos = [] } = useVideos(channelId);
  const addItem = useAddPlaylistItem();
  const removeItem = useRemovePlaylistItem();

  const readyVideos = allVideos.filter((v) => v.status === 'READY');
  const itemVideoIds = new Set(playlist?.items?.map((i) => i.video.id) ?? []);
  // Mostrar TODOS los videos ready; marcar los que ya están en la playlist
  const availableVideos = readyVideos;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48">
        <RefreshCw className="w-5 h-5 text-slate-500 animate-spin" />
      </div>
    );
  }

  if (!playlist) return null;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Volver
        </button>
        <div className="flex-1">
          <h2 className="text-base font-semibold text-white">{playlist.name}</h2>
          <p className="text-xs text-slate-500">
            {playlist._count?.items ?? playlist.items?.length ?? 0} videos
            {playlist.totalDuration ? ` · ${formatDuration(playlist.totalDuration)}` : ''}
            {' · '}
            {LOOP_LABELS[playlist.loopMode]}
          </p>
        </div>
        <button
          onClick={() => setShowAddVideo(!showAddVideo)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium bg-brand-600 hover:bg-brand-500 text-white transition-colors"
        >
          <Plus className="w-4 h-4" />
          Agregar video
        </button>
      </div>

      {/* Selector de videos */}
      {showAddVideo && (
        <div className="glass-card p-4">
          <p className="text-xs font-medium text-slate-400 mb-3">
            Videos disponibles ({availableVideos.length})
          </p>
          {availableVideos.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-4">
              No hay videos disponibles. Subí y procesá videos primero.
            </p>
          ) : (
            <div className="space-y-1.5 max-h-56 overflow-y-auto">
              {availableVideos.map((video) => {
                const alreadyAdded = itemVideoIds.has(video.id);
                return (
                  <button
                    key={video.id}
                    disabled={alreadyAdded || addItem.isPending}
                    onClick={() => {
                      if (alreadyAdded) return;
                      addItem.mutate({ playlistId, videoId: video.id });
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/5 transition-colors text-left disabled:opacity-60 disabled:cursor-default"
                  >
                    <div className="w-12 h-7 rounded bg-surface-600 flex-shrink-0 overflow-hidden flex items-center justify-center">
                      {video.thumbnailUrl ? (
                        <img src={video.thumbnailUrl} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <Film className="w-3.5 h-3.5 text-slate-600" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white truncate">{video.title}</p>
                      {video.duration && (
                        <p className="text-xs text-slate-500">{formatDuration(video.duration)}</p>
                      )}
                    </div>
                    {alreadyAdded
                      ? <Check className="w-4 h-4 text-green-400 flex-shrink-0" />
                      : <Plus className="w-4 h-4 text-brand-400 flex-shrink-0" />
                    }
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Lista de items */}
      {!playlist.items?.length ? (
        <div className="glass-card p-12 text-center">
          <Film className="w-8 h-8 text-slate-600 mx-auto mb-3" />
          <p className="text-sm text-slate-500">La playlist está vacía.</p>
          <p className="text-xs text-slate-600 mt-1">Agregá videos con el botón de arriba.</p>
        </div>
      ) : (
        <div className="glass-card divide-y divide-white/5">
          {playlist.items.map((item, idx) => (
            <div key={item.id} className="flex items-center gap-3 px-4 py-3 hover:bg-white/[0.02] transition-colors">
              <GripVertical className="w-4 h-4 text-slate-700 flex-shrink-0" />
              <span className="text-xs text-slate-600 w-5 text-center">{idx + 1}</span>
              <div className="w-14 h-8 rounded bg-surface-600 flex-shrink-0 overflow-hidden flex items-center justify-center">
                {item.video.thumbnailUrl ? (
                  <img src={item.video.thumbnailUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  <Film className="w-3.5 h-3.5 text-slate-600" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white truncate">{item.video.title}</p>
                {item.video.duration && (
                  <p className="text-xs text-slate-500">{formatDuration(item.video.duration)}</p>
                )}
              </div>
              <button
                onClick={() => removeItem.mutate({ playlistId, itemId: item.id })}
                className="text-slate-600 hover:text-red-400 transition-colors p-1 flex-shrink-0"
                title="Quitar de la playlist"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
