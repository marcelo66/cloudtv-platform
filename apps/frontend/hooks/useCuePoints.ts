import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/lib/api-client';
import { toast } from 'sonner';

export type CuePointType = 'PRE_ROLL' | 'MID_ROLL' | 'POST_ROLL';

export interface CuePoint {
  id: string;
  channelId: string;
  videoId: string;
  adBlockId: string;
  type: CuePointType;
  timeOffset: number | null;
  label: string | null;
  isActive: boolean;
  createdAt: string;
  video: { id: string; title: string; duration: number | null; thumbnailUrl?: string };
  adBlock: { id: string; name: string; rotationMode: string; isActive: boolean };
}

export interface CreateCuePointInput {
  videoId: string;
  adBlockId: string;
  type: CuePointType;
  timeOffset?: number;
  label?: string;
}

export interface UpdateCuePointInput {
  adBlockId?: string;
  type?: CuePointType;
  timeOffset?: number;
  label?: string;
  isActive?: boolean;
}

export const CUE_TYPE_LABELS: Record<CuePointType, string> = {
  PRE_ROLL:  'Pre-roll',
  MID_ROLL:  'Mid-roll',
  POST_ROLL: 'Post-roll',
};

export const CUE_TYPE_DESC: Record<CuePointType, string> = {
  PRE_ROLL:  'Antes del video',
  MID_ROLL:  'En un punto específico dentro del video',
  POST_ROLL: 'Después del video',
};

export const CUE_TYPE_COLOR: Record<CuePointType, string> = {
  PRE_ROLL:  'text-blue-400 bg-blue-500/10 border-blue-500/20',
  MID_ROLL:  'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
  POST_ROLL: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
};

// ─── Queries ──────────────────────────────────────────────────

export function useCuePoints(channelId: string | null) {
  return useQuery<CuePoint[]>({
    queryKey: ['cue-points', channelId],
    queryFn: async () => {
      const { data } = await apiClient.get(`/channels/${channelId}/cue-points`);
      return data;
    },
    enabled: !!channelId,
  });
}

// ─── Mutations ────────────────────────────────────────────────

export function useCreateCuePoint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ channelId, input }: { channelId: string; input: CreateCuePointInput }) =>
      apiClient.post(`/channels/${channelId}/cue-points`, input),
    onSuccess: (_, { channelId }) => {
      qc.invalidateQueries({ queryKey: ['cue-points', channelId] });
      toast.success('Cue point creado');
    },
    onError: (err: any) => toast.error(err?.response?.data?.message ?? 'Error al crear el cue point'),
  });
}

export function useUpdateCuePoint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ channelId, id, input }: { channelId: string; id: string; input: UpdateCuePointInput }) =>
      apiClient.patch(`/channels/${channelId}/cue-points/${id}`, input),
    onSuccess: (_, { channelId }) => {
      qc.invalidateQueries({ queryKey: ['cue-points', channelId] });
      toast.success('Cue point actualizado');
    },
    onError: (err: any) => toast.error(err?.response?.data?.message ?? 'Error al actualizar'),
  });
}

export function useDeleteCuePoint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ channelId, id }: { channelId: string; id: string }) =>
      apiClient.delete(`/channels/${channelId}/cue-points/${id}`),
    onSuccess: (_, { channelId }) => {
      qc.invalidateQueries({ queryKey: ['cue-points', channelId] });
      toast.success('Cue point eliminado');
    },
    onError: () => toast.error('Error al eliminar el cue point'),
  });
}
