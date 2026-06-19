import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/lib/api-client';
import { toast } from 'sonner';

export type Platform = 'YOUTUBE' | 'FACEBOOK' | 'TWITCH' | 'RTMP_CUSTOM' | 'SRT_CALLER' | 'SRT_LISTENER';
export type OutputStatus = 'IDLE' | 'STREAMING' | 'ERROR';

export interface StreamOutput {
  id:        string;
  channelId: string;
  name:      string;
  platform:  Platform;
  rtmpUrl:   string;
  streamKey: string;
  enabled:   boolean;
  status:    OutputStatus;
  // SRT
  srtPort?:       number | null;
  srtLatency?:    number | null;
  srtPassphrase?: string | null;
  // Calidad por salida
  customBitrate?: number | null;
  customQuality?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateOutputInput {
  name:         string;
  platform:     Platform;
  // RTMP: URL base. SRT_CALLER: host/IP destino. SRT_LISTENER: no aplica.
  rtmpUrl?:     string;
  // RTMP: stream key. SRT: no aplica.
  streamKey?:   string;
  enabled?:     boolean;
  // SRT
  srtPort?:     number;
  srtLatency?:  number;
  srtPassphrase?: string;
  // Calidad por salida
  customBitrate?: number | null;
  customQuality?: string | null;
}

export interface UpdateOutputInput {
  name?:        string;
  rtmpUrl?:     string;
  streamKey?:   string;
  enabled?:     boolean;
  srtPort?:     number;
  srtLatency?:  number;
  srtPassphrase?: string;
  customBitrate?: number | null;
  customQuality?: string | null;
}

// ─── Platform metadata ────────────────────────────────────────

export const PLATFORM_META: Record<Platform, {
  label:          string;
  defaultRtmpUrl: string;
  color:          string;
  bg:             string;
  border:         string;
  badge:          string;
  isSrt?:         boolean;
}> = {
  YOUTUBE: {
    label:          'YouTube',
    defaultRtmpUrl: 'rtmp://a.rtmp.youtube.com/live2',
    color:  'text-red-400',
    bg:     'bg-red-500/10',
    border: 'border-red-500/20',
    badge:  'YT',
  },
  FACEBOOK: {
    label:          'Facebook',
    defaultRtmpUrl: 'rtmps://live-api-s.facebook.com:443/rtmp',
    color:  'text-blue-400',
    bg:     'bg-blue-500/10',
    border: 'border-blue-500/20',
    badge:  'FB',
  },
  TWITCH: {
    label:          'Twitch',
    defaultRtmpUrl: 'rtmp://live.twitch.tv/app',
    color:  'text-purple-400',
    bg:     'bg-purple-500/10',
    border: 'border-purple-500/20',
    badge:  'TW',
  },
  RTMP_CUSTOM: {
    label:          'RTMP Custom',
    defaultRtmpUrl: '',
    color:  'text-slate-300',
    bg:     'bg-slate-500/10',
    border: 'border-slate-500/20',
    badge:  'RTMP',
  },
  SRT_CALLER: {
    label:          'SRT (Enviar)',
    defaultRtmpUrl: '',
    color:  'text-cyan-400',
    bg:     'bg-cyan-500/10',
    border: 'border-cyan-500/20',
    badge:  'SRT→',
    isSrt:  true,
  },
  SRT_LISTENER: {
    label:          'SRT (Recibir)',
    defaultRtmpUrl: '',
    color:  'text-teal-400',
    bg:     'bg-teal-500/10',
    border: 'border-teal-500/20',
    badge:  '←SRT',
    isSrt:  true,
  },
};

// ─── Queries ──────────────────────────────────────────────────

export function useStreamOutputs(channelId: string | null) {
  return useQuery<StreamOutput[]>({
    queryKey: ['stream-outputs', channelId],
    queryFn: async () => {
      const { data } = await apiClient.get(`/channels/${channelId}/outputs`);
      return data;
    },
    enabled: !!channelId,
    refetchInterval: 5000,
  });
}

// ─── Mutations ────────────────────────────────────────────────

export function useCreateOutput() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ channelId, input }: { channelId: string; input: CreateOutputInput }) =>
      apiClient.post(`/channels/${channelId}/outputs`, input),
    onSuccess: (_, { channelId }) => {
      qc.invalidateQueries({ queryKey: ['stream-outputs', channelId] });
      toast.success('Salida creada');
    },
    onError: () => toast.error('Error al crear la salida'),
  });
}

export function useUpdateOutput() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      channelId,
      id,
      input,
    }: {
      channelId: string;
      id: string;
      input: UpdateOutputInput;
    }) => apiClient.patch(`/channels/${channelId}/outputs/${id}`, input),
    onSuccess: (_, { channelId }) => {
      qc.invalidateQueries({ queryKey: ['stream-outputs', channelId] });
      toast.success('Salida actualizada');
    },
    onError: () => toast.error('Error al actualizar la salida'),
  });
}

export function useDeleteOutput() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ channelId, id }: { channelId: string; id: string }) =>
      apiClient.delete(`/channels/${channelId}/outputs/${id}`),
    onSuccess: (_, { channelId }) => {
      qc.invalidateQueries({ queryKey: ['stream-outputs', channelId] });
      toast.success('Salida eliminada');
    },
    onError: () => toast.error('Error al eliminar la salida'),
  });
}

export function useStartOutput() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ channelId, id }: { channelId: string; id: string }) =>
      apiClient.post(`/playout/${channelId}/outputs/${id}/start`),
    onSuccess: (res: any, { channelId }) => {
      qc.invalidateQueries({ queryKey: ['stream-outputs', channelId] });
      if (res.data?.success) toast.success(res.data.message ?? 'Salida iniciada');
      else toast.error(res.data?.message ?? 'No se pudo iniciar la salida');
    },
    onError: () => toast.error('Error al iniciar la salida'),
  });
}

export function useStopOutput() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ channelId, id }: { channelId: string; id: string }) =>
      apiClient.post(`/playout/${channelId}/outputs/${id}/stop`),
    onSuccess: (_, { channelId }) => {
      qc.invalidateQueries({ queryKey: ['stream-outputs', channelId] });
      toast.success('Salida detenida');
    },
    onError: () => toast.error('Error al detener la salida'),
  });
}
