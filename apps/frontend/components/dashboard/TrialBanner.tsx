'use client';

import { useAuthStore } from '@/stores/auth.store';

export function TrialBanner() {
  const user = useAuthStore((s) => s.user);

  if (!user?.trialExpiresAt || user.role === 'ADMIN' || user.role === 'SUPER_ADMIN') {
    return null;
  }

  const expiresAt = new Date(user.trialExpiresAt);
  const now = new Date();
  const hoursLeft = Math.max(0, Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60)));
  const expired = user.trialExpired || hoursLeft <= 0;

  if (expired) {
    return (
      <div className="bg-red-900/80 border-b border-red-700 px-4 py-3">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-red-300 text-lg">&#9888;</span>
            <div>
              <p className="text-white font-medium text-sm">
                Tu periodo de prueba ha expirado
              </p>
              <p className="text-red-300 text-xs">
                Actualiza tu plan para seguir usando la plataforma.
              </p>
            </div>
          </div>
          <a
            href="/settings"
            className="bg-brand-500 hover:bg-brand-600 text-white text-sm px-4 py-1.5 rounded-md transition-colors"
          >
            Ver planes
          </a>
        </div>
      </div>
    );
  }

  const daysLeft = Math.ceil(hoursLeft / 24);

  return (
    <div className="bg-amber-900/60 border-b border-amber-700/50 px-4 py-2">
      <div className="max-w-5xl mx-auto flex items-center justify-between">
        <p className="text-amber-200 text-sm">
          <span className="font-medium">Demo gratuita:</span>{' '}
          {daysLeft > 1 ? `${daysLeft} dias restantes` : `${hoursLeft} horas restantes`}
        </p>
        <a
          href="/settings"
          className="text-amber-200 hover:text-white text-sm underline transition-colors"
        >
          Actualizar plan
        </a>
      </div>
    </div>
  );
}
