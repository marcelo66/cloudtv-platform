'use client';

import { useEffect, useState } from 'react';
import {
  Tv,
  Film,
  ListVideo,
  Clock,
  Radio,
  Plus,
  ArrowRight,
  Activity,
  Zap,
} from 'lucide-react';
import { Header } from '@/components/dashboard/Header';
import { StatsCard } from '@/components/dashboard/StatsCard';
import { ChannelStatusCard } from '@/components/channel/ChannelStatusCard';
import { useAuthStore } from '@/stores/auth.store';
import apiClient from '@/lib/api-client';
import { formatDuration } from '@/lib/utils';
import Link from 'next/link';
import { toast } from 'sonner';

interface DashboardStats {
  channels: number;
  liveChannels: number;
  videos: number;
  playlists: number;
  totalDurationSeconds: number;
}

interface Channel {
  id: string;
  name: string;
  slug: string;
  status: string;
  streamKey: string;
  hlsUrl?: string;
  _count: { videos: number; playlists: number };
}

export default function DashboardPage() {
  const { user } = useAuthStore();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [statsRes, channelsRes] = await Promise.all([
        apiClient.get('/channels/stats'),
        apiClient.get('/channels'),
      ]);
      setStats(statsRes.data);
      setChannels(channelsRes.data);
    } catch (_) {
      // Muestra datos vacíos si la API aún no responde
    } finally {
      setLoading(false);
    }
  };

  const handleCreateChannel = async () => {
    try {
      const name = `Mi Canal ${Date.now().toString(36).slice(-4).toUpperCase()}`;
      const { data } = await apiClient.post('/channels', { name });
      setChannels((prev) => [data, ...prev]);
      toast.success(`Canal "${data.name}" creado`);
      loadData();
    } catch (error: any) {
      toast.error(error?.response?.data?.message || 'Error al crear el canal');
    }
  };

  const greeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Buenos días';
    if (hour < 18) return 'Buenas tardes';
    return 'Buenas noches';
  };

  return (
    <div className="flex flex-col flex-1">
      <Header
        title="Dashboard"
        subtitle={`${greeting()}, ${user?.name?.split(' ')[0] ?? 'Usuario'}`}
      />

      <div className="flex-1 p-6 space-y-6 overflow-y-auto">
        {/* Welcome banner (solo si no hay canales) */}
        {!loading && channels.length === 0 && (
          <div
            className="rounded-xl p-6 border border-brand-600/30 relative overflow-hidden"
            style={{
              background:
                'linear-gradient(135deg, rgba(79,110,247,0.15) 0%, rgba(79,110,247,0.05) 100%)',
            }}
          >
            <div className="absolute right-0 top-0 w-48 h-48 opacity-5">
              <Tv className="w-full h-full text-brand-500" />
            </div>
            <div className="relative">
              <div className="flex items-center gap-2 mb-2">
                <Zap className="w-4 h-4 text-brand-400" />
                <span className="text-xs font-semibold text-brand-400 uppercase tracking-wider">
                  Empezá ahora
                </span>
              </div>
              <h2 className="text-lg font-bold text-white mb-1">
                Creá tu primer canal de TV
              </h2>
              <p className="text-sm text-slate-400 mb-4 max-w-md">
                Subí videos, organizá playlists y empezá a emitir en 24/7 en pocos minutos.
              </p>
              <button
                onClick={handleCreateChannel}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold transition-colors"
              >
                <Plus className="w-4 h-4" />
                Crear canal ahora
              </button>
            </div>
          </div>
        )}

        {/* Stats grid */}
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          <StatsCard
            title="Canales"
            value={stats?.channels ?? 0}
            subtitle={`${stats?.liveChannels ?? 0} en vivo ahora`}
            icon={Tv}
            color="blue"
          />
          <StatsCard
            title="Videos"
            value={stats?.videos ?? 0}
            subtitle="En biblioteca"
            icon={Film}
            color="purple"
          />
          <StatsCard
            title="Playlists"
            value={stats?.playlists ?? 0}
            subtitle="Organizadas"
            icon={ListVideo}
            color="orange"
          />
          <StatsCard
            title="Contenido total"
            value={
              stats ? formatDuration(stats.totalDurationSeconds) : '0:00'
            }
            subtitle="Horas de material"
            icon={Clock}
            color="green"
          />
        </div>

        {/* Channels + Quick actions */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Channels list */}
          <div className="lg:col-span-2 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">Mis canales</h2>
              {channels.length > 0 && (
                <button
                  onClick={handleCreateChannel}
                  className="flex items-center gap-1.5 text-xs text-brand-400 hover:text-brand-300 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Nuevo canal
                </button>
              )}
            </div>

            {loading ? (
              <div className="space-y-3">
                {[1, 2].map((i) => (
                  <div
                    key={i}
                    className="glass-card p-5 animate-pulse"
                    style={{ height: 200 }}
                  >
                    <div className="h-4 bg-white/5 rounded w-1/3 mb-3" />
                    <div className="h-3 bg-white/5 rounded w-1/2" />
                  </div>
                ))}
              </div>
            ) : channels.length === 0 ? (
              <div className="glass-card p-8 text-center">
                <Radio className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                <p className="text-sm text-slate-400">
                  No tenés canales aún. ¡Creá el primero!
                </p>
              </div>
            ) : (
              channels.map((channel) => (
                <ChannelStatusCard
                  key={channel.id}
                  channel={channel}
                  onStart={() => toast.info('Próximamente: iniciar canal')}
                  onStop={() => toast.info('Próximamente: detener canal')}
                />
              ))
            )}
          </div>

          {/* Quick actions */}
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-white">Acciones rápidas</h2>
            <div className="glass-card p-4 space-y-1">
              {[
                {
                  label: 'Subir video',
                  href: '/library/upload',
                  icon: Film,
                  desc: 'Agregar a la biblioteca',
                },
                {
                  label: 'Nueva playlist',
                  href: '/playlists',
                  icon: ListVideo,
                  desc: 'Organizar contenido',
                },
                {
                  label: 'Programar emisión',
                  href: '/scheduler',
                  icon: Clock,
                  desc: 'Horario semanal',
                },
                {
                  label: 'Ver canal en vivo',
                  href: '/channel',
                  icon: Radio,
                  desc: 'Monitor y estadísticas',
                },
              ].map(({ label, href, icon: Icon, desc }) => (
                <Link
                  key={href}
                  href={href}
                  className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-white/5 transition-colors group"
                >
                  <div className="w-8 h-8 rounded-lg bg-brand-600/15 border border-brand-600/20 flex items-center justify-center flex-shrink-0 group-hover:bg-brand-600/25 transition-colors">
                    <Icon className="w-4 h-4 text-brand-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white">{label}</p>
                    <p className="text-xs text-slate-500">{desc}</p>
                  </div>
                  <ArrowRight className="w-3.5 h-3.5 text-slate-600 group-hover:text-slate-400 group-hover:translate-x-0.5 transition-all" />
                </Link>
              ))}
            </div>

            {/* Activity indicator */}
            <div className="glass-card p-4">
              <div className="flex items-center gap-2 mb-3">
                <Activity className="w-4 h-4 text-slate-400" />
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  Actividad del sistema
                </span>
              </div>
              <div className="space-y-2">
                {[
                  { label: 'CPU Worker', value: 12, color: 'bg-blue-500' },
                  { label: 'Almacenamiento', value: 34, color: 'bg-purple-500' },
                  { label: 'Ancho de banda', value: 8, color: 'bg-green-500' },
                ].map(({ label, value, color }) => (
                  <div key={label}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-slate-500">{label}</span>
                      <span className="text-slate-400">{value}%</span>
                    </div>
                    <div className="h-1 bg-surface-600 rounded-full overflow-hidden">
                      <div
                        className={`h-full ${color} rounded-full transition-all duration-500`}
                        style={{ width: `${value}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
