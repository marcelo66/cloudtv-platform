import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/lib/api-client';
import { toast } from 'sonner';

export type RotationMode = 'SEQUENTIAL' | 'RANDOM' | 'WEIGHTED';

export interface AdSpot {
  id: string;
  adBlockId: string;
  videoId: string;
  name: string;
  advertiser: string;
  weight: number;
  order: number;
  isActive: boolean;
  createdAt: string;
  video: { id: string; title: string; duration: number | null; status: string; thumbnailUrl?: string };
}

export interface AdBlock {
  id: string;
  channelId: string;
  name: string;
  description?: string;
  rotationMode: RotationMode;
  isActive: boolean;
  createdAt: string;
  spots: AdSpot[];
  _count?: { spots: number; cuePoints: number; impressions: number };
}

export interface CreateAdBlockInput {
  name: string;
  description?: string;
  rotationMode?: RotationMode;
}

export interface UpdateAdBlockInput {
  name?: string;
  description?: string;
  rotationMode?: RotationMode;
  isActive?: boolean;
}

export interface CreateAdSpotInput {
  videoId: string;
  name: string;
  advertiser: string;
  weight?: number;
  order?: number;
}

export interface UpdateAdSpotInput {
  name?: string;
  advertiser?: string;
  weight?: number;
  order?: number;
  isActive?: boolean;
}

export const ROTATION_MODE_LABELS: Record<RotationMode, string> = {
  SEQUENTIAL: 'Secuencial',
  RANDOM: 'Aleatoria',
  WEIGHTED: 'Ponderada',
};

export const ROTATION_MODE_DESC: Record<RotationMode, string> = {
  SEQUENTIAL: 'Los spots se emiten en orden fijo, rotando el inicio en cada ciclo',
  RANDOM: 'Los spots se mezclan aleatoriamente en cada tanda',
  WEIGHTED: 'Los spots con mayor peso aparecen con más frecuencia',
};

// ─── Queries ──────────────────────────────────────────────────

export function useAdBlocks(channelId: string | null) {
  return useQuery<AdBlock[]>({
    queryKey: ['ad-blocks', channelId],
    queryFn: async () => {
      const { data } = await apiClient.get(`/channels/${channelId}/ad-blocks`);
      return data;
    },
    enabled: !!channelId,
  });
}

export function useAdBlock(channelId: string | null, adBlockId: string | null) {
  return useQuery<AdBlock>({
    queryKey: ['ad-block', channelId, adBlockId],
    queryFn: async () => {
      const { data } = await apiClient.get(`/channels/${channelId}/ad-blocks/${adBlockId}`);
      return data;
    },
    enabled: !!channelId && !!adBlockId,
  });
}

// ─── Ad Block Mutations ───────────────────────────────────────

export function useCreateAdBlock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ channelId, input }: { channelId: string; input: CreateAdBlockInput }) =>
      apiClient.post(`/channels/${channelId}/ad-blocks`, input),
    onSuccess: (_, { channelId }) => {
      qc.invalidateQueries({ queryKey: ['ad-blocks', channelId] });
      toast.success('Tanda creada');
    },
    onError: () => toast.error('Error al crear la tanda'),
  });
}

export function useUpdateAdBlock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ channelId, id, input }: { channelId: string; id: string; input: UpdateAdBlockInput }) =>
      apiClient.patch(`/channels/${channelId}/ad-blocks/${id}`, input),
    onSuccess: (_, { channelId }) => {
      qc.invalidateQueries({ queryKey: ['ad-blocks', channelId] });
      toast.success('Tanda actualizada');
    },
    onError: () => toast.error('Error al actualizar la tanda'),
  });
}

export function useDeleteAdBlock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ channelId, id }: { channelId: string; id: string }) =>
      apiClient.delete(`/channels/${channelId}/ad-blocks/${id}`),
    onSuccess: (_, { channelId }) => {
      qc.invalidateQueries({ queryKey: ['ad-blocks', channelId] });
      toast.success('Tanda eliminada');
    },
    onError: () => toast.error('Error al eliminar la tanda'),
  });
}

// ─── Ad Spot Mutations ────────────────────────────────────────

export function useAddAdSpot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ channelId, adBlockId, input }: { channelId: string; adBlockId: string; input: CreateAdSpotInput }) =>
      apiClient.post(`/channels/${channelId}/ad-blocks/${adBlockId}/spots`, input),
    onSuccess: (_, { channelId }) => {
      qc.invalidateQueries({ queryKey: ['ad-blocks', channelId] });
      toast.success('Spot agregado');
    },
    onError: (err: any) => toast.error(err?.response?.data?.message ?? 'Error al agregar el spot'),
  });
}

export function useUpdateAdSpot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ channelId, adBlockId, spotId, input }: { channelId: string; adBlockId: string; spotId: string; input: UpdateAdSpotInput }) =>
      apiClient.patch(`/channels/${channelId}/ad-blocks/${adBlockId}/spots/${spotId}`, input),
    onSuccess: (_, { channelId }) => {
      qc.invalidateQueries({ queryKey: ['ad-blocks', channelId] });
      toast.success('Spot actualizado');
    },
    onError: () => toast.error('Error al actualizar el spot'),
  });
}

export function useRemoveAdSpot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ channelId, adBlockId, spotId }: { channelId: string; adBlockId: string; spotId: string }) =>
      apiClient.delete(`/channels/${channelId}/ad-blocks/${adBlockId}/spots/${spotId}`),
    onSuccess: (_, { channelId }) => {
      qc.invalidateQueries({ queryKey: ['ad-blocks', channelId] });
      toast.success('Spot eliminado');
    },
    onError: () => toast.error('Error al eliminar el spot'),
  });
}

export function useReorderAdSpots() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ channelId, adBlockId, ids }: { channelId: string; adBlockId: string; ids: string[] }) =>
      apiClient.patch(`/channels/${channelId}/ad-blocks/${adBlockId}/spots/reorder`, { ids }),
    onSuccess: (_, { channelId }) => {
      qc.invalidateQueries({ queryKey: ['ad-blocks', channelId] });
    },
    onError: () => toast.error('Error al reordenar spots'),
  });
}
