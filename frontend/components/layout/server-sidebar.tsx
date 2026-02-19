'use client';

import Link from 'next/link';
import { ConnzectServer } from '@/types';
import { cn } from '@/lib/utils';

interface ServerSidebarProps {
  servers: ConnzectServer[];
  activeServerId?: string;
}

export const ServerSidebar = ({ servers, activeServerId }: ServerSidebarProps) => {
  return (
    <aside className="glass w-full rounded-2xl p-3 md:w-64">
      <p className="mb-3 text-xs uppercase tracking-[0.2em] text-slate-400">Servers</p>
      <div className="space-y-2">
        {servers.map((server) => (
          <Link
            key={server.id}
            href={`/server/${server.id}`}
            className={cn(
              'flex items-center gap-3 rounded-xl border border-transparent px-3 py-2 text-sm transition hover:border-white/20 hover:bg-white/5',
              activeServerId === server.id ? 'border-burgundySoft/50 bg-white/5' : ''
            )}
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-burgundySoft/80 text-xs font-bold uppercase">
              {server.name.slice(0, 2)}
            </div>
            <span className="truncate">{server.name}</span>
          </Link>
        ))}
      </div>
    </aside>
  );
};
