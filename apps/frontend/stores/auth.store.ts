'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import apiClient from '@/lib/api-client';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string;
  role: string;
  plan: string;
  trialExpiresAt?: string;
  trialExpired?: boolean;
}

interface AdminSnapshot {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
}

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  impersonationAdmin: AdminSnapshot | null;

  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setTokens: (accessToken: string, refreshToken: string) => void;
  loadUser: () => Promise<void>;
  impersonate: (targetUser: AuthUser, targetAccessToken: string) => void;
  exitImpersonation: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      isLoading: false,
      impersonationAdmin: null,

      setTokens: (accessToken, refreshToken) => {
        localStorage.setItem('accessToken', accessToken);
        localStorage.setItem('refreshToken', refreshToken);
        set({ accessToken, refreshToken, isAuthenticated: true });
      },

      login: async (email, password) => {
        set({ isLoading: true });
        try {
          const { data } = await apiClient.post('/auth/login', { email, password });
          get().setTokens(data.accessToken, data.refreshToken);
          set({ user: data.user, isLoading: false });
        } catch (error) {
          set({ isLoading: false });
          throw error;
        }
      },

      register: async (name, email, password) => {
        set({ isLoading: true });
        try {
          const { data } = await apiClient.post('/auth/register', { name, email, password });
          get().setTokens(data.accessToken, data.refreshToken);
          set({ user: data.user, isLoading: false });
        } catch (error) {
          set({ isLoading: false });
          throw error;
        }
      },

      logout: async () => {
        const { refreshToken } = get();
        try {
          await apiClient.post('/auth/logout', { refreshToken });
        } catch (_) {
          // Ignorar errores de logout
        } finally {
          localStorage.removeItem('accessToken');
          localStorage.removeItem('refreshToken');
          set({
            user: null,
            accessToken: null,
            refreshToken: null,
            isAuthenticated: false,
            impersonationAdmin: null,
          });
        }
      },

      loadUser: async () => {
        const token = localStorage.getItem('accessToken');
        if (!token) {
          set({ isAuthenticated: false });
          return;
        }
        try {
          const { data } = await apiClient.get('/auth/me');
          set({ user: data, isAuthenticated: true });
        } catch (_) {
          set({ isAuthenticated: false, user: null });
        }
      },

      impersonate: (targetUser, targetAccessToken) => {
        const { user, accessToken, refreshToken } = get();
        if (!user || !accessToken) return;

        const adminSnapshot: AdminSnapshot = {
          user,
          accessToken,
          refreshToken: refreshToken ?? '',
        };

        localStorage.setItem('accessToken', targetAccessToken);

        set({
          impersonationAdmin: adminSnapshot,
          user: targetUser,
          accessToken: targetAccessToken,
          refreshToken: null,
          isAuthenticated: true,
        });
      },

      exitImpersonation: () => {
        const { impersonationAdmin } = get();
        if (!impersonationAdmin) return;

        localStorage.setItem('accessToken', impersonationAdmin.accessToken);
        localStorage.setItem('refreshToken', impersonationAdmin.refreshToken);

        set({
          user: impersonationAdmin.user,
          accessToken: impersonationAdmin.accessToken,
          refreshToken: impersonationAdmin.refreshToken,
          impersonationAdmin: null,
          isAuthenticated: true,
        });
      },
    }),
    {
      name: 'cloudtv-auth',
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        isAuthenticated: state.isAuthenticated,
        impersonationAdmin: state.impersonationAdmin,
      }),
    },
  ),
);
