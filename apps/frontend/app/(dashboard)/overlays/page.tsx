'use client';

import { Layers } from 'lucide-react';
import { Header } from '@/components/dashboard/Header';

export default function OverlaysPage() {
  return (
    <div className="flex flex-col flex-1">
      <Header title="Overlays" subtitle="Logos, textos y gráficos sobre la señal" />
      <div className="flex-1 p-6 flex items-center justify-center">
        <div className="glass-card p-16 text-center max-w-sm">
          <div className="w-16 h-16 rounded-2xl bg-surface-700 flex items-center justify-center mx-auto mb-4">
            <Layers className="w-8 h-8 text-slate-600" />
          </div>
          <h3 className="text-base font-semibold text-white mb-2">Overlays</h3>
          <p className="text-sm text-slate-500">
            Agregá logos, banners de texto y gráficos animados sobre la señal en vivo.
            Este módulo se activa junto al motor de playout avanzado.
          </p>
        </div>
      </div>
    </div>
  );
}
