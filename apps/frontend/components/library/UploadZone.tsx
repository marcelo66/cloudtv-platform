'use client';

import { useState, useRef, useCallback, useId } from 'react';
import {
  Upload,
  X,
  CheckCircle2,
  AlertCircle,
  Film,
  Loader2,
} from 'lucide-react';
import { uploadVideo, validateVideoFile, UploadStatus } from '@/lib/upload';
import { formatBytes } from '@/lib/utils';
import { cn } from '@/lib/utils';

interface UploadItem {
  id: string;
  file: File;
  status: UploadStatus;
  progress: number;
  error?: string;
  abortController: AbortController;
}

interface UploadZoneProps {
  channelId: string;
  folder?: string;
  onUploadComplete?: (videoId: string) => void;
}

export function UploadZone({ channelId, folder, onUploadComplete }: UploadZoneProps) {
  const inputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [queue, setQueue] = useState<UploadItem[]>([]);

  const updateItem = useCallback(
    (id: string, update: Partial<UploadItem>) => {
      setQueue((prev) =>
        prev.map((item) => (item.id === id ? { ...item, ...update } : item)),
      );
    },
    [],
  );

  const processFile = useCallback(
    async (file: File) => {
      const validationError = validateVideoFile(file);
      if (validationError) {
        // Agregar directamente con error
        const item: UploadItem = {
          id: crypto.randomUUID(),
          file,
          status: 'error',
          progress: 0,
          error: validationError,
          abortController: new AbortController(),
        };
        setQueue((prev) => [...prev, item]);
        return;
      }

      const abortController = new AbortController();
      const itemId = crypto.randomUUID();

      const item: UploadItem = {
        id: itemId,
        file,
        status: 'initiating',
        progress: 0,
        abortController,
      };

      setQueue((prev) => [...prev, item]);

      try {
        await uploadVideo(
          file,
          channelId,
          {
            signal: abortController.signal,
            onStatusChange: (status) => updateItem(itemId, { status }),
            onProgress: ({ percent }) => updateItem(itemId, { progress: percent }),
          },
          folder,
        );

        updateItem(itemId, { status: 'done', progress: 100 });
        onUploadComplete?.(itemId);
      } catch (err: any) {
        if (err.name === 'AbortError') {
          updateItem(itemId, { status: 'aborted' });
        } else {
          const msg =
            err?.response?.data?.message ||
            err.message ||
            'Error desconocido';
          updateItem(itemId, { status: 'error', error: msg });
        }
      }
    },
    [channelId, folder, onUploadComplete, updateItem],
  );

  const handleFiles = useCallback(
    (files: FileList | File[]) => {
      Array.from(files).forEach(processFile);
    },
    [processFile],
  );

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const removeItem = (id: string) => {
    const item = queue.find((i) => i.id === id);
    if (item && (item.status === 'uploading' || item.status === 'initiating')) {
      item.abortController.abort();
    }
    setQueue((prev) => prev.filter((i) => i.id !== id));
  };

  const activeUploads = queue.filter(
    (i) => i.status === 'uploading' || i.status === 'initiating' || i.status === 'completing',
  ).length;

  return (
    <div className="space-y-4">
      {/* Drop zone */}
      <div
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={() => setDragOver(false)}
        onClick={() => fileInputRef.current?.click()}
        className={cn(
          'relative flex flex-col items-center justify-center p-10 rounded-xl border-2 border-dashed cursor-pointer transition-all duration-200',
          dragOver
            ? 'border-brand-500 bg-brand-500/5 scale-[1.01]'
            : 'border-white/10 hover:border-white/20 hover:bg-white/[0.02]',
        )}
      >
        <input
          ref={fileInputRef}
          id={inputId}
          type="file"
          multiple
          accept="video/mp4,video/quicktime,video/x-matroska,video/x-msvideo,video/webm,.mp4,.mov,.mkv,.avi,.webm"
          className="hidden"
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
        />

        <div
          className={cn(
            'w-14 h-14 rounded-2xl flex items-center justify-center mb-4 transition-colors',
            dragOver ? 'bg-brand-600/20' : 'bg-surface-600',
          )}
        >
          {activeUploads > 0 ? (
            <Loader2 className="w-7 h-7 text-brand-400 animate-spin" />
          ) : (
            <Upload
              className={cn(
                'w-7 h-7 transition-colors',
                dragOver ? 'text-brand-400' : 'text-slate-500',
              )}
            />
          )}
        </div>

        <p className="text-sm font-semibold text-white mb-1">
          {dragOver ? 'Soltar para subir' : 'Arrastrá videos aquí'}
        </p>
        <p className="text-xs text-slate-500">
          MP4, MOV, MKV, AVI, WebM · Máximo 10 GB por archivo
        </p>

        {activeUploads > 0 && (
          <div className="mt-3 text-xs text-brand-400 font-medium">
            {activeUploads} archivo{activeUploads > 1 ? 's' : ''} subiendo...
          </div>
        )}
      </div>

      {/* Upload queue */}
      {queue.length > 0 && (
        <div className="glass-card divide-y divide-white/5">
          {queue.map((item) => (
            <UploadQueueItem
              key={item.id}
              item={item}
              onRemove={() => removeItem(item.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function UploadQueueItem({
  item,
  onRemove,
}: {
  item: UploadItem;
  onRemove: () => void;
}) {
  const statusIcons: Record<string, React.ReactNode> = {
    idle: <Film className="w-4 h-4 text-slate-500" />,
    initiating: <Loader2 className="w-4 h-4 text-brand-400 animate-spin" />,
    uploading: <Loader2 className="w-4 h-4 text-brand-400 animate-spin" />,
    completing: <Loader2 className="w-4 h-4 text-brand-400 animate-spin" />,
    done: <CheckCircle2 className="w-4 h-4 text-green-400" />,
    error: <AlertCircle className="w-4 h-4 text-red-400" />,
    aborted: <X className="w-4 h-4 text-slate-500" />,
  };

  const statusLabels: Record<string, string> = {
    idle: 'En espera',
    initiating: 'Iniciando...',
    uploading: `${item.progress}%`,
    completing: 'Finalizando...',
    done: 'Completado',
    error: item.error || 'Error',
    aborted: 'Cancelado',
  };

  const isActive =
    item.status === 'uploading' ||
    item.status === 'initiating' ||
    item.status === 'completing';

  return (
    <div className="px-4 py-3 flex items-center gap-3">
      <div className="flex-shrink-0">{statusIcons[item.status]}</div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 mb-1">
          <p className="text-sm text-white truncate">{item.file.name}</p>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span
              className={cn(
                'text-xs',
                item.status === 'done'
                  ? 'text-green-400'
                  : item.status === 'error'
                    ? 'text-red-400'
                    : 'text-slate-500',
              )}
            >
              {statusLabels[item.status]}
            </span>
            <button
              onClick={onRemove}
              className="text-slate-600 hover:text-slate-300 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Progress bar */}
        {isActive && (
          <div className="h-1 bg-surface-600 rounded-full overflow-hidden">
            <div
              className="h-full bg-brand-500 rounded-full transition-all duration-300"
              style={{ width: `${item.progress}%` }}
            />
          </div>
        )}

        {/* Meta */}
        {item.status !== 'error' && item.status !== 'aborted' && (
          <p className="text-xs text-slate-600 mt-0.5">
            {formatBytes(item.file.size)}
          </p>
        )}

        {item.status === 'error' && item.error && (
          <p className="text-xs text-red-400/80 mt-0.5">{item.error}</p>
        )}
      </div>
    </div>
  );
}
