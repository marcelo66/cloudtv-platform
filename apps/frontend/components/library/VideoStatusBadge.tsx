import { cn } from '@/lib/utils';
import { Loader2, CheckCircle2, AlertCircle, Archive, Clock } from 'lucide-react';

type VideoStatus = 'PENDING' | 'PROCESSING' | 'READY' | 'ERROR' | 'ARCHIVED';

const config: Record<
  VideoStatus,
  { label: string; className: string; icon: React.ElementType; spin?: boolean }
> = {
  PENDING: {
    label: 'En cola',
    className: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
    icon: Clock,
  },
  PROCESSING: {
    label: 'Procesando',
    className: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
    icon: Loader2,
    spin: true,
  },
  READY: {
    label: 'Listo',
    className: 'bg-green-500/10 text-green-400 border-green-500/20',
    icon: CheckCircle2,
  },
  ERROR: {
    label: 'Error',
    className: 'bg-red-500/10 text-red-400 border-red-500/20',
    icon: AlertCircle,
  },
  ARCHIVED: {
    label: 'Archivado',
    className: 'bg-slate-500/10 text-slate-500 border-slate-500/20',
    icon: Archive,
  },
};

export function VideoStatusBadge({
  status,
  progress,
}: {
  status: VideoStatus;
  progress?: number | null;
}) {
  const { label, className, icon: Icon, spin } = config[status] ?? config.PENDING;

  const displayLabel =
    status === 'PROCESSING' && progress != null && progress > 0
      ? `Procesando · ${progress}%`
      : label;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border',
        className,
      )}
    >
      <Icon className={cn('w-3 h-3', spin && 'animate-spin')} />
      {displayLabel}
    </span>
  );
}
