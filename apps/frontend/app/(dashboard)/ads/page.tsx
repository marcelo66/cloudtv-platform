'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import {
  Clapperboard,
  Plus,
  Trash2,
  Edit3,
  Check,
  X,
  ChevronDown,
  ChevronRight,
  GripVertical,
  BarChart3,
  MapPin,
  Film,
  Shuffle,
  ArrowUpDown,
  Weight,
  Clock,
  AlertCircle,
  ToggleLeft,
  ToggleRight,
  Save,
  TrendingUp,
  Users,
  PlaySquare,
  EyeOff,
  Eye,
} from 'lucide-react';
import { Header } from '@/components/dashboard/Header';
import { useChannels } from '@/hooks/useChannels';
import {
  useAdBlocks,
  useCreateAdBlock,
  useUpdateAdBlock,
  useDeleteAdBlock,
  useAddAdSpot,
  useUpdateAdSpot,
  useRemoveAdSpot,
  ROTATION_MODE_LABELS,
  ROTATION_MODE_DESC,
  type AdBlock,
  type AdSpot,
  type RotationMode,
} from '@/hooks/useAdBlocks';
import {
  useCuePoints,
  useCreateCuePoint,
  useUpdateCuePoint,
  useDeleteCuePoint,
  CUE_TYPE_LABELS,
  CUE_TYPE_COLOR,
  type CuePoint,
  type CuePointType,
} from '@/hooks/useCuePoints';
import { useAdReportSummary, useAdImpressions } from '@/hooks/useAdReports';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

// ─── helpers ──────────────────────────────────────────────────

function fmtDuration(sec: number | null | undefined) {
  if (!sec) return '—';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('es-AR', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

const ROTATION_ICONS: Record<RotationMode, React.ElementType> = {
  SEQUENTIAL: ArrowUpDown,
  RANDOM: Shuffle,
  WEIGHTED: Weight,
};

// ─── Page ─────────────────────────────────────────────────────

export default function AdsPage() {
  const { data: channels = [], isLoading: loadingChannels } = useChannels();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showSelector, setShowSelector] = useState(false);
  const [activeTab, setActiveTab] = useState<'blocks' | 'cuepoints' | 'reports'>('blocks');

  useEffect(() => {
    if (channels.length > 0 && !selectedId) setSelectedId(channels[0].id);
  }, [channels, selectedId]);

  if (loadingChannels) {
    return (
      <div className="flex flex-col flex-1">
        <Header title="Publicidad" subtitle="Tandas, cue points e informes" />
        <div className="flex-1 flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-brand-500/30 border-t-brand-500 rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (channels.length === 0) {
    return (
      <div className="flex flex-col flex-1">
        <Header title="Publicidad" subtitle="Tandas, cue points e informes" />
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="glass-card p-16 text-center max-w-sm">
            <Clapperboard className="w-12 h-12 text-slate-600 mx-auto mb-4" />
            <h3 className="text-base font-semibold text-white mb-2">Sin canales</h3>
            <p className="text-sm text-slate-500">Creá un canal primero para gestionar publicidad.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <Header title="Publicidad" subtitle="Tandas, cue points e informes" />

      <div className="flex-1 p-6 overflow-y-auto space-y-5">
        {/* Channel selector + tabs */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          {/* Channel selector */}
          <div className="relative">
            <button
              onClick={() => setShowSelector((v) => !v)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-white/10 bg-surface-700/50 text-sm text-white hover:border-white/20 transition-colors"
            >
              <span className="font-medium">
                {channels.find((c) => c.id === selectedId)?.name ?? 'Seleccionar canal'}
              </span>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
            </button>
            {showSelector && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowSelector(false)} />
                <div className="absolute left-0 top-10 z-20 w-52 rounded-xl border border-white/10 bg-surface-600 shadow-xl overflow-hidden">
                  {channels.map((ch) => (
                    <button
                      key={ch.id}
                      onClick={() => { setSelectedId(ch.id); setShowSelector(false); }}
                      className={cn(
                        'w-full text-left px-3 py-2.5 text-sm hover:bg-white/5 transition-colors',
                        ch.id === selectedId ? 'text-white bg-brand-600/10' : 'text-slate-400',
                      )}
                    >
                      {ch.name}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Tabs */}
          <div className="flex rounded-lg border border-white/10 overflow-hidden">
            {([ ['blocks', Clapperboard, 'Tandas'], ['cuepoints', MapPin, 'Cue Points'], ['reports', BarChart3, 'Reportes'] ] as const).map(([tab, Icon, label]) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={cn(
                  'px-4 py-1.5 text-xs font-medium flex items-center gap-1.5 transition-colors border-l border-white/10 first:border-l-0',
                  activeTab === tab
                    ? 'bg-brand-600/20 text-white'
                    : 'text-slate-400 hover:text-white hover:bg-white/5',
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Tab content */}
        {selectedId && (
          <>
            {activeTab === 'blocks' && <BlocksTab channelId={selectedId} />}
            {activeTab === 'cuepoints' && <CuePointsTab channelId={selectedId} />}
            {activeTab === 'reports' && <ReportsTab channelId={selectedId} />}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Tab: Tandas (Ad Blocks) ──────────────────────────────────

function BlocksTab({ channelId }: { channelId: string }) {
  const { data: blocks = [], isLoading } = useAdBlocks(channelId);
  const [showCreate, setShowCreate] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  if (isLoading) return <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-brand-500/30 border-t-brand-500 rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-400">
          {blocks.length === 0 ? 'Aún no hay tandas' : `${blocks.length} tanda${blocks.length !== 1 ? 's' : ''}`}
        </p>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-brand-600 hover:bg-brand-500 text-white transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Nueva tanda
        </button>
      </div>

      {blocks.length === 0 && (
        <div className="glass-card p-12 text-center">
          <Clapperboard className="w-10 h-10 text-slate-600 mx-auto mb-3" />
          <h3 className="text-sm font-medium text-slate-400 mb-1">Sin tandas publicitarias</h3>
          <p className="text-xs text-slate-600">
            Creá una tanda, agregá spots y luego asignala a los videos mediante Cue Points.
          </p>
        </div>
      )}

      <div className="space-y-3">
        {blocks.map((block) => (
          <AdBlockCard
            key={block.id}
            block={block}
            channelId={channelId}
            isExpanded={expanded === block.id}
            onToggle={() => setExpanded(expanded === block.id ? null : block.id)}
          />
        ))}
      </div>

      {showCreate && (
        <CreateAdBlockModal
          channelId={channelId}
          onClose={() => setShowCreate(false)}
        />
      )}
    </div>
  );
}

// ─── Ad Block Card ────────────────────────────────────────────

function AdBlockCard({
  block,
  channelId,
  isExpanded,
  onToggle,
}: {
  block: AdBlock;
  channelId: string;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(block.name);
  const [editDesc, setEditDesc] = useState(block.description ?? '');
  const [editRotation, setEditRotation] = useState<RotationMode>(block.rotationMode);
  const [showAddSpot, setShowAddSpot] = useState(false);

  const updateBlock = useUpdateAdBlock();
  const deleteBlock = useDeleteAdBlock();
  const addSpot = useAddAdSpot();
  const removeSpot = useRemoveAdSpot();
  const updateSpot = useUpdateAdSpot();

  const RotIcon = ROTATION_ICONS[block.rotationMode];

  const handleSave = () => {
    updateBlock.mutate(
      { channelId, id: block.id, input: { name: editName, description: editDesc, rotationMode: editRotation } },
      { onSuccess: () => setEditing(false) },
    );
  };

  const handleToggleActive = () => {
    updateBlock.mutate({ channelId, id: block.id, input: { isActive: !block.isActive } });
  };

  const handleToggleSuppressOverlays = () => {
    updateBlock.mutate({ channelId, id: block.id, input: { suppressOverlays: !block.suppressOverlays } });
  };

  return (
    <div className={cn('glass-card overflow-hidden transition-all', !block.isActive && 'opacity-60')}>
      {/* Header */}
      <div className="p-4 flex items-center gap-3">
        <button onClick={onToggle} className="text-slate-500 hover:text-white transition-colors">
          {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>

        <div className="flex-1 min-w-0">
          {editing ? (
            <input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="w-full bg-surface-700 border border-white/10 rounded-lg px-2 py-1 text-sm text-white focus:outline-none focus:ring-1 focus:ring-brand-500/50"
              autoFocus
            />
          ) : (
            <p className="text-sm font-semibold text-white truncate">{block.name}</p>
          )}
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <RotIcon className="w-3 h-3 text-slate-500" />
            <span className="text-xs text-slate-500">{ROTATION_MODE_LABELS[block.rotationMode]}</span>
            <span className="text-slate-600">·</span>
            <span className="text-xs text-slate-500">{block.spots.length} spot{block.spots.length !== 1 ? 's' : ''}</span>
            {block._count?.cuePoints ? (
              <>
                <span className="text-slate-600">·</span>
                <span className="text-xs text-slate-500">{block._count.cuePoints} cue point{block._count.cuePoints !== 1 ? 's' : ''}</span>
              </>
            ) : null}
            {block.suppressOverlays && (
              <span className="flex items-center gap-1 text-[10px] text-amber-400/80 font-medium">
                <EyeOff className="w-2.5 h-2.5" />
                sin overlays
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1">
          {/* Suppress overlays toggle */}
          <button
            onClick={handleToggleSuppressOverlays}
            title={block.suppressOverlays
              ? 'Logo/hora se ocultan durante esta tanda (click para desactivar)'
              : 'Overlays visibles durante esta tanda (click para ocultar)'}
            className={cn(
              'p-1.5 rounded transition-colors',
              block.suppressOverlays
                ? 'text-amber-400 hover:text-amber-300'
                : 'text-slate-600 hover:text-slate-400',
            )}
          >
            {block.suppressOverlays ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>

          {/* Active toggle */}
          <button
            onClick={handleToggleActive}
            title={block.isActive ? 'Desactivar tanda' : 'Activar tanda'}
            className="p-1.5 rounded text-slate-500 hover:text-white transition-colors"
          >
            {block.isActive
              ? <ToggleRight className="w-4 h-4 text-green-400" />
              : <ToggleLeft className="w-4 h-4" />}
          </button>

          {editing ? (
            <>
              <button onClick={handleSave} className="p-1.5 rounded text-green-400 hover:text-green-300 transition-colors">
                <Save className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => { setEditing(false); setEditName(block.name); setEditDesc(block.description ?? ''); setEditRotation(block.rotationMode); }}
                className="p-1.5 rounded text-slate-500 hover:text-white transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </>
          ) : (
            <button onClick={() => setEditing(true)} className="p-1.5 rounded text-slate-500 hover:text-white transition-colors">
              <Edit3 className="w-3.5 h-3.5" />
            </button>
          )}

          <button
            onClick={() => {
              if (confirm(`¿Eliminar la tanda "${block.name}"? Se eliminarán todos sus spots y cue points.`)) {
                deleteBlock.mutate({ channelId, id: block.id });
              }
            }}
            className="p-1.5 rounded text-slate-500 hover:text-red-400 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Expanded: edit + spots */}
      {isExpanded && (
        <div className="border-t border-white/5 p-4 space-y-4">
          {/* Rotation mode picker (when editing) */}
          {editing && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-slate-400">Modo de rotación</p>
              <div className="grid grid-cols-3 gap-2">
                {(['SEQUENTIAL', 'RANDOM', 'WEIGHTED'] as RotationMode[]).map((mode) => {
                  const Icon = ROTATION_ICONS[mode];
                  return (
                    <button
                      key={mode}
                      onClick={() => setEditRotation(mode)}
                      className={cn(
                        'flex flex-col items-center gap-1.5 p-3 rounded-xl border text-xs transition-all',
                        editRotation === mode
                          ? 'border-brand-500/50 bg-brand-500/10 text-white'
                          : 'border-white/10 text-slate-500 hover:text-white hover:border-white/20',
                      )}
                    >
                      <Icon className="w-4 h-4" />
                      <span className="font-medium">{ROTATION_MODE_LABELS[mode]}</span>
                      <span className="text-center text-[10px] leading-tight opacity-70">{ROTATION_MODE_DESC[mode]}</span>
                    </button>
                  );
                })}
              </div>
              <div>
                <label className="text-xs text-slate-500 mb-1 block">Descripción (opcional)</label>
                <input
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  placeholder="Descripción de la tanda..."
                  className="w-full bg-surface-700 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-brand-500/50"
                />
              </div>
            </div>
          )}

          {/* Spots list */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Spots</p>
              <button
                onClick={() => setShowAddSpot(true)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs text-brand-400 border border-brand-500/30 hover:bg-brand-500/10 transition-colors"
              >
                <Plus className="w-3 h-3" />
                Agregar spot
              </button>
            </div>

            {block.spots.length === 0 ? (
              <p className="text-xs text-slate-600 py-3 text-center">Sin spots — agregá videos de tu biblioteca</p>
            ) : (
              <div className="space-y-2">
                {block.spots.map((spot, idx) => (
                  <SpotRow
                    key={spot.id}
                    spot={spot}
                    index={idx}
                    channelId={channelId}
                    adBlockId={block.id}
                    rotationMode={block.rotationMode}
                    onRemove={() => removeSpot.mutate({ channelId, adBlockId: block.id, spotId: spot.id })}
                    onToggle={() => updateSpot.mutate({ channelId, adBlockId: block.id, spotId: spot.id, input: { isActive: !spot.isActive } })}
                    onWeightChange={(w) => updateSpot.mutate({ channelId, adBlockId: block.id, spotId: spot.id, input: { weight: w } })}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {showAddSpot && (
        <AddSpotModal
          channelId={channelId}
          adBlockId={block.id}
          onClose={() => setShowAddSpot(false)}
        />
      )}
    </div>
  );
}

// ─── Spot Row ─────────────────────────────────────────────────

function SpotRow({
  spot,
  index,
  channelId,
  adBlockId,
  rotationMode,
  onRemove,
  onToggle,
  onWeightChange,
}: {
  spot: AdSpot;
  index: number;
  channelId: string;
  adBlockId: string;
  rotationMode: RotationMode;
  onRemove: () => void;
  onToggle: () => void;
  onWeightChange: (w: number) => void;
}) {
  return (
    <div className={cn('flex items-center gap-3 px-3 py-2.5 rounded-xl bg-surface-700/40 border border-white/5', !spot.isActive && 'opacity-50')}>
      <GripVertical className="w-3.5 h-3.5 text-slate-600 flex-shrink-0" />
      <span className="text-xs text-slate-600 w-4 flex-shrink-0">{index + 1}</span>

      {spot.video.thumbnailUrl ? (
        <div className="relative w-10 h-6 rounded overflow-hidden bg-surface-800 flex-shrink-0">
          <Image src={spot.video.thumbnailUrl} alt="" fill className="object-cover" sizes="40px" />
        </div>
      ) : (
        <div className="w-10 h-6 rounded bg-surface-800 flex items-center justify-center flex-shrink-0">
          <Film className="w-3 h-3 text-slate-600" />
        </div>
      )}

      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-white truncate">{spot.name}</p>
        <p className="text-[11px] text-slate-500 truncate">{spot.advertiser} · {fmtDuration(spot.video.duration)}</p>
      </div>

      {/* Weight (only in WEIGHTED mode) */}
      {rotationMode === 'WEIGHTED' && (
        <div className="flex items-center gap-1 flex-shrink-0">
          <Weight className="w-3 h-3 text-slate-500" />
          <input
            type="number"
            min={1}
            max={99}
            value={spot.weight}
            onChange={(e) => onWeightChange(Math.max(1, parseInt(e.target.value, 10) || 1))}
            className="w-10 bg-surface-800 border border-white/10 rounded px-1.5 py-0.5 text-xs text-white text-center focus:outline-none focus:ring-1 focus:ring-brand-500/50"
          />
        </div>
      )}

      <button onClick={onToggle} title={spot.isActive ? 'Desactivar' : 'Activar'}
        className="p-1 rounded text-slate-500 hover:text-white transition-colors flex-shrink-0">
        {spot.isActive ? <ToggleRight className="w-3.5 h-3.5 text-green-400" /> : <ToggleLeft className="w-3.5 h-3.5" />}
      </button>

      <button onClick={onRemove}
        className="p-1 rounded text-slate-500 hover:text-red-400 transition-colors flex-shrink-0">
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ─── Tab: Cue Points ──────────────────────────────────────────

function CuePointsTab({ channelId }: { channelId: string }) {
  const { data: cuePoints = [], isLoading } = useCuePoints(channelId);
  const { data: blocks = [] } = useAdBlocks(channelId);
  const [showCreate, setShowCreate] = useState(false);
  const deleteCp = useDeleteCuePoint();
  const updateCp = useUpdateCuePoint();

  if (isLoading) return <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-brand-500/30 border-t-brand-500 rounded-full animate-spin" /></div>;

  // Agrupar por video
  const byVideo = cuePoints.reduce<Record<string, CuePoint[]>>((acc, cp) => {
    (acc[cp.videoId] ??= []).push(cp);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-400">
          {cuePoints.length === 0 ? 'Sin cue points' : `${cuePoints.length} cue point${cuePoints.length !== 1 ? 's' : ''} en ${Object.keys(byVideo).length} video${Object.keys(byVideo).length !== 1 ? 's' : ''}`}
        </p>
        <button
          onClick={() => setShowCreate(true)}
          disabled={blocks.length === 0}
          title={blocks.length === 0 ? 'Creá una tanda primero' : ''}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-brand-600 hover:bg-brand-500 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Plus className="w-3.5 h-3.5" />
          Nuevo cue point
        </button>
      </div>

      {blocks.length === 0 && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-yellow-500/5 border border-yellow-500/20">
          <AlertCircle className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-yellow-300">Primero creá al menos una tanda con spots para asignar cue points.</p>
        </div>
      )}

      {cuePoints.length === 0 && blocks.length > 0 && (
        <div className="glass-card p-12 text-center">
          <MapPin className="w-10 h-10 text-slate-600 mx-auto mb-3" />
          <h3 className="text-sm font-medium text-slate-400 mb-1">Sin cue points</h3>
          <p className="text-xs text-slate-600">
            Un cue point define <strong className="text-slate-400">dónde</strong> entra la publicidad:<br />
            antes, durante o después de cada video.
          </p>
        </div>
      )}

      {/* Agrupado por video */}
      {Object.entries(byVideo).map(([videoId, cps]) => {
        const video = cps[0].video;
        return (
          <div key={videoId} className="glass-card overflow-hidden">
            <div className="px-4 py-3 border-b border-white/5 flex items-center gap-3">
              <Film className="w-4 h-4 text-slate-500 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-white truncate">{video.title}</p>
                <p className="text-xs text-slate-500">{fmtDuration(video.duration)}</p>
              </div>
              <span className="text-xs text-slate-500 flex-shrink-0">{cps.length} cue point{cps.length !== 1 ? 's' : ''}</span>
            </div>
            <div className="divide-y divide-white/5">
              {cps.map((cp) => (
                <CuePointRow
                  key={cp.id}
                  cp={cp}
                  channelId={channelId}
                  onDelete={() => deleteCp.mutate({ channelId, id: cp.id })}
                  onToggle={() => updateCp.mutate({ channelId, id: cp.id, input: { isActive: !cp.isActive } })}
                />
              ))}
            </div>
          </div>
        );
      })}

      {showCreate && (
        <CreateCuePointModal
          channelId={channelId}
          onClose={() => setShowCreate(false)}
        />
      )}
    </div>
  );
}

function CuePointRow({ cp, channelId, onDelete, onToggle }: {
  cp: CuePoint;
  channelId: string;
  onDelete: () => void;
  onToggle: () => void;
}) {
  const colorCls = CUE_TYPE_COLOR[cp.type];
  return (
    <div className={cn('flex items-center gap-3 px-4 py-3', !cp.isActive && 'opacity-50')}>
      <span className={cn('text-[11px] font-bold px-2 py-0.5 rounded-full border flex-shrink-0', colorCls)}>
        {CUE_TYPE_LABELS[cp.type]}
      </span>

      {cp.type === 'MID_ROLL' && cp.timeOffset != null && (
        <div className="flex items-center gap-1 text-xs text-slate-400 flex-shrink-0">
          <Clock className="w-3 h-3" />
          <span className="font-mono">{fmtDuration(cp.timeOffset)}</span>
        </div>
      )}

      <div className="flex-1 min-w-0">
        <p className="text-xs text-white truncate">{cp.adBlock.name}</p>
        {cp.label && <p className="text-[11px] text-slate-500 truncate">{cp.label}</p>}
      </div>

      <div className={cn('text-[11px] px-1.5 py-0.5 rounded border flex-shrink-0',
        cp.adBlock.isActive ? 'text-green-400 bg-green-500/10 border-green-500/20' : 'text-slate-500 bg-surface-700/50 border-white/10')}>
        {cp.adBlock.isActive ? 'Activa' : 'Inactiva'}
      </div>

      <button onClick={onToggle} className="p-1 text-slate-500 hover:text-white transition-colors flex-shrink-0">
        {cp.isActive ? <ToggleRight className="w-4 h-4 text-green-400" /> : <ToggleLeft className="w-4 h-4" />}
      </button>

      <button onClick={onDelete} className="p-1 text-slate-500 hover:text-red-400 transition-colors flex-shrink-0">
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ─── Tab: Reports ─────────────────────────────────────────────

function ReportsTab({ channelId }: { channelId: string }) {
  const [from, setFrom] = useState('');
  const [to, setTo]   = useState('');
  const { data: summary, isLoading } = useAdReportSummary(channelId, from || undefined, to || undefined);

  const CUE_LABEL: Record<string, string> = { PRE_ROLL: 'Pre-roll', MID_ROLL: 'Mid-roll', POST_ROLL: 'Post-roll' };

  return (
    <div className="space-y-5">
      {/* Date range filter */}
      <div className="flex items-center gap-3 flex-wrap">
        <p className="text-xs text-slate-500">Período:</p>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
          className="bg-surface-700 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-brand-500/50" />
        <span className="text-slate-600 text-xs">→</span>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
          className="bg-surface-700 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-brand-500/50" />
        {(from || to) && (
          <button onClick={() => { setFrom(''); setTo(''); }} className="text-xs text-slate-500 hover:text-white transition-colors">
            Limpiar
          </button>
        )}
      </div>

      {isLoading && (
        <div className="flex justify-center py-12">
          <div className="w-6 h-6 border-2 border-brand-500/30 border-t-brand-500 rounded-full animate-spin" />
        </div>
      )}

      {summary && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard icon={PlaySquare} label="Total impresiones" value={String(summary.totalImpressions)} />
            <StatCard icon={Users} label="Anunciantes únicos" value={String(summary.byAdvertiser.length)} />
            <StatCard
              icon={TrendingUp}
              label="Top anunciante"
              value={summary.byAdvertiser[0]?.advertiser ?? '—'}
              sub={summary.byAdvertiser[0] ? `${summary.byAdvertiser[0].impressions} imp.` : ''}
            />
            <StatCard
              icon={BarChart3}
              label="Tipo más frecuente"
              value={summary.byType[0] ? CUE_LABEL[summary.byType[0].type] ?? summary.byType[0].type : '—'}
              sub={summary.byType[0] ? `${summary.byType[0].impressions} imp.` : ''}
            />
          </div>

          {/* By advertiser */}
          {summary.byAdvertiser.length > 0 && (
            <div className="glass-card p-4 space-y-3">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Por anunciante</h3>
              <div className="space-y-2">
                {summary.byAdvertiser.map((a) => {
                  const pct = summary.totalImpressions > 0 ? (a.impressions / summary.totalImpressions) * 100 : 0;
                  return (
                    <div key={a.advertiser} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-white font-medium">{a.advertiser}</span>
                        <span className="text-slate-400">{a.impressions} imp. · {Math.round(a.totalDuration / 60)}min</span>
                      </div>
                      <div className="h-1.5 bg-surface-700 rounded-full overflow-hidden">
                        <div className="h-full bg-brand-500 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* By block */}
          {summary.byBlock.length > 0 && (
            <div className="glass-card p-4 space-y-3">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Por tanda</h3>
              <div className="divide-y divide-white/5">
                {summary.byBlock.map((b) => (
                  <div key={b.adBlockId} className="flex items-center justify-between py-2.5 text-xs">
                    <span className="text-white">{b.name}</span>
                    <span className="text-slate-400">{b.impressions} impresiones</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent impressions */}
          {summary.recentImpressions.length > 0 && (
            <div className="glass-card p-4 space-y-3">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Últimas impresiones</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-slate-500 border-b border-white/5">
                      <th className="pb-2 font-medium">Fecha</th>
                      <th className="pb-2 font-medium">Spot</th>
                      <th className="pb-2 font-medium">Anunciante</th>
                      <th className="pb-2 font-medium">Tanda</th>
                      <th className="pb-2 font-medium">Tipo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {summary.recentImpressions.map((imp) => (
                      <tr key={imp.id} className="text-slate-400">
                        <td className="py-2 pr-4 font-mono whitespace-nowrap">{fmtDate(imp.scheduledAt)}</td>
                        <td className="py-2 pr-4 text-white truncate max-w-[140px]">{imp.adSpot.name}</td>
                        <td className="py-2 pr-4">{imp.adSpot.advertiser}</td>
                        <td className="py-2 pr-4">{imp.adBlock.name}</td>
                        <td className="py-2">
                          <span className={cn('px-1.5 py-0.5 rounded border text-[11px]', CUE_TYPE_COLOR[imp.type as CuePointType])}>
                            {CUE_LABEL[imp.type] ?? imp.type}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {summary.totalImpressions === 0 && (
            <div className="glass-card p-12 text-center">
              <BarChart3 className="w-10 h-10 text-slate-600 mx-auto mb-3" />
              <p className="text-sm text-slate-500">Sin impresiones para el período seleccionado</p>
              <p className="text-xs text-slate-600 mt-1">Las impresiones se registran cuando el canal inicia con cue points activos</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function StatCard({ icon: Icon, label, value, sub }: { icon: React.ElementType; label: string; value: string; sub?: string }) {
  return (
    <div className="glass-card p-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-3.5 h-3.5 text-slate-500" />
        <span className="text-xs text-slate-500">{label}</span>
      </div>
      <p className="text-lg font-bold text-white truncate">{value}</p>
      {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
    </div>
  );
}

// ─── Modals ───────────────────────────────────────────────────

function CreateAdBlockModal({ channelId, onClose }: { channelId: string; onClose: () => void }) {
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [rotation, setRotation] = useState<RotationMode>('SEQUENTIAL');
  const createBlock = useCreateAdBlock();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    createBlock.mutate(
      { channelId, input: { name: name.trim(), description: desc.trim() || undefined, rotationMode: rotation } },
      { onSuccess: onClose },
    );
  };

  return (
    <Modal title="Nueva tanda publicitaria" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="text-xs text-slate-400 mb-1.5 block">Nombre *</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ej: Tanda Hora Pico"
            required
            className="w-full bg-surface-700 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-brand-500/50"
          />
        </div>
        <div>
          <label className="text-xs text-slate-400 mb-1.5 block">Descripción</label>
          <input
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="Descripción opcional..."
            className="w-full bg-surface-700 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-brand-500/50"
          />
        </div>
        <div>
          <label className="text-xs text-slate-400 mb-2 block">Modo de rotación</label>
          <div className="grid grid-cols-3 gap-2">
            {(['SEQUENTIAL', 'RANDOM', 'WEIGHTED'] as RotationMode[]).map((mode) => {
              const Icon = ROTATION_ICONS[mode];
              return (
                <button type="button" key={mode} onClick={() => setRotation(mode)}
                  className={cn(
                    'flex flex-col items-center gap-1.5 p-3 rounded-xl border text-xs transition-all',
                    rotation === mode
                      ? 'border-brand-500/50 bg-brand-500/10 text-white'
                      : 'border-white/10 text-slate-500 hover:text-white hover:border-white/20',
                  )}
                >
                  <Icon className="w-4 h-4" />
                  <span className="font-medium">{ROTATION_MODE_LABELS[mode]}</span>
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-slate-500 mt-2">{ROTATION_MODE_DESC[rotation]}</p>
        </div>
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onClose} className="flex-1 py-2 rounded-lg text-sm text-slate-400 border border-white/10 hover:text-white hover:border-white/20 transition-colors">Cancelar</button>
          <button type="submit" disabled={!name.trim() || createBlock.isPending}
            className="flex-1 py-2 rounded-lg text-sm font-medium bg-brand-600 hover:bg-brand-500 text-white transition-colors disabled:opacity-50">
            {createBlock.isPending ? 'Creando...' : 'Crear tanda'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function AddSpotModal({ channelId, adBlockId, onClose }: { channelId: string; adBlockId: string; onClose: () => void }) {
  const [videoId, setVideoId] = useState('');
  const [name, setName] = useState('');
  const [advertiser, setAdvertiser] = useState('');
  const [weight, setWeight] = useState(1);
  const addSpot = useAddAdSpot();

  // Cargar videos READY del canal
  const [videos, setVideos] = useState<any[]>([]);
  useEffect(() => {
    import('@/lib/api-client').then(({ default: api }) => {
      api.get(`/videos?channelId=${channelId}`).then(({ data }) => {
        const all = Array.isArray(data) ? data : data.items ?? [];
        setVideos(all.filter((v: any) => v.status === 'READY'));
      }).catch(() => {});
    });
  }, [channelId]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!videoId || !name.trim() || !advertiser.trim()) return;
    addSpot.mutate(
      { channelId, adBlockId, input: { videoId, name: name.trim(), advertiser: advertiser.trim(), weight } },
      { onSuccess: onClose },
    );
  };

  return (
    <Modal title="Agregar spot" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="text-xs text-slate-400 mb-1.5 block">Video (spot) *</label>
          <select
            value={videoId}
            onChange={(e) => {
              setVideoId(e.target.value);
              if (!name) {
                const v = videos.find((v) => v.id === e.target.value);
                if (v) setName(v.title);
              }
            }}
            required
            className="w-full bg-surface-700 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-brand-500/50"
          >
            <option value="">Seleccioná un video...</option>
            {videos.map((v) => (
              <option key={v.id} value={v.id}>
                {v.title} ({fmtDuration(v.duration)})
              </option>
            ))}
          </select>
          {videos.length === 0 && (
            <p className="text-[11px] text-slate-500 mt-1">No hay videos READY en este canal.</p>
          )}
        </div>
        <div>
          <label className="text-xs text-slate-400 mb-1.5 block">Nombre del spot *</label>
          <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Nombre descriptivo"
            className="w-full bg-surface-700 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-brand-500/50" />
        </div>
        <div>
          <label className="text-xs text-slate-400 mb-1.5 block">Anunciante *</label>
          <input value={advertiser} onChange={(e) => setAdvertiser(e.target.value)} required placeholder="Nombre del anunciante"
            className="w-full bg-surface-700 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-brand-500/50" />
        </div>
        <div>
          <label className="text-xs text-slate-400 mb-1.5 block">Peso (para rotación ponderada)</label>
          <div className="flex items-center gap-3">
            <input type="range" min={1} max={10} value={weight} onChange={(e) => setWeight(parseInt(e.target.value, 10))}
              className="flex-1 accent-brand-500" />
            <span className="w-8 text-center text-sm font-bold text-white">{weight}</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">Mayor peso = mayor frecuencia en modo Ponderado</p>
        </div>
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onClose} className="flex-1 py-2 rounded-lg text-sm text-slate-400 border border-white/10 hover:text-white hover:border-white/20 transition-colors">Cancelar</button>
          <button type="submit" disabled={!videoId || !name.trim() || !advertiser.trim() || addSpot.isPending}
            className="flex-1 py-2 rounded-lg text-sm font-medium bg-brand-600 hover:bg-brand-500 text-white transition-colors disabled:opacity-50">
            {addSpot.isPending ? 'Agregando...' : 'Agregar spot'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function CreateCuePointModal({ channelId, onClose }: { channelId: string; onClose: () => void }) {
  const { data: blocks = [] } = useAdBlocks(channelId);
  const [videoId, setVideoId] = useState('');
  const [adBlockId, setAdBlockId] = useState('');
  const [type, setType] = useState<CuePointType>('PRE_ROLL');
  const [timeOffset, setTimeOffset] = useState('');
  const [label, setLabel] = useState('');
  const [videos, setVideos] = useState<any[]>([]);
  const createCp = useCreateCuePoint();

  useEffect(() => {
    import('@/lib/api-client').then(({ default: api }) => {
      api.get(`/videos?channelId=${channelId}`).then(({ data }) => {
        const all = Array.isArray(data) ? data : data.items ?? [];
        setVideos(all.filter((v: any) => v.status === 'READY'));
      }).catch(() => {});
    });
  }, [channelId]);

  const selectedVideo = videos.find((v) => v.id === videoId);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!videoId || !adBlockId) return;
    const offset = type === 'MID_ROLL' ? parseFloat(timeOffset) : undefined;
    createCp.mutate(
      { channelId, input: { videoId, adBlockId, type, timeOffset: offset, label: label.trim() || undefined } },
      { onSuccess: onClose },
    );
  };

  return (
    <Modal title="Nuevo cue point" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="text-xs text-slate-400 mb-1.5 block">Video *</label>
          <select value={videoId} onChange={(e) => setVideoId(e.target.value)} required
            className="w-full bg-surface-700 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-brand-500/50">
            <option value="">Seleccioná un video...</option>
            {videos.map((v) => (
              <option key={v.id} value={v.id}>{v.title} ({fmtDuration(v.duration)})</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-xs text-slate-400 mb-2 block">Tipo de inserción *</label>
          <div className="grid grid-cols-3 gap-2">
            {(['PRE_ROLL', 'MID_ROLL', 'POST_ROLL'] as CuePointType[]).map((t) => (
              <button type="button" key={t} onClick={() => setType(t)}
                className={cn(
                  'py-2 rounded-xl border text-xs font-medium transition-all',
                  type === t ? cn(CUE_TYPE_COLOR[t], 'ring-1') : 'border-white/10 text-slate-500 hover:text-white hover:border-white/20',
                )}>
                <div>{CUE_TYPE_LABELS[t]}</div>
              </button>
            ))}
          </div>
        </div>

        {type === 'MID_ROLL' && (
          <div>
            <label className="text-xs text-slate-400 mb-1.5 block">
              Tiempo de inserción (segundos) *
              {selectedVideo?.duration && (
                <span className="text-slate-600 ml-2">
                  duración del video: {fmtDuration(selectedVideo.duration)}
                </span>
              )}
            </label>
            <input
              type="number"
              value={timeOffset}
              onChange={(e) => setTimeOffset(e.target.value)}
              min="1"
              max={selectedVideo?.duration ? String(Math.floor(selectedVideo.duration - 1)) : undefined}
              step="1"
              placeholder="ej: 120 (= 2:00)"
              required
              className="w-full bg-surface-700 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-brand-500/50"
            />
            <p className="text-[11px] text-slate-500 mt-1">
              {timeOffset ? `La tanda entrará a los ${fmtDuration(parseFloat(timeOffset))} del video` : ''}
            </p>
          </div>
        )}

        <div>
          <label className="text-xs text-slate-400 mb-1.5 block">Tanda publicitaria *</label>
          <select value={adBlockId} onChange={(e) => setAdBlockId(e.target.value)} required
            className="w-full bg-surface-700 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-brand-500/50">
            <option value="">Seleccioná una tanda...</option>
            {blocks.filter((b) => b.isActive).map((b) => (
              <option key={b.id} value={b.id}>{b.name} ({b.spots.length} spots)</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-xs text-slate-400 mb-1.5 block">Etiqueta (opcional)</label>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="ej: Publicidad apertura"
            className="w-full bg-surface-700 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-brand-500/50" />
        </div>

        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onClose} className="flex-1 py-2 rounded-lg text-sm text-slate-400 border border-white/10 hover:text-white hover:border-white/20 transition-colors">Cancelar</button>
          <button type="submit"
            disabled={!videoId || !adBlockId || (type === 'MID_ROLL' && !timeOffset) || createCp.isPending}
            className="flex-1 py-2 rounded-lg text-sm font-medium bg-brand-600 hover:bg-brand-500 text-white transition-colors disabled:opacity-50">
            {createCp.isPending ? 'Creando...' : 'Crear cue point'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Reusable Modal wrapper ───────────────────────────────────

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-surface-800 border border-white/10 rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-surface-800 px-6 py-4 border-b border-white/10 flex items-center justify-between">
          <h3 className="text-base font-semibold text-white">{title}</h3>
          <button onClick={onClose} className="p-1 rounded text-slate-500 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}
