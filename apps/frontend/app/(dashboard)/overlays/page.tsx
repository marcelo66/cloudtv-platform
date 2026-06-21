'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Layers,
  Plus,
  Trash2,
  Edit2,
  Image as ImageIcon,
  Type,
  Clock,
  AlignLeft,
  ChevronDown,
  ToggleLeft,
  ToggleRight,
  Upload,
  X,
  Info,
  Thermometer,
} from 'lucide-react';
import { Header } from '@/components/dashboard/Header';
import apiClient from '@/lib/api-client';
import {
  useOverlays,
  useCreateOverlay,
  useUpdateOverlay,
  useDeleteOverlay,
  useUploadOverlayLogo,
  type Overlay,
  type OverlayType,
  type CreateOverlayInput,
} from '@/hooks/useOverlays';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

// ─── Metadatos por tipo ───────────────────────────────────────────────────────

const TYPE_META: Record<OverlayType, { label: string; desc: string; Icon: any; color: string }> = {
  LOGO: {
    label: 'Logo',
    desc: 'Imagen estática superpuesta (PNG/JPG)',
    Icon: ImageIcon,
    color: 'text-blue-400',
  },
  TEXT_STATIC: {
    label: 'Texto estático',
    desc: 'Texto fijo en pantalla',
    Icon: Type,
    color: 'text-green-400',
  },
  TEXT_SCROLL: {
    label: 'Texto scrolling',
    desc: 'Texto que se desplaza de derecha a izquierda',
    Icon: AlignLeft,
    color: 'text-yellow-400',
  },
  CLOCK: {
    label: 'Reloj',
    desc: 'Hora en tiempo real',
    Icon: Clock,
    color: 'text-purple-400',
  },
  TICKER: {
    label: 'Ticker',
    desc: 'Banda scrolling tipo news ticker',
    Icon: AlignLeft,
    color: 'text-orange-400',
  },
  TEMPERATURE: {
    label: 'Temperatura',
    desc: 'Temperatura actual de una ciudad (wttr.in)',
    Icon: Thermometer,
    color: 'text-red-400',
  },
};

const POSITIONS_XY = [
  { value: 'top-left',     label: 'Arriba izquierda' },
  { value: 'top-right',    label: 'Arriba derecha' },
  { value: 'bottom-left',  label: 'Abajo izquierda' },
  { value: 'bottom-right', label: 'Abajo derecha' },
  { value: 'center',       label: 'Centro' },
  { value: 'custom',       label: 'Personalizado (x/y)' },
];

const POSITIONS_BAR = [
  { value: 'bottom', label: 'Abajo' },
  { value: 'top',    label: 'Arriba' },
];

// ─── Presets de color de fondo ────────────────────────────────────────────────

const BG_PRESETS = [
  { label: 'Sin fondo',  value: 'black@0.0',    hex: 'rgba(0,0,0,0)' },
  { label: 'Negro 40%',  value: 'black@0.4',    hex: 'rgba(0,0,0,0.4)' },
  { label: 'Negro 60%',  value: 'black@0.6',    hex: 'rgba(0,0,0,0.6)' },
  { label: 'Negro 80%',  value: 'black@0.8',    hex: 'rgba(0,0,0,0.8)' },
  { label: 'Azul TV',    value: '#003280@0.85',  hex: 'rgba(0,50,128,0.85)' },
  { label: 'Rojo',       value: '#cc0000@0.8',   hex: 'rgba(204,0,0,0.8)' },
];

function BgColorField({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="block text-xs text-slate-400 mb-1.5">Color fondo</label>
      <div className="flex gap-1.5 flex-wrap mb-1.5" title="Presets rápidos">
        {BG_PRESETS.map(p => (
          <button
            key={p.value}
            type="button"
            title={p.label}
            onClick={() => onChange(p.value)}
            style={{ background: p.hex }}
            className={cn(
              'w-6 h-6 rounded border-2 transition-all',
              value === p.value
                ? 'border-brand-400 scale-110'
                : 'border-surface-500 hover:border-surface-300',
            )}
          />
        ))}
      </div>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="black@0.6  |  #003280@0.85  |  red@0.7"
        className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-brand-500"
      />
    </div>
  );
}

// ─── Ajuste de posición (offsetX / offsetY) ───────────────────────────────────

function OffsetInputs({
  config,
  setCfg,
}: {
  config: Record<string, any>;
  setCfg: (k: string, v: any) => void;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-400 mb-1">
        Ajuste fino de posición (px)
      </label>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs text-slate-400 mb-1">X · + derecha / − izquierda</label>
          <input
            type="number"
            step={1}
            value={config.offsetX ?? 0}
            onChange={e => setCfg('offsetX', +e.target.value)}
            className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Y · + abajo / − arriba</label>
          <input
            type="number"
            step={1}
            value={config.offsetY ?? 0}
            onChange={e => setCfg('offsetY', +e.target.value)}
            className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500"
          />
        </div>
      </div>
    </div>
  );
}

// ─── Defaults por tipo ────────────────────────────────────────────────────────

const DEFAULT_CONFIG: Record<OverlayType, Record<string, any>> = {
  LOGO:        { position: 'top-left', width: 120, opacity: 1, offsetX: 0, offsetY: 0 },
  TEXT_STATIC: { text: '', position: 'bottom-right', fontSize: 24, fontColor: 'white', bgColor: 'black@0.5', bold: false, offsetX: 0, offsetY: 0 },
  TEXT_SCROLL: { textSource: 'manual', text: '', rssUrl: '', rssItems: 5, rssRefreshMin: 10, position: 'bottom', fontSize: 20, fontColor: 'white', bgColor: 'black@0.7', speed: 80, barHeight: 36, offsetX: 0, offsetY: 0 },
  CLOCK:       { position: 'top-right', fontSize: 28, fontColor: 'white', bgColor: 'black@0.6', format: 'time_short', timezone: 'America/Argentina/Buenos_Aires', offsetX: 0, offsetY: 0 },
  TICKER:      { textSource: 'manual', text: '', rssUrl: '', rssItems: 5, rssRefreshMin: 10, position: 'bottom', fontSize: 20, fontColor: 'white', bgColor: 'black@0.7', speed: 80, barHeight: 36, offsetX: 0, offsetY: 0 },
  TEMPERATURE: { city: 'Buenos Aires', unit: 'celsius', showUnit: true, position: 'top-right', fontSize: 28, fontColor: 'white', bgColor: 'black@0.6', offsetX: 0, offsetY: 0 },
};

// ─── Overlay card ─────────────────────────────────────────────────────────────

function OverlayCard({
  overlay,
  channelId,
  onEdit,
  onDelete,
  onToggle,
}: {
  overlay: Overlay;
  channelId: string;
  onEdit: (o: Overlay) => void;
  onDelete: (id: string) => void;
  onToggle: (o: Overlay) => void;
}) {
  const meta  = TYPE_META[overlay.type];
  const { Icon } = meta;
  const cfg   = overlay.config;

  const configSummary = () => {
    switch (overlay.type) {
      case 'LOGO':
        return cfg.imageUrl
          ? `Imagen subida · ${cfg.position ?? 'top-left'}`
          : 'Sin imagen · ' + (cfg.position ?? 'top-left');
      case 'TEXT_STATIC':
        return `"${(cfg.text ?? '').slice(0, 40)}" · ${cfg.position ?? 'top-left'} · ${cfg.fontSize ?? 24}px`;
      case 'TEXT_SCROLL':
      case 'TICKER':
        return cfg.textSource === 'rss'
          ? `RSS · ${cfg.rssItems ?? 5} noticias · ${cfg.speed ?? 80}px/s · ${cfg.position ?? 'bottom'}`
          : `"${(cfg.text ?? '').slice(0, 40)}" · ${cfg.speed ?? 80}px/s · ${cfg.position ?? 'bottom'}`;
      case 'CLOCK': {
        const fmtLabel = cfg.format === 'datetime' ? 'Fecha+hora' : cfg.format === 'time' ? 'HH:MM:SS' : 'HH:MM';
        const tz = cfg.timezone ? (cfg.timezone as string).split('/').pop() : '';
        return `${fmtLabel} · ${cfg.position ?? 'top-right'} · ${cfg.fontSize ?? 28}px${tz ? ` · ${tz}` : ''}`;
      }
      case 'TEMPERATURE':
        return `${cfg.city ?? 'Buenos Aires'} · ${cfg.unit === 'fahrenheit' ? '°F' : '°C'} · ${cfg.position ?? 'top-right'}`;
      default:
        return '';
    }
  };

  return (
    <div className={cn(
      'glass-card p-4 transition-opacity',
      !overlay.enabled && 'opacity-50',
    )}>
      <div className="flex items-start gap-3">
        <div className={cn('w-9 h-9 rounded-lg bg-surface-700 flex items-center justify-center flex-shrink-0', meta.color)}>
          <Icon className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-white truncate">{overlay.name}</span>
            <span className={cn('text-xs px-1.5 py-0.5 rounded font-medium border', meta.color,
              'bg-surface-700 border-surface-600')}>
              {meta.label}
            </span>
            <span className="text-xs text-slate-500 ml-auto">z:{overlay.zIndex}</span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5 truncate">{configSummary()}</p>
          {overlay.type === 'LOGO' && cfg.imageUrl && (
            <img
              src={cfg.imageUrl}
              alt="logo preview"
              className="mt-2 h-8 object-contain rounded border border-surface-600"
            />
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-surface-700">
        {/* Toggle enabled */}
        <button
          onClick={() => onToggle(overlay)}
          className={cn(
            'flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded transition-colors',
            overlay.enabled
              ? 'text-green-400 hover:bg-green-500/10'
              : 'text-slate-500 hover:bg-slate-500/10',
          )}
        >
          {overlay.enabled
            ? <><ToggleRight className="w-4 h-4" />Activo</>
            : <><ToggleLeft className="w-4 h-4" />Inactivo</>
          }
        </button>

        <div className="flex-1" />

        <button
          onClick={() => onEdit(overlay)}
          className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-surface-700 transition-colors"
          title="Editar"
        >
          <Edit2 className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => onDelete(overlay.id)}
          className="p-1.5 rounded text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
          title="Eliminar"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// ─── Modal de creación/edición ────────────────────────────────────────────────

function OverlayFormModal({
  channelId,
  overlay,
  onClose,
}: {
  channelId: string;
  overlay: Overlay | null; // null = crear nuevo
  onClose: () => void;
}) {
  const isEdit = !!overlay;

  const [name, setName]         = useState(overlay?.name ?? '');
  const [type, setType]         = useState<OverlayType>(overlay?.type ?? 'TEXT_STATIC');
  const [enabled, setEnabled]   = useState(overlay?.enabled ?? true);
  const [zIndex, setZIndex]     = useState(overlay?.zIndex ?? 0);
  const [config, setConfig]     = useState<Record<string, any>>(
    overlay?.config ?? DEFAULT_CONFIG['TEXT_STATIC'],
  );
  // Logo pendiente (solo en modo creación — se sube al guardar)
  const [pendingLogo, setPendingLogo]                 = useState<File | null>(null);
  const [pendingLogoPreview, setPendingLogoPreview]   = useState<string | null>(null);

  // Cuando cambia el tipo (solo en creación) resetear config
  const handleTypeChange = (t: OverlayType) => {
    setType(t);
    setConfig({ ...DEFAULT_CONFIG[t] });
  };

  const setCfg = (key: string, value: any) =>
    setConfig(prev => ({ ...prev, [key]: value }));

  const createMut  = useCreateOverlay();
  const updateMut  = useUpdateOverlay();
  const uploadLogo = useUploadOverlayLogo();
  const logoRef    = useRef<HTMLInputElement>(null);

  const isLoading = createMut.isPending || updateMut.isPending || uploadLogo.isPending;

  const handleSubmit = async () => {
    if (!name.trim()) { toast.error('El nombre es requerido'); return; }

    if (isEdit) {
      updateMut.mutate(
        { channelId, id: overlay!.id, input: { name: name.trim(), enabled, config, zIndex } },
        { onSuccess: onClose },
      );
    } else {
      createMut.mutate(
        {
          channelId,
          input: { name: name.trim(), type, enabled, config, zIndex } satisfies CreateOverlayInput,
        },
        {
          onSuccess: async (res: any) => {
            if (pendingLogo && type === 'LOGO') {
              try {
                await uploadLogo.mutateAsync({ channelId, id: res.data.id, file: pendingLogo });
              } catch {
                toast.error('Overlay creado, pero falló la subida del logo. Intentá de nuevo editando el overlay.');
              }
            }
            onClose();
          },
        },
      );
    }
  };

  const handleLogoFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (isEdit) {
      uploadLogo.mutate(
        { channelId, id: overlay!.id, file },
        {
          onSuccess: (res: any) => {
            setConfig((prev: any) => ({ ...prev, ...res.data.config }));
          },
        },
      );
    } else {
      if (pendingLogoPreview) URL.revokeObjectURL(pendingLogoPreview);
      setPendingLogo(file);
      setPendingLogoPreview(URL.createObjectURL(file));
    }
    e.target.value = '';
  };

  const effectiveType = isEdit ? overlay!.type : type;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      <div className="relative bg-surface-800 border border-surface-700 rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-surface-700">
          <h2 className="text-base font-semibold text-white">
            {isEdit ? 'Editar overlay' : 'Nuevo overlay'}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-surface-700 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }} className="flex-1 overflow-y-auto p-5 space-y-4">

          {/* Nombre */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Nombre</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Ej: Logo canal, Ticker noticias…"
              className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-brand-500"
            />
          </div>

          {/* Tipo (solo en creación) */}
          {!isEdit && (
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Tipo</label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {(Object.keys(TYPE_META) as OverlayType[]).map(t => {
                  const m = TYPE_META[t];
                  const { Icon: TIcon } = m;
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => handleTypeChange(t)}
                      className={cn(
                        'flex flex-col items-center gap-1 p-2.5 rounded-xl border text-xs font-medium transition-all',
                        type === t
                          ? 'border-brand-500 bg-brand-500/10 text-white'
                          : 'border-surface-600 bg-surface-700 text-slate-400 hover:border-surface-500 hover:text-white',
                      )}
                    >
                      <TIcon className={cn('w-4 h-4', type === t ? 'text-brand-400' : m.color)} />
                      {m.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── LOGO ── */}
          {effectiveType === 'LOGO' && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Posición</label>
                <select
                  value={config.position ?? 'top-left'}
                  onChange={e => setCfg('position', e.target.value)}
                  className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500"
                >
                  {POSITIONS_XY.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>
              {config.position === 'custom' && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">X (px)</label>
                    <input type="number" value={config.x ?? 10} onChange={e => setCfg('x', +e.target.value)}
                      className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500" />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Y (px)</label>
                    <input type="number" value={config.y ?? 10} onChange={e => setCfg('y', +e.target.value)}
                      className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500" />
                  </div>
                </div>
              )}
              {config.position !== 'custom' && (
                <OffsetInputs config={config} setCfg={setCfg} />
              )}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Ancho (px, 0=original)</label>
                  <input type="number" min={0} value={config.width ?? 120} onChange={e => setCfg('width', +e.target.value || undefined)}
                    className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500" />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Opacidad (0–1)</label>
                  <input type="number" min={0} max={1} step={0.1} value={config.opacity ?? 1} onChange={e => setCfg('opacity', parseFloat(e.target.value))}
                    className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500" />
                </div>
              </div>

              {/* Logo upload */}
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Imagen del logo</label>
                {(pendingLogoPreview || config.imageUrl) && (
                  <img
                    src={pendingLogoPreview ?? config.imageUrl}
                    alt="logo preview"
                    className="h-14 object-contain rounded mb-2 border border-surface-600 bg-surface-900 p-1"
                  />
                )}
                <button
                  type="button"
                  onClick={() => logoRef.current?.click()}
                  disabled={uploadLogo.isPending}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-surface-500 text-xs text-slate-400 hover:border-brand-500 hover:text-brand-400 transition-colors disabled:opacity-50"
                >
                  <Upload className="w-3.5 h-3.5" />
                  {uploadLogo.isPending
                    ? 'Subiendo...'
                    : pendingLogo
                      ? `✓ ${pendingLogo.name}`
                      : config.imageUrl
                        ? 'Cambiar imagen'
                        : 'Seleccionar PNG / JPG'}
                </button>
                <input
                  ref={logoRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={handleLogoFileSelect}
                />
                {!isEdit && pendingLogo && (
                  <p className="text-xs text-green-400 mt-1 flex items-center gap-1">
                    <Upload className="w-3 h-3" /> La imagen se subirá al crear el overlay.
                  </p>
                )}
                {!isEdit && !pendingLogo && (
                  <p className="text-xs text-slate-500 mt-1">
                    Podés seleccionar la imagen ahora o después de crear el overlay.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* ── TEXT_STATIC ── */}
          {effectiveType === 'TEXT_STATIC' && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Texto</label>
                <input value={config.text ?? ''} onChange={e => setCfg('text', e.target.value)}
                  placeholder="Texto a mostrar en pantalla"
                  className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-brand-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Posición</label>
                <select value={config.position ?? 'bottom-right'} onChange={e => setCfg('position', e.target.value)}
                  className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500">
                  {POSITIONS_XY.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>
              {config.position === 'custom' ? (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">X (px)</label>
                    <input type="number" value={config.x ?? 10} onChange={e => setCfg('x', +e.target.value)}
                      className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500" />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Y (px)</label>
                    <input type="number" value={config.y ?? 10} onChange={e => setCfg('y', +e.target.value)}
                      className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500" />
                  </div>
                </div>
              ) : (
                <OffsetInputs config={config} setCfg={setCfg} />
              )}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Tamaño fuente (px)</label>
                  <input type="number" min={8} max={120} value={config.fontSize ?? 24} onChange={e => setCfg('fontSize', +e.target.value)}
                    className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500" />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Color texto</label>
                  <input value={config.fontColor ?? 'white'} onChange={e => setCfg('fontColor', e.target.value)}
                    placeholder="white, #FF0000…"
                    className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-brand-500" />
                </div>
              </div>
              <BgColorField value={config.bgColor ?? 'black@0.5'} onChange={v => setCfg('bgColor', v)} />
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={!!config.bold} onChange={e => setCfg('bold', e.target.checked)}
                  className="rounded border-surface-600" />
                <span className="text-xs text-slate-300">Negrita</span>
              </label>
            </div>
          )}

          {/* ── TEXT_SCROLL / TICKER ── */}
          {(effectiveType === 'TEXT_SCROLL' || effectiveType === 'TICKER') && (
            <div className="space-y-3">

              {/* Fuente del texto */}
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">Fuente del texto</label>
                <div className="grid grid-cols-2 gap-2">
                  {(['manual', 'rss'] as const).map(src => (
                    <button
                      key={src}
                      type="button"
                      onClick={() => setCfg('textSource', src)}
                      className={cn(
                        'py-2 rounded-lg border text-xs font-medium transition-all',
                        (config.textSource ?? 'manual') === src
                          ? 'border-brand-500 bg-brand-500/10 text-white'
                          : 'border-surface-600 bg-surface-700 text-slate-400 hover:border-surface-500 hover:text-white',
                      )}
                    >
                      {src === 'manual' ? 'Texto manual' : 'RSS / Feed URL'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Texto manual */}
              {(config.textSource ?? 'manual') === 'manual' && (
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">Texto</label>
                  <textarea value={config.text ?? ''} onChange={e => setCfg('text', e.target.value)}
                    rows={2} placeholder="Texto que scrolleará de derecha a izquierda"
                    className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-brand-500 resize-none" />
                </div>
              )}

              {/* RSS / Feed */}
              {(config.textSource ?? 'manual') === 'rss' && (
                <div className="space-y-2">
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1">URL del feed RSS / Atom</label>
                    <input
                      value={config.rssUrl ?? ''}
                      onChange={e => setCfg('rssUrl', e.target.value)}
                      placeholder="https://www.lanacion.com.ar/arcio/rss/"
                      className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-brand-500"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">N° de noticias</label>
                      <input type="number" min={1} max={20} value={config.rssItems ?? 5}
                        onChange={e => setCfg('rssItems', +e.target.value)}
                        className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500" />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">Actualizar cada (min)</label>
                      <input type="number" min={5} max={120} value={config.rssRefreshMin ?? 10}
                        onChange={e => setCfg('rssRefreshMin', +e.target.value)}
                        className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1">Texto de respaldo (si el feed falla)</label>
                    <input value={config.text ?? ''} onChange={e => setCfg('text', e.target.value)}
                      placeholder="Texto que se muestra si el RSS no responde"
                      className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-brand-500" />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Posición</label>
                  <select value={config.position ?? 'bottom'} onChange={e => setCfg('position', e.target.value)}
                    className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500">
                    {POSITIONS_BAR.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Velocidad (px/s)</label>
                  <input type="number" min={20} max={400} value={config.speed ?? 80} onChange={e => setCfg('speed', +e.target.value)}
                    className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Tamaño fuente (px)</label>
                  <input type="number" min={8} max={72} value={config.fontSize ?? 20} onChange={e => setCfg('fontSize', +e.target.value)}
                    className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500" />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Alto de banda (px)</label>
                  <input type="number" min={24} max={80} value={config.barHeight ?? 36} onChange={e => setCfg('barHeight', +e.target.value)}
                    className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Color texto</label>
                  <input value={config.fontColor ?? 'white'} onChange={e => setCfg('fontColor', e.target.value)}
                    className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500" />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Color banda</label>
                  <input value={config.bgColor ?? 'black@0.7'} onChange={e => setCfg('bgColor', e.target.value)}
                    className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500" />
                </div>
              </div>
              <OffsetInputs config={config} setCfg={setCfg} />
            </div>
          )}

          {/* ── CLOCK ── */}
          {effectiveType === 'CLOCK' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">Formato</label>
                  <select value={config.format ?? 'time_short'} onChange={e => setCfg('format', e.target.value)}
                    className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500">
                    <option value="time_short">Solo hora (HH:MM)</option>
                    <option value="time">Hora + segundos (HH:MM:SS)</option>
                    <option value="datetime">Fecha y hora (DD/MM/YYYY HH:MM:SS)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">Posición</label>
                  <select value={config.position ?? 'top-right'} onChange={e => setCfg('position', e.target.value)}
                    className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500">
                    {POSITIONS_XY.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                </div>
              </div>
              {config.position === 'custom' ? (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">X (px)</label>
                    <input type="number" value={config.x ?? 10} onChange={e => setCfg('x', +e.target.value)}
                      className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500" />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Y (px)</label>
                    <input type="number" value={config.y ?? 10} onChange={e => setCfg('y', +e.target.value)}
                      className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500" />
                  </div>
                </div>
              ) : (
                <OffsetInputs config={config} setCfg={setCfg} />
              )}
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Zona horaria</label>
                <select value={config.timezone ?? 'America/Argentina/Buenos_Aires'} onChange={e => setCfg('timezone', e.target.value)}
                  className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500">
                  <option value="America/Argentina/Buenos_Aires">Argentina (UTC-3)</option>
                  <option value="America/Sao_Paulo">Brasil — São Paulo (UTC-3)</option>
                  <option value="America/Santiago">Chile (UTC-4/-3)</option>
                  <option value="America/Lima">Perú / Ecuador (UTC-5)</option>
                  <option value="America/Bogota">Colombia (UTC-5)</option>
                  <option value="America/Caracas">Venezuela (UTC-4)</option>
                  <option value="America/Mexico_City">México Centro (UTC-6/-5)</option>
                  <option value="America/New_York">Nueva York (UTC-5/-4)</option>
                  <option value="America/Los_Angeles">Los Ángeles (UTC-8/-7)</option>
                  <option value="Europe/Madrid">España (UTC+1/+2)</option>
                  <option value="UTC">UTC</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Tamaño fuente (px)</label>
                  <input type="number" min={12} max={96} value={config.fontSize ?? 28} onChange={e => setCfg('fontSize', +e.target.value)}
                    className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500" />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Color texto</label>
                  <input value={config.fontColor ?? 'white'} onChange={e => setCfg('fontColor', e.target.value)}
                    className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500" />
                </div>
              </div>
              <BgColorField value={config.bgColor ?? 'black@0.6'} onChange={v => setCfg('bgColor', v)} />
            </div>
          )}

          {/* ── TEMPERATURE ── */}
          {effectiveType === 'TEMPERATURE' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">Ciudad</label>
                  <input
                    value={config.city ?? 'Buenos Aires'}
                    onChange={e => setCfg('city', e.target.value)}
                    placeholder="Buenos Aires, Madrid, New York…"
                    className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-brand-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">Unidad</label>
                  <select
                    value={config.unit ?? 'celsius'}
                    onChange={e => setCfg('unit', e.target.value)}
                    className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500"
                  >
                    <option value="celsius">Celsius (°C)</option>
                    <option value="fahrenheit">Fahrenheit (°F)</option>
                  </select>
                </div>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.showUnit !== false}
                  onChange={e => setCfg('showUnit', e.target.checked)}
                  className="rounded border-surface-600"
                />
                <span className="text-xs text-slate-300">Mostrar unidad (°C / °F)</span>
              </label>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Posición</label>
                <select
                  value={config.position ?? 'top-right'}
                  onChange={e => setCfg('position', e.target.value)}
                  className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500"
                >
                  {POSITIONS_XY.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>
              {config.position === 'custom' ? (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">X (px)</label>
                    <input type="number" value={config.x ?? 10} onChange={e => setCfg('x', +e.target.value)}
                      className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500" />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Y (px)</label>
                    <input type="number" value={config.y ?? 10} onChange={e => setCfg('y', +e.target.value)}
                      className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500" />
                  </div>
                </div>
              ) : (
                <OffsetInputs config={config} setCfg={setCfg} />
              )}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Tamaño fuente (px)</label>
                  <input
                    type="number" min={12} max={96}
                    value={config.fontSize ?? 28}
                    onChange={e => setCfg('fontSize', +e.target.value)}
                    className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Color texto</label>
                  <input
                    value={config.fontColor ?? 'white'}
                    onChange={e => setCfg('fontColor', e.target.value)}
                    className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500"
                  />
                </div>
              </div>
              <BgColorField value={config.bgColor ?? 'black@0.6'} onChange={v => setCfg('bgColor', v)} />
              <p className="text-xs text-slate-500 flex items-start gap-1.5 pt-1">
                <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-slate-400" />
                Temperatura obtenida de wttr.in, actualizada cada 10 min.
                Para mostrarla junto al reloj: usá la misma posición y ajustá el desplazamiento X
                (ej: Reloj offsetX=0, Temperatura offsetX=−80).
              </p>
            </div>
          )}

          {/* Común: estado + z-index */}
          <div className="pt-2 border-t border-surface-700 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-slate-400">Habilitado</label>
              <button
                type="button"
                onClick={() => setEnabled(!enabled)}
                className={cn(
                  'flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors',
                  enabled
                    ? 'border-green-500/30 bg-green-500/10 text-green-400'
                    : 'border-surface-600 bg-surface-700 text-slate-400',
                )}
              >
                {enabled ? <><ToggleRight className="w-4 h-4" />Activo</> : <><ToggleLeft className="w-4 h-4" />Inactivo</>}
              </button>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Z-Index (orden de capas, mayor = encima)</label>
              <input type="number" min={0} value={zIndex} onChange={e => setZIndex(+e.target.value)}
                className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500" />
            </div>
          </div>
        </form>

        {/* Footer */}
        <div className="p-5 border-t border-surface-700 flex gap-3">
          <button type="button" onClick={onClose}
            className="flex-1 py-2 rounded-xl border border-surface-600 text-sm text-slate-400 hover:text-white hover:bg-surface-700 transition-colors">
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={isLoading}
            className="flex-1 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-sm font-semibold text-white transition-colors disabled:opacity-50"
          >
            {isLoading ? 'Guardando...' : isEdit ? 'Guardar cambios' : 'Crear overlay'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function OverlaysPage() {
  const [channelId, setChannelId]   = useState<string | null>(null);
  const [channels, setChannels]     = useState<Array<{ id: string; name: string }>>([]);
  const [showModal, setShowModal]   = useState(false);
  const [editing, setEditing]       = useState<Overlay | null>(null);

  // Cargar canales
  useEffect(() => {
    apiClient.get('/channels').then(({ data }) => {
      setChannels(data);
      if (data.length > 0) setChannelId(data[0].id);
    }).catch(() => {});
  }, []);

  const { data: overlays = [], isLoading } = useOverlays(channelId);
  const deleteMut  = useDeleteOverlay();
  const updateMut  = useUpdateOverlay();

  const handleOpenCreate = () => {
    setEditing(null);
    setShowModal(true);
  };

  const handleOpenEdit = (o: Overlay) => {
    setEditing(o);
    setShowModal(true);
  };

  const handleDelete = (id: string) => {
    if (!channelId || !confirm('¿Eliminar este overlay?')) return;
    deleteMut.mutate({ channelId, id });
  };

  const handleToggle = (o: Overlay) => {
    if (!channelId) return;
    updateMut.mutate({
      channelId,
      id: o.id,
      input: { enabled: !o.enabled },
    });
  };

  return (
    <div className="flex flex-col flex-1">
      <Header title="Overlays" subtitle="Logos, textos y gráficos sobre la señal en vivo" />

      <div className="flex-1 p-6 overflow-y-auto space-y-6">

        {/* Aviso: los overlays se aplican al reiniciar el canal */}
        <div className="flex items-start gap-2.5 rounded-xl bg-amber-500/8 border border-amber-500/20 px-4 py-3">
          <Info className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-amber-300">
            Los cambios en overlays toman efecto la próxima vez que el canal se inicie o reinicie.
            Si el canal está en vivo, detené y volvé a iniciar desde{' '}
            <a href="/channel" className="underline font-medium">Canal en vivo</a>.
          </p>
        </div>

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

          <div className="flex-1" />

          <button
            onClick={handleOpenCreate}
            disabled={!channelId}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-sm font-semibold text-white transition-colors disabled:opacity-40"
          >
            <Plus className="w-4 h-4" />
            Agregar overlay
          </button>
        </div>

        {/* Sin canales */}
        {channels.length === 0 && (
          <div className="glass-card p-12 text-center">
            <Layers className="w-10 h-10 text-slate-600 mx-auto mb-3" />
            <p className="text-sm text-slate-500">No tenés canales creados aún.</p>
          </div>
        )}

        {/* Loading */}
        {channelId && isLoading && (
          <div className="glass-card p-8 text-center text-sm text-slate-500">Cargando overlays...</div>
        )}

        {/* Sin overlays */}
        {channelId && !isLoading && overlays.length === 0 && (
          <div className="glass-card p-12 text-center">
            <Layers className="w-10 h-10 text-slate-600 mx-auto mb-3" />
            <h3 className="text-sm font-semibold text-white mb-1">Sin overlays</h3>
            <p className="text-xs text-slate-500 mb-4">
              Agregá un logo, texto, reloj, temperatura o ticker para superponerlos sobre la señal en vivo.
            </p>
            <button
              onClick={handleOpenCreate}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-sm font-semibold text-white transition-colors"
            >
              <Plus className="w-4 h-4" />
              Agregar primer overlay
            </button>
          </div>
        )}

        {/* Grid de overlays */}
        {overlays.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-slate-500">
                {overlays.filter(o => o.enabled).length} activo(s) de {overlays.length}
                {' '}· Se aplican en orden por z-index cuando el canal está en vivo.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {overlays.map(o => (
                <OverlayCard
                  key={o.id}
                  overlay={o}
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
        <OverlayFormModal
          channelId={channelId}
          overlay={editing}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  );
}
