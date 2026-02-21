import type { ConnzectServer } from '@/types';
import { cn } from '@/lib/utils';
import { ServerCard } from './server-card';
import styles from './landing-page.module.css';

interface SidebarProps {
  servers: ConnzectServer[];
  activeServerId?: string | null;
  collapsed?: boolean;
  className?: string;
  onOpenServer: (serverId: string) => void;
  onJoinServer?: () => void;
  onServerPicked?: () => void;
}

export const Sidebar = ({
  servers,
  activeServerId,
  collapsed = false,
  className,
  onOpenServer,
  onJoinServer,
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
        <div className="flex items-center gap-2">
          {onJoinServer ? (
            <button
              type="button"
              onClick={onJoinServer}
              className={cn(
                styles.joinButton,
                'inline-flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-base leading-none text-emerald-100'
              )}
              title="Join or create server"
              aria-label="Join or create server"
            >
              +
            </button>
          ) : null}
          <span
            className={cn(
              'inline-flex min-w-6 items-center justify-center rounded-md border border-white/15 bg-white/5 px-1.5 py-0.5 text-[10px] font-semibold text-slate-200',
              collapsed ? 'hidden' : 'inline-flex'
            )}
            title={`${servers.length} servers`}
            aria-label={`Server count: ${servers.length}`}
          >
            {servers.length}
          </span>
          <div className={cn('h-2 w-2 rounded-full bg-emerald-300/70', collapsed ? 'hidden' : 'block')} />
        </div>
      </div>

      <div className={cn(styles.scrollArea, 'min-h-0 flex-1 space-y-2 overflow-x-hidden overflow-y-auto pr-1')}>
        {servers.map((server) => (
          <ServerCard
            key={server.id}
            server={server}
            collapsed={collapsed}
            isActive={activeServerId === server.id}
            onOpen={handleOpen}
          />
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
