import type { ConnzectServer } from '@/types';
import { cn } from '@/lib/utils';
import styles from './landing-page.module.css';

interface ServerCardProps {
  server: ConnzectServer;
  collapsed?: boolean;
  onOpen: (serverId: string) => void;
}

const getInitials = (name: string) => {
  const trimmed = name.trim();
  if (!trimmed) return 'SV';

  const initials = trimmed
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return initials || trimmed.slice(0, 2).toUpperCase();
};

export const ServerCard = ({ server, collapsed = false, onOpen }: ServerCardProps) => {
  const initials = getInitials(server.name);

  return (
    <button
      type="button"
      title={server.name}
      onClick={() => onOpen(server.id)}
      className={cn(
        styles.surface,
        styles.cardLift,
        'group flex w-full items-center gap-3 rounded-2xl border px-3 py-3 text-left transition',
        collapsed ? 'justify-center px-2' : ''
      )}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-emerald-100/20 bg-emerald-300/10 text-xs font-semibold tracking-[0.14em] text-emerald-100">
        {initials}
      </div>
      <div className={cn('min-w-0', collapsed ? 'hidden' : 'block')}>
        <p className="truncate text-sm font-medium text-slate-100">{server.name}</p>
        <p className="mt-0.5 text-xs text-emerald-100/60">Server</p>
      </div>
    </button>
  );
};
