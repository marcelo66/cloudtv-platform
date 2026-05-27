'use client';

import { useState, useEffect } from 'react';
import {
  Radio,
  Plus,
  Trash2,
  Edit2,
  Eye,
  EyeOff,
  ChevronDown,
  ToggleLeft,
  ToggleRight,
  X,
  AlertCircle,
  CheckCircle2,
  Loader2,
  ExternalLink,
} from 'lucide-react';
import { Header } from '@/components/dashboard/Header';
import apiClient from '@/lib/api-client';
import {
  useStreamOutputs,
  useCreateOutput,
  useUpdateOutput,
  useDeleteOutput,
  PLATFORM_META,
  type StreamOutput,
  type Platform,
  type CreateOutputInput,
} from '@/hooks/useStreamOutputs';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PLATFORMS: Platform[] = ['YOUTUBE', 'FACEBOOK', 'TWITCH', 'RTMP_CUSTOM'];

const STATUS_CONFIG = {
  IDLE:      { label: 'Inactivo', dot: 'bg-slate-500', text: 'text-slate-400' },
  STREAMING: { label: 'Transmitiendo', dot: 'bg-green-500 animate-pulse', text: 'text-green-400' },
  ERROR:     { label: 'Error', dot: 'bg-red-500', text: 'text-red-400' },
} as const;

function PlatformBadge({ platform, size = 'md' }: { platform: Platform; size?: 'sm' | 'md' }) {
  const m = PLATFORM_META[platform];
  return (
    <span className={cn(
      'inline-flex items-center justify-center font-bold rounded',
      m.bg, m.color, m.border, 'border',
      size === 'sm' ? 'w-8 h-6 text-[10px]' : 'w-10 h-7 text-xs',
    )}>
      {m.badge}
    </span>
  );
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

// ─── Output Card ─────────────────────────────────────────────────────────────

function OutputCard({
  output,
  channelId,
  onEdit,
  onDelete,
  onToggle,
}: {
  output: StreamOutput;
  channelId: string;
  onEdit: (o: StreamOutput) => void;
  onDelete: (id: string) => void;
  onToggle: (o: StreamOutput) => void;
}) {
  const meta   = PLATFORM_META[output.platform];
  const status = STATUS_CONFIG[output.status];

  return (
    <div className={cn(
      'glass-card p-4 transition-opacity',
      !output.enabled && 'opacity-50',
    )}>
      <div className="flex items-start gap-3">
        <PlatformBadge platform={output.platform} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-white truncate">{output.name}</span>
            <span className={cn('text-xs font-medium', meta.color)}>{meta.label}</span>
          </div>
          {/* Status */}
          <div className="flex items-center gap-1.5 mt-1">
            <div className={cn('w-2 h-2 rounded-full', status.dot)} />
            <span className={cn('text-xs font-medium', status.text)}>{status.label}</span>
          </div>
          {/* RTMP URL */}
          <p className="text-xs text-slate-500 mt-1 truncate font-mono">
            {output.rtmpUrl || '—'}
          </p>
          {/* Stream Key */}
          <div className="mt-1">
            <MaskedKey value={output.streamKey} />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-surface-700">
        <button
          onClick={() => onToggle(output)}
          className={cn(
            'flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded transition-colors',
            output.enabled
              ? 'text-green-400 hover:bg-green-500/10'
              : 'text-slate-500 hover:bg-slate-500/10',
          )}
        >
          {output.enabled
            ? <><ToggleRight className="w-4 h-4" />Habilitada</>
            : <><ToggleLeft className="w-4 h-4" />Deshabilitada</>
          }
        </button>
        <div className="flex-1" />
        <button
          onClick={() => onEdit(output)}
          className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-surface-700 transition-colors"
          title="Editar"
        >
          <Edit2 className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => onDelete(output.id)}
          className="p-1.5 rounded text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
          title="Eliminar"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// ─── Modal ────────────────────────────────────────────────────────────────────

function OutputFormModal({
  channelId,
  output,
  onClose,
}: {
  channelId: string;
  output: StreamOutput | null;
  onClose: () => void;
}) {
  const isEdit = !!output;

  const [platform, setPlatform] = useState<Platform>(output?.platform ?? 'YOUTUBE');
  const [name, setName]         = useState(output?.name ?? '');
  const [rtmpUrl, setRtmpUrl]   = useState(output?.rtmpUrl ?? PLATFORM_META['YOUTUBE'].defaultRtmpUrl);
  const [streamKey, setStreamKey] = useState(output?.streamKey ?? '');
  const [enabled, setEnabled]   = useState(output?.enabled ?? true);
  const [showKey, setShowKey]   = useState(false);

  const createMut = useCreateOutput();
  const updateMut = useUpdateOutput();
  const isLoading = createMut.isPending || updateMut.isPending;

  const handlePlatformChange = (p: Platform) => {
    setPlatform(p);
    const def = PLATFORM_META[p].defaultRtmpUrl;
    if (def) setRtmpUrl(def);
    if (!name || PLATFORMS.some(pl => PLATFORM_META[pl].label === name)) {
      setName(PLATFORM_META[p].label);
    }
  };

  const handleSubmit = () => {
    if (!name.trim())      { toast.error('El nombre es requerido'); return; }
    if (!streamKey.trim()) { toast.error('La stream key es requerida'); return; }
    if (platform === 'RTMP_CUSTOM' && !rtmpUrl.trim()) {
      toast.error('La URL RTMP es requerida para destinos personalizados');
      return;
    }

    if (isEdit) {
      updateMut.mutate(
        { channelId, id: output!.id, input: { name: name.trim(), rtmpUrl: rtmpUrl.trim(), streamKey: streamKey.trim(), enabled } },
        { onSuccess: onClose },
      );
    } else {
      createMut.mutate(
        {
          channelId,
          input: {
            name: name.trim(),
            platform,
            rtmpUrl: rtmpUrl.trim() || undefined,
            streamKey: streamKey.trim(),
            enabled,
          } satisfies CreateOutputInput,
        },
        { onSuccess: onClose },
      );
    }
  };

  const effectivePlatform = isEdit ? output!.platform : platform;
  const meta = PLATFORM_META[effectivePlatform];
  const isCustom = effectivePlatform === 'RTMP_CUSTOM';

  // Guías de dónde obtener la stream key
  const KEY_HELP: Partial<Record<Platform, { label: string; url: string }>> = {
    YOUTUBE:  { label: 'YouTube Studio → En vivo → Configurar', url: 'https://studio.youtube.com/channel/live' },
    FACEBOOK: { label: 'Facebook → Creator Studio → Live Dashboard', url: 'https://www.facebook.com/live/producer' },
    TWITCH:   { label: 'Twitch → Dashboard → Configuración → Canal', url: 'https://dashboard.twitch.tv/settings/stream' },
  };
  const help = KEY_HELP[effectivePlatform];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      <div className="relative bg-surface-800 border border-surface-700 rounded-2xl w-full max-w-md shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-surface-700">
          <div className="flex items-center gap-2.5">
            <PlatformBadge platform={effectivePlatform} />
            <h2 className="text-base font-semibold text-white">
              {isEdit ? `Editar — ${meta.label}` : 'Nueva salida de stream'}
            </h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-surface-700 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Platform selector (solo en creación) */}
          {!isEdit && (
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-2">Plataforma</label>
              <div className="grid grid-cols-4 gap-2">
                {PLATFORMS.map(p => {
                  const m = PLATFORM_META[p];
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => handlePlatformChange(p)}
                      className={cn(
                        'flex flex-col items-center gap-1.5 p-2.5 rounded-xl border text-xs font-medium transition-all',
                        platform === p
                          ? `border-current ${m.bg} ${m.color} ${m.border}`
                          : 'border-surface-600 bg-surface-700 text-slate-400 hover:border-surface-500',
                      )}
                    >
                      <span className={cn(
                        'text-[10px] font-bold px-1.5 py-0.5 rounded',
                        platform === p ? `${m.bg} ${m.color}` : 'bg-surface-600 text-slate-400',
                      )}>{m.badge}</span>
                      <span className="text-[10px] leading-tight text-center">{m.label}</span>
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

          {/* URL RTMP */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">
              URL del servidor RTMP
            </label>
            <input
              value={rtmpUrl}
              onChange={e => setRtmpUrl(e.target.value)}
              readOnly={!isCustom}
              placeholder={isCustom ? 'rtmp://tu-servidor.com/live' : meta.defaultRtmpUrl}
              className={cn(
                'w-full border rounded-lg px-3 py-2 text-sm focus:outline-none',
                isCustom
                  ? 'bg-surface-700 border-surface-600 text-white placeholder-slate-500 focus:border-brand-500'
                  : 'bg-surface-900 border-surface-700 text-slate-400 cursor-not-allowed',
              )}
            />
            {!isCustom && (
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
              <button
                type="button"
                onClick={() => setShowKey(v => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-xs text-slate-500 mt-1 flex items-center gap-1">
              <AlertCircle className="w-3 h-3 flex-shrink-0" />
              La stream key se almacena encriptada. No la compartas con nadie.
            </p>
          </div>

          {/* Habilitado */}
          <div className="flex items-center justify-between pt-1 border-t border-surface-700">
            <label className="text-xs font-medium text-slate-400">Habilitada al iniciar canal</label>
            <button
              type="button"
              onClick={() => setEnabled(v => !v)}
              className={cn(
                'flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors',
                enabled
                  ? 'border-green-500/30 bg-green-500/10 text-green-400'
                  : 'border-surface-600 bg-surface-700 text-slate-400',
              )}
            >
              {enabled
                ? <><ToggleRight className="w-4 h-4" />Activa</>
                : <><ToggleLeft className="w-4 h-4" />Inactiva</>
              }
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 pb-5 flex gap-3">
          <button onClick={onClose}
            className="flex-1 py-2 rounded-xl border border-surface-600 text-sm text-slate-400 hover:text-white hover:bg-surface-700 transition-colors">
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={isLoading}
            className="flex-1 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-sm font-semibold text-white transition-colors disabled:opacity-50"
          >
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
  const [channels, setChannels]     = useState<Array<{ id: string; name: string; status: string }>>([]);
  const [showModal, setShowModal]   = useState(false);
  const [editing, setEditing]       = useState<StreamOutput | null>(null);

  useEffect(() => {
    apiClient.get('/channels').then(({ data }) => {
      setChannels(data);
      if (data.length > 0) setChannelId(data[0].id);
    }).catch(() => {});
  }, []);

  const { data: outputs = [], isLoading } = useStreamOutputs(channelId);
  const deleteMut = useDeleteOutput();
  const updateMut = useUpdateOutput();

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

  const streaming = outputs.filter(o => o.status === 'STREAMING').length;
  const errors    = outputs.filter(o => o.status === 'ERROR').length;
  const enabled   = outputs.filter(o => o.enabled).length;

  const currentChannel = channels.find(c => c.id === channelId);
  const isLive = currentChannel?.status === 'LIVE_PLAYLIST' || currentChannel?.status === 'LIVE_RTMP';

  return (
    <div className="flex flex-col flex-1">
      <Header title="Salidas de Stream" subtitle="Emisión simultánea a YouTube, Facebook, Twitch y RTMP" />

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
                {channels.map(ch => (
                  <option key={ch.id} value={ch.id}>{ch.name}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
            </div>
          )}
          {channels.length === 1 && (
            <span className="text-sm font-medium text-white">{channels[0].name}</span>
          )}

          {/* Stats rápidas */}
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

        {/* Info banner cuando el canal está OFFLINE */}
        {channelId && !isLive && outputs.length > 0 && (
          <div className="flex items-start gap-2.5 p-3.5 rounded-xl border border-yellow-500/20 bg-yellow-500/5 text-xs text-yellow-300">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold">El canal no está en vivo.</span>{' '}
              Las salidas configuradas comenzarán a transmitir automáticamente cuando inicies el canal desde la sección <strong>Canal</strong>.
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

        {/* Empty */}
        {channelId && !isLoading && outputs.length === 0 && (
          <div className="glass-card p-12 text-center">
            <Radio className="w-10 h-10 text-slate-600 mx-auto mb-3" />
            <h3 className="text-sm font-semibold text-white mb-1">Sin salidas configuradas</h3>
            <p className="text-xs text-slate-500 mb-5 max-w-xs mx-auto">
              Configurá una o más salidas para emitir simultáneamente a YouTube, Facebook, Twitch u otros servidores RTMP.
            </p>
            <div className="flex flex-wrap justify-center gap-2 mb-5">
              {(['YOUTUBE', 'FACEBOOK', 'TWITCH', 'RTMP_CUSTOM'] as Platform[]).map(p => (
                <PlatformBadge key={p} platform={p} />
              ))}
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
            {/* Cabecera informativa */}
            <div className="flex items-center justify-between">
              <p className="text-xs text-slate-500">
                Las salidas habilitadas se activan automáticamente al iniciar el canal.
                El stream se transmite vía <code className="text-slate-400">ffmpeg -re -i hls → flv/rtmp</code>.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {outputs.map(o => (
                <OutputCard
                  key={o.id}
                  output={o}
                  channelId={channelId!}
                  onEdit={handleOpenEdit}
                  onDelete={handleDelete}
                  onToggle={handleToggle}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && channelId && (
        <OutputFormModal
          channelId={channelId}
          output={editing}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  );
}
