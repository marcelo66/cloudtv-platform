import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/lib/api-client';
import { toast } from 'sonner';

export type OverlayType = 'LOGO' | 'TEXT_STATIC' | 'TEXT_SCROLL' | 'CLOCK' | 'TICKER';

export interface Overlay {
  id: string;
  channelId: string;
  name: string;
  type: OverlayType;
  enabled: boolean;
  config: Record<string, any>;
  zIndex: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateOverlayInput {
  name: string;
  type: OverlayType;
  enabled?: boolean;
  config: Record<string, any>;
  zIndex?: number;
}

export interface UpdateOverlayInput {
  name?: string;
  enabled?: boolean;
  config?: Record<string, any>;
  zIndex?: number;
}

// ─── Queries ──────────────────────────────────────────────────

export function useOverlays(channelId: string | null) {
  return useQuery<Overlay[]>({
    queryKey: ['overlays', channelId],
    queryFn: async () => {
      const { data } = await apiClient.get(`/channels/${channelId}/overlays`);
      return data;
    },
    enabled: !!channelId,
  });
}

// ─── Mutations ────────────────────────────────────────────────

export function useCreateOverlay() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ channelId, input }: { channelId: string; input: CreateOverlayInput }) =>
      apiClient.post(`/channels/${channelId}/overlays`, input),
    onSuccess: (_, { channelId }) => {
      qc.invalidateQueries({ queryKey: ['overlays', channelId] });
      toast.success('Overlay creado');
    },
    onError: () => toast.error('Error al crear el overlay'),
  });
}

export function useUpdateOverlay() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      channelId,
      id,
      input,
    }: {
      channelId: string;
      id: string;
      input: UpdateOverlayInput;
    }) => apiClient.patch(`/channels/${channelId}/overlays/${id}`, input),
    onSuccess: (_, { channelId }) => {
      qc.invalidateQueries({ queryKey: ['overlays', channelId] });
      toast.success('Overlay actualizado');
    },
    onError: () => toast.error('Error al actualizar el overlay'),
  });
}

export function useDeleteOverlay() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ channelId, id }: { channelId: string; id: string }) =>
      apiClient.delete(`/channels/${channelId}/overlays/${id}`),
    onSuccess: (_, { channelId }) => {
      qc.invalidateQueries({ queryKey: ['overlays', channelId] });
      toast.success('Overlay eliminado');
    },
    onError: () => toast.error('Error al eliminar el overlay'),
  });
}

export function useUploadOverlayLogo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      channelId,
      id,
      file,
    }: {
      channelId: string;
      id: string;
      file: File;
    }) => {
      const formData = new FormData();
      formData.append('file', file);
      return apiClient.post(`/channels/${channelId}/overlays/${id}/logo`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    },
    onSuccess: (_, { channelId }) => {
      qc.invalidateQueries({ queryKey: ['overlays', channelId] });
      toast.success('Logo subido correctamente');
    },
    onError: () => toast.error('Error al subir el logo'),
  });
}
