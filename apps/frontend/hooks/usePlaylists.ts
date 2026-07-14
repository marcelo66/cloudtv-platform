import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/lib/api-client';
import { toast } from 'sonner';

export interface PlaylistItem {
  id: string;
  order: number;
  trimStart?: number;
  trimEnd?: number;
  videoId?: string | null;
  video?: {
    id: string;
    title: string;
    duration?: number;
    thumbnailUrl?: string;
    status: string;
  } | null;
  adBlockId?: string | null;
  adBlock?: {
    id: string;
    name: string;
    spots: Array<{
      id: string;
      name: string;
      video: { id: string; title: string; duration?: number; thumbnailUrl?: string };
    }>;
  } | null;
}

export interface Playlist {
  id: string;
  channelId: string;
  name: string;
  description?: string;
  loopMode: 'LOOP_ALL' | 'LOOP_ONE' | 'SEQUENTIAL';
  isDefault: boolean;
  totalDuration?: number;
  createdAt: string;
  updatedAt: string;
  items?: PlaylistItem[];
  _count?: { items: number };
}

// ─── List ─────────────────────────────────────────────────────

export function usePlaylists(channelId: string | null) {
  return useQuery<Playlist[]>({
    queryKey: ['playlists', channelId],
    queryFn: async () => {
      const { data } = await apiClient.get('/playlists', { params: { channelId } });
      return data;
    },
    enabled: !!channelId,
  });
}

export function usePlaylist(id: string | null) {
  return useQuery<Playlist>({
    queryKey: ['playlist', id],
    queryFn: async () => {
      const { data } = await apiClient.get(`/playlists/${id}`);
      return data;
    },
    enabled: !!id,
    refetchOnMount: 'always',
  });
}

// ─── Create ───────────────────────────────────────────────────

export function useCreatePlaylist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: {
      channelId: string;
      name: string;
      description?: string;
      loopMode?: string;
    }) => apiClient.post('/playlists', dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['playlists'] });
      toast.success('Playlist creada');
    },
    onError: () => toast.error('Error al crear la playlist'),
  });
}

// ─── Update ───────────────────────────────────────────────────

export function useUpdatePlaylist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Playlist> }) =>
      apiClient.patch(`/playlists/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['playlists'] });
      qc.invalidateQueries({ queryKey: ['playlist'] });
      toast.success('Playlist actualizada');
    },
    onError: () => toast.error('Error al actualizar'),
  });
}

// ─── Delete ───────────────────────────────────────────────────

export function useDeletePlaylist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/playlists/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['playlists'] });
      toast.success('Playlist eliminada');
    },
    onError: () => toast.error('Error al eliminar'),
  });
}

// ─── Items ────────────────────────────────────────────────────

export function useAddPlaylistItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ playlistId, videoId }: { playlistId: string; videoId: string }) =>
      apiClient.post(`/playlists/${playlistId}/items`, { videoId }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['playlist', vars.playlistId] });
      qc.invalidateQueries({ queryKey: ['playlists'] });
      toast.success('Video agregado');
    },
    onError: () => toast.error('Error al agregar video'),
  });
}

export function useAddPlaylistAdBlock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ playlistId, adBlockId }: { playlistId: string; adBlockId: string }) =>
      apiClient.post(`/playlists/${playlistId}/ad-items`, { adBlockId }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['playlist', vars.playlistId] });
      qc.invalidateQueries({ queryKey: ['playlists'] });
      toast.success('Bloque publicitario agregado');
    },
    onError: () => toast.error('Error al agregar bloque publicitario'),
  });
}

export function useRemovePlaylistItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ playlistId, itemId }: { playlistId: string; itemId: string }) =>
      apiClient.delete(`/playlists/${playlistId}/items/${itemId}`),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['playlist', vars.playlistId] });
      qc.invalidateQueries({ queryKey: ['playlists'] });
    },
    onError: () => toast.error('Error al quitar video'),
  });
}

export function useReorderPlaylistItems() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      playlistId,
      items,
    }: {
      playlistId: string;
      items: Array<{ id: string; order: number }>;
    }) => apiClient.patch(`/playlists/${playlistId}/items/reorder`, { items }),
    onSettled: (_, __, vars) => {
      // Refrescar siempre (éxito o error) para que localItems vuelva al orden del servidor
      qc.invalidateQueries({ queryKey: ['playlist', vars.playlistId] });
      qc.invalidateQueries({ queryKey: ['playlists'] });
    },
    onError: () => toast.error('Error al reordenar'),
  });
}
