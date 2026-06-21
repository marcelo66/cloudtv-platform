'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Users,
  Tv2,
  Radio,
  Film,
  Search,
  Plus,
  MoreVertical,
  ChevronRight,
  UserCheck,
  Power,
  Trash2,
  X,
} from 'lucide-react';
import {
  useAdminStats,
  useAdminUsers,
  useCreateAdminUser,
  useUpdateAdminUser,
  useDeleteAdminUser,
  useImpersonate,
  PLAN_LABELS,
  ROLE_LABELS,
  type AdminUser,
  type CreateAdminUserInput,
} from '@/hooks/useAdmin';
import { cn } from '@/lib/utils';

const PLAN_COLORS: Record<string, string> = {
  FREE: 'bg-slate-500/20 text-slate-400',
  STARTER: 'bg-blue-500/20 text-blue-400',
  PRO: 'bg-violet-500/20 text-violet-400',
  ENTERPRISE: 'bg-amber-500/20 text-amber-400',
};

function StatCard({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string;
  value: number;
  icon: React.ElementType;
  accent: string;
}) {
  return (
    <div className="bg-surface-800 border border-white/5 rounded-xl p-5 flex items-center gap-4">
      <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center', accent)}>
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <p className="text-2xl font-bold text-white">{value.toLocaleString()}</p>
        <p className="text-xs text-slate-400 mt-0.5">{label}</p>
      </div>
    </div>
  );
}

function CreateUserModal({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState<CreateAdminUserInput>({
    name: '',
    email: '',
    password: '',
    plan: 'FREE',
  });
  const create = useCreateAdminUser();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await create.mutateAsync(form);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-surface-800 border border-white/10 rounded-2xl p-6 w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-white">Crear usuario</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Nombre</label>
            <input
              required
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Juan Pérez"
              className="w-full bg-surface-700 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-brand-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Email</label>
            <input
              required
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              placeholder="juan@ejemplo.com"
              className="w-full bg-surface-700 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-brand-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">
              Contraseña <span className="text-slate-500">(mín. 8 caracteres)</span>
            </label>
            <input
              required
              type="password"
              minLength={8}
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              placeholder="••••••••"
              className="w-full bg-surface-700 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-brand-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Plan</label>
            <select
              value={form.plan}
              onChange={(e) => setForm((f) => ({ ...f, plan: e.target.value }))}
              className="w-full bg-surface-700 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500"
            >
              {Object.entries(PLAN_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">
              Límite de canales <span className="text-slate-500">(dejar vacío = según plan)</span>
            </label>
            <input
              type="number"
              min={1}
              value={form.maxChannels ?? ''}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  maxChannels: e.target.value ? Number(e.target.value) : undefined,
                }))
              }
              placeholder="Automático"
              className="w-full bg-surface-700 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-brand-500"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-surface-700 hover:bg-surface-600 text-slate-300 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={create.isPending}
              className="flex-1 bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors"
            >
              {create.isPending ? 'Creando...' : 'Crear usuario'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function UserRow({ user }: { user: AdminUser }) {
  const router = useRouter();
  const updateUser = useUpdateAdminUser();
  const deleteUser = useDeleteAdminUser();
  const impersonate = useImpersonate();
  const [menuOpen, setMenuOpen] = useState(false);

  const toggleActive = () =>
    updateUser.mutate({ id: user.id, input: { isActive: !user.isActive } });

  const handleDelete = () => {
    if (!confirm(`¿Eliminar a ${user.name}? Esta acción no se puede deshacer.`)) return;
    deleteUser.mutate(user.id);
  };

  return (
    <tr className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-brand-600/30 flex items-center justify-center flex-shrink-0">
            <span className="text-xs font-bold text-brand-400">
              {user.name.charAt(0).toUpperCase()}
            </span>
          </div>
          <div>
            <p className="text-sm font-medium text-white">{user.name}</p>
            <p className="text-xs text-slate-500">{user.email}</p>
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <span className={cn('inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium', PLAN_COLORS[user.plan])}>
          {PLAN_LABELS[user.plan] ?? user.plan}
        </span>
      </td>
      <td className="px-4 py-3 text-sm text-slate-400">
        {ROLE_LABELS[user.role] ?? user.role}
      </td>
      <td className="px-4 py-3 text-sm text-slate-400">
        {user._count?.channels ?? 0}
        {user.maxChannels != null && (
          <span className="text-slate-600 text-xs ml-1">/ {user.maxChannels}</span>
        )}
      </td>
      <td className="px-4 py-3">
        <button
          onClick={toggleActive}
          className={cn(
            'flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-md transition-colors',
            user.isActive
              ? 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
              : 'bg-red-500/10 text-red-400 hover:bg-red-500/20',
          )}
        >
          <span className={cn('w-1.5 h-1.5 rounded-full', user.isActive ? 'bg-emerald-400' : 'bg-red-400')} />
          {user.isActive ? 'Activo' : 'Inactivo'}
        </button>
      </td>
      <td className="px-4 py-3 text-xs text-slate-500">
        {new Date(user.createdAt).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' })}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1 justify-end">
          <button
            onClick={() => router.push(`/admin/users/${user.id}`)}
            className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
            title="Ver detalle"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <div className="relative">
            <button
              onClick={() => setMenuOpen((o) => !o)}
              className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
            >
              <MoreVertical className="w-4 h-4" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 w-44 bg-surface-700 border border-white/10 rounded-xl shadow-xl z-10 py-1">
                {user.role === 'USER' && (
                  <button
                    onClick={() => { impersonate.mutate(user.id); setMenuOpen(false); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-slate-300 hover:text-white hover:bg-white/5 transition-colors"
                  >
                    <UserCheck className="w-4 h-4" />
                    Impersonar
                  </button>
                )}
                <button
                  onClick={() => { toggleActive(); setMenuOpen(false); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-slate-300 hover:text-white hover:bg-white/5 transition-colors"
                >
                  <Power className="w-4 h-4" />
                  {user.isActive ? 'Desactivar' : 'Activar'}
                </button>
                <div className="border-t border-white/5 my-1" />
                <button
                  onClick={() => { handleDelete(); setMenuOpen(false); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/5 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                  Eliminar
                </button>
              </div>
            )}
          </div>
        </div>
      </td>
    </tr>
  );
}

export default function AdminPage() {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const { data: stats } = useAdminStats();
  const { data: users, isLoading } = useAdminUsers(debouncedSearch || undefined);

  const handleSearch = (val: string) => {
    setSearch(val);
    clearTimeout((window as any).__adminSearch);
    (window as any).__adminSearch = setTimeout(() => setDebouncedSearch(val), 350);
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-white">Panel de Administración</h1>
          <p className="text-sm text-slate-400 mt-1">Gestión de usuarios, planes y accesos</p>
        </div>

        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <StatCard label="Usuarios totales" value={stats.totalUsers} icon={Users} accent="bg-brand-500/20 text-brand-400" />
            <StatCard label="Usuarios activos" value={stats.activeUsers} icon={Users} accent="bg-emerald-500/20 text-emerald-400" />
            <StatCard label="Canales totales" value={stats.totalChannels} icon={Tv2} accent="bg-blue-500/20 text-blue-400" />
            <StatCard label="Canales en vivo" value={stats.liveChannels} icon={Radio} accent="bg-red-500/20 text-red-400" />
            <StatCard label="Videos listos" value={stats.totalVideos} icon={Film} accent="bg-violet-500/20 text-violet-400" />
          </div>
        )}

        {/* Users table */}
        <div className="bg-surface-800 border border-white/5 rounded-2xl overflow-hidden">
          {/* Table header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
            <h2 className="text-base font-semibold text-white">Usuarios</h2>
            <div className="flex items-center gap-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                <input
                  value={search}
                  onChange={(e) => handleSearch(e.target.value)}
                  placeholder="Buscar por nombre o email..."
                  className="bg-surface-700 border border-white/10 rounded-lg pl-8 pr-4 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-brand-500 w-64"
                />
              </div>
              <button
                onClick={() => setShowCreate(true)}
                className="flex items-center gap-2 bg-brand-600 hover:bg-brand-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                <Plus className="w-4 h-4" />
                Nuevo usuario
              </button>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/5">
                  {['Usuario', 'Plan', 'Rol', 'Canales', 'Estado', 'Registro', ''].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-slate-500 text-sm">
                      Cargando usuarios...
                    </td>
                  </tr>
                ) : users?.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-slate-500 text-sm">
                      No se encontraron usuarios
                    </td>
                  </tr>
                ) : (
                  users?.map((u) => <UserRow key={u.id} user={u} />)
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {showCreate && <CreateUserModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}
