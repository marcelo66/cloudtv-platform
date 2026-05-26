import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/lib/api-client';
import { toast } from 'sonner';

export interface Schedule {
  id: string;
  channelId: string;
  playlistId?: string;
  playlist?: { id: string; name: string };
  name: string;
  startTime: string;
  endTime: string;
  recurrence: 'ONCE' | 'DAILY' | 'WEEKLY' | 'WEEKDAYS' | 'WEEKENDS';
  priority: number;
  createdAt: string;
}

export function useSchedules(channelId: string | null, from?: string, to?: string) {
  return useQuery<Schedule[]>({
    queryKey: ['schedules', channelId, from, to],
    queryFn: async () => {
      const { data } = await apiClient.get('/schedules', {
        params: { channelId, from, to },
      });
      return data;
    },
    enabled: !!channelId,
  });
}

export function useCreateSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: {
      channelId: string;
      playlistId?: string;
      name: string;
      startTime: string;
      endTime: string;
      recurrence?: string;
      priority?: number;
    }) => apiClient.post('/schedules', dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schedules'] });
      toast.success('Programación creada');
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message ?? 'Error al crear programación';
      toast.error(Array.isArray(msg) ? msg[0] : msg);
    },
  });
}

export function useDeleteSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/schedules/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schedules'] });
      toast.success('Programación eliminada');
    },
    onError: () => toast.error('Error al eliminar'),
  });
}

export function useUpdateSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Schedule> }) =>
      apiClient.patch(`/schedules/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schedules'] });
      toast.success('Programación actualizada');
    },
    onError: () => toast.error('Error al actualizar'),
  });
}
