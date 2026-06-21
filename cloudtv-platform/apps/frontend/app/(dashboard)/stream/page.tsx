'use client';

import { Tv2 } from 'lucide-react';
import { Header } from '@/components/dashboard/Header';

export default function StreamPage() {
  return (
    <div className="flex flex-col flex-1">
      <Header title="Stream / Salidas" subtitle="Configurá los destinos de tu señal" />
      <div className="flex-1 p-6">
        <div className="glass-card p-16 text-center">
          <div className="w-16 h-16 rounded-2xl bg-surface-700 flex items-center justify-center mx-auto mb-4">
            <Tv2 className="w-8 h-8 text-slate-600" />
          </div>
          <h3 className="text-base font-semibold text-white mb-2">
            Salidas de stream
          </h3>
          <p className="text-sm text-slate-500 max-w-sm mx-auto">
            Configurá emisión simultánea a YouTube, Facebook, Twitch y destinos RTMP personalizados.
          </p>
        </div>
      </div>
    </div>
  );
}
