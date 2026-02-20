'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AuthGuard } from '@/components/layout/auth-guard';
import { CreateServerForm } from '@/components/forms/create-server-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth-context';
import type { ConnzectServer, DirectConversation } from '@/types';
import { NewsCard, type NewsCardVariant } from './news-card';
import { Sidebar } from './sidebar';
import styles from './landing-page.module.css';

const featuredLayout: NewsCardVariant[] = ['hero', 'medium', 'wide'];

const getServerNewsCount = (server: ConnzectServer, index: number) => ((server.name.length + index * 3) % 8) + 3;

interface LandingPageProps {
  requireAuth?: boolean;
}

export const LandingPage = ({ requireAuth = false }: LandingPageProps) => {
  const router = useRouter();
  const { user, loading, logout, authRequest } = useAuth();
  const [servers, setServers] = useState<ConnzectServer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [tabletSidebarCollapsed, setTabletSidebarCollapsed] = useState(false);
  const [isTabletViewport, setIsTabletViewport] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  const [dmEmail, setDmEmail] = useState('');

  useEffect(() => {
    if (loading || !user) {
      setServers([]);
      setError(null);
      return;
    }

    let mounted = true;

    authRequest<ConnzectServer[]>('/servers')
      .then((data) => {
        if (!mounted) return;
        setServers(data);
      })
      .catch((nextError) => {
        if (!mounted) return;
        setError(nextError instanceof Error ? nextError.message : 'Failed to load servers');
      });

    return () => {
      mounted = false;
    };
  }, [authRequest, loading, user]);

  useEffect(() => {
    const handleResize = () => {
      const width = window.innerWidth;
      setIsTabletViewport(width >= 768 && width < 1024);
      if (width >= 768) {
        setMobileSidebarOpen(false);
      }
    };

    handleResize();
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  useEffect(() => {
    if (!isTabletViewport) {
      setTabletSidebarCollapsed(false);
    }
  }, [isTabletViewport]);

  const featuredServers = useMemo(
    () =>
      servers.slice(0, 3).map((server, index) => ({
        server,
        variant: featuredLayout[index] ?? 'medium',
        newsCount: getServerNewsCount(server, index)
      })),
    [servers]
  );

  const connzectNewsCount = Math.max(3, servers.length * 2 + 1);

  const openServer = (serverId: string) => {
    if (!user) {
      router.push('/login');
      return;
    }
    router.push(`/server/${serverId}`);
  };

  const handleLogout = () => {
    logout().then(() => router.replace('/login'));
  };

  const joinInvite = async (event: FormEvent) => {
    event.preventDefault();
    const code = inviteCode.trim();
    if (!code) return;

    try {
      const joined = await authRequest<{ server: { id: string } }>(`/invites/${code}/join`, {
        method: 'POST'
      });
      setInviteCode('');
      openServer(joined.server.id);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to join invite');
    }
  };

  const startDm = async (event: FormEvent) => {
    event.preventDefault();
    if (!dmEmail.trim()) return;

    try {
      const conversation = await authRequest<DirectConversation>('/dm/conversations', {
        method: 'POST',
        body: JSON.stringify({ email: dmEmail })
      });
      setDmEmail('');
      router.push(`/dm/${conversation.id}`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to start DM');
    }
  };

  const sidebarCollapsed = isTabletViewport && tabletSidebarCollapsed;

  const content = (
    <>
      <div className={cn(styles.shell, 'text-slate-100')}>
        <header className={cn(styles.header, 'sticky top-0 z-50')}>
          <div className="relative mx-auto flex h-20 max-w-[1600px] items-center gap-2 px-4 md:px-8">
            <button
              type="button"
              className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/15 bg-white/5 md:hidden"
              onClick={() => setMobileSidebarOpen(true)}
              aria-label="Open sidebar"
            >
              <div className="space-y-1.5">
                <span className="block h-0.5 w-5 rounded-full bg-slate-200" />
                <span className="block h-0.5 w-5 rounded-full bg-slate-200" />
                <span className="block h-0.5 w-5 rounded-full bg-slate-200" />
              </div>
            </button>

            <button
              type="button"
              className="hidden h-11 w-11 items-center justify-center rounded-2xl border border-white/15 bg-white/5 md:inline-flex lg:hidden"
              onClick={() => setTabletSidebarCollapsed((current) => !current)}
              aria-label="Toggle sidebar"
            >
              <span className="text-sm text-slate-200">{sidebarCollapsed ? '>' : '<'}</span>
            </button>

            <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
              <div className={cn(styles.logoBadge, 'rounded-full px-5 py-2')}>
                <span className="text-xs font-semibold tracking-[0.34em] text-emerald-50">CONNZECT</span>
              </div>
            </div>

            <div className="ml-auto flex items-center gap-2">
              {user ? (
                <>
                  <Button variant="soft" className="hidden sm:inline-flex" onClick={() => router.push('/dm')}>
                    Direct Messages
                  </Button>
                  <Button variant="soft" onClick={handleLogout}>
                    Logout
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="soft" className="hidden sm:inline-flex" onClick={() => router.push('/register')}>
                    Register
                  </Button>
                  <Button variant="soft" onClick={() => router.push('/login')}>
                    Login
                  </Button>
                </>
              )}
            </div>
          </div>
        </header>

        <div
          className={cn(
            'fixed inset-0 z-40 bg-black/70 backdrop-blur-sm transition-opacity duration-300 md:hidden',
            mobileSidebarOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
          )}
          onClick={() => setMobileSidebarOpen(false)}
        />

        <div
          className={cn(
            'fixed inset-y-0 left-0 z-50 w-72 p-4 transition-transform duration-300 md:hidden',
            mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'
          )}
        >
          <Sidebar
            servers={servers}
            onOpenServer={openServer}
            onServerPicked={() => setMobileSidebarOpen(false)}
            className="h-full"
          />
        </div>

        <div className="mx-auto flex w-full max-w-[1600px] gap-6 px-4 pb-8 pt-6 md:px-8">
          <div
            className={cn(
              'hidden shrink-0 transition-[width] duration-300 ease-out md:block lg:w-[17rem]',
              sidebarCollapsed ? 'w-20' : 'w-72'
            )}
          >
            <Sidebar servers={servers} collapsed={sidebarCollapsed} onOpenServer={openServer} className="h-[calc(100vh-7.5rem)]" />
          </div>

          <main className="min-w-0 flex-1 space-y-6">
            <section className={cn(styles.surface, styles.fadeIn, 'rounded-3xl border p-5')}>
              <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Workspace</p>
              <h1 className="mt-2 text-2xl font-semibold text-white sm:text-3xl">
                {user ? `Welcome back, ${user.displayName}` : 'Connzect Landing'}
              </h1>
              <p className="mt-2 text-sm text-slate-300">
                {user
                  ? 'Your mint-black activity board with all server highlights in one place.'
                  : 'Mint-black overview for your communities, updates, and workspace activity.'}
              </p>
            </section>

            {user && error ? (
              <section className="rounded-2xl border border-red-400/40 bg-red-500/10 p-4 text-sm text-red-200">{error}</section>
            ) : null}

            <section className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.85fr)]">
              <div className="grid gap-6 sm:auto-rows-[170px] sm:grid-cols-2">
                {featuredServers.map((entry, index) => (
                  <NewsCard
                    key={entry.server.id}
                    server={entry.server}
                    newsCount={entry.newsCount}
                    variant={entry.variant}
                    onOpenServer={openServer}
                    delayClassName={index === 0 ? styles.fadeDelay1 : index === 1 ? styles.fadeDelay2 : styles.fadeDelay3}
                  />
                ))}

                {featuredServers.length === 0 ? (
                  <div className={cn(styles.surface, styles.fadeIn, 'rounded-3xl border p-6 sm:col-span-2')}>
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Server News</p>
                    <h3 className="mt-2 text-xl font-semibold text-white">No servers available</h3>
                    <p className="mt-2 text-sm text-slate-300">Create or join a server to unlock the personalized news grid.</p>
                  </div>
                ) : null}
              </div>

              <section className={cn(styles.surfaceStrong, styles.cardLift, styles.fadeIn, styles.fadeDelay2, 'rounded-3xl border p-6')}>
                <p className="text-xs uppercase tracking-[0.22em] text-emerald-100/70">Connzect News</p>
                <h2 className="mt-2 text-3xl font-semibold text-white">{connzectNewsCount} Connzect News</h2>
                <p className="mt-3 text-sm text-slate-200/90">
                  Platform-wide release notes, trust alerts, and system updates curated for your workspace.
                </p>

                <div className="mt-6 space-y-3">
                  <div className="rounded-2xl border border-emerald-100/15 bg-black/15 px-4 py-3 text-sm text-emerald-50/90">Server uptime and reliability digest</div>
                  <div className="rounded-2xl border border-emerald-100/15 bg-black/15 px-4 py-3 text-sm text-emerald-50/90">Latest communication improvements</div>
                  <div className="rounded-2xl border border-emerald-100/15 bg-black/15 px-4 py-3 text-sm text-emerald-50/90">Moderation and safety highlights</div>
                </div>

                <div className="mt-6 flex flex-wrap gap-2">
                  <Button variant="soft" onClick={() => router.push(user ? '/dm' : '/login')}>
                    {user ? 'Open DM Hub' : 'Sign In'}
                  </Button>
                  {user ? (
                    <Button variant="soft" onClick={() => setActionsOpen((current) => !current)}>
                      {actionsOpen ? 'Hide Workspace Actions' : 'Workspace Actions'}
                    </Button>
                  ) : null}
                  {servers[0] ? (
                    <Button variant="soft" onClick={() => openServer(servers[0].id)}>
                      Open First Server
                    </Button>
                  ) : null}
                </div>
              </section>
            </section>

            {user && actionsOpen ? (
              <section className={cn(styles.surface, styles.fadeIn, 'rounded-3xl border p-6')}>
                <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Workspace Actions</p>
                <div className="mt-4 grid gap-4 xl:grid-cols-3">
                  <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
                    <h3 className="text-base font-semibold text-white">Create Server</h3>
                    <p className="mb-4 mt-1 text-xs text-slate-300">Provision instantly with icon upload.</p>
                    <CreateServerForm onCreated={(server) => setServers((previous) => [server, ...previous])} />
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
                    <h3 className="text-base font-semibold text-white">Join by Invite</h3>
                    <p className="mb-4 mt-1 text-xs text-slate-300">Paste an invite code and enter directly.</p>
                    <form className="space-y-2" onSubmit={joinInvite}>
                      <Input
                        required
                        placeholder="Paste invite code"
                        value={inviteCode}
                        onChange={(event) => setInviteCode(event.target.value)}
                      />
                      <Button variant="soft" className="w-full">
                        Join Server
                      </Button>
                    </form>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
                    <h3 className="text-base font-semibold text-white">Start Direct Message</h3>
                    <p className="mb-4 mt-1 text-xs text-slate-300">Open a DM thread by user email.</p>
                    <form className="space-y-2" onSubmit={startDm}>
                      <Input
                        required
                        type="email"
                        placeholder="User email"
                        value={dmEmail}
                        onChange={(event) => setDmEmail(event.target.value)}
                      />
                      <Button variant="soft" className="w-full">
                        Open DM
                      </Button>
                    </form>
                  </div>
                </div>
              </section>
            ) : null}
          </main>
        </div>
      </div>
    </>
  );

  if (requireAuth) {
    return <AuthGuard>{content}</AuthGuard>;
  }

  return content;
};
