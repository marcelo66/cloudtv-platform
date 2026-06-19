'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  UserCheck,
  Save,
  Trash2,
  Tv2,
  CheckCircle2,
  XCircle,
  Radio,
  Film,
  ListVideo,
} from 'lucide-react';
import {
  useAdminUser,
  useUpdateAdminUser,
  useDeleteAdminUser,
  useImpersonate,
  PLAN_LABELS,
  PLAN_LIMITS,
  ROLE_LABELS,
  type UpdateAdminUserInput,
} from '@/hooks/useAdmin';
import { useAuthStore } from '@/stores/auth.store';
import { cn } from '@/lib/utils';

const CHANNEL_STATUS_COLORS: Record<string, string> = {
  LIVE_PLAYLIST: 'text-emerald-400',
  LIVE_RTMP: 'text-emerald-400',
  STARTING: 'text-amber-400',
  ERROR: 'text-red-400',
  OFFLINE: 'text-slate-500',
};

const CHANNEL_STATUS_LABELS: Record<string, string> = {
  LIVE_PLAYLIST: 'En vivo',
  LIVE_RTMP: 'En vivo (RTMP)',
  STARTING: 'Iniciando',
  ERROR: 'Error',
  OFFLINE: 'Offline',
};

export default function AdminUserDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const { id } = params;
  const router = useRouter();
  const { user: currentUser } = useAuthStore();

  const { data: user, isLoading } = useAdminUser(id);
  const updateUser = useUpdateAdminUser();
  const deleteUser = useDeleteAdminUser();
  const impersonate = useImpersonate();

  const [form, setForm] = useState<UpdateAdminUserInput>({});
  const [dirty, setDirty] = useState(false);

  const set = <K extends keyof UpdateAdminUserInput>(key: K, val: UpdateAdminUserInput[K]) => {
    setForm((f) => ({ ...f, [key]: val }));
    setDirty(true);
  };

  const handleSave = async () => {
    if (!dirty) return;
    await updateUser.mutateAsync({ id, input: form });
    setDirty(false);
    setForm({});
  };

  const handleDelete = () => {
    if (!confirm(`¿Eliminar a ${user?.name}? Esto eliminará todos sus canales, videos y datos. Esta acción no se puede deshacer.`)) return;
    deleteUser.mutate(id);
  };

  const handleImpersonate = () => {
    impersonate.mutate(id);
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-slate-500">Usuario no encontrado</p>
      </div>
    );
  }

  const effectivePlan = form.plan ?? user.plan;
  const planDefaultLimit = PLAN_LIMITS[effectivePlan] ?? 1;
  const effectiveLimit =
    (form.maxChannels !== undefined ? form.maxChannels : user.maxChannels) ?? planDefaultLimit;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        {/* Back + actions bar */}
        <div className="flex items-center justify-between">
          <button
            onClick={() => router.push('/admin')}
            className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors text-sm"
          >
            <ArrowLeft className="w-4 h-4" />
            Volver a Administración
          </button>

          <div className="flex items-center gap-3">
            {user.role === 'USER' && currentUser?.role !== user.role && (
              <button
                onClick={handleImpersonate}
                disabled={impersonate.isPending || !user.isActive}
                className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-amber-950 font-semibold px-4 py-2 rounded-lg text-sm transition-colors"
              >
                <UserCheck className="w-4 h-4" />
                {impersonate.isPending ? 'Entrando...' : 'Impersonar usuario'}
              </button>
            )}
            {dirty && (
              <button
                onClick={handleSave}
                disabled={updateUser.isPending}
                className="flex items-center gap-2 bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                <Save className="w-4 h-4" />
                {updateUser.isPending ? 'Guardando...' : 'Guardar cambios'}
              </button>
            )}
          </div>
        </div>

        {/* User header */}
        <div className="bg-surface-800 border border-white/5 rounded-2xl p-6">
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-xl bg-brand-600 flex items-center justify-center flex-shrink-0">
              <span className="text-xl font-bold text-white">
                {user.name.charAt(0).toUpperCase()}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-bold text-white">{user.name}</h1>
              <p className="text-sm text-slate-400 mt-0.5">{user.email}</p>
              <div className="flex items-center gap-3 mt-2">
                <span className="text-xs text-slate-500">
                  Registrado el {new Date(user.createdAt).toLocaleDateString('es', { day: '2-digit', month: 'long', year: 'numeric' })}
                </span>
                {user.isActive ? (
                  <span className="flex items-center gap-1 text-xs text-emerald-400">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Cuenta activa
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-xs text-red-400">
                    <XCircle className="w-3.5 h-3.5" /> Cuenta inactiva
                  </span>
                )}
              </div>
            </div>

            {/* Danger zone */}
            <button
              onClick={handleDelete}
              disabled={deleteUser.isPending}
              className="flex items-center gap-1.5 text-red-400 hover:text-red-300 hover:bg-red-500/10 px-3 py-1.5 rounded-lg text-sm transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              Eliminar
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Edit form */}
          <div className="bg-surface-800 border border-white/5 rounded-2xl p-6 space-y-5">
            <h2 className="text-base font-semibold text-white">Configuración</h2>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Nombre</label>
              <input
                value={form.name ?? user.name}
                onChange={(e) => set('name', e.target.value)}
                className="w-full bg-surface-700 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Plan</label>
              <select
                value={form.plan ?? user.plan}
                onChange={(e) => set('plan', e.target.value)}
                className="w-full bg-surface-700 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500"
              >
                {Object.entries(PLAN_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>

            {currentUser?.role === 'SUPER_ADMIN' && (
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">Rol</label>
                <select
                  value={form.role ?? user.role}
                  onChange={(e) => set('role', e.target.value)}
                  className="w-full bg-surface-700 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500"
                >
                  {Object.entries(ROLE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">
                Límite de canales
                <span className="text-slate-600 ml-1">
                  (por plan: {planDefaultLimit === 9999 ? 'ilimitado' : planDefaultLimit})
                </span>
              </label>
              <input
                type="number"
                min={1}
                value={
                  form.maxChannels !== undefined
                    ? (form.maxChannels ?? '')
                    : (user.maxChannels ?? '')
                }
                onChange={(e) =>
                  set('maxChannels', e.target.value ? Number(e.target.value) : null)
                }
                placeholder={`Por defecto (${planDefaultLimit === 9999 ? '∞' : planDefaultLimit})`}
                className="w-full bg-surface-700 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-brand-500"
              />
              <p className="text-xs text-slate-600 mt-1">
                Dejar vacío para respetar el límite del plan. El límite efectivo actual es{' '}
                <strong className="text-slate-400">
                  {effectiveLimit === 9999 ? 'ilimitado' : effectiveLimit}
                </strong>.
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-2">Estado de la cuenta</label>
              <button
                onClick={() => set('isActive', !(form.isActive ?? user.isActive))}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                  (form.isActive ?? user.isActive)
                    ? 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                    : 'bg-red-500/10 text-red-400 hover:bg-red-500/20',
                )}
              >
                <span className={cn(
                  'w-2 h-2 rounded-full',
                  (form.isActive ?? user.isActive) ? 'bg-emerald-400' : 'bg-red-400',
                )} />
                {(form.isActive ?? user.isActive) ? 'Cuenta activa — clic para desactivar' : 'Cuenta inactiva — clic para activar'}
              </button>
            </div>
          </div>

          {/* Channels */}
          <div className="bg-surface-800 border border-white/5 rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-white">
                Canales <span className="text-slate-500 font-normal text-sm">({user._count?.channels ?? 0})</span>
              </h2>
              <p className="text-xs text-slate-500">
                {user._count?.channels ?? 0} / {effectiveLimit === 9999 ? '∞' : effectiveLimit} usados
              </p>
            </div>

            {user.channels.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <Tv2 className="w-8 h-8 text-slate-600 mb-2" />
                <p className="text-sm text-slate-500">Sin canales creados</p>
              </div>
            ) : (
              <div className="space-y-2">
                {user.channels.map((ch) => (
                  <div
                    key={ch.id}
                    className="flex items-center gap-3 p-3 rounded-xl bg-surface-700/50 border border-white/5"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-white truncate">{ch.name}</p>
                        {(ch.status === 'LIVE_PLAYLIST' || ch.status === 'LIVE_RTMP') && (
                          <Radio className="w-3 h-3 text-red-400 animate-pulse flex-shrink-0" />
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className={cn('text-xs', CHANNEL_STATUS_COLORS[ch.status])}>
                          {CHANNEL_STATUS_LABELS[ch.status] ?? ch.status}
                        </span>
                        <span className="text-xs text-slate-500 flex items-center gap-1">
                          <Film className="w-3 h-3" /> {ch._count.videos}
                        </span>
                        <span className="text-xs text-slate-500 flex items-center gap-1">
                          <ListVideo className="w-3 h-3" /> {ch._count.playlists}
                        </span>
                      </div>
                    </div>
                    <p className="text-xs text-slate-600 flex-shrink-0">
                      {new Date(ch.createdAt).toLocaleDateString('es', { day: '2-digit', month: 'short' })}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
