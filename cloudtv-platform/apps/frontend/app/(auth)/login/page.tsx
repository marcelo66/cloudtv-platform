'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Loader2, Tv, Mail, Lock, Eye, EyeOff } from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';

const loginSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(1, 'Ingresa tu contraseña'),
});
type LoginForm = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuthStore();
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({ resolver: zodResolver(loginSchema) });

  const onSubmit = async (data: LoginForm) => {
    try {
      await login(data.email, data.password);
      toast.success('Bienvenido de vuelta');
      router.push('/');
    } catch (error: any) {
      const msg =
        error?.response?.data?.message || 'Error al iniciar sesión';
      toast.error(msg);
    }
  };

  return (
    <div className="w-full">
      {/* Logo */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-brand-600 flex items-center justify-center">
            <Tv className="w-5 h-5 text-white" />
          </div>
          <span className="text-xl font-bold text-white tracking-tight">
            CloudTV
          </span>
        </div>
        <h1 className="text-2xl font-bold text-white">Iniciar sesión</h1>
        <p className="text-slate-400 mt-1 text-sm">
          Accede al panel de tu canal
        </p>
      </div>

      {/* Card */}
      <div className="glass-card p-8">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          {/* Email */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">
              Email
            </label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                {...register('email')}
                type="email"
                placeholder="tu@email.com"
                autoComplete="email"
                className={`
                  w-full pl-10 pr-4 py-2.5 rounded-lg text-sm
                  bg-surface-700 border text-white placeholder-slate-500
                  focus:outline-none focus:ring-2 focus:ring-brand-500/50 focus:border-brand-500
                  transition-colors
                  ${errors.email ? 'border-red-500/50' : 'border-white/10'}
                `}
              />
            </div>
            {errors.email && (
              <p className="mt-1 text-xs text-red-400">{errors.email.message}</p>
            )}
          </div>

          {/* Password */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">
              Contraseña
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                {...register('password')}
                type={showPassword ? 'text' : 'password'}
                placeholder="Tu contraseña"
                autoComplete="current-password"
                className={`
                  w-full pl-10 pr-10 py-2.5 rounded-lg text-sm
                  bg-surface-700 border text-white placeholder-slate-500
                  focus:outline-none focus:ring-2 focus:ring-brand-500/50 focus:border-brand-500
                  transition-colors
                  ${errors.password ? 'border-red-500/50' : 'border-white/10'}
                `}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
              >
                {showPassword ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            </div>
            {errors.password && (
              <p className="mt-1 text-xs text-red-400">
                {errors.password.message}
              </p>
            )}
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={isSubmitting}
            className={`
              w-full py-2.5 px-4 rounded-lg font-semibold text-sm
              bg-brand-600 hover:bg-brand-500 text-white
              transition-all duration-200
              disabled:opacity-50 disabled:cursor-not-allowed
              flex items-center justify-center gap-2
              focus:outline-none focus:ring-2 focus:ring-brand-500/50
            `}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Ingresando...
              </>
            ) : (
              'Ingresar al panel'
            )}
          </button>
        </form>
      </div>

      {/* Register link */}
      <p className="text-center text-sm text-slate-500 mt-6">
        ¿No tenés cuenta?{' '}
        <Link
          href="/register"
          className="text-brand-500 hover:text-brand-400 font-medium transition-colors"
        >
          Registrarte gratis
        </Link>
      </p>
    </div>
  );
}
