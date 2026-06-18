'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { Film, Upload, Search, Grid3X3, List, RefreshCw, Folder, FolderOpen, Zap } from 'lucide-react';
import { Header } from '@/components/dashboard/Header';
import { VideoCard } from '@/components/library/VideoCard';
import { VideoStatusBadge } from '@/components/library/VideoStatusBadge';
import { useVideos, useUpdateVideo, useDeleteVideo, usePrenormalizeVideos } from '@/hooks/useVideos';
import apiClient from '@/lib/api-client';
import { formatDuration, formatBytes } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

export default function LibraryPage() {
  const [channelId, setChannelId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [activeFolder, setActiveFolder] = useState<string | null>(null);

  // Cargar el primer canal del usuario
  useEffect(() => {
    apiClient.get('/channels').then(({ data }) => {
      if (data.length > 0) setChannelId(data[0].id);
    });
  }, []);

  const { data: videos = [], isLoading, refetch } = useVideos(channelId);
  const updateVideo = useUpdateVideo();
  const deleteVideo = useDeleteVideo();
  const prenormalize = usePrenormalizeVideos();

  // Carpetas únicas derivadas de los videos
  const folders = useMemo(() => {
    const set = new Set<string>();
    videos.forEach((v) => { if (v.folder) set.add(v.folder); });
    return Array.from(set).sort();
  }, [videos]);

  const filtered = videos.filter((v) => {
    const matchesSearch = v.title.toLowerCase().includes(search.toLowerCase());
    const matchesFolder = activeFolder === null || v.folder === activeFolder;
    return matchesSearch && matchesFolder;
  });

  const processingCount = videos.filter(
    (v) => v.status === 'PROCESSING' || v.status === 'PENDING',
  ).length;

  const handleDelete = (videoId: string) => {
    const video = videos.find((v) => v.id === videoId);
    const msg = `¿Eliminar "${video?.title ?? 'este video'}"?\n\nSe borrará del storage y se quitará de todas las playlists donde esté.`;
    if (!confirm(msg)) return;
    deleteVideo.mutate(videoId, {
      onError: (err: any) => {
        const detail = err?.response?.data?.message;
        toast.error(Array.isArray(detail) ? detail[0] : (detail ?? 'Error al eliminar el video'));
      },
    });
  };

  const handleUpdate = (id: string, data: { title?: string; folder?: string | null }) => {
    updateVideo.mutate({ videoId: id, data });
  };

  return (
    <div className="flex flex-col flex-1">
      <Header
        title="Biblioteca de videos"
        subtitle={`${videos.length} video${videos.length !== 1 ? 's' : ''}${activeFolder ? ` en "${activeFolder}"` : ''}`}
      />

      <div className="flex-1 p-6 space-y-4 overflow-y-auto">
        {/* Toolbar */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-52 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar videos..."
              className="w-full pl-9 pr-4 py-2 rounded-lg text-sm bg-surface-700 border border-white/10 text-white placeholder-slate-500
                         focus:outline-none focus:ring-1 focus:ring-brand-500/50 focus:border-brand-500 transition-colors"
            />
          </div>

          <div className="flex items-center gap-1 border border-white/10 rounded-lg p-0.5">
            <button
              onClick={() => setViewMode('grid')}
              className={cn(
                'p-1.5 rounded transition-colors',
                viewMode === 'grid' ? 'bg-brand-600 text-white' : 'text-slate-500 hover:text-white',
              )}
            >
              <Grid3X3 className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={cn(
                'p-1.5 rounded transition-colors',
                viewMode === 'list' ? 'bg-brand-600 text-white' : 'text-slate-500 hover:text-white',
              )}
            >
              <List className="w-4 h-4" />
            </button>
          </div>

          {processingCount > 0 && (
            <button
              onClick={() => refetch()}
              className="flex items-center gap-1.5 text-xs text-yellow-400 hover:text-yellow-300 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              {processingCount} procesando
            </button>
          )}

          {/* Pre-normalizar: prepara videos viejos para emisión instantánea */}
          {channelId && videos.some((v) => v.status === 'READY') && (
            <button
              onClick={() => prenormalize.mutate(channelId)}
              disabled={prenormalize.isPending}
              title="Normaliza al formato broadcast todos los videos que aún no están optimizados. Solo toca los que faltan; los que ya están listos no se vuelven a procesar."
              className={cn(
                'flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border transition-colors',
                prenormalize.isPending
                  ? 'border-amber-500/30 bg-amber-500/10 text-amber-400 cursor-wait'
                  : 'border-white/10 bg-surface-700 text-slate-300 hover:border-white/20 hover:text-white',
              )}
            >
              <Zap className={cn('w-4 h-4', prenormalize.isPending && 'animate-pulse')} />
              {prenormalize.isPending ? 'Encolando…' : 'Pre-normalizar'}
            </button>
          )}

          <Link
            href="/library/upload"
            className="ml-auto flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-brand-600 hover:bg-brand-500 text-white transition-colors"
          >
            <Upload className="w-4 h-4" />
            Subir video
          </Link>
        </div>

        {/* Filtros por carpeta */}
        {folders.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setActiveFolder(null)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors',
                activeFolder === null
                  ? 'bg-brand-600 border-brand-600 text-white'
                  : 'border-white/10 text-slate-400 hover:border-white/20 hover:text-white',
              )}
            >
              <FolderOpen className="w-3 h-3" />
              Todas
              <span className={cn('opacity-70', activeFolder === null && 'opacity-100')}>
                ({videos.length})
              </span>
            </button>

            {folders.map((folder) => {
              const count = videos.filter((v) => v.folder === folder).length;
              return (
                <button
                  key={folder}
                  onClick={() => setActiveFolder(activeFolder === folder ? null : folder)}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors',
                    activeFolder === folder
                      ? 'bg-brand-600 border-brand-600 text-white'
                      : 'border-white/10 text-slate-400 hover:border-white/20 hover:text-white',
                  )}
                >
                  <Folder className="w-3 h-3" />
                  {folder}
                  <span className="opacity-60">({count})</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Content */}
        {isLoading ? (
          <div className={cn(viewMode === 'grid' ? 'grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4' : 'space-y-2')}>
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="glass-card animate-pulse" style={{ height: viewMode === 'grid' ? 220 : 64 }} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="glass-card p-16 text-center">
            <div className="w-16 h-16 rounded-2xl bg-surface-700 flex items-center justify-center mx-auto mb-4">
              {activeFolder
                ? <Folder className="w-8 h-8 text-slate-600" />
                : <Film className="w-8 h-8 text-slate-600" />
              }
            </div>
            <h3 className="text-base font-semibold text-white mb-2">
              {search ? 'Sin resultados' : activeFolder ? `Carpeta "${activeFolder}" vacía` : 'Biblioteca vacía'}
            </h3>
            <p className="text-sm text-slate-500 mb-6">
              {search
                ? `No hay videos que coincidan con "${search}"`
                : activeFolder
                  ? 'No hay videos en esta carpeta.'
                  : 'Subí tu primer video para empezar.'}
            </p>
            {!search && !activeFolder && (
              <Link
                href="/library/upload"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium text-sm bg-brand-600 hover:bg-brand-500 text-white transition-colors"
              >
                <Upload className="w-4 h-4" />
                Subir video
              </Link>
            )}
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
            {filtered.map((video) => (
              <VideoCard
                key={video.id}
                video={video}
                folders={folders}
                onUpdate={handleUpdate}
                onDelete={handleDelete}
              />
            ))}
          </div>
        ) : (
          <div className="glass-card divide-y divide-white/5">
            {filtered.map((video) => (
              <div
                key={video.id}
                className="flex items-center gap-4 px-4 py-3 hover:bg-white/[0.02] transition-colors"
              >
                <div className="w-16 h-10 rounded bg-surface-600 overflow-hidden flex-shrink-0 flex items-center justify-center">
                  {video.thumbnailUrl ? (
                    <img src={video.thumbnailUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <Film className="w-4 h-4 text-slate-600" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{video.title}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <p className="text-xs text-slate-500">
                      {video.duration ? formatDuration(video.duration) : '—'} ·{' '}
                      {formatBytes(Number(video.fileSize))}
                      {video.height ? ` · ${video.height}p` : ''}
                    </p>
                    {video.folder && (
                      <span className="flex items-center gap-1 text-[10px] text-brand-400/80">
                        <Folder className="w-2.5 h-2.5" />
                        {video.folder}
                      </span>
                    )}
                  </div>
                </div>
                <VideoStatusBadge status={video.status} />
                <button
                  onClick={() => handleDelete(video.id)}
                  className="text-slate-600 hover:text-red-400 transition-colors p-1"
                >
                  <span className="text-xs">×</span>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
