import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/lib/api-client';
import { toast } from 'sonner';

export interface Channel {
  id: string;
  name: string;
  slug: string;
  description?: string;
  logoUrl?: string;
  status: 'OFFLINE' | 'LIVE_PLAYLIST' | 'LIVE_RTMP' | 'STARTING' | 'ERROR';
  streamKey: string;
  hlsUrl?: string;
  videoQuality: '480p' | '720p' | '1080p';
  adIntervalMinutes?: number | null;
  adIntervalBlockId?: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: { videos: number; playlists: number };
}

// ─── Queries ──────────────────────────────────────────────────

export function useChannels() {
  return useQuery<Channel[]>({
    queryKey: ['channels'],
    queryFn: async () => {
      const { data } = await apiClient.get('/channels');
      return data;
    },
  });
}

export function useChannel(id: string | null) {
  return useQuery<Channel>({
    queryKey: ['channel', id],
    queryFn: async () => {
      const { data } = await apiClient.get(`/channels/${id}`);
      return data;
    },
    enabled: !!id,
    refetchInterval: 5000, // Poll every 5 s to reflect status changes
  });
}

// ─── Mutations ────────────────────────────────────────────────

export function useUpdateChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: { name?: string; description?: string; videoQuality?: string; adIntervalMinutes?: number | null; adIntervalBlockId?: string | null } }) =>
      apiClient.patch(`/channels/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['channels'] });
      qc.invalidateQueries({ queryKey: ['channel'] });
      toast.success('Canal actualizado');
    },
    onError: () => toast.error('Error al actualizar el canal'),
  });
}

export function useStartChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.post(`/channels/${id}/start`),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['channels'] });
      qc.invalidateQueries({ queryKey: ['channel', id] });
      toast.success('Canal iniciado');
    },
    onError: () => toast.error('Error al iniciar el canal'),
  });
}

export function useStopChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.post(`/channels/${id}/stop`),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['channels'] });
      qc.invalidateQueries({ queryKey: ['channel', id] });
      toast.success('Canal detenido');
    },
    onError: () => toast.error('Error al detener el canal'),
  });
}

export function useRegenerateStreamKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.post(`/channels/${id}/regenerate-key`),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['channel', id] });
      qc.invalidateQueries({ queryKey: ['channels'] });
      toast.success('Stream key regenerada');
    },
    onError: () => toast.error('Error al regenerar la key'),
  });
}

export function useDeleteChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/channels/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['channels'] });
      toast.success('Canal eliminado');
    },
    onError: () => toast.error('Error al eliminar el canal'),
  });
}
