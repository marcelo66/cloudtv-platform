'use client';

import { useState, useMemo, useEffect } from 'react';
import Image from 'next/image';
import {
  ArrowLeft, Plus, Trash2, Film, GripVertical,
  RefreshCw, Check, Search, Folder, X,
  ChevronUp, ChevronDown, Megaphone,
} from 'lucide-react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  usePlaylist,
  useAddPlaylistItem,
  useAddPlaylistAdBlock,
  useRemovePlaylistItem,
  useReorderPlaylistItems,
  PlaylistItem,
} from '@/hooks/usePlaylists';
import { useVideos } from '@/hooks/useVideos';
import { useAdBlocks } from '@/hooks/useAdBlocks';
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

// ─── Item Sortable ───────────────────────────────────────────────────────────

/** Formatea segundos totales a HH:MM:SS o MM:SS */
function formatOffset(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  if (h > 0) return `${h}:${mm}:${ss}`;
  return `${mm}:${ss}`;
}

interface SortableItemProps {
  item: PlaylistItem;
  idx: number;
  total: number;
  playlistId: string;
  startOffset: number;   // segundos acumulados antes de este item
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  isReordering: boolean;
}

function SortableItem({
  item,
  idx,
  total,
  startOffset,
  onMoveUp,
  onMoveDown,
  onRemove,
  isReordering,
}: SortableItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex items-center gap-3 px-4 py-3 transition-colors select-none',
        isDragging
          ? 'bg-surface-600/80 shadow-lg rounded-lg z-10 opacity-90'
          : 'hover:bg-white/[0.02]',
      )}
    >
      {/* Drag handle */}
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-slate-600 hover:text-slate-400 transition-colors flex-shrink-0 touch-none"
        title="Arrastrar para reordenar"
        tabIndex={-1}
      >
        <GripVertical className="w-4 h-4" />
      </button>

      {/* Número de orden */}
      <span className="text-xs text-slate-600 w-5 text-center flex-shrink-0">
        {idx + 1}
      </span>

      {/* Thumbnail / Ad icon */}
      {item.adBlockId ? (
        <div className="w-14 h-8 rounded bg-amber-500/10 border border-amber-500/30 flex-shrink-0 flex items-center justify-center">
          <Megaphone className="w-3.5 h-3.5 text-amber-400" />
        </div>
      ) : (
        <div className="relative w-14 h-8 rounded bg-surface-600 flex-shrink-0 overflow-hidden">
          {item.video?.thumbnailUrl ? (
            <Image src={item.video.thumbnailUrl} alt="" fill className="object-cover" sizes="56px" />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <Film className="w-3.5 h-3.5 text-slate-600" />
            </div>
          )}
        </div>
      )}

      {/* Info */}
      <div className="flex-1 min-w-0">
        {item.adBlockId && item.adBlock ? (
          <>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/25">PUBLICIDAD</span>
              <p className="text-sm text-white truncate">{item.adBlock.name}</p>
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xs text-slate-500">
                {item.adBlock.spots.length} spot{item.adBlock.spots.length !== 1 ? 's' : ''}
                {' · '}
                {formatDuration(item.adBlock.spots.reduce((s, sp) => s + (sp.video.duration ?? 0), 0))}
              </span>
              <span className="text-[11px] text-slate-600 font-mono" title="Posición de inicio en la playlist">
                @ {formatOffset(startOffset)}
              </span>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-white truncate">{item.video?.title ?? '—'}</p>
            <div className="flex items-center gap-2 mt-0.5">
              {item.video?.duration && (
                <span className="text-xs text-slate-500">{formatDuration(item.video.duration)}</span>
              )}
              <span className="text-[11px] text-slate-600 font-mono" title="Posición de inicio en la playlist">
                @ {formatOffset(startOffset)}
              </span>
            </div>
          </>
        )}
      </div>

      {/* Flechas ↑↓ */}
      <div className="flex flex-col gap-0.5 flex-shrink-0">
        <button
          onClick={onMoveUp}
          disabled={idx === 0 || isReordering}
          className="p-0.5 text-slate-600 hover:text-slate-300 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
          title="Subir"
        >
          <ChevronUp className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={onMoveDown}
          disabled={idx === total - 1 || isReordering}
          className="p-0.5 text-slate-600 hover:text-slate-300 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
          title="Bajar"
        >
          <ChevronDown className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Eliminar */}
      <button
        onClick={onRemove}
        className="text-slate-600 hover:text-red-400 transition-colors p-1 flex-shrink-0"
        title="Quitar de la playlist"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ─── PlaylistDetail ──────────────────────────────────────────────────────────

export function PlaylistDetail({ playlistId, channelId, onBack }: Props) {
  const [showAddVideo, setShowAddVideo] = useState(false);
  const [showAddAdBlock, setShowAddAdBlock] = useState(false);
  const [search, setSearch] = useState('');
  const [activeFolder, setActiveFolder] = useState<string | null>(null);

  // Estado local para orden optimista (actualiza la UI antes de la respuesta del servidor)
  const [localItems, setLocalItems] = useState<PlaylistItem[]>([]);

  const { data: playlist, isLoading } = usePlaylist(playlistId);
  const { data: allVideos = [] } = useVideos(channelId);
  const { data: adBlocks = [] } = useAdBlocks(channelId);
  const addItem     = useAddPlaylistItem();
  const addAdBlock  = useAddPlaylistAdBlock();
  const removeItem  = useRemovePlaylistItem();
  const reorderItems = useReorderPlaylistItems();

  // Sincronizar items locales cuando llegan datos del servidor
  useEffect(() => {
    if (playlist?.items) {
      setLocalItems([...playlist.items].sort((a, b) => a.order - b.order));
    }
  }, [playlist?.items]);

  // Sensores dnd-kit: mouse/touch (5px de distancia para no interferir con scroll)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // ── Handlers de reorden ─────────────────────────────────────────

  function applyNewOrder(newItems: PlaylistItem[]) {
    setLocalItems(newItems);
    reorderItems.mutate({
      playlistId,
      items: newItems.map((item, idx) => ({ id: item.id, order: idx })),
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = localItems.findIndex(i => i.id === active.id);
    const newIndex = localItems.findIndex(i => i.id === over.id);
    applyNewOrder(arrayMove(localItems, oldIndex, newIndex));
  }

  function handleMoveItem(fromIdx: number, toIdx: number) {
    if (toIdx < 0 || toIdx >= localItems.length) return;
    applyNewOrder(arrayMove(localItems, fromIdx, toIdx));
  }

  // ── Videos disponibles ──────────────────────────────────────────

  const readyVideos = useMemo(
    () => allVideos.filter((v) => v.status === 'READY'),
    [allVideos],
  );

  const folders = useMemo(() => {
    const set = new Set<string>();
    readyVideos.forEach((v) => { if (v.folder) set.add(v.folder); });
    return Array.from(set).sort();
  }, [readyVideos]);

  const itemVideoIds = useMemo(
    () => new Set(localItems.filter(i => i.video).map((i) => i.video!.id)),
    [localItems],
  );

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
    setShowAddAdBlock(false);
    setShowAddVideo(true);
  };

  const openAdBlockPicker = () => {
    setShowAddVideo(false);
    setShowAddAdBlock(true);
  };

  // ── Render ──────────────────────────────────────────────────────

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
            {localItems.length} item{localItems.length !== 1 ? 's' : ''}
            {playlist.totalDuration ? ` · ${formatDuration(playlist.totalDuration)}` : ''}
            {' · '}
            {LOOP_LABELS[playlist.loopMode]}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {adBlocks.filter(b => b.isActive && b.spots?.length > 0).length > 0 && (
            <button
              onClick={() => (showAddAdBlock ? setShowAddAdBlock(false) : openAdBlockPicker())}
              className={cn(
                'flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
                showAddAdBlock
                  ? 'bg-surface-600 text-slate-300 hover:text-white border border-white/10'
                  : 'bg-amber-600/80 hover:bg-amber-600 text-white',
              )}
            >
              {showAddAdBlock ? <X className="w-4 h-4" /> : <Megaphone className="w-4 h-4" />}
              {showAddAdBlock ? 'Cerrar' : 'Insertar publicidad'}
            </button>
          )}
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
                    <div className="relative w-12 h-7 rounded bg-surface-600 flex-shrink-0 overflow-hidden">
                      {video.thumbnailUrl ? (
                        <Image src={video.thumbnailUrl} alt="" fill className="object-cover" sizes="48px" />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <Film className="w-3.5 h-3.5 text-slate-600" />
                        </div>
                      )}
                    </div>
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

      {/* ── Selector de bloques publicitarios ──────────────────────── */}
      {showAddAdBlock && (
        <div className="glass-card p-4 space-y-3 border-amber-500/20">
          <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
            <Megaphone className="w-3.5 h-3.5" />
            Bloques publicitarios disponibles
          </p>
          {adBlocks.filter(b => b.isActive && b.spots?.length > 0).length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-5">
              No hay bloques publicitarios activos con spots. Crealos en la sección Publicidad.
            </p>
          ) : (
            <div className="space-y-1">
              {adBlocks
                .filter(b => b.isActive && b.spots?.length > 0)
                .map((block) => {
                  const totalDur = block.spots.reduce((s, sp) => s + (sp.video?.duration ?? 0), 0);
                  return (
                    <button
                      key={block.id}
                      disabled={addAdBlock.isPending}
                      onClick={() => addAdBlock.mutate({ playlistId, adBlockId: block.id })}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-amber-500/5 transition-colors text-left border border-transparent hover:border-amber-500/20"
                    >
                      <div className="w-10 h-7 rounded bg-amber-500/10 flex items-center justify-center flex-shrink-0">
                        <Megaphone className="w-3.5 h-3.5 text-amber-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-white truncate">{block.name}</p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {block.spots.length} spot{block.spots.length !== 1 ? 's' : ''}
                          {totalDur > 0 && ` · ${formatDuration(totalDur)}`}
                          {block.description && ` · ${block.description}`}
                        </p>
                      </div>
                      <Plus className="w-4 h-4 text-amber-400 flex-shrink-0" />
                    </button>
                  );
                })}
            </div>
          )}
        </div>
      )}

      {/* ── Lista de items con drag-and-drop ──────────────────────── */}
      {localItems.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <Film className="w-8 h-8 text-slate-600 mx-auto mb-3" />
          <p className="text-sm text-slate-500">La playlist está vacía.</p>
          <p className="text-xs text-slate-600 mt-1">Agregá videos con el botón de arriba.</p>
        </div>
      ) : (
        <>
          {/* Hint visible solo cuando hay más de 1 item */}
          {localItems.length > 1 && (
            <p className="text-[11px] text-slate-600 px-1">
              Arrastrá desde <GripVertical className="inline w-3 h-3 mb-0.5" /> o usá las flechas para reordenar
            </p>
          )}

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={localItems.map(i => i.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="glass-card divide-y divide-white/5 overflow-hidden">
                {localItems.map((item, idx) => {
                  // Calcular posición acumulada (segundos antes de este item)
                  const startOffset = localItems.slice(0, idx).reduce((acc, it) => {
                    if (it.adBlockId && it.adBlock) {
                      return acc + it.adBlock.spots.reduce((s, sp) => s + (sp.video.duration ?? 0), 0);
                    }
                    const dur = it.video?.duration ?? 0;
                    const from = it.trimStart ?? 0;
                    const to   = it.trimEnd   ?? dur;
                    return acc + Math.max(0, to - from);
                  }, 0);
                  return (
                    <SortableItem
                      key={item.id}
                      item={item}
                      idx={idx}
                      total={localItems.length}
                      playlistId={playlistId}
                      startOffset={startOffset}
                      isReordering={reorderItems.isPending}
                      onMoveUp={() => handleMoveItem(idx, idx - 1)}
                      onMoveDown={() => handleMoveItem(idx, idx + 1)}
                      onRemove={() => removeItem.mutate({ playlistId, itemId: item.id })}
                    />
                  );
                })}
              </div>
            </SortableContext>
          </DndContext>
        </>
      )}
    </div>
  );
}
