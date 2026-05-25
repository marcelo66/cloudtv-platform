'use client';

import { Bell, Search } from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';

interface HeaderProps {
  title: string;
  subtitle?: string;
}

export function Header({ title, subtitle }: HeaderProps) {
  const { user } = useAuthStore();

  return (
    <header className="h-16 border-b border-white/5 bg-surface-800/40 backdrop-blur-sm flex items-center px-6 gap-4 sticky top-0 z-10">
      {/* Title */}
      <div className="flex-1">
        <h1 className="text-base font-semibold text-white leading-none">{title}</h1>
        {subtitle && (
          <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
        )}
      </div>

      {/* Search */}
      <div className="relative hidden md:block">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
        <input
          type="search"
          placeholder="Buscar..."
          className="w-52 pl-9 pr-4 py-1.5 rounded-lg text-sm bg-surface-700 border border-white/10 text-white placeholder-slate-500
                     focus:outline-none focus:ring-1 focus:ring-brand-500/50 focus:border-brand-500 transition-colors"
        />
      </div>

      {/* Notifications */}
      <button className="relative w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/5 text-slate-400 hover:text-white transition-colors">
        <Bell className="w-4 h-4" />
        <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-brand-500" />
      </button>

      {/* Avatar */}
      <div className="w-8 h-8 rounded-full bg-brand-600 flex items-center justify-center cursor-pointer">
        <span className="text-xs font-bold text-white">
          {user?.name?.charAt(0).toUpperCase() ?? 'U'}
        </span>
      </div>
    </header>
  );
}
