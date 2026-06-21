'use client';

import { useState } from 'react';
import { Settings2, User, Bell, Shield, Palette, Save } from 'lucide-react';
import { Header } from '@/components/dashboard/Header';
import { useAuthStore } from '@/stores/auth.store';
import { toast } from 'sonner';
import apiClient from '@/lib/api-client';

export default function SettingsPage() {
  const { user } = useAuthStore();
  const [name, setName] = useState(user?.name ?? '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await apiClient.patch('/users/me', { name: name.trim() });
      toast.success('Perfil actualizado');
    } catch {
      toast.error('Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  const inputClass =
    'w-full px-3 py-2 rounded-lg text-sm bg-surface-700 border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-brand-500/50 focus:border-brand-500 transition-colors';

  return (
    <div className="flex flex-col flex-1">
      <Header title="Configuración" subtitle="Preferencias de tu cuenta" />

      <div className="flex-1 p-6 overflow-y-auto">
        <div className="max-w-2xl space-y-5">
          {/* Profile */}
          <div className="glass-card p-5 space-y-4">
            <div className="flex items-center gap-2 mb-1">
              <User className="w-4 h-4 text-slate-400" />
              <h3 className="text-sm font-semibold text-slate-200">Perfil</h3>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">
                Nombre
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                className={inputClass}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">
                Email
              </label>
              <input
                value={user?.email ?? ''}
                disabled
                className={inputClass + ' opacity-50 cursor-not-allowed'}
              />
              <p className="text-xs text-slate-600 mt-1">
                El email no se puede cambiar por el momento.
              </p>
            </div>

            <div className="flex justify-end">
              <button
                onClick={handleSave}
                disabled={saving || !name.trim() || name === user?.name}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-brand-600 hover:bg-brand-500 text-white transition-colors disabled:opacity-50"
              >
                <Save className="w-3.5 h-3.5" />
                {saving ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>

          {/* Plan */}
          <div className="glass-card p-5">
            <div className="flex items-center gap-2 mb-4">
              <Shield className="w-4 h-4 text-slate-400" />
              <h3 className="text-sm font-semibold text-slate-200">Plan</h3>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-white capitalize">
                  {user?.plan ?? 'Free'}
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  Plan actual de tu cuenta
                </p>
              </div>
              <span className="px-3 py-1 rounded-full text-xs font-semibold bg-brand-600/20 text-brand-400 border border-brand-600/30">
                {user?.plan?.toUpperCase() ?? 'FREE'}
              </span>
            </div>
          </div>

          {/* Coming soon sections */}
          {[
            { icon: Bell, title: 'Notificaciones', desc: 'Alertas por email cuando el canal se cae o hay errores de procesamiento.' },
            { icon: Palette, title: 'Apariencia', desc: 'Personalización del panel y opciones de marca blanca.' },
          ].map(({ icon: Icon, title, desc }) => (
            <div key={title} className="glass-card p-5 opacity-60">
              <div className="flex items-center gap-2 mb-3">
                <Icon className="w-4 h-4 text-slate-400" />
                <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
                <span className="ml-auto text-xs text-slate-500 px-2 py-0.5 rounded-full border border-white/10">
                  Próximamente
                </span>
              </div>
              <p className="text-xs text-slate-500">{desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
