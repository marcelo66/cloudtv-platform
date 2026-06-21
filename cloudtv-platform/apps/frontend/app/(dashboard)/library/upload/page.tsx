'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Info, Folder, FolderPlus } from 'lucide-react';
import Link from 'next/link';
import { Header } from '@/components/dashboard/Header';
import { UploadZone } from '@/components/library/UploadZone';
import { useQueryClient } from '@tanstack/react-query';
import apiClient from '@/lib/api-client';
import { cn } from '@/lib/utils';

export default function UploadPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [channelId, setChannelId] = useState<string | null>(null);
  const [channelName, setChannelName] = useState('');
  const [uploadCount, setUploadCount] = useState(0);

  // Carpetas existentes
  const [existingFolders, setExistingFolders] = useState<string[]>([]);
  const [selectedFolder, setSelectedFolder] = useState('');
  const [newFolderMode, setNewFolderMode] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  useEffect(() => {
    apiClient.get('/channels').then(({ data }) => {
      if (data.length > 0) {
        setChannelId(data[0].id);
        setChannelName(data[0].name);
        // Cargar carpetas existentes
        return apiClient.get('/videos', { params: { channelId: data[0].id } }).then(({ data: videos }) => {
          const folderSet = new Set<string>();
          videos.forEach((v: any) => { if (v.folder) folderSet.add(v.folder); });
          setExistingFolders(Array.from(folderSet).sort());
        });
      }
    });
  }, []);

  const activeFolder = useMemo(() => {
    if (newFolderMode) return newFolderName.trim() || undefined;
    return selectedFolder || undefined;
  }, [newFolderMode, newFolderName, selectedFolder]);

  const handleUploadComplete = () => {
    setUploadCount((n) => n + 1);
    queryClient.invalidateQueries({ queryKey: ['videos'] });
    // Si era carpeta nueva, añadirla a la lista para usos futuros en esta sesión
    if (newFolderMode && newFolderName.trim() && !existingFolders.includes(newFolderName.trim())) {
      setExistingFolders((prev) => [...prev, newFolderName.trim()].sort());
    }
  };

  const inputClass =
    'w-full px-3 py-2 rounded-lg text-sm bg-surface-700 border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-brand-500/50 focus:border-brand-500 transition-colors';

  if (!channelId) {
    return (
      <div className="flex flex-col flex-1">
        <Header title="Subir videos" />
        <div className="flex-1 flex items-center justify-center">
          <div className="glass-card p-10 text-center max-w-sm">
            <p className="text-white font-medium mb-2">Sin canal activo</p>
            <p className="text-sm text-slate-500 mb-4">
              Necesitás crear un canal antes de subir videos.
            </p>
            <Link href="/" className="text-sm text-brand-400 hover:text-brand-300">
              Ir al dashboard para crear uno
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1">
      <Header
        title="Subir videos"
        subtitle={channelName ? `Canal: ${channelName}` : undefined}
      />

      <div className="flex-1 p-6 overflow-y-auto">
        <div className="max-w-2xl mx-auto space-y-5">
          {/* Back */}
          <Link
            href="/library"
            className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Volver a la biblioteca
          </Link>

          {/* Info card */}
          <div className="flex gap-3 p-4 rounded-xl bg-brand-600/10 border border-brand-600/20">
            <Info className="w-4 h-4 text-brand-400 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-slate-300 space-y-1">
              <p className="font-medium text-white">Procesamiento automático</p>
              <p className="text-slate-400">
                Cada video subido se analiza con FFprobe (duración, resolución,
                codec) y se genera un thumbnail automáticamente. Si el codec no
                es H.264/AAC, se recodifica para compatibilidad con el playout.
              </p>
            </div>
          </div>

          {/* Selector de carpeta */}
          <div className="glass-card p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Folder className="w-4 h-4 text-brand-400" />
              <span className="text-sm font-semibold text-white">Carpeta de destino</span>
              <span className="text-xs text-slate-600 ml-auto">opcional</span>
            </div>

            <div className="flex gap-2">
              <select
                value={newFolderMode ? '__new__' : selectedFolder}
                onChange={(e) => {
                  if (e.target.value === '__new__') {
                    setNewFolderMode(true);
                    setSelectedFolder('');
                  } else {
                    setNewFolderMode(false);
                    setSelectedFolder(e.target.value);
                  }
                }}
                className={cn(inputClass, newFolderMode ? 'w-44 flex-shrink-0' : 'flex-1')}
              >
                <option value="">— Sin carpeta —</option>
                {existingFolders.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
                <option value="__new__">+ Nueva carpeta...</option>
              </select>

              {newFolderMode && (
                <input
                  autoFocus
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder="Nombre de la carpeta"
                  maxLength={100}
                  className={cn(inputClass, 'flex-1')}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setNewFolderMode(false);
                      setNewFolderName('');
                    }
                  }}
                />
              )}
            </div>

            {activeFolder && (
              <p className="text-xs text-slate-500 flex items-center gap-1.5">
                <FolderPlus className="w-3 h-3 text-brand-400" />
                Los videos se subirán a{' '}
                <span className="text-brand-400 font-medium">"{activeFolder}"</span>
              </p>
            )}
          </div>

          {/* Upload zone */}
          <UploadZone
            channelId={channelId}
            folder={activeFolder}
            onUploadComplete={handleUploadComplete}
          />

          {/* Counter */}
          {uploadCount > 0 && (
            <div className="text-center">
              <p className="text-sm text-slate-400">
                {uploadCount} video{uploadCount > 1 ? 's' : ''} enviado
                {uploadCount > 1 ? 's' : ''} a procesar.{' '}
                <Link
                  href="/library"
                  className="text-brand-400 hover:text-brand-300 font-medium transition-colors"
                >
                  Ver en biblioteca →
                </Link>
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
