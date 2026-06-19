'use client';

import { UserCheck, X } from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';
import { useRouter } from 'next/navigation';

export function ImpersonationBanner() {
  const { impersonationAdmin, user, exitImpersonation } = useAuthStore();
  const router = useRouter();

  if (!impersonationAdmin) return null;

  const handleExit = () => {
    exitImpersonation();
    router.push('/admin');
  };

  return (
    <div className="flex items-center gap-3 bg-amber-500 text-amber-950 px-4 py-2 text-sm font-medium">
      <UserCheck className="w-4 h-4 flex-shrink-0" />
      <span className="flex-1">
        Estás viendo la plataforma como{' '}
        <strong>{user?.name}</strong>{' '}
        <span className="opacity-70">({user?.email})</span>
      </span>
      <button
        onClick={handleExit}
        className="flex items-center gap-1.5 bg-amber-950/20 hover:bg-amber-950/30 px-3 py-1 rounded-md transition-colors whitespace-nowrap"
      >
        <X className="w-3.5 h-3.5" />
        Volver a mi cuenta
      </button>
    </div>
  );
}
