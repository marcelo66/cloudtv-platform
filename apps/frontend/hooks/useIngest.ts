import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/lib/api-client';
import { toast } from 'sonner';

// ─── Types ────────────────────────────────────────────────────

export type IngestType   = 'YOUTUBE' | 'SRT_CALLER' | 'SRT_LISTENER' | 'RTMP_PUSH';
export type IngestStatus = 'IDLE' | 'ACTIVE' | 'ERROR';

export interface IngestSource {
  id:            string;
  channelId:     string;
  name:          string;
  type:          IngestType;
  url:           string;
  srtPort:       number | null;
  srtLatency:    number | null;
  srtPassphrase: string | null;
  srtStreamId:   string | null;
  rtmpPort:      number | null;
  rtmpApp:       string | null;
  rtmpKey:       string | null;
  status:        IngestStatus;
  createdAt:     string;
  updatedAt:     string;
}

export interface CreateIngestInput {
  name:           string;
  type:           IngestType;
  url?:           string;   // YouTube URL / SRT host
  srtPort?:       number;
  srtLatency?:    number;
  srtPassphrase?: string;
  srtStreamId?:   string;   // Stream ID para servidores SRT con enrutamiento
  rtmpPort?:      number;
  rtmpApp?:       string;   // Nombre de app RTMP (default "live")
  rtmpKey?:       string;
}

export interface UpdateIngestInput {
  name?:          string;
  url?:           string;
  srtPort?:       number;
  srtLatency?:    number;
  srtPassphrase?: string;
  srtStreamId?:   string;
  rtmpPort?:      number;
  rtmpApp?:       string;
  rtmpKey?:       string;
}

// ─── Metadata por tipo ────────────────────────────────────────

export const INGEST_TYPE_META: Record<IngestType, {
  label:       string;
  description: string;
  color:       string;
  bg:          string;
  border:      string;
  badge:       string;
}> = {
  YOUTUBE: {
    label:       'YouTube',
    description: 'Señal en vivo desde YouTube. Requiere yt-dlp en el servidor.',
    color:  'text-red-400',
    bg:     'bg-red-500/10',
    border: 'border-red-500/20',
    badge:  'YT',
  },
  SRT_CALLER: {
    label:       'SRT (Conectar)',
    description: 'El servidor se conecta a una fuente SRT remota (encoder o cliente ZeroTier).',
    color:  'text-cyan-400',
    bg:     'bg-cyan-500/10',
    border: 'border-cyan-500/20',
    badge:  'SRT→',
  },
  SRT_LISTENER: {
    label:       'SRT (Escuchar)',
    description: 'El servidor espera que un encoder conecte por SRT.',
    color:  'text-teal-400',
    bg:     'bg-teal-500/10',
    border: 'border-teal-500/20',
    badge:  '←SRT',
  },
  RTMP_PUSH: {
    label:       'RTMP Push',
    description: 'Un encoder (OBS, vMix…) envía señal RTMP al servidor.',
    color:  'text-orange-400',
    bg:     'bg-orange-500/10',
    border: 'border-orange-500/20',
    badge:  'RTMP',
  },
};

// ─── Status metadata ──────────────────────────────────────────

export const INGEST_STATUS_META: Record<IngestStatus, {
  label:  string;
  color:  string;
  dot:    string;
}> = {
  IDLE:   { label: 'Inactiva', color: 'text-slate-400',  dot: 'bg-slate-500'  },
  ACTIVE: { label: 'En vivo',  color: 'text-green-400',  dot: 'bg-green-400'  },
  ERROR:  { label: 'Error',    color: 'text-red-400',    dot: 'bg-red-500'    },
};

// ─── Queries ──────────────────────────────────────────────────

export function useIngestSources(channelId: string | null) {
  return useQuery<IngestSource[]>({
    queryKey: ['ingest', channelId],
    queryFn: async () => {
      const { data } = await apiClient.get(`/channels/${channelId}/ingest`);
      return data;
    },
    enabled: !!channelId,
    refetchInterval: 5_000,
  });
}

// ─── Mutations ────────────────────────────────────────────────

export function useCreateIngest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ channelId, input }: { channelId: string; input: CreateIngestInput }) =>
      apiClient.post(`/channels/${channelId}/ingest`, input),
    onSuccess: (_, { channelId }) => {
      qc.invalidateQueries({ queryKey: ['ingest', channelId] });
      toast.success('Fuente de ingesta creada');
    },
    onError: () => toast.error('Error al crear la fuente'),
  });
}

export function useUpdateIngest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ channelId, id, input }: { channelId: string; id: string; input: UpdateIngestInput }) =>
      apiClient.patch(`/channels/${channelId}/ingest/${id}`, input),
    onSuccess: (_, { channelId }) => {
      qc.invalidateQueries({ queryKey: ['ingest', channelId] });
      toast.success('Fuente actualizada');
    },
    onError: () => toast.error('Error al actualizar la fuente'),
  });
}

export function useDeleteIngest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ channelId, id }: { channelId: string; id: string }) =>
      apiClient.delete(`/channels/${channelId}/ingest/${id}`),
    onSuccess: (_, { channelId }) => {
      qc.invalidateQueries({ queryKey: ['ingest', channelId] });
      toast.success('Fuente eliminada');
    },
    onError: () => toast.error('Error al eliminar la fuente'),
  });
}

export function useActivateIngest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ channelId, ingestId }: { channelId: string; ingestId: string }) =>
      apiClient.post(`/playout/${channelId}/ingest/${ingestId}/activate`),
    onSuccess: (res: any, { channelId }) => {
      qc.invalidateQueries({ queryKey: ['ingest', channelId] });
      qc.invalidateQueries({ queryKey: ['channel', channelId] });
      if (res.data?.success) toast.success(res.data.message ?? 'Ingesta activada');
      else toast.error(res.data?.message ?? 'No se pudo activar la ingesta');
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message ?? 'Error al activar la ingesta';
      toast.error(msg);
    },
  });
}

export function useDeactivateIngest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ channelId }: { channelId: string }) =>
      apiClient.post(`/playout/${channelId}/ingest/deactivate`),
    onSuccess: (res: any, { channelId }) => {
      qc.invalidateQueries({ queryKey: ['ingest', channelId] });
      qc.invalidateQueries({ queryKey: ['channel', channelId] });
      if (res.data?.success) toast.success(res.data.message ?? 'Ingesta desactivada');
      else toast.error(res.data?.message ?? 'No se pudo desactivar');
    },
    onError: () => toast.error('Error al desactivar la ingesta'),
  });
}
