import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import apiClient from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';
import { toast } from 'sonner';

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: string;
  plan: string;
  isActive: boolean;
  maxChannels: number | null;
  createdAt: string;
  _count?: { channels: number };
}

export interface AdminUserDetail extends AdminUser {
  updatedAt: string;
  channels: {
    id: string;
    name: string;
    slug: string;
    status: string;
    createdAt: string;
    _count: { videos: number; playlists: number };
  }[];
}

export interface AdminStats {
  totalUsers: number;
  activeUsers: number;
  totalChannels: number;
  liveChannels: number;
  totalVideos: number;
}

export interface CreateAdminUserInput {
  email: string;
  name: string;
  password: string;
  plan?: string;
  maxChannels?: number;
}

export interface UpdateAdminUserInput {
  name?: string;
  plan?: string;
  role?: string;
  isActive?: boolean;
  maxChannels?: number | null;
}

export const PLAN_LABELS: Record<string, string> = {
  FREE: 'Free',
  STARTER: 'Starter',
  PRO: 'Pro',
  ENTERPRISE: 'Enterprise',
};

export const PLAN_LIMITS: Record<string, number> = {
  FREE: 1,
  STARTER: 3,
  PRO: 10,
  ENTERPRISE: 9999,
};

export const ROLE_LABELS: Record<string, string> = {
  USER: 'Usuario',
  ADMIN: 'Administrador',
  SUPER_ADMIN: 'Super Admin',
};

// ─── Queries ──────────────────────────────────────────────────

export function useAdminStats() {
  return useQuery<AdminStats>({
    queryKey: ['admin-stats'],
    queryFn: async () => {
      const { data } = await apiClient.get('/admin/stats');
      return data;
    },
  });
}

export function useAdminUsers(search?: string) {
  return useQuery<AdminUser[]>({
    queryKey: ['admin-users', search],
    queryFn: async () => {
      const { data } = await apiClient.get('/admin/users', {
        params: search ? { search } : undefined,
      });
      return data;
    },
  });
}

export function useAdminUser(id: string) {
  return useQuery<AdminUserDetail>({
    queryKey: ['admin-user', id],
    queryFn: async () => {
      const { data } = await apiClient.get(`/admin/users/${id}`);
      return data;
    },
    enabled: !!id,
  });
}

// ─── Mutations ────────────────────────────────────────────────

export function useCreateAdminUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAdminUserInput) =>
      apiClient.post('/admin/users', input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      qc.invalidateQueries({ queryKey: ['admin-stats'] });
      toast.success('Usuario creado');
    },
    onError: (err: any) =>
      toast.error(err?.response?.data?.message ?? 'Error al crear usuario'),
  });
}

export function useUpdateAdminUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateAdminUserInput }) =>
      apiClient.patch(`/admin/users/${id}`, input),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      qc.invalidateQueries({ queryKey: ['admin-user', id] });
      toast.success('Usuario actualizado');
    },
    onError: (err: any) =>
      toast.error(err?.response?.data?.message ?? 'Error al actualizar usuario'),
  });
}

export function useDeleteAdminUser() {
  const qc = useQueryClient();
  const router = useRouter();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/admin/users/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      qc.invalidateQueries({ queryKey: ['admin-stats'] });
      toast.success('Usuario eliminado');
      router.push('/admin');
    },
    onError: (err: any) =>
      toast.error(err?.response?.data?.message ?? 'Error al eliminar usuario'),
  });
}

export function useImpersonate() {
  const { impersonate } = useAuthStore();
  const router = useRouter();
  return useMutation({
    mutationFn: (userId: string) =>
      apiClient.post(`/admin/impersonate/${userId}`),
    onSuccess: ({ data }) => {
      impersonate(data.user, data.accessToken);
      toast.success(`Viendo como ${data.user.name}`);
      router.push('/');
    },
    onError: (err: any) =>
      toast.error(err?.response?.data?.message ?? 'No se pudo impersonar'),
  });
}
