'use client';

import { useState, useEffect } from 'react';
import {
  Radio, Plus, Trash2, Edit2, Eye, EyeOff, ChevronDown,
  ToggleLeft, ToggleRight, X, AlertCircle, Loader2, ExternalLink,
  Play, Square, Info, Copy, Check, Wifi, Network, ChevronRight,
  Shield, RefreshCw, AlertTriangle, Signal,
} from 'lucide-react';
import { Header } from '@/components/dashboard/Header';
import apiClient from '@/lib/api-client';
import {
  useStreamOutputs, useCreateOutput, useUpdateOutput, useDeleteOutput,
  useStartOutput, useStopOutput,
  PLATFORM_META,
  type StreamOutput, type Platform, type CreateOutputInput,
} from '@/hooks/useStreamOutputs';
import { useZeroTierSummary, type ZTNetwork, type ZTPeer, ztIpOnly } from '@/hooks/useZeroTier';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

// ─── Constantes ───────────────────────────────────────────────────────────────

const RTMP_PLATFORMS: Platform[] = ['YOUTUBE', 'FACEBOOK', 'TWITCH', 'RTMP_CUSTOM'];
const SRT_PLATFORMS:  Platform[] = ['SRT_CALLER', 'SRT_LISTENER'];
const ALL_PLATFORMS:  Platform[] = [...RTMP_PLATFORMS, ...SRT_PLATFORMS];

const STATUS_CONFIG = {
  IDLE:      { label: 'Inactivo',         dot: 'bg-slate-500',               text: 'text-slate-400' },
  STREAMING: { label: 'Transmitiendo',    dot: 'bg-green-500 animate-pulse', text: 'text-green-400' },
  ERROR:     { label: 'Error',            dot: 'bg-red-500',                 text: 'text-red-400'   },
} as const;

const SRT_LISTENER_STATUS = {
  IDLE:      { label: 'Esperando',        dot: 'bg-slate-500',               text: 'text-slate-400' },
  STREAMING: { label: 'Escuchando',       dot: 'bg-teal-500 animate-pulse',  text: 'text-teal-400'  },
  ERROR:     { label: 'Error',            dot: 'bg-red-500',                 text: 'text-red-400'   },
} as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function PlatformBadge({
  platform, size = 'md', badgeOverride,
}: {
  platform: Platform;
  size?: 'sm' | 'md';
  badgeOverride?: string;
}) {
  const m = PLATFORM_META[platform];
  return (
    <span className={cn(
      'inline-flex items-center justify-center font-bold rounded',
      m.bg, m.color, m.border, 'border',
      size === 'sm' ? 'px-1.5 h-6 text-[10px]' : 'px-2 h-7 text-xs',
    )}>
      {badgeOverride ?? m.badge}
    </span>
  );
}

/** Para RTMP_CUSTOM: deriva badge corto del nombre ("RTMP 1" → "RT1", "Mi servidor" → "RT") */
function getRtmpCustomBadge(name: string): string {
  const match = name.match(/(\d+)$/);
  if (match) return `RT${match[1]}`;
  return 'RTMP';
}

function MaskedKey({ value }: { value: string }) {
  const [show, setShow] = useState(false);
  const masked = value.length > 8
    ? value.slice(0, 4) + '••••••••' + value.slice(-4)
    : '••••••••';
  return (
    <div className="flex items-center gap-1.5">
      <code className="text-xs font-mono text-slate-300 bg-surface-700 px-2 py-0.5 rounded truncate max-w-[180px]">
        {show ? value : masked}
      </code>
      <button onClick={() => setShow(v => !v)} className="text-slate-500 hover:text-slate-300">
        {show ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
      </button>
    </div>
  );
}

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <button
      onClick={copy}
      title="Copiar"
      className="flex items-center gap-1 px-2 py-0.5 rounded text-xs text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
    >
      {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
      {label && <span>{label}</span>}
    </button>
  );
}

// ─── Output Card ─────────────────────────────────────────────────────────────

function OutputCard({
  output, channelId, isChannelLive, onEdit, onDelete, onToggle, onStart, onStop,
}: {
  output:        StreamOutput;
  channelId:     string;
  isChannelLive: boolean;
  onEdit:   (o: StreamOutput) => void;
  onDelete: (id: string)      => void;
  onToggle: (o: StreamOutput) => void;
  onStart:  (o: StreamOutput) => void;
  onStop:   (o: StreamOutput) => void;
}) {
  const meta   = PLATFORM_META[output.platform];
  const isListener = output.platform === 'SRT_LISTENER';
  const isSrt  = meta.isSrt;
  const stCfg  = isListener ? SRT_LISTENER_STATUS[output.status] : STATUS_CONFIG[output.status];

  // Línea de conexión a mostrar según protocolo
  const connectionLine = isSrt
    ? (output.platform === 'SRT_LISTENER'
        ? `:${output.srtPort ?? 9001} · ${output.srtLatency ?? 120} ms latencia`
        : `${output.rtmpUrl || '—'}:${output.srtPort ?? 9001} · ${output.srtLatency ?? 120} ms`)
    : (output.rtmpUrl || '—');

  return (
    <div className={cn('glass-card p-4 transition-opacity', !output.enabled && 'opacity-60')}>
      <div className="flex items-start gap-3">
        <PlatformBadge
          platform={output.platform}
          badgeOverride={output.platform === 'RTMP_CUSTOM' ? getRtmpCustomBadge(output.name) : undefined}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-white truncate">{output.name}</span>
            <span className={cn('text-xs font-medium', meta.color)}>{meta.label}</span>
          </div>
          {/* Status */}
          <div className="flex items-center gap-1.5 mt-1">
            <div className={cn('w-2 h-2 rounded-full flex-shrink-0', stCfg.dot)} />
            <span className={cn('text-xs font-medium', stCfg.text)}>{stCfg.label}</span>
          </div>
          {/* Conexión */}
          <p className="text-xs text-slate-500 mt-1 truncate font-mono">{connectionLine}</p>
          {/* RTMP stream key / SRT passphrase indicator */}
          {!isSrt && output.streamKey && (
            <div className="mt-1">
              <MaskedKey value={output.streamKey} />
            </div>
          )}
          {isSrt && output.srtPassphrase && (
            <div className="flex items-center gap-1 mt-1 text-xs text-slate-500">
              <Shield className="w-3 h-3 text-cyan-500/70" />
              <span>Cifrado AES habilitado</span>
            </div>
          )}
        </div>
      </div>

      {/* Acciones */}
      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-surface-700 flex-wrap">
        <button
          onClick={() => onToggle(output)}
          className={cn(
            'flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded transition-colors',
            output.enabled ? 'text-slate-400 hover:bg-slate-500/10' : 'text-slate-600 hover:bg-slate-500/10',
          )}
          title={output.enabled ? 'Desactivar auto-inicio' : 'Activar auto-inicio al arrancar el canal'}
        >
          {output.enabled
            ? <><ToggleRight className="w-4 h-4 text-green-400" />Auto</>
            : <><ToggleLeft className="w-4 h-4" />Auto</>
          }
        </button>
        <div className="flex-1" />

        {isChannelLive ? (
          <>
            {output.status !== 'STREAMING' && (
              <button
                onClick={() => onStart(output)}
                className="flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-lg bg-green-600/20 text-green-400 hover:bg-green-600/30 border border-green-500/20 transition-colors"
              >
                <Play className="w-3 h-3" />
                {output.status === 'ERROR' ? 'Reintentar' : (isListener ? 'Escuchar' : 'Transmitir')}
              </button>
            )}
            {output.status === 'STREAMING' && (
              <button
                onClick={() => onStop(output)}
                className="flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-lg bg-red-600/20 text-red-400 hover:bg-red-600/30 border border-red-500/20 transition-colors"
              >
                <Square className="w-3 h-3" />
                Detener
              </button>
            )}
          </>
        ) : (
          <span className="text-xs text-slate-600 italic">Canal offline</span>
        )}

        <button onClick={() => onEdit(output)} className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-surface-700 transition-colors" title="Editar">
          <Edit2 className="w-3.5 h-3.5" />
        </button>
        <button onClick={() => onDelete(output.id)} className="p-1.5 rounded text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors" title="Eliminar">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// ─── ZeroTier Panel ──────────────────────────────────────────────────────────

function ZeroTierPanel({ onPickIp }: { onPickIp?: (ip: string) => void }) {
  const [open, setOpen] = useState(false);
  const { data, isLoading, error, refetch, isFetching } = useZeroTierSummary(open);

  const ztError = (error as any)?.response?.data?.message || (error as any)?.message;

  return (
    <div className="glass-card overflow-hidden">
      {/* Header colapsable */}
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 p-4 hover:bg-white/[0.02] transition-colors"
      >
        <div className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center flex-shrink-0">
          <Network className="w-4 h-4 text-cyan-400" />
        </div>
        <div className="flex-1 text-left">
          <p className="text-sm font-semibold text-white">ZeroTier</p>
          <p className="text-xs text-slate-500">Red privada virtual para SRT y distribución segura</p>
        </div>
        <div className="flex items-center gap-2">
          {data?.status?.online && (
            <span className="flex items-center gap-1 text-xs text-green-400">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              Online
            </span>
          )}
          <ChevronRight className={cn('w-4 h-4 text-slate-500 transition-transform', open && 'rotate-90')} />
        </div>
      </button>

      {open && (
        <div className="border-t border-white/5 p-4 space-y-4">
          {isLoading && (
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <Loader2 className="w-4 h-4 animate-spin" />
              Conectando con ZeroTier...
            </div>
          )}

          {ztError && !isLoading && (
            <div className="space-y-3">
              <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/5 border border-amber-500/15">
                <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                <div className="text-xs text-amber-300/90 space-y-1">
                  <p className="font-medium">ZeroTier no disponible</p>
                  <p className="text-amber-400/70">{ztError}</p>
                </div>
              </div>
              <div className="p-3 rounded-lg bg-surface-700 border border-white/5 space-y-2">
                <p className="text-xs font-semibold text-slate-300">Cómo configurar ZeroTier</p>
                <ol className="text-xs text-slate-500 space-y-1 list-decimal list-inside">
                  <li>Instalá ZeroTier One en el servidor donde corre EasyPanel</li>
                  <li>Copiá el contenido de <code className="text-slate-300">/var/lib/zerotier-one/authtoken.secret</code></li>
                  <li>En EasyPanel, agregá la variable de entorno: <code className="text-slate-300">ZEROTIER_AUTH_TOKEN=&lt;token&gt;</code></li>
                  <li>Si ZeroTier corre en el host (Docker), agregá también: <code className="text-slate-300">ZEROTIER_API_URL=http://host.docker.internal:9993</code></li>
                  <li>Hacé Deploy de la API para aplicar los cambios</li>
                </ol>
              </div>
              <button
                onClick={() => refetch()}
                className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors"
              >
                <RefreshCw className={cn('w-3.5 h-3.5', isFetching && 'animate-spin')} />
                Reintentar
              </button>
            </div>
          )}

          {data && !isLoading && (
            <div className="space-y-4">
              {/* Estado del nodo */}
              <div className="flex items-center gap-3 p-3 rounded-lg bg-surface-700 border border-white/5">
                <div className={cn(
                  'w-2 h-2 rounded-full flex-shrink-0',
                  data.status.online ? 'bg-green-400 animate-pulse' : 'bg-slate-500',
                )} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-white">
                    {data.status.online ? 'Online' : 'Offline'}
                    <span className="text-slate-500 font-normal ml-2">v{data.status.version}</span>
                  </p>
                  <p className="text-xs text-slate-500 font-mono mt-0.5">Node ID: {data.status.address}</p>
                </div>
                <button
                  onClick={() => refetch()}
                  className="p-1 text-slate-500 hover:text-slate-300 transition-colors"
                  title="Actualizar"
                >
                  <RefreshCw className={cn('w-3.5 h-3.5', isFetching && 'animate-spin')} />
                </button>
              </div>

              {/* Redes */}
              {data.networks.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
                    Redes ({data.networks.length})
                  </p>
                  {data.networks.map((net: ZTNetwork) => (
                    <div key={net.id} className="p-3 rounded-lg bg-surface-700 border border-white/5">
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <div>
                          <span className="text-xs font-medium text-white">{net.name || '(sin nombre)'}</span>
                          <span className="ml-2 text-[10px] text-slate-600 font-mono">{net.id}</span>
                        </div>
                        <span className={cn(
                          'text-[10px] px-1.5 py-0.5 rounded font-medium',
                          net.status === 'OK' ? 'bg-green-500/10 text-green-400' : 'bg-amber-500/10 text-amber-400',
                        )}>
                          {net.status}
                        </span>
                      </div>

                      {net.assignedAddresses.length > 0 ? (
                        <div className="space-y-1">
                          <p className="text-[10px] text-slate-600 uppercase tracking-wide">Mis IPs en esta red</p>
                          {net.assignedAddresses.map((addr) => {
                            const ip = ztIpOnly(addr);
                            return (
                              <div key={addr} className="flex items-center gap-2">
                                <code className="text-xs font-mono text-cyan-300 flex-1">{ip}</code>
                                <span className="text-[10px] text-slate-600">{addr.split('/')[1] ? `/${addr.split('/')[1]}` : ''}</span>
                                {onPickIp && (
                                  <button
                                    onClick={() => { onPickIp(ip); toast.success(`IP ${ip} copiada al campo destino`); }}
                                    className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 transition-colors"
                                  >
                                    Usar
                                  </button>
                                )}
                                <CopyButton text={ip} />
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-xs text-slate-600">Sin IP asignada aún</p>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-3 rounded-lg bg-surface-700 border border-white/5 text-center">
                  <p className="text-xs text-slate-500">No estás unido a ninguna red ZeroTier.</p>
                  <a
                    href="https://my.zerotier.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 mt-1 text-xs text-cyan-400 hover:text-cyan-300"
                  >
                    Crear / unirte a una red
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              )}

              {/* Peers LEAF */}
              {data.peers.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
                    Peers activos ({data.peers.length})
                  </p>
                  <div className="space-y-1.5">
                    {(data.peers as ZTPeer[]).map((peer) => {
                      const activePath = peer.paths.find((p) => p.active && p.preferred) || peer.paths.find((p) => p.active);
                      return (
                        <div key={peer.address} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-surface-700/50 border border-white/[0.04]">
                          <Signal className="w-3 h-3 text-slate-500 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <code className="text-xs font-mono text-slate-300">{peer.address}</code>
                            {activePath && (
                              <p className="text-[10px] text-slate-600 font-mono truncate">{activePath.address}</p>
                            )}
                          </div>
                          <span className="text-[10px] text-slate-500 flex-shrink-0">{peer.latency >= 0 ? `${peer.latency}ms` : '—'}</span>
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-[10px] text-slate-600">
                    Los peers muestran sus IPs físicas. Para ver sus IPs de ZeroTier, consultá{' '}
                    <a href="https://my.zerotier.com" target="_blank" rel="noopener noreferrer" className="text-cyan-500 hover:text-cyan-400">my.zerotier.com</a>.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Form Modal ──────────────────────────────────────────────────────────────

function OutputFormModal({
  channelId, output, existingOutputs, onClose,
}: {
  channelId:       string;
  output:          StreamOutput | null;
  existingOutputs: StreamOutput[];
  onClose:         () => void;
}) {
  const isEdit = !!output;

  const [platform,   setPlatform]   = useState<Platform>(output?.platform ?? 'YOUTUBE');
  const [name,       setName]       = useState(output?.name ?? '');
  const [rtmpUrl,    setRtmpUrl]    = useState(output?.rtmpUrl ?? PLATFORM_META['YOUTUBE'].defaultRtmpUrl);
  const [streamKey,  setStreamKey]  = useState(output?.streamKey ?? '');
  const [enabled,    setEnabled]    = useState(output?.enabled ?? true);
  const [showKey,    setShowKey]    = useState(false);
  // SRT
  const [srtHost,    setSrtHost]    = useState(output?.rtmpUrl ?? '');
  const [srtPort,    setSrtPort]    = useState<number>(output?.srtPort ?? 9001);
  const [srtLatency, setSrtLatency] = useState<number>(output?.srtLatency ?? 120);
  const [srtPass,    setSrtPass]    = useState(output?.srtPassphrase ?? '');
  const [showPass,   setShowPass]   = useState(false);
  // ZeroTier picker
  const [showZt,     setShowZt]     = useState(false);

  const isSrt = PLATFORM_META[platform].isSrt ?? false;
  const isListener = platform === 'SRT_LISTENER';

  const createMut = useCreateOutput();
  const updateMut = useUpdateOutput();
  const isLoading = createMut.isPending || updateMut.isPending;

  const { data: ztData } = useZeroTierSummary(showZt);

  const handlePlatformChange = (p: Platform) => {
    setPlatform(p);
    const def = PLATFORM_META[p].defaultRtmpUrl;
    if (def) setRtmpUrl(def);

    // Auto-nombre: solo sobreescribir si el nombre está vacío o es el default de otra plataforma
    const isAutoName = !name
      || ALL_PLATFORMS.some(pl => PLATFORM_META[pl].label === name)
      || /^RTMP \d+$/.test(name);

    if (isAutoName) {
      if (p === 'RTMP_CUSTOM') {
        // Numerar: "RTMP 1", "RTMP 2", etc. según cuántos RTMP Custom ya existen
        const existing = existingOutputs.filter(o => o.platform === 'RTMP_CUSTOM').length;
        setName(`RTMP ${existing + 1}`);
      } else {
        setName(PLATFORM_META[p].label);
      }
    }
  };

  const handleSubmit = () => {
    if (!name.trim()) { toast.error('El nombre es requerido'); return; }
    if (!isSrt && !streamKey.trim()) { toast.error('La stream key es requerida'); return; }
    if (platform === 'RTMP_CUSTOM' && !rtmpUrl.trim()) {
      toast.error('La URL RTMP es requerida para destinos personalizados');
      return;
    }
    if (platform === 'SRT_CALLER' && !srtHost.trim()) {
      toast.error('El host de destino es requerido para SRT Caller');
      return;
    }
    if (srtPass && (srtPass.length < 10 || srtPass.length > 79)) {
      toast.error('La passphrase debe tener entre 10 y 79 caracteres');
      return;
    }

    const srtInput: Partial<CreateOutputInput> = isSrt ? {
      rtmpUrl:      isListener ? '' : srtHost.trim(),
      streamKey:    '',
      srtPort,
      srtLatency,
      srtPassphrase: srtPass.trim() || undefined,
    } : {};

    const rtmpInput: Partial<CreateOutputInput> = !isSrt ? {
      rtmpUrl:   rtmpUrl.trim() || undefined,
      streamKey: streamKey.trim(),
    } : {};

    if (isEdit) {
      updateMut.mutate(
        {
          channelId,
          id: output!.id,
          input: {
            name: name.trim(), enabled,
            ...srtInput, ...rtmpInput,
          },
        },
        { onSuccess: onClose },
      );
    } else {
      createMut.mutate(
        {
          channelId,
          input: {
            name: name.trim(), platform, enabled,
            ...srtInput, ...rtmpInput,
          } as CreateOutputInput,
        },
        { onSuccess: onClose },
      );
    }
  };

  const effectivePlatform = isEdit ? output!.platform : platform;
  const meta   = PLATFORM_META[effectivePlatform];
  const isCustom = effectivePlatform === 'RTMP_CUSTOM';

  const KEY_HELP: Partial<Record<Platform, { label: string; url: string }>> = {
    YOUTUBE:  { label: 'YouTube Studio → En vivo', url: 'https://studio.youtube.com/channel/live' },
    FACEBOOK: { label: 'Facebook → Creator Studio', url: 'https://www.facebook.com/live/producer' },
    TWITCH:   { label: 'Twitch → Dashboard → Config', url: 'https://dashboard.twitch.tv/settings/stream' },
  };
  const help = KEY_HELP[effectivePlatform];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-surface-800 border border-surface-700 rounded-2xl w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto">

        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-surface-700">
          <div className="flex items-center gap-2.5">
            <PlatformBadge
              platform={effectivePlatform}
              badgeOverride={
                effectivePlatform === 'RTMP_CUSTOM' && name
                  ? getRtmpCustomBadge(name)
                  : undefined
              }
            />
            <h2 className="text-base font-semibold text-white">
              {isEdit ? `Editar — ${meta.label}` : 'Nueva salida de stream'}
            </h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-surface-700 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">

          {/* Platform selector (solo en creación) — 3 por fila */}
          {!isEdit && (
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-2">Protocolo / Plataforma</label>
              {/* RTMP */}
              <p className="text-[10px] text-slate-600 uppercase tracking-wide mb-1.5">RTMP</p>
              <div className="grid grid-cols-4 gap-2 mb-3">
                {RTMP_PLATFORMS.map(p => {
                  const m = PLATFORM_META[p];
                  return (
                    <button key={p} type="button" onClick={() => handlePlatformChange(p)}
                      className={cn(
                        'flex flex-col items-center gap-1.5 p-2.5 rounded-xl border text-xs font-medium transition-all',
                        platform === p
                          ? `border-current ${m.bg} ${m.color} ${m.border}`
                          : 'border-surface-600 bg-surface-700 text-slate-400 hover:border-surface-500',
                      )}>
                      <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded', platform === p ? `${m.bg} ${m.color}` : 'bg-surface-600 text-slate-400')}>{m.badge}</span>
                      <span className="text-[10px] leading-tight text-center">{m.label}</span>
                    </button>
                  );
                })}
              </div>
              {/* SRT */}
              <p className="text-[10px] text-slate-600 uppercase tracking-wide mb-1.5">SRT — Secure Reliable Transport</p>
              <div className="grid grid-cols-2 gap-2">
                {SRT_PLATFORMS.map(p => {
                  const m = PLATFORM_META[p];
                  return (
                    <button key={p} type="button" onClick={() => handlePlatformChange(p)}
                      className={cn(
                        'flex items-center gap-2.5 p-3 rounded-xl border text-xs font-medium transition-all',
                        platform === p
                          ? `border-current ${m.bg} ${m.color} ${m.border}`
                          : 'border-surface-600 bg-surface-700 text-slate-400 hover:border-surface-500',
                      )}>
                      <span className={cn('text-[11px] font-bold px-1.5 py-0.5 rounded flex-shrink-0', platform === p ? `${m.bg} ${m.color}` : 'bg-surface-600 text-slate-400')}>{m.badge}</span>
                      <div className="text-left">
                        <p className="text-xs font-semibold">{m.label}</p>
                        <p className="text-[10px] opacity-60 leading-tight">
                          {p === 'SRT_CALLER' ? 'Enviás a cablera o encoder' : 'Receptor se conecta a vos'}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Nombre */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Nombre</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={`Ej: ${meta.label} Principal`}
              className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-brand-500"
            />
          </div>

          {/* ── Campos SRT ────────────────────────────── */}
          {isSrt && (
            <>
              {/* SRT_CALLER: host de destino */}
              {!isListener && (
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">Host / IP de destino</label>
                  <div className="flex gap-2">
                    <input
                      value={srtHost}
                      onChange={e => setSrtHost(e.target.value)}
                      placeholder="10.147.17.5 o dominio"
                      className="flex-1 bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setShowZt(v => !v)}
                      title="Elegir IP de ZeroTier"
                      className={cn(
                        'flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium transition-colors flex-shrink-0',
                        showZt
                          ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-400'
                          : 'border-surface-600 bg-surface-700 text-slate-400 hover:border-surface-500 hover:text-slate-200',
                      )}
                    >
                      <Network className="w-3.5 h-3.5" />
                      ZT
                    </button>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    IP o hostname de la cablera / encoder destino.
                  </p>

                  {/* Mini picker ZeroTier */}
                  {showZt && (
                    <div className="mt-2 p-3 rounded-lg bg-surface-900 border border-cyan-500/15 space-y-2">
                      <p className="text-xs font-medium text-cyan-400 flex items-center gap-1.5">
                        <Network className="w-3.5 h-3.5" />
                        Redes ZeroTier — elegí una IP de destino
                      </p>
                      {!ztData && (
                        <p className="text-xs text-slate-500">Cargando...</p>
                      )}
                      {ztData && ztData.networks.length === 0 && (
                        <p className="text-xs text-slate-500">Sin redes ZeroTier configuradas.</p>
                      )}
                      {ztData?.networks.map((net: ZTNetwork) => (
                        <div key={net.id} className="space-y-1">
                          <p className="text-[10px] text-slate-500 font-mono">{net.name || net.id}</p>
                          {net.assignedAddresses.map((addr) => {
                            const ip = ztIpOnly(addr);
                            return (
                              <button key={addr} type="button"
                                onClick={() => { setSrtHost(ip); setShowZt(false); }}
                                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded bg-cyan-500/5 border border-cyan-500/15 hover:bg-cyan-500/10 transition-colors text-left"
                              >
                                <code className="text-xs text-cyan-300 font-mono flex-1">{ip}</code>
                                <span className="text-[10px] text-slate-600">(mi IP en red)</span>
                              </button>
                            );
                          })}
                          {net.assignedAddresses.length === 0 && (
                            <p className="text-xs text-slate-600 pl-2">Sin IP asignada</p>
                          )}
                        </div>
                      ))}
                      <p className="text-[10px] text-slate-600 pt-1">
                        Para ver la IP de la cablera, consultá ZeroTier Central o pedísela directamente.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* SRT_LISTENER: info de modo */}
              {isListener && (
                <div className="p-3 rounded-lg bg-teal-500/5 border border-teal-500/15">
                  <div className="flex items-start gap-2">
                    <Info className="w-3.5 h-3.5 text-teal-400 flex-shrink-0 mt-0.5" />
                    <div className="text-xs text-teal-300/80 space-y-1">
                      <p className="font-medium">Modo receptor (Listener)</p>
                      <p>FFmpeg escucha en el puerto configurado. El encoder de la cablera o encoder remoto se conecta a <strong>tu IP ZeroTier : puerto</strong>.</p>
                      <p className="text-teal-400/60">El puerto debe ser accesible desde la red ZeroTier del receptor.</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Puerto SRT */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">Puerto</label>
                  <input
                    type="number"
                    value={srtPort}
                    onChange={e => setSrtPort(Math.max(1, Math.min(65535, parseInt(e.target.value) || 9001)))}
                    min={1} max={65535}
                    className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 font-mono"
                  />
                  <p className="text-[10px] text-slate-600 mt-0.5">Default: 9001</p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">Latencia (ms)</label>
                  <input
                    type="number"
                    value={srtLatency}
                    onChange={e => setSrtLatency(Math.max(20, Math.min(8000, parseInt(e.target.value) || 120)))}
                    min={20} max={8000}
                    className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 font-mono"
                  />
                  <p className="text-[10px] text-slate-600 mt-0.5">20-8000 ms (rec: 120)</p>
                </div>
              </div>

              {/* Passphrase */}
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1 flex items-center gap-1.5">
                  <Shield className="w-3 h-3" />
                  Passphrase de cifrado AES
                  <span className="text-slate-600 font-normal">(opcional)</span>
                </label>
                <div className="relative">
                  <input
                    type={showPass ? 'text' : 'password'}
                    value={srtPass}
                    onChange={e => setSrtPass(e.target.value)}
                    placeholder="Mín. 10 caracteres"
                    className="w-full bg-surface-700 border border-surface-600 rounded-lg pl-3 pr-9 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                  />
                  <button type="button" onClick={() => setShowPass(v => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200">
                    {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  Si se configura, ambos extremos deben usar la misma passphrase. Longitud: 10-79 caracteres.
                </p>
              </div>
            </>
          )}

          {/* ── Campos RTMP ───────────────────────────── */}
          {!isSrt && (
            <>
              {/* URL RTMP */}
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">URL del servidor RTMP</label>
                <input
                  value={rtmpUrl}
                  onChange={e => setRtmpUrl(e.target.value)}
                  readOnly={!isCustom}
                  placeholder={isCustom ? 'rtmp://servidor.com:1935/app' : meta.defaultRtmpUrl}
                  className={cn(
                    'w-full border rounded-lg px-3 py-2 text-sm focus:outline-none font-mono',
                    isCustom
                      ? 'bg-surface-700 border-surface-600 text-white placeholder-slate-500 focus:border-brand-500'
                      : 'bg-surface-900 border-surface-700 text-slate-400 cursor-not-allowed',
                  )}
                />
                {isCustom ? (
                  <div className="mt-2 p-2.5 rounded-lg bg-blue-500/5 border border-blue-500/15 space-y-1">
                    <div className="flex items-start gap-1.5">
                      <Info className="w-3 h-3 text-blue-400 flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-blue-300 font-medium">Autenticación Adobe RTMP</p>
                    </div>
                    <p className="text-xs text-slate-400">
                      Si el servidor requiere usuario/contraseña (<code className="text-slate-300 text-[11px]">authmod=adobe</code>), incluilos en la URL:
                    </p>
                    <code className="block text-[11px] text-green-400 bg-surface-900 rounded px-2 py-1 font-mono break-all">
                      rtmp://usuario:contraseña@servidor:1935/app
                    </code>
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 mt-1">URL oficial de {meta.label} (no editable)</p>
                )}
              </div>

              {/* Stream Key */}
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">
                  Stream Key
                  {help && (
                    <a href={help.url} target="_blank" rel="noopener noreferrer"
                      className="ml-2 text-brand-400 hover:text-brand-300 inline-flex items-center gap-0.5">
                      <ExternalLink className="w-2.5 h-2.5" />
                      {help.label}
                    </a>
                  )}
                </label>
                <div className="relative">
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={streamKey}
                    onChange={e => setStreamKey(e.target.value)}
                    placeholder="xxxx-xxxx-xxxx-xxxx"
                    className="w-full bg-surface-700 border border-surface-600 rounded-lg pl-3 pr-9 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-brand-500 font-mono"
                  />
                  <button type="button" onClick={() => setShowKey(v => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200">
                    {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-xs text-slate-500 mt-1 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3 flex-shrink-0" />
                  La stream key no se comparte con nadie.
                </p>
              </div>
            </>
          )}

          {/* Habilitado */}
          <div className="flex items-center justify-between pt-1 border-t border-surface-700">
            <div>
              <p className="text-xs font-medium text-slate-400">Auto-inicio al arrancar canal</p>
              <p className="text-xs text-slate-600 mt-0.5">Si está activa, inicia automáticamente cuando el canal arranca.</p>
            </div>
            <button type="button" onClick={() => setEnabled(v => !v)}
              className={cn(
                'flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors flex-shrink-0 ml-3',
                enabled
                  ? 'border-green-500/30 bg-green-500/10 text-green-400'
                  : 'border-surface-600 bg-surface-700 text-slate-400',
              )}>
              {enabled ? <><ToggleRight className="w-4 h-4" />Activa</> : <><ToggleLeft className="w-4 h-4" />Inactiva</>}
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 pb-5 flex gap-3">
          <button onClick={onClose}
            className="flex-1 py-2 rounded-xl border border-surface-600 text-sm text-slate-400 hover:text-white hover:bg-surface-700 transition-colors">
            Cancelar
          </button>
          <button onClick={handleSubmit} disabled={isLoading}
            className="flex-1 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-sm font-semibold text-white transition-colors disabled:opacity-50">
            {isLoading ? 'Guardando...' : isEdit ? 'Guardar cambios' : 'Agregar salida'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function StreamPage() {
  const [channelId, setChannelId]   = useState<string | null>(null);
  const [channels,  setChannels]    = useState<Array<{ id: string; name: string; status: string }>>([]);
  const [showModal, setShowModal]   = useState(false);
  const [editing,   setEditing]     = useState<StreamOutput | null>(null);

  useEffect(() => {
    apiClient.get('/channels').then(({ data }) => {
      setChannels(data);
      if (data.length > 0) setChannelId(data[0].id);
    }).catch(() => {});

    const interval = setInterval(() => {
      apiClient.get('/channels').then(({ data }) => setChannels(data)).catch(() => {});
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const { data: outputs = [], isLoading } = useStreamOutputs(channelId);
  const deleteMut = useDeleteOutput();
  const updateMut = useUpdateOutput();
  const startMut  = useStartOutput();
  const stopMut   = useStopOutput();

  const handleOpenCreate = () => { setEditing(null); setShowModal(true); };
  const handleOpenEdit   = (o: StreamOutput) => { setEditing(o); setShowModal(true); };

  const handleDelete = (id: string) => {
    if (!channelId || !confirm('¿Eliminar esta salida?')) return;
    deleteMut.mutate({ channelId, id });
  };

  const handleToggle = (o: StreamOutput) => {
    if (!channelId) return;
    updateMut.mutate({ channelId, id: o.id, input: { enabled: !o.enabled } });
  };

  const handleStart = (o: StreamOutput) => {
    if (!channelId) return;
    startMut.mutate({ channelId, id: o.id });
  };

  const handleStop = (o: StreamOutput) => {
    if (!channelId) return;
    stopMut.mutate({ channelId, id: o.id });
  };

  const streaming = outputs.filter(o => o.status === 'STREAMING').length;
  const errors    = outputs.filter(o => o.status === 'ERROR').length;
  const enabled   = outputs.filter(o => o.enabled).length;

  const currentChannel = channels.find(c => c.id === channelId);
  const isLive = currentChannel?.status === 'LIVE_PLAYLIST' || currentChannel?.status === 'LIVE_RTMP';

  return (
    <div className="flex flex-col flex-1">
      <Header
        title="Salidas de Stream"
        subtitle="RTMP (YouTube, Facebook, Twitch) y SRT (cablera, ZeroTier)"
      />

      <div className="flex-1 p-6 overflow-y-auto space-y-6">

        {/* Toolbar */}
        <div className="flex items-center gap-3 flex-wrap">
          {channels.length > 1 && (
            <div className="relative">
              <select
                value={channelId ?? ''}
                onChange={e => setChannelId(e.target.value)}
                className="appearance-none bg-surface-700 border border-surface-600 rounded-xl pl-3 pr-8 py-2 text-sm text-white focus:outline-none focus:border-brand-500"
              >
                {channels.map(ch => <option key={ch.id} value={ch.id}>{ch.name}</option>)}
              </select>
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
            </div>
          )}
          {channels.length === 1 && (
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-white">{channels[0].name}</span>
              <span className={cn(
                'text-xs px-2 py-0.5 rounded-full font-medium',
                isLive ? 'bg-green-500/10 text-green-400' : 'bg-slate-500/10 text-slate-400',
              )}>
                {isLive ? '● En vivo' : '○ Offline'}
              </span>
            </div>
          )}

          {outputs.length > 0 && (
            <div className="flex items-center gap-3 text-xs">
              {streaming > 0 && (
                <span className="flex items-center gap-1 text-green-400">
                  <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                  {streaming} transmitiendo
                </span>
              )}
              {errors > 0 && (
                <span className="flex items-center gap-1 text-red-400">
                  <span className="w-2 h-2 rounded-full bg-red-500" />
                  {errors} con error
                </span>
              )}
              {streaming === 0 && errors === 0 && (
                <span className="text-slate-500">{enabled} habilitada(s)</span>
              )}
            </div>
          )}

          <div className="flex-1" />

          <button
            onClick={handleOpenCreate}
            disabled={!channelId}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-sm font-semibold text-white transition-colors disabled:opacity-40"
          >
            <Plus className="w-4 h-4" />
            Agregar salida
          </button>
        </div>

        {/* Banner offline */}
        {channelId && !isLive && outputs.length > 0 && (
          <div className="flex items-start gap-2.5 p-3.5 rounded-xl border border-yellow-500/20 bg-yellow-500/5 text-xs text-yellow-300">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold">El canal no está en vivo.</span>{' '}
              Las salidas con <strong>Auto</strong> activado arrancarán cuando inicies el canal.
              También podés iniciar cada salida con el botón <strong>Transmitir / Escuchar</strong> una vez que el canal esté live.
            </div>
          </div>
        )}

        {/* Sin canales */}
        {channels.length === 0 && (
          <div className="glass-card p-12 text-center">
            <Radio className="w-10 h-10 text-slate-600 mx-auto mb-3" />
            <p className="text-sm text-slate-500">No tenés canales creados aún.</p>
          </div>
        )}

        {/* Loading */}
        {channelId && isLoading && (
          <div className="glass-card p-8 text-center">
            <Loader2 className="w-6 h-6 text-slate-500 animate-spin mx-auto" />
          </div>
        )}

        {/* Empty state */}
        {channelId && !isLoading && outputs.length === 0 && (
          <div className="glass-card p-12 text-center">
            <Radio className="w-10 h-10 text-slate-600 mx-auto mb-3" />
            <h3 className="text-sm font-semibold text-white mb-1">Sin salidas configuradas</h3>
            <p className="text-xs text-slate-500 mb-5 max-w-xs mx-auto">
              Configurá salidas RTMP para YouTube, Facebook o Twitch, o bien salidas SRT para
              distribución directa a cableoperadoras vía ZeroTier u otras redes privadas.
            </p>
            <div className="flex flex-wrap justify-center gap-2 mb-5">
              {ALL_PLATFORMS.map(p => <PlatformBadge key={p} platform={p} />)}
            </div>
            <button
              onClick={handleOpenCreate}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-sm font-semibold text-white transition-colors"
            >
              <Plus className="w-4 h-4" />
              Agregar primera salida
            </button>
          </div>
        )}

        {/* Grid de salidas */}
        {outputs.length > 0 && (
          <div className="space-y-3">
            <p className="text-xs text-slate-500">
              Usá <strong className="text-slate-400">Auto</strong> para que la salida arranque con el canal,
              o <strong className="text-slate-400">Transmitir</strong> para iniciarla manualmente cuando el canal ya esté live.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {outputs.map(o => (
                <OutputCard
                  key={o.id}
                  output={o}
                  channelId={channelId!}
                  isChannelLive={isLive}
                  onEdit={handleOpenEdit}
                  onDelete={handleDelete}
                  onToggle={handleToggle}
                  onStart={handleStart}
                  onStop={handleStop}
                />
              ))}
            </div>
          </div>
        )}

        {/* ZeroTier panel */}
        {channelId && <ZeroTierPanel />}

      </div>

      {/* Modal */}
      {showModal && channelId && (
        <OutputFormModal
          channelId={channelId}
          output={editing}
          existingOutputs={outputs}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  );
}
