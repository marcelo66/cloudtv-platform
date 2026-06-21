import { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StatsCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: LucideIcon;
  trend?: { value: string; positive: boolean };
  color?: 'blue' | 'green' | 'purple' | 'orange';
}

const colorMap = {
  blue: {
    icon: 'text-blue-400',
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/20',
  },
  green: {
    icon: 'text-green-400',
    bg: 'bg-green-500/10',
    border: 'border-green-500/20',
  },
  purple: {
    icon: 'text-purple-400',
    bg: 'bg-purple-500/10',
    border: 'border-purple-500/20',
  },
  orange: {
    icon: 'text-orange-400',
    bg: 'bg-orange-500/10',
    border: 'border-orange-500/20',
  },
};

export function StatsCard({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  color = 'blue',
}: StatsCardProps) {
  const colors = colorMap[color];

  return (
    <div className="glass-card p-5 hover:border-white/10 transition-all duration-200 group">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
            {title}
          </p>
          <p className="text-2xl font-bold text-white leading-none">{value}</p>
          {subtitle && (
            <p className="text-xs text-slate-500 mt-1.5">{subtitle}</p>
          )}
          {trend && (
            <div className="flex items-center gap-1 mt-2">
              <span
                className={cn(
                  'text-xs font-medium',
                  trend.positive ? 'text-green-400' : 'text-red-400',
                )}
              >
                {trend.positive ? '↑' : '↓'} {trend.value}
              </span>
              <span className="text-xs text-slate-600">vs ayer</span>
            </div>
          )}
        </div>
        <div
          className={cn(
            'w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ml-3',
            colors.bg,
            'border',
            colors.border,
          )}
        >
          <Icon className={cn('w-5 h-5', colors.icon)} />
        </div>
      </div>
    </div>
  );
}
