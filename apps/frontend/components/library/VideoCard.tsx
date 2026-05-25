'use client';

import { useState } from 'react';
import Image from 'next/image';
import { MoreHorizontal, Pencil, Trash2, Film, Check, X } from 'lucide-react';
import { Video } from '@/hooks/useVideos';
import { VideoStatusBadge } from './VideoStatusBadge';
import { formatDuration, formatBytes } from '@/lib/utils';
import { cn } from '@/lib/utils';

interface VideoCardProps {
  video: Video;
  onUpdate: (id: string, data: { title: string }) => void;
  onDelete: (id: string) => void;
}

export function VideoCard({ video, onUpdate, onDelete }: VideoCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(video.title);

  const handleSaveTitle = () => {
    if (editTitle.trim() && editTitle !== video.title) {
      onUpdate(video.id, { title: editTitle.trim() });
    }
    setEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSaveTitle();
    if (e.key === 'Escape') {
      setEditTitle(video.title);
      setEditing(false);
    }
  };

  const isProcessing =
    video.status === 'PROCESSING' || video.status === 'PENDING';

  return (
    <div className="group glass-card overflow-hidden hover:border-white/10 transition-all duration-200">
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

        {/* Processing overlay */}
        {isProcessing && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
            <VideoStatusBadge status={video.status} />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-3">
        {/* Title */}
        <div className="flex items-start gap-2 mb-2">
          {editing ? (
            <div className="flex-1 flex items-center gap-1">
              <input
                autoFocus
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={handleSaveTitle}
                className="flex-1 text-sm font-medium bg-surface-600 border border-brand-500/50 rounded px-2 py-0.5 text-white focus:outline-none"
              />
              <button
                onClick={handleSaveTitle}
                className="text-green-400 hover:text-green-300 p-0.5"
              >
                <Check className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => {
                  setEditTitle(video.title);
                  setEditing(false);
                }}
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

          {/* Menu */}
          <div className="relative flex-shrink-0">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="w-6 h-6 flex items-center justify-center rounded text-slate-500 hover:text-white hover:bg-white/10 transition-colors"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>

            {menuOpen && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setMenuOpen(false)}
                />
                <div className="absolute right-0 top-7 z-20 w-36 rounded-lg border border-white/10 bg-surface-600 shadow-xl overflow-hidden">
                  <button
                    onClick={() => {
                      setEditing(true);
                      setMenuOpen(false);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-300 hover:bg-white/5 hover:text-white transition-colors"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    Renombrar
                  </button>
                  <button
                    onClick={() => {
                      onDelete(video.id);
                      setMenuOpen(false);
                    }}
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

        {/* Meta row */}
        <div className="flex items-center justify-between">
          <VideoStatusBadge status={video.status} />
          <div className="flex items-center gap-2 text-xs text-slate-600">
            {video.width && video.height && (
              <span>{video.height}p</span>
            )}
            <span>{formatBytes(Number(video.fileSize))}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
