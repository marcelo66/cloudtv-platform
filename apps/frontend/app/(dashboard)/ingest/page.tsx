'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Radio,
  Plus,
  Trash2,
  Edit2,
  Play,
  Square,
  ChevronDown,
  X,
  Info,
  Copy,
  Check,
  Wifi,
  AlertCircle,
  Loader2,
  Youtube,
  ExternalLink,
  LogOut,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { Header } from '@/components/dashboard/Header';
import apiClient from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  useIngestSources,
  useCreateIngest,
  useUpdateIngest,
  useDeleteIngest,
  useActivateIngest,
  useDeactivateIngest,
  INGEST_TYPE_META,
  INGEST_STATUS_META,
  type IngestSource,
  type IngestType,
  type CreateIngestInput,
  type UpdateIngestInput,
} from '@/hooks/useIngest';
import {
  useYoutubeAuthStatus,
  useYoutubeStartFlow,
  useYoutubeDevicePoll,
  useYoutubeDisconnect,
  type DeviceFlowSession,
} from '@/hooks/useYoutubeAuth';

// ─── Helpers ──────────────────────────────────────────────────

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="p-1 rounded text-slate-400 hover:text-white transition-colors"
      title="Copiar"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

// ─── Device Flow Modal ────────────────────────────────────────

interface DeviceFlowModalProps {
  session: DeviceFlowSession;
  onClose: () => void;
  onSuccess: () => void;
}

function DeviceFlowModal({ session, onClose, onSuccess }: DeviceFlowModalProps) {
  const [copied, setCopied] = useState(false);
  const { data: pollData } = useYoutubeDevicePoll(session.sessionId);
  const calledSuccess = useRef(false);

  // Detectar autorización exitosa
  useEffect(() => {
    if (pollData?.status === 'authorized' && !calledSuccess.current) {
      calledSuccess.current = true;
      setTimeout(onSuccess, 1800); // pequeño delay para mostrar el tick
    }
  }, [pollData?.status, onSuccess]);

  const authorized = pollData?.status === 'authorized';
  const hasError   = pollData?.status === 'error';

  const copyCode = () => {
    navigator.clipboard.writeText(session.userCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-md bg-surface-800 rounded-2xl border border-white/10 shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-red-500/15 flex items-center justify-center">
              <Youtube className="w-4 h-4 text-red-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">Conectar cuenta de YouTube</p>
              <p className="text-xs text-slate-400">Autorización en 3 pasos</p>
            </div>
          </div>
          {!authorized && (
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/5 text-slate-400 hover:text-white transition-colors">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="px-6 py-5 space-y-5">

          {authorized ? (
            /* ── Estado: autorizado ──────────────────────────────── */
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <div className="w-14 h-14 rounded-full bg-green-500/15 flex items-center justify-center">
                <CheckCircle2 className="w-8 h-8 text-green-400" />
              </div>
              <div>
                <p className="text-base font-semibold text-white">¡Cuenta conectada!</p>
                <p className="text-sm text-slate-400 mt-1">
                  Ahora podés usar fuentes YouTube sin restricciones de bot detection.
                </p>
              </div>
            </div>
          ) : hasError ? (
            /* ── Estado: error ───────────────────────────────────── */
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <div className="w-14 h-14 rounded-full bg-red-500/15 flex items-center justify-center">
                <XCircle className="w-8 h-8 text-red-400" />
              </div>
              <div>
                <p className="text-base font-semibold text-white">Error en la autorización</p>
                <p className="text-sm text-slate-400 mt-1">
                  {pollData?.errorMessage ?? 'Ocurrió un error. Intentá de nuevo.'}
                </p>
              </div>
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-xl bg-surface-600 hover:bg-surface-500 text-sm font-medium text-white transition-colors"
              >
                Cerrar
              </button>
            </div>
          ) : (
            /* ── Estado: pendiente ───────────────────────────────── */
            <>
              {/* Paso 1 */}
              <div className="flex gap-3">
                <div className="flex-shrink-0 w-6 h-6 rounded-full bg-brand-600 flex items-center justify-center text-xs font-bold text-white">1</div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-white mb-1.5">Abrir la página de activación</p>
                  <a
                    href={session.authUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-500 text-sm font-medium text-white transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Abrir {session.authUrl.replace('https://', '')}
                  </a>
                  <p className="text-xs text-slate-500 mt-1">O copiá la URL: <span className="text-slate-400 font-mono">{session.authUrl}</span></p>
                </div>
              </div>

              {/* Paso 2 */}
              <div className="flex gap-3">
                <div className="flex-shrink-0 w-6 h-6 rounded-full bg-brand-600 flex items-center justify-center text-xs font-bold text-white">2</div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-white mb-1.5">Ingresar este código</p>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-surface-700 border border-surface-500 rounded-xl px-4 py-2.5 font-mono text-xl font-bold text-white tracking-widest text-center">
                      {session.userCode}
                    </div>
                    <button
                      onClick={copyCode}
                      className="p-2.5 rounded-xl bg-surface-700 border border-surface-500 hover:bg-surface-600 text-slate-300 hover:text-white transition-colors"
                      title="Copiar código"
                    >
                      {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>

              {/* Paso 3 */}
              <div className="flex gap-3">
                <div className="flex-shrink-0 w-6 h-6 rounded-full bg-brand-600 flex items-center justify-center text-xs font-bold text-white">3</div>
                <div>
                  <p className="text-sm font-medium text-white">Seleccionar tu cuenta de Google y autorizar</p>
                  <p className="text-xs text-slate-500 mt-0.5">La ventana se cerrará automáticamente al completar.</p>
                </div>
              </div>

              {/* Spinner de espera */}
              <div className="flex items-center justify-center gap-2 pt-1 text-slate-400">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-sm">Esperando autorización...</span>
              </div>

              <div className="flex justify-end pt-1">
                <button
                  onClick={onClose}
                  className="px-4 py-2 rounded-xl text-sm font-medium text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
                >
                  Cancelar
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── YouTube Connect Card ─────────────────────────────────────

function YoutubeConnectCard() {
  const { data: authStatus, isLoading, refetch } = useYoutubeAuthStatus();
  const startFlow   = useYoutubeStartFlow();
  const disconnect  = useYoutubeDisconnect();
  const [flowSession, setFlowSession] = useState<DeviceFlowSession | null>(null);

  const handleConnect = async () => {
    try {
      const session = await startFlow.mutateAsync();
      setFlowSession(session);
    } catch { /* toast shown by mutation */ }
  };

  const handleSuccess = () => {
    setFlowSession(null);
    refetch();
    toast.success('¡Cuenta de YouTube conectada! Las fuentes YouTube ya no necesitan cookies.');
  };

  return (
    <>
      <div className={cn(
        'rounded-2xl border p-4 transition-all',
        authStatus?.connected
          ? 'bg-green-500/5 border-green-500/20'
          : 'bg-red-500/5 border-red-500/20',
      )}>
        <div className="flex items-center gap-4">
          {/* Icono */}
          <div className={cn(
            'flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center',
            authStatus?.connected ? 'bg-green-500/15' : 'bg-red-500/15',
          )}>
            <Youtube className={cn('w-5 h-5', authStatus?.connected ? 'text-green-400' : 'text-red-400')} />
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            {isLoading ? (
              <div className="flex items-center gap-2 text-slate-400">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span className="text-sm">Verificando...</span>
              </div>
            ) : authStatus?.connected ? (
              <>
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-green-400" />
                  <p className="text-sm font-semibold text-green-300">Cuenta de YouTube conectada</p>
                </div>
                <p className="text-xs text-green-400/70 mt-0.5">
                  {authStatus.email ?? 'Cuenta Google autorizada'} · Las fuentes YouTube usan OAuth2 (sin bot detection)
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-semibold text-red-300">Sin cuenta de YouTube conectada</p>
                <p className="text-xs text-red-400/70 mt-0.5">
                  Las fuentes YouTube pueden fallar por bot detection en IPs de servidor. Conectá tu cuenta para evitarlo.
                </p>
              </>
            )}
          </div>

          {/* Acción */}
          {!isLoading && (
            authStatus?.connected ? (
              <button
                onClick={() => disconnect.mutate()}
                disabled={disconnect.isPending}
                className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-700 hover:bg-surface-600 text-slate-300 hover:text-white text-xs font-medium transition-colors disabled:opacity-50"
              >
                {disconnect.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <LogOut className="w-3.5 h-3.5" />}
                Desconectar
              </button>
            ) : (
              <button
                onClick={handleConnect}
                disabled={startFlow.isPending}
                className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-300 hover:text-red-200 text-xs font-semibold transition-colors disabled:opacity-50"
              >
                {startFlow.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Youtube className="w-3.5 h-3.5" />}
                Conectar cuenta
              </button>
            )
          )}
        </div>
      </div>

      {/* Modal de Device Flow */}
      {flowSession && (
        <DeviceFlowModal
          session={flowSession}
          onClose={() => setFlowSession(null)}
          onSuccess={handleSuccess}
        />
      )}
    </>
  );
}

// ─── Create / Edit Modal ─────────────────────────────────────

interface ModalProps {
  channelId: string;
  editing:   IngestSource | null;
  onClose:   () => void;
}

const INGEST_TYPES: IngestType[] = ['YOUTUBE', 'SRT_CALLER', 'SRT_LISTENER', 'RTMP_PUSH'];

function IngestFormModal({ channelId, editing, onClose }: ModalProps) {
  const isEdit = !!editing;

  const [name,          setName]          = useState(editing?.name          ?? '');
  const [type,          setType]          = useState<IngestType>(editing?.type ?? 'YOUTUBE');
  const [url,           setUrl]           = useState(editing?.url           ?? '');
  const [srtPort,       setSrtPort]       = useState(editing?.srtPort?.toString()    ?? '');
  const [srtLatency,    setSrtLatency]    = useState(editing?.srtLatency?.toString() ?? '120');
  const [srtPassphrase, setSrtPassphrase] = useState(editing?.srtPassphrase  ?? '');
  const [rtmpPort,      setRtmpPort]      = useState(editing?.rtmpPort?.toString()   ?? '1935');
  const [rtmpKey,       setRtmpKey]       = useState(editing?.rtmpKey        ?? '');

  const createMut = useCreateIngest();
  const updateMut = useUpdateIngest();

  const busy = createMut.isPending || updateMut.isPending;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { toast.error('El nombre es requerido'); return; }
    if (type === 'YOUTUBE' && !url.trim()) { toast.error('La URL de YouTube es requerida'); return; }
    if (type === 'SRT_CALLER' && !url.trim()) { toast.error('El host/IP de destino es requerido'); return; }

    const payload: CreateIngestInput = {
      name: name.trim(),
      type,
      url:           url.trim()           || undefined,
      srtPort:       srtPort       ? parseInt(srtPort)    : undefined,
      srtLatency:    srtLatency    ? parseInt(srtLatency) : undefined,
      srtPassphrase: srtPassphrase.trim() || undefined,
      rtmpPort:      rtmpPort      ? parseInt(rtmpPort)   : undefined,
      rtmpKey:       rtmpKey.trim()        || undefined,
    };

    try {
      if (isEdit) {
        const upd: UpdateIngestInput = { ...payload };
        delete (upd as any).type;
        await updateMut.mutateAsync({ channelId, id: editing!.id, input: upd });
      } else {
        await createMut.mutateAsync({ channelId, input: payload });
      }
      onClose();
    } catch { /* toast shown by mutation */ }
  };

  const isSrt  = type === 'SRT_CALLER' || type === 'SRT_LISTENER';
  const isRtmp = type === 'RTMP_PUSH';
  const meta   = INGEST_TYPE_META[type];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-surface-800 rounded-2xl border border-white/10 shadow-2xl flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 flex-shrink-0">
          <div>
            <h2 className="text-base font-semibold text-white">
              {isEdit ? 'Editar fuente' : 'Nueva fuente de ingesta'}
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {isEdit ? `Modificando "${editing!.name}"` : 'Configurá la señal externa'}
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/5 text-slate-400 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-y-auto">
          <div className="px-6 py-5 space-y-5">

            {/* Tipo (solo al crear) */}
            {!isEdit && (
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-2">Tipo de fuente</label>
                <div className="grid grid-cols-2 gap-2">
                  {INGEST_TYPES.map((t) => {
                    const m = INGEST_TYPE_META[t];
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setType(t)}
                        className={cn(
                          'flex flex-col gap-1 px-3 py-3 rounded-xl border text-left transition-all',
                          type === t
                            ? `${m.bg} ${m.border} ${m.color}`
                            : 'bg-surface-700/50 border-surface-600 text-slate-400 hover:border-slate-500',
                        )}
                      >
                        <span className="text-xs font-bold">{m.badge}</span>
                        <span className="text-xs font-medium leading-snug">{m.label}</span>
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2 text-xs text-slate-500">{meta.description}</p>
              </div>
            )}

            {/* Nombre */}
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Nombre</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Ej: Evento especial — señal OB"
                className="w-full bg-surface-700 border border-surface-600 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-brand-500"
              />
            </div>

            {/* YouTube URL */}
            {type === 'YOUTUBE' && (
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">URL de YouTube</label>
                <input
                  type="url"
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  placeholder="https://www.youtube.com/watch?v=..."
                  className="w-full bg-surface-700 border border-surface-600 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-brand-500"
                />
                <p className="mt-1.5 text-xs text-slate-500">
                  Recomendado: conectá tu cuenta de YouTube en la sección de autenticación para evitar bloqueos por bot detection.
                </p>
              </div>
            )}

            {/* SRT Caller: host */}
            {type === 'SRT_CALLER' && (
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">Host / IP de destino</label>
                <input
                  type="text"
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  placeholder="10.147.20.5 (IP ZeroTier, LAN o pública)"
                  className="w-full bg-surface-700 border border-surface-600 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-brand-500"
                />
              </div>
            )}

            {/* SRT fields (Caller + Listener) */}
            {isSrt && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">Puerto SRT</label>
                  <input
                    type="number"
                    value={srtPort}
                    onChange={e => setSrtPort(e.target.value)}
                    placeholder="9000"
                    min={1} max={65535}
                    className="w-full bg-surface-700 border border-surface-600 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-brand-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">Latencia (ms)</label>
                  <input
                    type="number"
                    value={srtLatency}
                    onChange={e => setSrtLatency(e.target.value)}
                    placeholder="120"
                    min={20} max={8000}
                    className="w-full bg-surface-700 border border-surface-600 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-brand-500"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">
                    Passphrase AES <span className="text-slate-500 font-normal">(opcional, 10–79 chars)</span>
                  </label>
                  <input
                    type="text"
                    value={srtPassphrase}
                    onChange={e => setSrtPassphrase(e.target.value)}
                    placeholder="Dejá vacío si no usás cifrado"
                    maxLength={79}
                    className="w-full bg-surface-700 border border-surface-600 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-brand-500"
                  />
                </div>
              </div>
            )}

            {/* RTMP Push fields */}
            {isRtmp && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">Puerto RTMP</label>
                  <input
                    type="number"
                    value={rtmpPort}
                    onChange={e => setRtmpPort(e.target.value)}
                    placeholder="1935"
                    min={1} max={65535}
                    className="w-full bg-surface-700 border border-surface-600 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-brand-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">Stream Key</label>
                  <input
                    type="text"
                    value={rtmpKey}
                    onChange={e => setRtmpKey(e.target.value)}
                    placeholder="live"
                    maxLength={128}
                    className="w-full bg-surface-700 border border-surface-600 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-brand-500"
                  />
                </div>
              </div>
            )}

            {/* SRT Listener: info de conexión */}
            {type === 'SRT_LISTENER' && (
              <div className="bg-teal-500/10 border border-teal-500/20 rounded-xl p-3 flex gap-2.5">
                <Info className="w-4 h-4 text-teal-400 flex-shrink-0 mt-0.5" />
                <div className="text-xs text-teal-300 space-y-1">
                  <p className="font-medium">Tu encoder debe conectarse a:</p>
                  <code className="block text-teal-200">srt://[IP del servidor]:{srtPort || '9000'}?mode=caller</code>
                  <p className="text-teal-400">Configurá esta dirección en OBS / vMix / FFmpeg. Cada cliente gestiona su propia red ZeroTier.</p>
                </div>
              </div>
            )}

            {/* RTMP Push: info de conexión */}
            {type === 'RTMP_PUSH' && (
              <div className="bg-orange-500/10 border border-orange-500/20 rounded-xl p-3 flex gap-2.5">
                <Info className="w-4 h-4 text-orange-400 flex-shrink-0 mt-0.5" />
                <div className="text-xs text-orange-300 space-y-1">
                  <p className="font-medium">Tu encoder debe enviar a:</p>
                  <code className="block text-orange-200">rtmp://[IP del servidor]:{rtmpPort || '1935'}/live/{rtmpKey || 'live'}</code>
                  <p className="text-orange-400">En OBS: Servidor = <code>rtmp://IP:{rtmpPort || '1935'}/live</code> — Clave = <code>{rtmpKey || 'live'}</code></p>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-white/10 flex justify-end gap-3 flex-shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-sm font-medium text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={busy}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-sm font-semibold text-white transition-colors disabled:opacity-50"
            >
              {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {isEdit ? 'Guardar cambios' : 'Crear fuente'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Source Card ─────────────────────────────────────────────

interface CardProps {
  source:       IngestSource;
  channelLive:  boolean;
  onEdit:       () => void;
  onDelete:     () => void;
  onActivate:   () => void;
  onDeactivate: () => void;
  activating:   boolean;
  deactivating: boolean;
}

function IngestCard({
  source, channelLive, onEdit, onDelete, onActivate, onDeactivate,
  activating, deactivating,
}: CardProps) {
  const meta   = INGEST_TYPE_META[source.type];
  const stMeta = INGEST_STATUS_META[source.status];
  const isActive = source.status === 'ACTIVE';
  const isBusy   = activating || deactivating;

  // ── Resumen de la fuente ────────────────────────────────────
  const connInfo = (() => {
    switch (source.type) {
      case 'YOUTUBE':
        return source.url ? (
          <span className="text-slate-400 truncate max-w-[280px]">{source.url}</span>
        ) : null;
      case 'SRT_CALLER':
        return (
          <span className="text-slate-400 font-mono text-xs">
            srt://{source.url || '?'}:{source.srtPort ?? '?'}
            {source.srtLatency ? <span className="text-slate-500"> · {source.srtLatency}ms</span> : null}
            {source.srtPassphrase ? <span className="text-slate-500"> · AES</span> : null}
          </span>
        );
      case 'SRT_LISTENER':
        return (
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400 font-mono text-xs">
              srt://[servidor]:{source.srtPort ?? '?'}
              {source.srtLatency ? <span className="text-slate-500"> · {source.srtLatency}ms</span> : null}
              {source.srtPassphrase ? <span className="text-slate-500"> · AES</span> : null}
            </span>
            <CopyBtn text={`srt://[servidor]:${source.srtPort ?? 9000}?mode=caller`} />
          </div>
        );
      case 'RTMP_PUSH':
        return (
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400 font-mono text-xs">
              rtmp://[servidor]:{source.rtmpPort ?? 1935}/live/{source.rtmpKey ?? 'live'}
            </span>
            <CopyBtn text={`rtmp://[servidor]:${source.rtmpPort ?? 1935}/live/${source.rtmpKey ?? 'live'}`} />
          </div>
        );
      default: return null;
    }
  })();

  return (
    <div className={cn(
      'rounded-2xl border p-4 transition-all',
      isActive
        ? 'bg-green-500/5 border-green-500/30'
        : 'bg-surface-800 border-white/8 hover:border-white/12',
    )}>
      <div className="flex items-start gap-3">

        {/* Type badge */}
        <div className={cn('flex-shrink-0 px-2 py-1 rounded-lg text-xs font-bold', meta.bg, meta.color)}>
          {meta.badge}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-white">{source.name}</span>
            {/* Status dot */}
            <div className={cn('flex items-center gap-1 text-xs', stMeta.color)}>
              <span className={cn('w-1.5 h-1.5 rounded-full', stMeta.dot, isActive && 'animate-pulse')} />
              {stMeta.label}
            </div>
          </div>

          <div className="mt-1 text-xs">{connInfo}</div>

          {/* Live indicator */}
          {isActive && (
            <div className="mt-2 flex items-center gap-1.5 text-xs text-green-400">
              <Wifi className="w-3.5 h-3.5 animate-pulse" />
              <span className="font-medium">Transmitiendo en vivo — señal activa</span>
            </div>
          )}

          {/* Error hint */}
          {source.status === 'ERROR' && (
            <div className="mt-2 flex items-center gap-1.5 text-xs text-red-400">
              <AlertCircle className="w-3.5 h-3.5" />
              <span>Ocurrió un error. Verificá la fuente y reactivá.</span>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {/* Activate / Deactivate */}
          {isActive ? (
            <button
              onClick={onDeactivate}
              disabled={isBusy}
              title="Desactivar ingesta"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/15 hover:bg-red-500/25 text-red-400 text-xs font-medium transition-colors disabled:opacity-50"
            >
              {deactivating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Square className="w-3.5 h-3.5" />}
              Detener
            </button>
          ) : (
            <button
              onClick={onActivate}
              disabled={isBusy || !channelLive}
              title={channelLive ? 'Activar esta fuente como señal en vivo' : 'El canal debe estar activo para activar la ingesta'}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-500/15 hover:bg-green-500/25 text-green-400 text-xs font-medium transition-colors disabled:opacity-40"
            >
              {activating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
              Activar
            </button>
          )}

          <button
            onClick={onEdit}
            title="Editar fuente"
            className="p-2 rounded-lg hover:bg-white/5 text-slate-400 hover:text-white transition-colors"
          >
            <Edit2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onDelete}
            disabled={isActive}
            title={isActive ? 'Desactivá la fuente antes de eliminarla' : 'Eliminar fuente'}
            className="p-2 rounded-lg hover:bg-red-500/10 text-slate-400 hover:text-red-400 transition-colors disabled:opacity-30"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────

type Channel = { id: string; name: string; status: string };

export default function IngestPage() {
  const [channelId,  setChannelId]  = useState<string | null>(null);
  const [channels,   setChannels]   = useState<Channel[]>([]);
  const [showModal,  setShowModal]  = useState(false);
  const [editing,    setEditing]    = useState<IngestSource | null>(null);
  const [activatingId,   setActivatingId]   = useState<string | null>(null);
  const [deactivatingId, setDeactivatingId] = useState<string | null>(null);

  // Cargar canales
  useEffect(() => {
    apiClient.get('/channels').then(({ data }) => {
      setChannels(data);
      if (data.length > 0) setChannelId(data[0].id);
    }).catch(() => {});
  }, []);

  // Re-fetch canal para status actualizado cada 5 s
  const [channelStatus, setChannelStatus] = useState<string>('OFFLINE');
  useEffect(() => {
    if (!channelId) return;
    const fetch = () =>
      apiClient.get(`/channels/${channelId}`).then(({ data }) => {
        setChannelStatus(data.status ?? 'OFFLINE');
      }).catch(() => {});
    fetch();
    const t = setInterval(fetch, 5_000);
    return () => clearInterval(t);
  }, [channelId]);

  const { data: sources = [], isLoading } = useIngestSources(channelId);
  const deleteMut     = useDeleteIngest();
  const activateMut   = useActivateIngest();
  const deactivateMut = useDeactivateIngest();

  const channelLive = channelStatus !== 'OFFLINE' && channelStatus !== 'ERROR';

  const selectedChannel = channels.find(c => c.id === channelId);

  const handleDelete = (source: IngestSource) => {
    if (!channelId || !confirm(`¿Eliminar la fuente "${source.name}"?`)) return;
    deleteMut.mutate({ channelId, id: source.id });
  };

  const handleActivate = (source: IngestSource) => {
    if (!channelId) return;
    setActivatingId(source.id);
    activateMut.mutate({ channelId, ingestId: source.id }, {
      onSettled: () => setActivatingId(null),
    });
  };

  const handleDeactivate = (source: IngestSource) => {
    if (!channelId) return;
    setDeactivatingId(source.id);
    deactivateMut.mutate({ channelId }, {
      onSettled: () => setDeactivatingId(null),
    });
  };

  const handleEdit = (source: IngestSource) => {
    setEditing(source);
    setShowModal(true);
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setEditing(null);
  };

  const activeSource = sources.find(s => s.status === 'ACTIVE');

  return (
    <div className="flex flex-col flex-1">
      <Header
        title="Ingesta"
        subtitle="Reemplazá la programación con una señal externa en vivo"
      />

      <div className="flex-1 p-6 overflow-y-auto space-y-6">

        {/* Canal + botón agregar */}
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

          {/* Canal status badge */}
          {channelId && (
            <span className={cn(
              'flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium',
              channelLive
                ? 'bg-green-500/10 text-green-400'
                : 'bg-slate-500/10 text-slate-400',
            )}>
              <span className={cn('w-1.5 h-1.5 rounded-full', channelLive ? 'bg-green-400 animate-pulse' : 'bg-slate-500')} />
              {channelLive ? 'Canal activo' : 'Canal offline'}
            </span>
          )}

          <div className="flex-1" />

          <button
            onClick={() => { setEditing(null); setShowModal(true); }}
            disabled={!channelId}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-sm font-semibold text-white transition-colors disabled:opacity-40"
          >
            <Plus className="w-4 h-4" />
            Nueva fuente
          </button>
        </div>

        {/* Banner: ingesta activa */}
        {activeSource && (
          <div className="rounded-2xl bg-green-500/10 border border-green-500/25 p-4 flex items-center gap-4">
            <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-green-500/20 flex items-center justify-center">
              <Wifi className="w-5 h-5 text-green-400 animate-pulse" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-green-300">Ingesta activa</p>
              <p className="text-xs text-green-400 mt-0.5">
                <span className="font-medium">{activeSource.name}</span>
                {' '}({INGEST_TYPE_META[activeSource.type].label}) está reemplazando la programación del canal.
              </p>
            </div>
            <button
              onClick={() => handleDeactivate(activeSource)}
              disabled={!!deactivatingId}
              className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/15 hover:bg-red-500/25 text-red-400 text-xs font-medium transition-colors disabled:opacity-50"
            >
              {deactivatingId ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Square className="w-3.5 h-3.5" />}
              Detener ingesta
            </button>
          </div>
        )}

        {/* Aviso canal offline */}
        {!channelLive && channelId && (
          <div className="rounded-2xl bg-amber-500/5 border border-amber-500/15 p-4 flex gap-3">
            <Info className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-300">
              El canal está offline. Para activar una fuente de ingesta, iniciá el canal primero desde{' '}
              <a href="/channel" className="underline font-medium">Canal en vivo</a>.
            </p>
          </div>
        )}

        {/* Autenticación YouTube */}
        <YoutubeConnectCard />

        {/* Lista */}
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 text-slate-500 animate-spin" />
          </div>
        ) : sources.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-14 h-14 rounded-2xl bg-surface-700 flex items-center justify-center mb-4">
              <Radio className="w-6 h-6 text-slate-500" />
            </div>
            <p className="text-base font-semibold text-white mb-1">Sin fuentes de ingesta</p>
            <p className="text-sm text-slate-400 max-w-xs">
              Creá una fuente para poder interrumpir la programación con señales en vivo (YouTube, SRT, RTMP).
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {sources.map((source) => (
              <IngestCard
                key={source.id}
                source={source}
                channelLive={channelLive}
                onEdit={() => handleEdit(source)}
                onDelete={() => handleDelete(source)}
                onActivate={() => handleActivate(source)}
                onDeactivate={() => handleDeactivate(source)}
                activating={activatingId === source.id}
                deactivating={deactivatingId === source.id}
              />
            ))}
          </div>
        )}

        {/* ── Guía de tipos ───────────────────────────────────────── */}
        <div className="rounded-2xl bg-surface-800/50 border border-white/5 p-5">
          <p className="text-xs font-semibold text-slate-300 mb-3">Tipos de fuente disponibles</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {INGEST_TYPES.map((t) => {
              const m = INGEST_TYPE_META[t];
              return (
                <div key={t} className="flex gap-3">
                  <span className={cn('flex-shrink-0 mt-0.5 px-1.5 py-0.5 rounded text-xs font-bold', m.bg, m.color)}>
                    {m.badge}
                  </span>
                  <div>
                    <p className="text-xs font-medium text-slate-300">{m.label}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{m.description}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

      </div>

      {/* Modal */}
      {showModal && channelId && (
        <IngestFormModal
          channelId={channelId}
          editing={editing}
          onClose={handleCloseModal}
        />
      )}
    </div>
  );
}
