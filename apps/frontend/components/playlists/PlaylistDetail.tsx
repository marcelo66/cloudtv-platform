'use client';

import { useState, useMemo } from 'react';
import {
  ArrowLeft, Plus, Trash2, Film, GripVertical,
  RefreshCw, Check, Search, Folder, X,
} from 'lucide-react';
import { usePlaylist, useAddPlaylistItem, useRemovePlaylistItem } from '@/hooks/usePlaylists';
import { useVideos } from '@/hooks/useVideos';
import { formatDuration } from '@/lib/utils';
import { cn } from '@/lib/utils';

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
  const [search, setSearch] = useState('');
  const [activeFolder, setActiveFolder] = useState<string | null>(null);

  const { data: playlist, isLoading } = usePlaylist(playlistId);
  const { data: allVideos = [] } = useVideos(channelId);
  const addItem  = useAddPlaylistItem();
  const removeItem = useRemovePlaylistItem();

  const readyVideos = useMemo(
    () => allVideos.filter((v) => v.status === 'READY'),
    [allVideos],
  );

  // Carpetas únicas presentes en los videos listos
  const folders = useMemo(() => {
    const set = new Set<string>();
    readyVideos.forEach((v) => { if (v.folder) set.add(v.folder); });
    return Array.from(set).sort();
  }, [readyVideos]);

  // IDs de videos ya presentes en la playlist
  const itemVideoIds = useMemo(
    () => new Set(playlist?.items?.map((i) => i.video.id) ?? []),
    [playlist],
  );

  // Videos filtrados por búsqueda + carpeta activa
  const filteredVideos = useMemo(() => {
    const q = search.trim().toLowerCase();
    return readyVideos.filter((v) => {
      const matchSearch = !q || v.title.toLowerCase().includes(q);
      const matchFolder = !activeFolder || v.folder === activeFolder;
      return matchSearch && matchFolder;
    });
  }, [readyVideos, search, activeFolder]);

  const openPicker = () => {
    setSearch('');
    setActiveFolder(null);
    setShowAddVideo(true);
  };

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
          onClick={() => (showAddVideo ? setShowAddVideo(false) : openPicker())}
          className={cn(
            'flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
            showAddVideo
              ? 'bg-surface-600 text-slate-300 hover:text-white border border-white/10'
              : 'bg-brand-600 hover:bg-brand-500 text-white',
          )}
        >
          {showAddVideo ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          {showAddVideo ? 'Cerrar' : 'Agregar video'}
        </button>
      </div>

      {/* ── Selector de videos ─────────────────────────────────── */}
      {showAddVideo && (
        <div className="glass-card p-4 space-y-3">

          {/* Búsqueda */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por título..."
              className="w-full pl-8 pr-3 py-1.5 rounded-lg text-sm bg-surface-700 border border-white/10 text-white
                         placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-brand-500/50 focus:border-brand-500 transition-colors"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Chips de carpetas */}
          {folders.length > 0 && (
            <div className="flex gap-1.5 flex-wrap">
              <button
                onClick={() => setActiveFolder(null)}
                className={cn(
                  'px-2.5 py-1 rounded-full text-xs font-medium border transition-colors',
                  activeFolder === null
                    ? 'bg-brand-600 border-brand-600 text-white'
                    : 'border-white/10 text-slate-400 hover:border-white/25 hover:text-slate-200',
                )}
              >
                Todas
              </button>
              {folders.map((folder) => (
                <button
                  key={folder}
                  onClick={() => setActiveFolder(activeFolder === folder ? null : folder)}
                  className={cn(
                    'flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors',
                    activeFolder === folder
                      ? 'bg-brand-600 border-brand-600 text-white'
                      : 'border-white/10 text-slate-400 hover:border-white/25 hover:text-slate-200',
                  )}
                >
                  <Folder className="w-2.5 h-2.5" />
                  {folder}
                  <span className={cn('opacity-60', activeFolder === folder && 'opacity-80')}>
                    ({readyVideos.filter((v) => v.folder === folder).length})
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Contador */}
          <p className="text-[11px] text-slate-500">
            {filteredVideos.length === 0
              ? 'Sin resultados'
              : `${filteredVideos.length} video${filteredVideos.length !== 1 ? 's' : ''}${search || activeFolder ? ' encontrados' : ''}`}
          </p>

          {/* Lista */}
          {filteredVideos.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-5">
              {readyVideos.length === 0
                ? 'No hay videos listos. Subí y procesá videos primero.'
                : 'No hay videos que coincidan con los filtros.'}
            </p>
          ) : (
            <div className="space-y-0.5 max-h-64 overflow-y-auto pr-0.5">
              {filteredVideos.map((video) => {
                const alreadyAdded = itemVideoIds.has(video.id);
                return (
                  <button
                    key={video.id}
                    disabled={alreadyAdded || addItem.isPending}
                    onClick={() => {
                      if (alreadyAdded) return;
                      addItem.mutate({ playlistId, videoId: video.id });
                    }}
                    className={cn(
                      'w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors text-left',
                      alreadyAdded
                        ? 'opacity-50 cursor-default bg-white/[0.02]'
                        : 'hover:bg-white/5 cursor-pointer',
                    )}
                  >
                    {/* Thumbnail */}
                    <div className="w-12 h-7 rounded bg-surface-600 flex-shrink-0 overflow-hidden flex items-center justify-center">
                      {video.thumbnailUrl ? (
                        <img src={video.thumbnailUrl} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <Film className="w-3.5 h-3.5 text-slate-600" />
                      )}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white truncate">{video.title}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        {video.duration && (
                          <span className="text-xs text-slate-500">{formatDuration(video.duration)}</span>
                        )}
                        {video.folder && (
                          <span className="flex items-center gap-1 text-[10px] text-slate-600">
                            <Folder className="w-2.5 h-2.5" />
                            {video.folder}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Estado */}
                    {alreadyAdded
                      ? <Check className="w-4 h-4 text-green-400 flex-shrink-0" />
                      : <Plus className="w-4 h-4 text-brand-400 flex-shrink-0 opacity-0 group-hover:opacity-100" />
                    }
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Items de la playlist ───────────────────────────────── */}
      {!playlist.items?.length ? (
        <div className="glass-card p-12 text-center">
          <Film className="w-8 h-8 text-slate-600 mx-auto mb-3" />
          <p className="text-sm text-slate-500">La playlist está vacía.</p>
          <p className="text-xs text-slate-600 mt-1">Agregá videos con el botón de arriba.</p>
        </div>
      ) : (
        <div className="glass-card divide-y divide-white/5">
          {playlist.items.map((item, idx) => (
            <div
              key={item.id}
              className="flex items-center gap-3 px-4 py-3 hover:bg-white/[0.02] transition-colors"
            >
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
