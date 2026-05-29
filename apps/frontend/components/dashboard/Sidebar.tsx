'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useRouter } from 'next/navigation';
import {
  Tv,
  LayoutDashboard,
  Film,
  ListVideo,
  CalendarClock,
  Radio,
  Layers,
  Settings,
  LogOut,
  ChevronRight,
  Clapperboard,
  Antenna,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth.store';
import { toast } from 'sonner';

const navItems = [
  {
    label: 'Dashboard',
    href: '/',
    icon: LayoutDashboard,
  },
  {
    label: 'Biblioteca',
    href: '/library',
    icon: Film,
  },
  {
    label: 'Playlists',
    href: '/playlists',
    icon: ListVideo,
  },
  {
    label: 'Programación',
    href: '/scheduler',
    icon: CalendarClock,
  },
  {
    label: 'Canal en vivo',
    href: '/channel',
    icon: Radio,
  },
  {
    label: 'Overlays',
    href: '/overlays',
    icon: Layers,
  },
  {
    label: 'Stream / Salidas',
    href: '/stream',
    icon: Tv,
  },
  {
    label: 'Publicidad',
    href: '/ads',
    icon: Clapperboard,
  },
  {
    label: 'Ingesta',
    href: '/ingest',
    icon: Antenna,
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuthStore();

  const handleLogout = async () => {
    await logout();
    toast.success('Sesión cerrada');
    router.push('/login');
  };

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  };

  return (
    <aside className="w-60 min-h-screen flex flex-col bg-surface-800 border-r border-white/5">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-brand-600 flex items-center justify-center flex-shrink-0">
            <Tv className="w-4 h-4 text-white" />
          </div>
          <div>
            <span className="text-base font-bold text-white leading-none">
              CloudTV
            </span>
            <p className="text-xs text-slate-500 mt-0.5">Plataforma</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {navItems.map(({ label, href, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 group relative',
              isActive(href)
                ? 'bg-brand-600/20 text-white'
                : 'text-slate-400 hover:text-white hover:bg-white/5',
            )}
          >
            {/* Active indicator */}
            {isActive(href) && (
              <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-brand-500 rounded-r-full" />
            )}
            <Icon
              className={cn(
                'w-4 h-4 flex-shrink-0 transition-colors',
                isActive(href) ? 'text-brand-400' : 'text-slate-500 group-hover:text-slate-300',
              )}
            />
            <span className="flex-1">{label}</span>
            {isActive(href) && (
              <ChevronRight className="w-3 h-3 text-brand-400/60" />
            )}
          </Link>
        ))}
      </nav>

      {/* Bottom: Settings + User */}
      <div className="px-3 pb-4 space-y-0.5 border-t border-white/5 pt-3">
        <Link
          href="/settings"
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-slate-400 hover:text-white hover:bg-white/5 transition-all group"
        >
          <Settings className="w-4 h-4 text-slate-500 group-hover:text-slate-300" />
          Configuración
        </Link>

        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-slate-400 hover:text-red-400 hover:bg-red-500/5 transition-all group"
        >
          <LogOut className="w-4 h-4 text-slate-500 group-hover:text-red-400" />
          Cerrar sesión
        </button>

        {/* User chip */}
        <div className="mt-3 px-3 py-2.5 rounded-lg bg-surface-700/50 flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-full bg-brand-600 flex items-center justify-center flex-shrink-0">
            <span className="text-xs font-bold text-white">
              {user?.name?.charAt(0).toUpperCase() ?? 'U'}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-white truncate">{user?.name}</p>
            <p className="text-xs text-slate-500 truncate">{user?.plan}</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
