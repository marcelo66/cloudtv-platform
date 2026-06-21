'use client';

import { Radio, Signal } from 'lucide-react';
import { Header } from '@/components/dashboard/Header';

export default function ChannelPage() {
  return (
    <div className="flex flex-col flex-1">
      <Header title="Canal en vivo" subtitle="Monitor y control de emisión" />
      <div className="flex-1 p-6">
        <div className="glass-card p-16 text-center">
          <div className="w-16 h-16 rounded-2xl bg-surface-700 flex items-center justify-center mx-auto mb-4">
            <Radio className="w-8 h-8 text-slate-600" />
          </div>
          <h3 className="text-base font-semibold text-white mb-2">
            Monitor del canal
          </h3>
          <p className="text-sm text-slate-500 max-w-sm mx-auto">
            El reproductor HLS en tiempo real, estadísticas y control del motor de playout se implementan en el siguiente módulo.
          </p>
          <div className="mt-6 flex items-center justify-center gap-2 text-xs text-slate-600">
            <Signal className="w-4 h-4" />
            Próximo módulo: Playout Engine
          </div>
        </div>
      </div>
    </div>
  );
}
