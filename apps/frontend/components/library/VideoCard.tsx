'use client';

import { useState } from 'react';
import Image from 'next/image';
import { MoreHorizontal, Pencil, Trash2, Film, Check, X, Folder, FolderInput } from 'lucide-react';
import { Video } from '@/hooks/useVideos';
import { VideoStatusBadge } from './VideoStatusBadge';
import { formatDuration, formatBytes } from '@/lib/utils';
import { cn } from '@/lib/utils';

interface VideoCardProps {
  video: Video;
  folders?: string[]; // carpetas existentes para el selector
  onUpdate: (id: string, data: { title?: string; folder?: string | null }) => void;
  onDelete: (id: string) => void;
}

export function VideoCard({ video, folders = [], onUpdate, onDelete }: VideoCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  // ── Edición de título ──────────────────────────────────────
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(video.title);

  const handleSaveTitle = () => {
    if (editTitle.trim() && editTitle !== video.title) {
      onUpdate(video.id, { title: editTitle.trim() });
    }
    setEditing(false);
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSaveTitle();
    if (e.key === 'Escape') { setEditTitle(video.title); setEditing(false); }
  };

  // ── Edición de carpeta ─────────────────────────────────────
  const [editingFolder, setEditingFolder] = useState(false);
  // folderInput: la carpeta que se va a guardar (seleccionada o escrita)
  const [folderInput, setFolderInput] = useState('');
  // customMode: el usuario quiere escribir una carpeta nueva
  const [customMode, setCustomMode] = useState(false);

  const openFolderEditor = () => {
    const currentFolder = video.folder ?? '';
    setFolderInput(currentFolder);
    // Entrar en customMode si no hay carpetas existentes O si la carpeta actual
    // no está en la lista (fue borrada por otro video, por ejemplo)
    const inList = currentFolder && folders.includes(currentFolder);
    setCustomMode(!folders.length || (!inList && !!currentFolder));
    setEditingFolder(true);
    setMenuOpen(false);
  };

  const handleSaveFolder = () => {
    const newFolder = folderInput.trim() || null;
    if (newFolder !== (video.folder ?? null)) {
      onUpdate(video.id, { folder: newFolder });
    }
    setEditingFolder(false);
  };

  const handleFolderKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSaveFolder();
    if (e.key === 'Escape') { setEditingFolder(false); }
  };

  const isProcessing = video.status === 'PROCESSING' || video.status === 'PENDING';

  return (
    <div className="group glass-card hover:border-white/10 transition-all duration-200">
      {/* Thumbnail */}
      <div className="relative aspect-video bg-surface-700 overflow-hidden">
        {video.thumbnailUrl ? (
          <Image
            src={video.thumbnailUrl}
            alt={video.title}
            fill
            className="object-cover group-hover:scale-105 transition-transform duration-300"
            sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <Film
              className={cn(
                'w-10 h-10',
                isProcessing ? 'text-yellow-500/40 animate-pulse' : 'text-slate-600',
              )}
            />
          </div>
        )}

        {/* Duration overlay */}
        {video.duration && video.status === 'READY' && (
          <div className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-black/70 text-xs text-white font-mono">
            {formatDuration(video.duration)}
          </div>
        )}

        {/* Folder badge */}
        {video.folder && (
          <div className="absolute top-2 left-2 flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/60 backdrop-blur-sm text-[10px] text-slate-300 font-medium">
            <Folder className="w-2.5 h-2.5 text-brand-400" />
            <span className="truncate max-w-[80px]">{video.folder}</span>
          </div>
        )}

        {/* Processing overlay */}
        {isProcessing && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
            <VideoStatusBadge status={video.status} />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-3">
        {/* Title row */}
        <div className="flex items-start gap-2 mb-2">
          {editing ? (
            <div className="flex-1 flex items-center gap-1">
              <input
                autoFocus
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                onKeyDown={handleTitleKeyDown}
                onBlur={handleSaveTitle}
                className="flex-1 text-sm font-medium bg-surface-600 border border-brand-500/50 rounded px-2 py-0.5 text-white focus:outline-none"
              />
              <button onClick={handleSaveTitle} className="text-green-400 hover:text-green-300 p-0.5">
                <Check className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => { setEditTitle(video.title); setEditing(false); }}
                className="text-slate-500 hover:text-slate-300 p-0.5"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <p
              className="flex-1 text-sm font-medium text-white truncate leading-snug cursor-pointer hover:text-brand-300 transition-colors"
              title={video.title}
              onClick={() => setEditing(true)}
            >
              {video.title}
            </p>
          )}

          {/* Kebab menu */}
          <div className="relative flex-shrink-0">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="w-6 h-6 flex items-center justify-center rounded text-slate-500 hover:text-white hover:bg-white/10 transition-colors"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>

            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-7 z-20 w-40 rounded-lg border border-white/10 bg-surface-600 shadow-xl overflow-hidden">
                  <button
                    onClick={() => { setEditing(true); setMenuOpen(false); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-300 hover:bg-white/5 hover:text-white transition-colors"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    Renombrar
                  </button>
                  <button
                    onClick={openFolderEditor}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-300 hover:bg-white/5 hover:text-white transition-colors"
                  >
                    <FolderInput className="w-3.5 h-3.5" />
                    Mover a carpeta
                  </button>
                  <button
                    onClick={() => { onDelete(video.id); setMenuOpen(false); }}
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

        {/* ── Editor de carpeta inline ─────────────────────────── */}
        {editingFolder && (
          <div className="mb-2 space-y-1.5">

            {/* Selector de carpetas existentes (se muestra solo si hay carpetas) */}
            {folders.length > 0 && (
              <select
                value={customMode ? '__custom__' : folderInput}
                onChange={(e) => {
                  if (e.target.value === '__custom__') {
                    // El usuario quiere escribir una nueva
                    setCustomMode(true);
                    setFolderInput('');
                  } else {
                    // El usuario eligió una carpeta existente o "Sin carpeta"
                    setCustomMode(false);
                    setFolderInput(e.target.value);
                  }
                }}
                className="w-full px-2 py-1.5 rounded text-xs bg-surface-600 border border-brand-500/50 text-white focus:outline-none"
              >
                <option value="">— Sin carpeta —</option>
                {folders.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
                <option value="__custom__">✏ Nueva carpeta...</option>
              </select>
            )}

            {/* Input de texto: visible cuando customMode=true o cuando no hay carpetas */}
            {(customMode || !folders.length) && (
              <input
                autoFocus
                value={folderInput}
                onChange={(e) => setFolderInput(e.target.value)}
                onKeyDown={handleFolderKeyDown}
                placeholder="Nombre de la carpeta"
                maxLength={100}
                className="w-full px-2 py-1.5 rounded text-xs bg-surface-600 border border-brand-500/50 text-white placeholder-slate-600 focus:outline-none"
              />
            )}

            {/* Botones guardar / cancelar */}
            <div className="flex justify-end gap-1">
              <button
                onClick={handleSaveFolder}
                className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium text-green-400 hover:text-green-300 hover:bg-green-400/10 transition-colors"
              >
                <Check className="w-3 h-3" />
                Guardar
              </button>
              <button
                onClick={() => setEditingFolder(false)}
                className="flex items-center gap-1 px-2.5 py-1 rounded text-xs text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-colors"
              >
                <X className="w-3 h-3" />
                Cancelar
              </button>
            </div>
          </div>
        )}

        {/* Meta row */}
        <div className="flex items-center justify-between">
          <VideoStatusBadge status={video.status} />
          <div className="flex items-center gap-2 text-xs text-slate-600">
            {video.width && video.height && <span>{video.height}p</span>}
            <span>{formatBytes(Number(video.fileSize))}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
