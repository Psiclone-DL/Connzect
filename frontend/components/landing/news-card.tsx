import type { ConnzectServer } from '@/types';
import { cn } from '@/lib/utils';
import styles from './landing-page.module.css';

export type NewsCardVariant = 'hero' | 'medium' | 'wide';

interface NewsCardProps {
  server: ConnzectServer;
  newsCount: number;
  variant: NewsCardVariant;
  onOpenServer: (serverId: string) => void;
  delayClassName?: string;
}

const variantLayout: Record<NewsCardVariant, string> = {
  hero: 'sm:col-span-2 sm:row-span-2 min-h-[17.5rem]',
  medium: 'min-h-[11rem]',
  wide: 'sm:col-span-2 min-h-[12rem]'
};

export const NewsCard = ({ server, newsCount, variant, onOpenServer, delayClassName }: NewsCardProps) => {
  return (
    <button
      type="button"
      onClick={() => onOpenServer(server.id)}
      className={cn(
        styles.surface,
        styles.cardLift,
        styles.fadeIn,
        variantLayout[variant],
        delayClassName,
        'relative overflow-hidden rounded-3xl border p-6 text-left'
      )}
    >
      <div className="pointer-events-none absolute -right-20 -top-20 h-52 w-52 rounded-full bg-emerald-300/10 blur-3xl" />
      <p className="text-xs uppercase tracking-[0.22em] text-emerald-100/70">Server News</p>
      <h3 className="mt-2 text-2xl font-semibold text-white">{server.name}</h3>
      <p className="mt-2 text-sm text-emerald-50/80">{newsCount} Server News</p>
      <p className="mt-5 max-w-md text-sm text-slate-300">
        Updates, activity highlights, and important announcements from this server.
      </p>
      <span className="mt-7 inline-flex rounded-xl border border-white/20 px-3 py-1 text-xs uppercase tracking-[0.18em] text-slate-200">
        Open server
      </span>
    </button>
  );
};
