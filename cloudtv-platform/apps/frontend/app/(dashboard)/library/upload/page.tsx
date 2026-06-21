'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Info } from 'lucide-react';
import Link from 'next/link';
import { Header } from '@/components/dashboard/Header';
import { UploadZone } from '@/components/library/UploadZone';
import { useQueryClient } from '@tanstack/react-query';
import apiClient from '@/lib/api-client';

export default function UploadPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [channelId, setChannelId] = useState<string | null>(null);
  const [channelName, setChannelName] = useState('');
  const [uploadCount, setUploadCount] = useState(0);

  useEffect(() => {
    apiClient.get('/channels').then(({ data }) => {
      if (data.length > 0) {
        setChannelId(data[0].id);
        setChannelName(data[0].name);
      }
    });
  }, []);

  const handleUploadComplete = () => {
    setUploadCount((n) => n + 1);
    // Invalidar cache de videos para que la biblioteca se actualice
    queryClient.invalidateQueries({ queryKey: ['videos'] });
  };

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
            <Link
              href="/"
              className="text-sm text-brand-400 hover:text-brand-300"
            >
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

          {/* Upload zone */}
          <UploadZone
            channelId={channelId}
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
