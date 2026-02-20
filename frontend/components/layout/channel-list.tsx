'use client';

import Link from 'next/link';
import { Channel } from '@/types';
import { cn } from '@/lib/utils';

interface ChannelListProps {
  serverId: string;
  channels: Channel[];
  activeChannelId?: string;
}

export const ChannelList = ({ serverId, channels, activeChannelId }: ChannelListProps) => {
  return (
    <section className="glass soft-scroll h-[calc(100vh-2rem)] overflow-y-auto rounded-2xl p-3">
      <p className="mb-3 px-1 text-xs uppercase tracking-[0.2em] text-slate-400">Channels</p>
      <div className="space-y-2">
        {channels.map((channel) => (
          <Link
            key={channel.id}
            href={`/server/${serverId}/channel/${channel.id}`}
            className={cn(
              'flex items-center justify-between rounded-xl border border-transparent px-3 py-2 text-sm transition hover:border-white/20 hover:bg-white/5',
              activeChannelId === channel.id ? 'border-burgundySoft/50 bg-white/5' : ''
            )}
          >
            <span>#{channel.name}</span>
            <span className="text-xs text-slate-400">{channel.type === 'TEXT' ? 'Text' : 'Voice'}</span>
          </Link>
        ))}
      </div>
    </section>
  );
};
