'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Radio,
  Play,
  Square,
  Copy,
  Check,
  RefreshCw,
  Settings2,
  Key,
  ExternalLink,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  Trash2,
  Save,
  Tv,
  Terminal,
  Gauge,
} from 'lucide-react';
import { Header } from '@/components/dashboard/Header';
import apiClient from '@/lib/api-client';
import { HlsPlayer } from '@/components/channel/HlsPlayer';
import {
  useChannels,
  useChannel,
  useStartChannel,
  useStopChannel,
  useUpdateChannel,
  useRegenerateStreamKey,
  useDeleteChannel,
} from '@/hooks/useChannels';
import { useSchedules } from '@/hooks/useSchedules';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

// ─── helpers ──────────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  OFFLINE: {
    label: 'Offline',
    badge: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
    dot: 'w-2 h-2 rounded-full bg-slate-500',
    icon: 'text-slate-500',
  },
  LIVE_PLAYLIST: {
    label: 'En vivo — Playlist',
    badge: 'bg-green-500/10 text-green-400 border-green-500/20',
    dot: 'w-2 h-2 rounded-full bg-green-500 animate-pulse',
    icon: 'text-green-400',
  },
  LIVE_RTMP: {
    label: 'En vivo — RTMP',
    badge: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    dot: 'w-2 h-2 rounded-full bg-blue-500 animate-pulse',
    icon: 'text-blue-400',
  },
  STARTING: {
    label: 'Iniciando...',
    badge: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
    dot: 'w-2 h-2 rounded-full bg-yellow-500 animate-pulse',
    icon: 'text-yellow-400',
  },
  ERROR: {
    label: 'Error',
    badge: 'bg-red-500/10 text-red-400 border-red-500/20',
    dot: 'w-2 h-2 rounded-full bg-red-500',
    icon: 'text-red-400',
  },
} as const;

function CopyBtn({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success(`${label} copiado`);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={copy}
      className="p-1.5 rounded text-slate-500 hover:text-slate-300 transition-colors flex-shrink-0"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function todayRange() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  return { from: start.toISOString(), to: end.toISOString() };
}

// ─── Quality presets ──────────────────────────────────────────────────────────

const QUALITY_PRESETS = [
  {
    key: '480p',
    label: '480p',
    sublabel: 'SD',
    vBitrate: '1.000 kbps',
    aBitrate: '96 kbps',
    scale: '854×480',
  },
  {
    key: '720p',
    label: '720p',
    sublabel: 'HD',
    vBitrate: '2.500 kbps',
    aBitrate: '128 kbps',
    scale: '1280×720',
  },
  {
    key: '1080p',
    label: '1080p',
    sublabel: 'FHD',
    vBitrate: '4.500 kbps',
    aBitrate: '192 kbps',
    scale: '1920×1080',
  },
] as const;

// ─── component ────────────────────────────────────────────────────────────────

export default function ChannelPage() {
  const { data: channels = [], isLoading: loadingChannels } = useChannels();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showSelector, setShowSelector] = useState(false);
  const [activeTab, setActiveTab] = useState<'monitor' | 'settings'>('monitor');
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [confirmStop, setConfirmStop] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showFullKey, setShowFullKey] = useState(false);

  // Auto-select first channel
  useEffect(() => {
    if (channels.length > 0 && !selectedId) {
      setSelectedId(channels[0].id);
    }
  }, [channels, selectedId]);

  const { data: channel, isLoading: loadingChannel } = useChannel(selectedId);

  // Sync edit fields
  useEffect(() => {
    if (channel) {
      setEditName(channel.name);
      setEditDesc(channel.description ?? '');
    }
  }, [channel?.id]);

  const { from, to } = todayRange();
  const { data: todaySchedules = [] } = useSchedules(selectedId, from, to);

  const start = useStartChannel();
  const stop = useStopChannel();
  const update = useUpdateChannel();
  const regen = useRegenerateStreamKey();
  const del = useDeleteChannel();

  const handleStart = () => {
    if (selectedId) start.mutate(selectedId);
  };

  const handleStop = () => {
    if (selectedId) {
      stop.mutate(selectedId);
      setConfirmStop(false);
    }
  };

  const handleSaveSettings = () => {
    if (!selectedId) return;
    update.mutate({ id: selectedId, data: { name: editName, description: editDesc } });
  };

  const handleQualityChange = (q: string) => {
    if (!selectedId || q === channel?.videoQuality) return;
    update.mutate({ id: selectedId, data: { videoQuality: q } });
  };

  const handleRegenKey = () => {
    if (!selectedId || !confirm('¿Regenerar stream key? La clave actual quedará inválida.')) return;
    regen.mutate(selectedId);
  };

  const handleDelete = () => {
    if (!selectedId) return;
    del.mutate(selectedId, {
      onSuccess: () => {
        setSelectedId(null);
        setConfirmDelete(false);
      },
    });
  };

  const isLive =
    channel?.status === 'LIVE_PLAYLIST' || channel?.status === 'LIVE_RTMP';
  const isStarting = channel?.status === 'STARTING';
  const statusCfg =
    STATUS_CONFIG[(channel?.status as keyof typeof STATUS_CONFIG) ?? 'OFFLINE'] ??
    STATUS_CONFIG.OFFLINE;

  const maskedKey = channel?.streamKey
    ? channel.streamKey.slice(0, 10) + '••••••••••••'
    : '••••••••••••••••••••';

  // ─── Loading ─────────────────────────────────────────────────

  if (loadingChannels) {
    return (
      <div className="flex flex-col flex-1">
        <Header title="Canal en vivo" subtitle="Monitor y control de emisión" />
        <div className="flex-1 flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-brand-500/30 border-t-brand-500 rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  // ─── No channels ─────────────────────────────────────────────

  if (channels.length === 0) {
    return (
      <div className="flex flex-col flex-1">
        <Header title="Canal en vivo" subtitle="Monitor y control de emisión" />
        <div className="flex-1 p-6 flex items-center justify-center">
          <div className="glass-card p-16 text-center max-w-sm">
            <div className="w-16 h-16 rounded-2xl bg-surface-700 flex items-center justify-center mx-auto mb-4">
              <Tv className="w-8 h-8 text-slate-600" />
            </div>
            <h3 className="text-base font-semibold text-white mb-2">No hay canales</h3>
            <p className="text-sm text-slate-500">
              Creá tu primer canal desde el Dashboard para comenzar a emitir.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ─── Main layout ─────────────────────────────────────────────

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <Header title="Canal en vivo" subtitle="Monitor y control de emisión" />

      <div className="flex-1 p-6 overflow-y-auto space-y-5">
        {/* Channel selector + tabs */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          {/* Channel selector */}
          <div className="relative">
            <button
              onClick={() => setShowSelector((v) => !v)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-white/10 bg-surface-700/50 text-sm text-white hover:border-white/20 transition-colors"
            >
              <span
                className={cn(
                  'w-2 h-2 rounded-full flex-shrink-0',
                  isLive ? 'bg-green-500 animate-pulse' : 'bg-slate-500',
                )}
              />
              <span className="font-medium">{channel?.name ?? 'Seleccionar canal'}</span>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
            </button>
            {showSelector && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowSelector(false)} />
                <div className="absolute left-0 top-10 z-20 w-56 rounded-xl border border-white/10 bg-surface-600 shadow-xl overflow-hidden">
                  {channels.map((ch) => {
                    const cfg =
                      STATUS_CONFIG[ch.status as keyof typeof STATUS_CONFIG] ??
                      STATUS_CONFIG.OFFLINE;
                    return (
                      <button
                        key={ch.id}
                        onClick={() => {
                          setSelectedId(ch.id);
                          setShowSelector(false);
                        }}
                        className={cn(
                          'w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-left hover:bg-white/5 transition-colors',
                          ch.id === selectedId && 'bg-brand-600/10 text-white',
                        )}
                      >
                        <span className={cn('w-2 h-2 rounded-full flex-shrink-0', cfg.dot)} />
                        <span className="flex-1 truncate">{ch.name}</span>
                        <span className="text-xs text-slate-500">/{ch.slug}</span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          {/* Tabs */}
          <div className="flex rounded-lg border border-white/10 overflow-hidden">
            {(['monitor', 'settings'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={cn(
                  'px-4 py-1.5 text-xs font-medium flex items-center gap-1.5 transition-colors',
                  tab !== 'monitor' && 'border-l border-white/10',
                  activeTab === tab
                    ? 'bg-brand-600/20 text-white'
                    : 'text-slate-400 hover:text-white hover:bg-white/5',
                )}
              >
                {tab === 'monitor' ? (
                  <><Radio className="w-3.5 h-3.5" /> Monitor</>
                ) : (
                  <><Settings2 className="w-3.5 h-3.5" /> Configuración</>
                )}
              </button>
            ))}
          </div>
        </div>

        {loadingChannel ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-brand-500/30 border-t-brand-500 rounded-full animate-spin" />
          </div>
        ) : !channel ? null : activeTab === 'monitor' ? (
          // ─── Monitor tab ────────────────────────────────────────
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Left col: status + controls */}
            <div className="space-y-4">
              {/* Status card */}
              <div className="glass-card p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div
                      className={cn(
                        'w-10 h-10 rounded-xl border flex items-center justify-center',
                        isLive
                          ? 'bg-green-500/10 border-green-500/20'
                          : 'bg-slate-500/10 border-slate-500/20',
                      )}
                    >
                      <Radio className={cn('w-5 h-5', statusCfg.icon)} />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-white">{channel.name}</p>
                      <p className="text-xs text-slate-500">/{channel.slug}</p>
                    </div>
                  </div>
                  <div
                    className={cn(
                      'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border',
                      statusCfg.badge,
                    )}
                  >
                    <span className={statusCfg.dot} />
                    {statusCfg.label}
                  </div>
                </div>

                {/* Control button */}
                {!isLive && !isStarting ? (
                  <button
                    onClick={handleStart}
                    disabled={start.isPending}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium bg-green-600 hover:bg-green-500 text-white transition-colors disabled:opacity-50"
                  >
                    <Play className="w-4 h-4" />
                    {start.isPending ? 'Iniciando...' : 'Iniciar emisión'}
                  </button>
                ) : isStarting ? (
                  <div className="space-y-2">
                    <div className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium bg-yellow-600/20 text-yellow-300 border border-yellow-500/20">
                      <span className="w-3 h-3 rounded-full border-2 border-yellow-400/40 border-t-yellow-400 animate-spin" />
                      Iniciando canal...
                    </div>
                    <button
                      onClick={handleStop}
                      disabled={stop.isPending}
                      className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-medium text-red-400 border border-red-500/30 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                    >
                      <Square className="w-3 h-3" />
                      {stop.isPending ? 'Cancelando...' : 'Cancelar inicio'}
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmStop(true)}
                    disabled={stop.isPending}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium bg-red-600/80 hover:bg-red-600 text-white transition-colors disabled:opacity-50"
                  >
                    <Square className="w-3.5 h-3.5" />
                    {stop.isPending ? 'Deteniendo...' : 'Detener emisión'}
                  </button>
                )}

                {/* Stats row */}
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <div className="rounded-lg bg-surface-700/50 px-3 py-2 text-center">
                    <p className="text-lg font-bold text-white">
                      {channel._count?.videos ?? 0}
                    </p>
                    <p className="text-xs text-slate-500">Videos</p>
                  </div>
                  <div className="rounded-lg bg-surface-700/50 px-3 py-2 text-center">
                    <p className="text-lg font-bold text-white">
                      {channel._count?.playlists ?? 0}
                    </p>
                    <p className="text-xs text-slate-500">Playlists</p>
                  </div>
                </div>
              </div>

              {/* Today's schedule */}
              <div className="glass-card p-4">
                <div className="flex items-center gap-2 mb-3">
                  <CalendarClock className="w-4 h-4 text-slate-400" />
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                    Programación de hoy
                  </span>
                </div>
                {todaySchedules.length === 0 ? (
                  <p className="text-xs text-slate-600 text-center py-4">
                    Sin programas para hoy
                  </p>
                ) : (
                  <div className="space-y-2">
                    {todaySchedules.map((sch) => {
                      const now = new Date();
                      const start = new Date(sch.startTime);
                      const end = new Date(sch.endTime);
                      const isCurrent = now >= start && now <= end;
                      const isPast = now > end;
                      return (
                        <div
                          key={sch.id}
                          className={cn(
                            'flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs',
                            isCurrent
                              ? 'bg-green-500/10 border border-green-500/20'
                              : isPast
                              ? 'opacity-40'
                              : 'bg-surface-700/50',
                          )}
                        >
                          {isCurrent && (
                            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse flex-shrink-0" />
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-white truncate">{sch.name}</p>
                            <p className="text-slate-500">
                              {formatTime(sch.startTime)} — {formatTime(sch.endTime)}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Right col: stream credentials + preview */}
            <div className="lg:col-span-2 space-y-4">
              {/* Preview */}
              <div className="glass-card overflow-hidden">
                <div className="aspect-video bg-black relative">
                  <HlsPlayer
                    src={`/api/playout/${channel.id}/hls/index.m3u8`}
                    active={isLive}
                    starting={isStarting}
                  />
                  {/* LIVE badge */}
                  {isLive && (
                    <div className="absolute top-3 left-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-600 text-xs font-bold text-white pointer-events-none">
                      <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                      EN VIVO
                    </div>
                  )}
                  {isStarting && (
                    <div className="absolute top-3 left-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-yellow-600 text-xs font-bold text-white pointer-events-none">
                      <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                      INICIANDO
                    </div>
                  )}
                </div>
              </div>

              {/* Stream credentials */}
              <div className="glass-card p-5 space-y-3">
                <div className="flex items-center gap-2 mb-1">
                  <Key className="w-4 h-4 text-slate-400" />
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                    Salida del canal
                  </span>
                </div>

                {/* HLS URL — principal */}
                <div className="space-y-1">
                  <p className="text-xs text-slate-500 px-1">URL de reproducción HLS</p>
                  <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-surface-700/50">
                    <span className="text-xs text-slate-300 font-mono flex-1 truncate">
                      {channel.hlsUrl
                        ? channel.hlsUrl
                        : <span className="text-slate-600">Disponible al iniciar el canal</span>}
                    </span>
                    {channel.hlsUrl && (
                      <>
                        <CopyBtn text={channel.hlsUrl} label="URL HLS" />
                        <a
                          href={channel.hlsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1.5 rounded text-slate-500 hover:text-slate-300 transition-colors flex-shrink-0"
                          title="Abrir en nueva pestaña"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      </>
                    )}
                  </div>
                  <p className="text-xs text-slate-600 px-1">
                    Usá esta URL en VLC, OBS (fuente media) o cualquier reproductor compatible con HLS.
                  </p>
                </div>

                {/* Stream Key */}
                <div className="space-y-1">
                  <p className="text-xs text-slate-500 px-1">Stream Key de canal</p>
                  <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-surface-700/50">
                    <span
                      className="text-xs text-slate-300 font-mono flex-1 truncate cursor-pointer select-none"
                      onClick={() => setShowFullKey((v) => !v)}
                      title="Clic para mostrar/ocultar"
                    >
                      {showFullKey ? channel.streamKey : maskedKey}
                    </span>
                    <CopyBtn text={channel.streamKey} label="Stream key" />
                    <button
                      onClick={handleRegenKey}
                      disabled={regen.isPending}
                      className="p-1.5 rounded text-slate-500 hover:text-yellow-400 transition-colors flex-shrink-0"
                      title="Regenerar stream key"
                    >
                      <RefreshCw
                        className={cn('w-3.5 h-3.5', regen.isPending && 'animate-spin')}
                      />
                    </button>
                  </div>
                  <p className="text-xs text-slate-600 px-1">
                    Clave de autenticación de la API. No la compartas.
                  </p>
                </div>
              </div>

              {/* Playout logs */}
              <PlayoutLogs
                channelId={channel.id}
                active={isLive || isStarting || channel.status === 'ERROR'}
              />
            </div>
          </div>
        ) : (
          // ─── Settings tab ────────────────────────────────────────
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 max-w-2xl">
            <div className="glass-card p-5 space-y-4 lg:col-span-2">
              <h3 className="text-sm font-semibold text-white">Información del canal</h3>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">
                  Nombre del canal
                </label>
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  maxLength={100}
                  className="w-full px-3 py-2 rounded-lg text-sm bg-surface-700 border border-white/10 text-white placeholder-slate-500
                             focus:outline-none focus:ring-1 focus:ring-brand-500/50 focus:border-brand-500 transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">
                  Descripción
                </label>
                <textarea
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  maxLength={500}
                  rows={3}
                  placeholder="Descripción del canal..."
                  className="w-full px-3 py-2 rounded-lg text-sm bg-surface-700 border border-white/10 text-white placeholder-slate-500
                             focus:outline-none focus:ring-1 focus:ring-brand-500/50 focus:border-brand-500 transition-colors resize-none"
                />
              </div>

              <div className="flex items-center justify-between pt-1">
                <div className="text-xs text-slate-500">
                  Slug:{' '}
                  <span className="font-mono text-slate-400">/{channel.slug}</span>
                </div>
                <button
                  onClick={handleSaveSettings}
                  disabled={
                    update.isPending ||
                    (editName === channel.name && editDesc === (channel.description ?? ''))
                  }
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-brand-600 hover:bg-brand-500 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Save className="w-3.5 h-3.5" />
                  {update.isPending ? 'Guardando...' : 'Guardar cambios'}
                </button>
              </div>
            </div>

            {/* Quality settings */}
            <div className="glass-card p-5 space-y-4 lg:col-span-2">
              <div className="flex items-center gap-2">
                <Gauge className="w-4 h-4 text-slate-400" />
                <h3 className="text-sm font-semibold text-white">Calidad de emisión</h3>
              </div>

              <div className="grid grid-cols-3 gap-3">
                {QUALITY_PRESETS.map((preset) => {
                  const isActive = (channel.videoQuality ?? '480p') === preset.key;
                  return (
                    <button
                      key={preset.key}
                      onClick={() => handleQualityChange(preset.key)}
                      disabled={update.isPending}
                      className={cn(
                        'rounded-xl border p-4 text-left transition-all disabled:cursor-not-allowed',
                        isActive
                          ? 'border-brand-500/50 bg-brand-500/10 ring-1 ring-brand-500/25'
                          : 'border-white/10 bg-surface-700/40 hover:border-white/20 hover:bg-surface-700/60',
                      )}
                    >
                      <div className="flex items-baseline gap-1.5 mb-2">
                        <span className="text-base font-bold text-white">{preset.label}</span>
                        <span className={cn('text-xs font-semibold', isActive ? 'text-brand-400' : 'text-slate-500')}>
                          {preset.sublabel}
                        </span>
                      </div>
                      <div className={cn('text-xs space-y-0.5', isActive ? 'text-slate-300' : 'text-slate-500')}>
                        <div>Video: {preset.vBitrate}</div>
                        <div>Audio: {preset.aBitrate}</div>
                        <div className="text-[11px] opacity-60 mt-1 font-mono">{preset.scale}</div>
                      </div>
                      {isActive && (
                        <div className="mt-2.5 flex items-center gap-1">
                          <Check className="w-3 h-3 text-brand-400" />
                          <span className="text-[11px] text-brand-400 font-medium">Seleccionada</span>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>

              <p className="text-xs text-slate-500 leading-relaxed">
                El cambio aplica al <span className="text-slate-400">reiniciar el canal</span>. Si el canal está en vivo, detenelo y volvé a iniciarlo para que tome efecto la nueva calidad.
              </p>
            </div>

            {/* Danger zone */}
            <div className="glass-card p-5 border-red-500/20 lg:col-span-2">
              <h3 className="text-sm font-semibold text-red-400 mb-3">Zona peligrosa</h3>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-white">Eliminar canal</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Elimina el canal y todos sus datos. Esta acción no se puede deshacer.
                  </p>
                </div>
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-red-400 border border-red-500/30 hover:bg-red-500/10 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                  Eliminar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Confirm stop modal */}
      {confirmStop && (
        <ConfirmModal
          title="¿Detener la emisión?"
          description="El canal dejará de transmitir de inmediato."
          confirmLabel="Detener"
          confirmClass="bg-red-600 hover:bg-red-500"
          onConfirm={handleStop}
          onCancel={() => setConfirmStop(false)}
          isPending={stop.isPending}
        />
      )}

      {/* Confirm delete modal */}
      {confirmDelete && (
        <ConfirmModal
          title="¿Eliminar el canal?"
          description="Se eliminarán todos los videos, playlists y programaciones asociadas. Esta acción no se puede deshacer."
          confirmLabel="Eliminar definitivamente"
          confirmClass="bg-red-600 hover:bg-red-500"
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(false)}
          isPending={del.isPending}
        />
      )}
    </div>
  );
}

// ─── Playout logs panel ───────────────────────────────────────────────────────

function PlayoutLogs({ channelId, active }: { channelId: string; active: boolean }) {
  const [open, setOpen] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const prevActive = useRef(false);

  // Abrir automáticamente cuando el canal pasa de inactivo a activo
  useEffect(() => {
    if (active && !prevActive.current) setOpen(true);
    prevActive.current = active;
  }, [active]);

  useEffect(() => {
    if (!open || !active) return;
    let cancelled = false;

    const fetchLogs = async () => {
      setLoading(true);
      try {
        const { data } = await apiClient.get(`/playout/${channelId}/logs`);
        if (!cancelled) setLogs(data.logs ?? []);
      } catch { /* ignorar */ } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchLogs();
    const interval = setInterval(fetchLogs, 3000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [open, active, channelId]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  if (!active) return null;

  return (
    <div className="glass-card overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-3 text-xs font-medium text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
      >
        {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        <Terminal className="w-3.5 h-3.5" />
        Logs de playout (FFmpeg)
        {loading && <span className="ml-auto text-slate-600">actualizando...</span>}
      </button>

      {open && (
        <div className="border-t border-white/10 bg-black/40 p-3 max-h-64 overflow-y-auto font-mono">
          {logs.length === 0 ? (
            <p className="text-xs text-slate-600">Sin logs disponibles aún...</p>
          ) : (
            logs.map((line, i) => {
              const isError = /error|ERROR|failed|FAILED/i.test(line);
              const isWarn  = /warn|WARN|timeout|TIMEOUT/i.test(line);
              const isOk    = /✓|LIVE_PLAYLIST|listo/i.test(line);
              return (
                <div
                  key={i}
                  className={
                    isError ? 'text-red-400 text-xs leading-5' :
                    isWarn  ? 'text-yellow-400 text-xs leading-5' :
                    isOk    ? 'text-green-400 text-xs leading-5' :
                              'text-slate-400 text-xs leading-5'
                  }
                >
                  {line}
                </div>
              );
            })
          )}
          <div ref={logsEndRef} />
        </div>
      )}
    </div>
  );
}

// ─── Confirm modal ────────────────────────────────────────────────────────────

function ConfirmModal({
  title,
  description,
  confirmLabel,
  confirmClass,
  onConfirm,
  onCancel,
  isPending,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  confirmClass: string;
  onConfirm: () => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative bg-surface-800 border border-white/10 rounded-2xl shadow-2xl p-6 max-w-sm w-full">
        <h3 className="text-base font-semibold text-white mb-2">{title}</h3>
        <p className="text-sm text-slate-400 mb-5">{description}</p>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2 rounded-lg text-sm text-slate-400 hover:text-white border border-white/10 hover:border-white/20 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            disabled={isPending}
            className={cn(
              'flex-1 px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-50',
              confirmClass,
            )}
          >
            {isPending ? 'Procesando...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
