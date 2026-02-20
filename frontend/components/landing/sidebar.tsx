import type { ConnzectServer } from '@/types';
import { cn } from '@/lib/utils';
import { ServerCard } from './server-card';
import styles from './landing-page.module.css';

interface SidebarProps {
  servers: ConnzectServer[];
  collapsed?: boolean;
  className?: string;
  onOpenServer: (serverId: string) => void;
  onServerPicked?: () => void;
}

export const Sidebar = ({
  servers,
  collapsed = false,
  className,
  onOpenServer,
  onServerPicked
}: SidebarProps) => {
  const handleOpen = (serverId: string) => {
    onOpenServer(serverId);
    onServerPicked?.();
  };

  return (
    <aside className={cn(styles.surface, 'flex h-full min-h-0 flex-col rounded-3xl border p-3', className)}>
      <div className={cn('mb-3 flex items-center', collapsed ? 'justify-center' : 'justify-between')}>
        <p className={cn('text-xs uppercase tracking-[0.24em] text-slate-400', collapsed ? 'hidden' : 'block')}>Servers</p>
        <div className={cn('h-2 w-2 rounded-full bg-emerald-300/70', collapsed ? 'hidden' : 'block')} />
      </div>

      <div className={cn(styles.scrollArea, 'min-h-0 flex-1 space-y-2 overflow-y-auto pr-1')}>
        {servers.map((server) => (
          <ServerCard key={server.id} server={server} collapsed={collapsed} onOpen={handleOpen} />
        ))}

        {servers.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/20 p-4 text-xs text-slate-400">
            No servers available yet.
          </div>
        ) : null}
      </div>
    </aside>
  );
};
