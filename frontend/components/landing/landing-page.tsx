'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AuthGuard } from '@/components/layout/auth-guard';
import { CreateServerForm } from '@/components/forms/create-server-form';
import { MessageInput } from '@/components/chat/message-input';
import { MessageList } from '@/components/chat/message-list';
import { VoiceRoom } from '@/components/voice/voice-room';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth-context';
import { useSocket } from '@/hooks/use-socket';
import type { Channel, ConnzectServer, Message, Role, ServerDetails } from '@/types';
import { Sidebar } from './sidebar';
import styles from './landing-page.module.css';

interface LandingPageProps {
  requireAuth?: boolean;
}

const parseInviteCode = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return '';

  if (!/[/?#]/.test(trimmed)) {
    return trimmed;
  }

  const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const url = new URL(normalized);
    const queryCode =
      url.searchParams.get('code') ?? url.searchParams.get('invite') ?? url.searchParams.get('inviteCode');
    if (queryCode) {
      return decodeURIComponent(queryCode).trim();
    }

    const parts = url.pathname.split('/').filter(Boolean);
    const inviteIndex = parts.findIndex((part) =>
      ['invite', 'invites', 'join', 'server-invite'].includes(part.toLowerCase())
    );

    if (inviteIndex >= 0 && parts[inviteIndex + 1]) {
      return decodeURIComponent(parts[inviteIndex + 1]).trim();
    }

    if (parts.length > 0) {
      return decodeURIComponent(parts[parts.length - 1]).trim();
    }
  } catch {
    const fallback = trimmed.split('/').filter(Boolean).pop();
    if (fallback) {
      return fallback.split('?')[0].split('#')[0].trim();
    }
  }

  return '';
};

const parsePermissionValue = (value?: string): bigint => {
  try {
    return BigInt(value ?? '0');
  } catch {
    return 0n;
  }
};

const compareBigIntDesc = (left: bigint, right: bigint): number => {
  if (left === right) return 0;
  return left > right ? -1 : 1;
};

export const LandingPage = ({ requireAuth = false }: LandingPageProps) => {
  const router = useRouter();
  const { user, loading, logout, authRequest, accessToken } = useAuth();
  const socket = useSocket(accessToken);

  const [servers, setServers] = useState<ConnzectServer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [tabletSidebarCollapsed, setTabletSidebarCollapsed] = useState(false);
  const [isTabletViewport, setIsTabletViewport] = useState(false);
  const [isClosingServerView, setIsClosingServerView] = useState(false);
  const [isOpeningServerView, setIsOpeningServerView] = useState(false);
  const [joinModalOpen, setJoinModalOpen] = useState(false);
  const [serverModalTab, setServerModalTab] = useState<'join' | 'create'>('join');
  const [isJoiningInvite, setIsJoiningInvite] = useState(false);
  const [isLeavingServer, setIsLeavingServer] = useState(false);

  const [activeServerId, setActiveServerId] = useState<string | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [serverMembers, setServerMembers] = useState<ServerDetails['members']>([]);
  const [activeChannelId, setActiveChannelId] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [threadParent, setThreadParent] = useState<Message | null>(null);
  const [threadMessages, setThreadMessages] = useState<Message[]>([]);

  const [inviteCode, setInviteCode] = useState('');
  const closeTimerRef = useRef<number | null>(null);
  const openTimerRef = useRef<number | null>(null);
  const activeChannel = useMemo(
    () => channels.find((channel) => channel.id === activeChannelId) ?? null,
    [activeChannelId, channels]
  );

  const refreshServers = useCallback(async () => {
    const data = await authRequest<ConnzectServer[]>('/servers');
    setServers(data);
    return data;
  }, [authRequest]);

  useEffect(() => {
    if (loading || !user) {
      if (openTimerRef.current) {
        window.clearTimeout(openTimerRef.current);
        openTimerRef.current = null;
      }
      setServers([]);
      setError(null);
      setActiveServerId(null);
      setIsOpeningServerView(false);
      setJoinModalOpen(false);
      setServerModalTab('join');
      return;
    }

    let mounted = true;

    refreshServers()
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
  }, [loading, refreshServers, user]);

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

  useEffect(() => {
    if (!joinModalOpen) return;

    const onEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setJoinModalOpen(false);
      }
    };

    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [joinModalOpen]);

  useEffect(() => {
    if (!activeServerId) return;
    if (!servers.some((server) => server.id === activeServerId)) {
      setActiveServerId(null);
    }
  }, [activeServerId, servers]);

  useEffect(
    () => () => {
      if (closeTimerRef.current) {
        window.clearTimeout(closeTimerRef.current);
      }
      if (openTimerRef.current) {
        window.clearTimeout(openTimerRef.current);
      }
    },
    []
  );

  useEffect(() => {
    if (!activeServerId) {
      setChannels([]);
      setServerMembers([]);
      setActiveChannelId('');
      setMessages([]);
      setThreadParent(null);
      setThreadMessages([]);
      return;
    }

    let cancelled = false;

    Promise.all([
      authRequest<Channel[]>(`/servers/${activeServerId}/channels`),
      authRequest<ServerDetails>(`/servers/${activeServerId}`)
    ])
      .then(([loadedChannels, serverDetails]) => {
        if (cancelled) return;
        setChannels(loadedChannels);
        setServerMembers(serverDetails.members);
      })
      .catch((nextError) => {
        if (cancelled) return;
        setError(nextError instanceof Error ? nextError.message : 'Failed loading channels');
        setChannels([]);
        setServerMembers([]);
      });

    return () => {
      cancelled = true;
    };
  }, [activeServerId, authRequest]);

  useEffect(() => {
    if (channels.length === 0) {
      setActiveChannelId('');
      setMessages([]);
      setThreadParent(null);
      setThreadMessages([]);
      return;
    }

    if (channels.some((channel) => channel.id === activeChannelId)) return;
    const firstText = channels.find((channel) => channel.type === 'TEXT');
    setActiveChannelId((firstText ?? channels[0]).id);
  }, [activeChannelId, channels]);

  useEffect(() => {
    if (!activeChannelId || !activeChannel || activeChannel.type === 'VOICE') {
      setMessages([]);
      setThreadParent(null);
      setThreadMessages([]);
      return;
    }

    authRequest<Message[]>(`/channels/${activeChannelId}/messages?limit=50`)
      .then((loadedMessages) => {
        setMessages(loadedMessages);
        setThreadParent(null);
        setThreadMessages([]);
      })
      .catch((nextError) => {
        setError(nextError instanceof Error ? nextError.message : 'Failed loading messages');
      });
  }, [activeChannel, activeChannelId, authRequest]);

  useEffect(() => {
    if (!threadParent || !activeChannelId || !activeChannel || activeChannel.type === 'VOICE') return;

    authRequest<Message[]>(`/channels/${activeChannelId}/messages?limit=50&parentMessageId=${threadParent.id}`)
      .then(setThreadMessages)
      .catch((nextError) => setError(nextError instanceof Error ? nextError.message : 'Failed loading thread'));
  }, [activeChannel, activeChannelId, authRequest, threadParent]);

  useEffect(() => {
    if (!socket || !activeChannelId || !activeChannel || activeChannel.type === 'VOICE') return;

    const joinChannel = () => {
      socket.emit('channel:join', { channelId: activeChannelId });
    };

    if (socket.connected) {
      joinChannel();
    }

    const onMessage = (message: Message) => {
      if (message.channelId !== activeChannelId) return;

      if (message.parentMessageId) {
        if (threadParent && message.parentMessageId === threadParent.id) {
          setThreadMessages((previous) => [...previous, message]);
        }
        return;
      }

      setMessages((previous) => [...previous, message]);
    };

    const onMessageUpdated = (message: Message) => {
      if (message.channelId !== activeChannelId) return;

      setMessages((previous) => previous.map((entry) => (entry.id === message.id ? message : entry)));
      setThreadMessages((previous) => previous.map((entry) => (entry.id === message.id ? message : entry)));
      setThreadParent((previous) => (previous?.id === message.id ? message : previous));
    };

    const onMessageDeleted = (payload: { id: string; channelId: string }) => {
      if (payload.channelId !== activeChannelId) return;
      setMessages((previous) => previous.filter((entry) => entry.id !== payload.id));
      setThreadMessages((previous) => previous.filter((entry) => entry.id !== payload.id));
      setThreadParent((previous) => (previous?.id === payload.id ? null : previous));
    };

    const onError = (payload: { scope: string; message: string }) => {
      setError(`${payload.scope}: ${payload.message}`);
    };

    socket.on('message:new', onMessage);
    socket.on('message:updated', onMessageUpdated);
    socket.on('message:deleted', onMessageDeleted);
    socket.on('error:event', onError);
    socket.on('connect', joinChannel);

    return () => {
      socket.emit('channel:leave', { channelId: activeChannelId });
      socket.off('message:new', onMessage);
      socket.off('message:updated', onMessageUpdated);
      socket.off('message:deleted', onMessageDeleted);
      socket.off('error:event', onError);
      socket.off('connect', joinChannel);
    };
  }, [activeChannel, activeChannelId, socket, threadParent]);

  const activeServer = useMemo(
    () => (activeServerId ? servers.find((server) => server.id === activeServerId) ?? null : null),
    [activeServerId, servers]
  );

  const rankedMembers = useMemo(() => {
    if (!activeServer || serverMembers.length === 0) return [];

    const ownerBoost = 1n << 62n;

    const ranked = serverMembers
      .map((member) => {
        const isOwner = member.userId === activeServer.ownerId;
        const availableRoles = member.memberRoles
          .map((memberRole) => memberRole.role)
          .filter((role): role is Role => Boolean(role));

        const sortedRoles = [...availableRoles].sort((left, right) => {
          const byPermissions = compareBigIntDesc(
            parsePermissionValue(left.permissions),
            parsePermissionValue(right.permissions)
          );
          if (byPermissions !== 0) return byPermissions;
          return right.position - left.position;
        });

        const topCustomRole = sortedRoles.find((role) => !role.isDefault) ?? null;
        const topRole = topCustomRole ?? sortedRoles[0] ?? null;
        const basePower = parsePermissionValue(topRole?.permissions);
        const power = basePower + (isOwner ? ownerBoost : 0n);
        const category = isOwner ? topCustomRole?.name ?? 'Founder' : topCustomRole?.name ?? 'Member';

        return {
          id: member.id,
          displayName: member.nickname?.trim() || member.user.displayName,
          initials:
            (member.nickname?.trim() || member.user.displayName)
              .split(/\s+/)
              .map((part) => part[0])
              .join('')
              .slice(0, 2)
              .toUpperCase() || 'MB',
          isOwner,
          category,
          roleLabel: topCustomRole?.name ?? (isOwner ? 'Founder' : 'Member'),
          roleColor: topCustomRole?.color ?? null,
          power
        };
      })
      .sort((left, right) => {
        const byPower = compareBigIntDesc(left.power, right.power);
        if (byPower !== 0) return byPower;
        if (left.isOwner !== right.isOwner) return left.isOwner ? -1 : 1;
        return left.displayName.localeCompare(right.displayName);
      });

    return ranked.map((entry, index) => ({
      ...entry,
      rank: index + 1
    }));
  }, [activeServer, serverMembers]);

  const categorizedMembers = useMemo(() => {
    const categories = new Map<
      string,
      {
        name: string;
        strongestPower: bigint;
        members: typeof rankedMembers;
      }
    >();

    for (const member of rankedMembers) {
      const existing = categories.get(member.category);
      if (!existing) {
        categories.set(member.category, {
          name: member.category,
          strongestPower: member.power,
          members: [member]
        });
        continue;
      }

      existing.members.push(member);
      if (member.power > existing.strongestPower) {
        existing.strongestPower = member.power;
      }
    }

    return Array.from(categories.values()).sort((left, right) => {
      const byPower = compareBigIntDesc(left.strongestPower, right.strongestPower);
      if (byPower !== 0) return byPower;
      return left.name.localeCompare(right.name);
    });
  }, [rankedMembers]);

  const openServerWidget = (serverId: string) => {
    if (activeServerId === serverId) {
      closeServer();
      return;
    }

    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }

    if (openTimerRef.current) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }

    setIsClosingServerView(false);

    if (!activeServerId) {
      setIsOpeningServerView(true);
      openTimerRef.current = window.setTimeout(() => {
        setActiveServerId(serverId);
        setIsOpeningServerView(false);
        openTimerRef.current = null;
      }, 220);
      return;
    }

    setIsOpeningServerView(false);
    setActiveServerId(serverId);
  };

  const closeServer = () => {
    if (openTimerRef.current) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
      setIsOpeningServerView(false);
    }

    if (!activeServerId || isClosingServerView) return;

    setIsClosingServerView(true);
    closeTimerRef.current = window.setTimeout(() => {
      setActiveServerId(null);
      setIsClosingServerView(false);
      closeTimerRef.current = null;
    }, 220);
  };

  const handleLogout = () => {
    logout().then(() => router.replace('/login'));
  };

  const upsertMessageLocal = (message: Message) => {
    if (message.parentMessageId) {
      setThreadMessages((previous) => {
        if (previous.some((entry) => entry.id === message.id)) {
          return previous.map((entry) => (entry.id === message.id ? message : entry));
        }
        return [...previous, message];
      });
      return;
    }

    setMessages((previous) => {
      if (previous.some((entry) => entry.id === message.id)) {
        return previous.map((entry) => (entry.id === message.id ? message : entry));
      }
      return [...previous, message];
    });
  };

  const removeMessageLocal = (messageId: string) => {
    setMessages((previous) => previous.filter((entry) => entry.id !== messageId));
    setThreadMessages((previous) => previous.filter((entry) => entry.id !== messageId));
    setThreadParent((previous) => (previous?.id === messageId ? null : previous));
  };

  const sendMessage = async (content: string, parentMessageId?: string) => {
    if (!activeChannelId) return;
    if (!activeChannel || activeChannel.type === 'VOICE') {
      setError('Voice channels do not support text chat');
      return;
    }

    if (!socket?.connected) {
      const created = await authRequest<Message>(`/channels/${activeChannelId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content, parentMessageId })
      });
      upsertMessageLocal(created);
      return;
    }

    socket.emit('message:send', { channelId: activeChannelId, content, parentMessageId });
  };

  const editMessage = async (messageId: string, content: string) => {
    if (!activeChannelId) return;
    if (!activeChannel || activeChannel.type === 'VOICE') {
      setError('Voice channels do not support text chat');
      return;
    }

    if (!socket?.connected) {
      const updated = await authRequest<Message>(`/channels/${activeChannelId}/messages/${messageId}`, {
        method: 'PATCH',
        body: JSON.stringify({ content })
      });
      upsertMessageLocal(updated);
      return;
    }

    socket.emit('message:edit', { channelId: activeChannelId, messageId, content });
  };

  const deleteMessage = async (messageId: string) => {
    if (!activeChannelId) return;
    if (!activeChannel || activeChannel.type === 'VOICE') {
      setError('Voice channels do not support text chat');
      return;
    }

    if (!socket?.connected) {
      const deleted = await authRequest<{ id: string }>(`/channels/${activeChannelId}/messages/${messageId}`, {
        method: 'DELETE'
      });
      removeMessageLocal(deleted.id);
      return;
    }

    socket.emit('message:delete', { channelId: activeChannelId, messageId });
  };

  const joinInvite = async (event: FormEvent) => {
    event.preventDefault();
    const code = parseInviteCode(inviteCode);
    if (!code) return;

    setIsJoiningInvite(true);
    try {
      const joined = await authRequest<{ server: ConnzectServer }>(`/invites/${code}/join`, {
        method: 'POST'
      });
      setError(null);
      setInviteCode('');
      setJoinModalOpen(false);
      setServerModalTab('join');
      try {
        await refreshServers();
      } catch {
        setServers((previous) => {
          if (previous.some((server) => server.id === joined.server.id)) {
            return previous;
          }
          return [joined.server, ...previous];
        });
      }
      setIsClosingServerView(false);
      setIsOpeningServerView(false);
      setActiveServerId(joined.server.id);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to join invite');
    } finally {
      setIsJoiningInvite(false);
    }
  };

  const leaveServer = async () => {
    if (!activeServer || !user || isLeavingServer) return;

    const ownerExitWarning =
      activeServer.ownerId === user.id
        ? 'You are the owner. Leaving will transfer ownership to another member, or delete the server if you are alone.\n\n'
        : '';

    if (!window.confirm(`${ownerExitWarning}Leave "${activeServer.name}"?`)) {
      return;
    }

    setIsLeavingServer(true);
    try {
      await authRequest(`/servers/${activeServer.id}/members/me`, {
        method: 'DELETE'
      });
      setError(null);
      if (closeTimerRef.current) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      setServers((previous) => previous.filter((server) => server.id !== activeServer.id));
      setActiveServerId(null);
      setIsClosingServerView(false);
      setIsOpeningServerView(false);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to leave server');
    } finally {
      setIsLeavingServer(false);
    }
  };

  const openServerModal = (tab: 'join' | 'create' = 'join') => {
    setServerModalTab(tab);
    setJoinModalOpen(true);
  };

  const handleServerCreated = (server: ConnzectServer) => {
    setServers((previous) => {
      if (previous.some((entry) => entry.id === server.id)) {
        return previous;
      }
      return [server, ...previous];
    });
    setJoinModalOpen(false);
    setServerModalTab('join');
    setIsClosingServerView(false);
    setIsOpeningServerView(false);
    setActiveServerId(server.id);
    setError(null);
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
              activeServerId={activeServerId}
              onOpenServer={openServerWidget}
              onJoinServer={user ? () => openServerModal('join') : undefined}
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
            <Sidebar
              servers={servers}
              activeServerId={activeServerId}
              collapsed={sidebarCollapsed}
              onOpenServer={openServerWidget}
              onJoinServer={user ? () => openServerModal('join') : undefined}
              className="h-[calc(100vh-7.5rem)]"
            />
          </div>

          <main className="min-w-0 flex-1 space-y-6">
            {user && error ? (
              <section className="rounded-2xl border border-red-400/40 bg-red-500/10 p-4 text-sm text-red-200">{error}</section>
            ) : null}

            {activeServer ? (
              <section
                className={cn(
                  styles.surfaceStrong,
                  styles.fadeIn,
                  isClosingServerView ? styles.panelOut : styles.panelIn,
                  'rounded-3xl border p-6'
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="mt-2 text-2xl font-semibold text-white">{activeServer.name}</h2>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="danger"
                      onClick={leaveServer}
                      disabled={isLeavingServer}
                      title="Leave server"
                    >
                      {isLeavingServer ? 'Leaving...' : 'Leave'}
                    </Button>
                    <Button variant="soft" onClick={closeServer}>
                      Close
                    </Button>
                  </div>
                </div>

                <div className="mt-6 grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)_280px]">
                  <aside className="rounded-2xl border border-white/10 bg-black/15 p-3">
                    <div className="soft-scroll max-h-[56vh] space-y-2 overflow-y-auto pr-1">
                      {channels.map((channel) => (
                        <button
                          key={channel.id}
                          type="button"
                          onClick={() => setActiveChannelId(channel.id)}
                          className={cn(
                            'flex w-full items-center justify-between rounded-xl border px-3 py-2 text-sm transition',
                            activeChannelId === channel.id
                              ? 'border-emerald-200/45 bg-white/10'
                              : 'border-transparent hover:border-white/20 hover:bg-white/5'
                          )}
                        >
                          <span className="inline-flex items-center gap-2">
                            {channel.type === 'VOICE' ? (
                              <svg
                                aria-hidden="true"
                                viewBox="0 0 24 24"
                                className="h-4 w-4 text-emerald-100/85"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <path d="M11 5 6 9H2v6h4l5 4V5Z" />
                                <path d="M15.5 8.5a5 5 0 0 1 0 7" />
                                <path d="M18.5 6a8.5 8.5 0 0 1 0 12" />
                              </svg>
                            ) : (
                              <span className="text-emerald-100/85">#</span>
                            )}
                            <span>{channel.name}</span>
                          </span>
                        </button>
                      ))}
                      {channels.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-white/20 p-4 text-xs text-slate-400">
                          No channels available for this server.
                        </div>
                      ) : null}
                    </div>
                  </aside>

                  <section className="rounded-2xl border border-white/10 bg-black/15 p-4">
                    {activeChannel ? (
                      activeChannel.type === 'VOICE' ? (
                        socket ? (
                          <VoiceRoom channelId={activeChannel.id} socket={socket} />
                        ) : (
                          <div className="rounded-2xl border border-dashed border-white/20 p-6 text-sm text-slate-300">
                            Voice channel selected. Realtime connection is required to join voice.
                          </div>
                        )
                      ) : (
                        <div className={`grid gap-4 ${threadParent ? 'lg:grid-cols-[1.6fr_1fr]' : ''}`}>
                          <div>
                            <MessageList
                              messages={messages}
                              currentUserId={user?.id}
                              onEdit={editMessage}
                              onDelete={deleteMessage}
                              allowDeleteOthers={activeServer.ownerId === user?.id}
                              onOpenThread={(message) => setThreadParent(message as Message)}
                              activeThreadParentId={threadParent?.id ?? null}
                            />
                            <MessageInput onSend={(content) => sendMessage(content)} placeholder="Type in channel" />
                          </div>

                          {threadParent ? (
                            <div className="glass rounded-xl border border-white/10 p-3">
                              <div className="mb-3 flex items-center justify-between gap-2">
                                <div>
                                  <p className="text-sm font-semibold">Thread</p>
                                  <p className="text-xs text-slate-400">From {threadParent.author.displayName}</p>
                                </div>
                                <Button variant="soft" type="button" onClick={() => setThreadParent(null)}>
                                  Close
                                </Button>
                              </div>

                              <MessageList
                                messages={threadMessages}
                                currentUserId={user?.id}
                                onEdit={editMessage}
                                onDelete={deleteMessage}
                                allowDeleteOthers={activeServer.ownerId === user?.id}
                              />
                              <MessageInput
                                onSend={(content) => sendMessage(content, threadParent.id)}
                                placeholder="Reply in thread"
                                submitLabel="Reply"
                              />
                            </div>
                          ) : null}
                        </div>
                      )
                    ) : (
                      <div className="rounded-2xl border border-dashed border-white/20 p-6 text-sm text-slate-300">
                        Pick a channel from the left box to view and send messages here.
                      </div>
                    )}
                  </section>

                  <aside className="rounded-2xl border border-white/10 bg-black/15 p-3">
                    <div className="soft-scroll max-h-[56vh] space-y-3 overflow-y-auto pr-1">
                      {categorizedMembers.map((group) => (
                        <section key={group.name} className="rounded-xl border border-white/10 bg-black/10 p-2.5">
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <p className="text-[10px] uppercase tracking-[0.2em] text-emerald-100/70">{group.name}</p>
                            <span className="text-[10px] text-slate-400">{group.members.length}</span>
                          </div>

                          <div className="space-y-1.5">
                            {group.members.map((member) => (
                              <div
                                key={member.id}
                                className="flex items-center justify-between gap-2 rounded-lg border border-transparent px-2 py-1.5 transition hover:border-white/15 hover:bg-white/5"
                              >
                                <div className="min-w-0 flex items-center gap-2">
                                  <span className="w-6 text-[10px] text-slate-400">#{member.rank}</span>
                                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-white/15 bg-white/5 text-[10px] font-semibold tracking-[0.08em] text-slate-200">
                                    {member.initials}
                                  </span>
                                  <span className="truncate text-sm text-slate-100">{member.displayName}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </section>
                      ))}

                      {rankedMembers.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-white/20 p-4 text-xs text-slate-400">
                          No players found for this server yet.
                        </div>
                      ) : null}
                    </div>
                  </aside>
                </div>
              </section>
            ) : (
              <section
                className={cn(styles.surface, styles.fadeIn, isOpeningServerView ? styles.panelOut : styles.panelIn, 'rounded-3xl border p-6')}
              >
                <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
                  <article className="rounded-2xl border border-white/10 bg-black/15 p-5">
                    <p className="text-xs uppercase tracking-[0.22em] text-emerald-100/70">News Feed</p>
                    <h3 className="mt-2 text-2xl font-semibold text-white">Connzect Updates</h3>
                    <p className="mt-2 text-sm text-slate-300">
                      Select a server from the left sidebar to open channels and continue conversations.
                    </p>
                    <div className="mt-5 space-y-2 text-sm text-slate-200">
                      <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">Realtime messaging improvements live.</div>
                      <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">Auto-update channel running on latest release stream.</div>
                      <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">Workspace latency and reliability optimizations deployed.</div>
                    </div>
                  </article>

                  <article className="rounded-2xl border border-white/10 bg-black/15 p-5">
                    <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Mint Black</p>
                    <h3 className="mt-2 text-2xl font-semibold text-white">Workspace Overview</h3>
                    <p className="mt-2 text-sm text-slate-300">
                      Use the left sidebar to select any server. Channels and messages will open instantly in this page.
                    </p>
                    <div className="mt-5 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200">
                      Active servers in workspace: <span className="text-emerald-100">{servers.length}</span>
                    </div>
                  </article>
                </div>
              </section>
            )}

          </main>
        </div>

        {user && joinModalOpen ? (
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
            <button
              type="button"
              className="absolute inset-0 bg-black/70 backdrop-blur-sm"
              onClick={() => {
                setJoinModalOpen(false);
                setServerModalTab('join');
              }}
              aria-label="Close join modal"
            />
            <section className={cn(styles.surfaceStrong, styles.fadeIn, 'relative z-[71] w-full max-w-md rounded-3xl border p-5')}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.22em] text-emerald-100/70">Server</p>
                  <h3 className="mt-2 text-xl font-semibold text-white">
                    {serverModalTab === 'join' ? 'Join server' : 'Create your server'}
                  </h3>
                </div>
                <button
                  type="button"
                  className="rounded-lg border border-white/15 bg-white/5 px-2 py-1 text-xs text-slate-200 transition hover:bg-white/10"
                  onClick={() => {
                    setJoinModalOpen(false);
                    setServerModalTab('join');
                  }}
                >
                  Close
                </button>
              </div>

              <div className="mt-4 flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 p-1">
                <button
                  type="button"
                  onClick={() => setServerModalTab('join')}
                  className={cn(
                    'flex-1 rounded-lg px-3 py-2 text-sm transition',
                    serverModalTab === 'join' ? 'bg-emerald-200/15 text-emerald-50' : 'text-slate-300 hover:bg-white/5'
                  )}
                >
                  Join
                </button>
                <button
                  type="button"
                  onClick={() => setServerModalTab('create')}
                  className={cn(
                    'flex-1 rounded-lg px-3 py-2 text-sm transition',
                    serverModalTab === 'create' ? 'bg-emerald-200/15 text-emerald-50' : 'text-slate-300 hover:bg-white/5'
                  )}
                >
                  Create
                </button>
              </div>

              {serverModalTab === 'join' ? (
                <form className="mt-5 space-y-3" onSubmit={joinInvite}>
                  <Input
                    required
                    placeholder="https://... or invite code"
                    value={inviteCode}
                    onChange={(event) => setInviteCode(event.target.value)}
                  />
                  <div className="flex items-center justify-end gap-2">
                    <Button
                      type="button"
                      variant="soft"
                      onClick={() => {
                        setJoinModalOpen(false);
                        setServerModalTab('join');
                      }}
                    >
                      Cancel
                    </Button>
                    <Button variant="soft" disabled={isJoiningInvite}>
                      {isJoiningInvite ? 'Joining...' : 'Join Server'}
                    </Button>
                  </div>
                </form>
              ) : (
                <div className="mt-5">
                  <CreateServerForm onCreated={handleServerCreated} />
                </div>
              )}
            </section>
          </div>
        ) : null}
      </div>
    </>
  );

  if (requireAuth) {
    return <AuthGuard>{content}</AuthGuard>;
  }

  return content;
};
