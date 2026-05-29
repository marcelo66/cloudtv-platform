import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/lib/api-client';
import { toast } from 'sonner';

export interface Video {
  id: string;
  title: string;
  description?: string;
  status: 'PENDING' | 'PROCESSING' | 'READY' | 'ERROR' | 'ARCHIVED';
  thumbnailUrl?: string;
  duration?: number;
  width?: number;
  height?: number;
  fps?: number;
  codec?: string;
  bitrate?: number;
  fileSize: string;
  mimeType: string;
  tags: string[];
  folder?: string | null;
  createdAt: string;
  updatedAt: string;
}

export function useVideos(channelId: string | null) {
  return useQuery<Video[]>({
    queryKey: ['videos', channelId],
    queryFn: async () => {
      const { data } = await apiClient.get('/videos', {
        params: { channelId },
      });
      return data;
    },
    enabled: !!channelId,
    // Refresca cada 4s si hay videos procesando
    refetchInterval: (query) => {
      const videos = query.state.data ?? [];
      const hasProcessing = videos.some(
        (v) => v.status === 'PROCESSING' || v.status === 'PENDING',
      );
      return hasProcessing ? 4000 : false;
    },
  });
}

export function useUpdateVideo() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      videoId,
      data,
    }: {
      videoId: string;
      data: { title?: string; description?: string; tags?: string[]; folder?: string | null };
    }) => apiClient.patch(`/videos/${videoId}`, data),

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['videos'] });
      toast.success('Video actualizado');
    },
    onError: () => toast.error('Error al actualizar el video'),
  });
}

export function useDeleteVideo() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (videoId: string) => apiClient.delete(`/videos/${videoId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['videos'] });
      queryClient.invalidateQueries({ queryKey: ['channels'] });
      toast.success('Video eliminado');
    },
    onError: () => toast.error('Error al eliminar el video'),
  });
}
