'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
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
import type { Channel, ConnzectServer, DirectConversation, Message } from '@/types';
import { Sidebar } from './sidebar';
import styles from './landing-page.module.css';

interface LandingPageProps {
  requireAuth?: boolean;
}

export const LandingPage = ({ requireAuth = false }: LandingPageProps) => {
  const router = useRouter();
  const { user, loading, logout, authRequest, accessToken } = useAuth();
  const socket = useSocket(accessToken);

  const [servers, setServers] = useState<ConnzectServer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [tabletSidebarCollapsed, setTabletSidebarCollapsed] = useState(false);
  const [isTabletViewport, setIsTabletViewport] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);

  const [activeServerId, setActiveServerId] = useState<string | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [activeChannelId, setActiveChannelId] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [threadParent, setThreadParent] = useState<Message | null>(null);
  const [threadMessages, setThreadMessages] = useState<Message[]>([]);

  const [inviteCode, setInviteCode] = useState('');
  const [dmEmail, setDmEmail] = useState('');

  useEffect(() => {
    if (loading || !user) {
      setServers([]);
      setError(null);
      setActiveServerId(null);
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

  useEffect(() => {
    if (!activeServerId) return;
    if (!servers.some((server) => server.id === activeServerId)) {
      setActiveServerId(null);
    }
  }, [activeServerId, servers]);

  useEffect(() => {
    if (!activeServerId) {
      setChannels([]);
      setActiveChannelId('');
      setMessages([]);
      setThreadParent(null);
      setThreadMessages([]);
      return;
    }

    authRequest<Channel[]>(`/servers/${activeServerId}/channels`)
      .then((loadedChannels) => {
        setChannels(loadedChannels);
      })
      .catch((nextError) => {
        setError(nextError instanceof Error ? nextError.message : 'Failed loading channels');
        setChannels([]);
      });
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
    if (!activeChannelId) {
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
  }, [activeChannelId, authRequest]);

  useEffect(() => {
    if (!threadParent || !activeChannelId) return;

    authRequest<Message[]>(`/channels/${activeChannelId}/messages?limit=50&parentMessageId=${threadParent.id}`)
      .then(setThreadMessages)
      .catch((nextError) => setError(nextError instanceof Error ? nextError.message : 'Failed loading thread'));
  }, [activeChannelId, authRequest, threadParent]);

  useEffect(() => {
    if (!socket || !activeChannelId) return;

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

    const onError = (payload: { scope: string; message: string }) => {
      setError(`${payload.scope}: ${payload.message}`);
    };

    socket.on('message:new', onMessage);
    socket.on('message:updated', onMessageUpdated);
    socket.on('error:event', onError);
    socket.on('connect', joinChannel);

    return () => {
      socket.emit('channel:leave', { channelId: activeChannelId });
      socket.off('message:new', onMessage);
      socket.off('message:updated', onMessageUpdated);
      socket.off('error:event', onError);
      socket.off('connect', joinChannel);
    };
  }, [activeChannelId, socket, threadParent]);

  const activeServer = useMemo(
    () => (activeServerId ? servers.find((server) => server.id === activeServerId) ?? null : null),
    [activeServerId, servers]
  );

  const activeChannel = useMemo(
    () => channels.find((channel) => channel.id === activeChannelId) ?? null,
    [activeChannelId, channels]
  );

  const openServerWidget = (serverId: string) => {
    setActiveServerId(serverId);
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

  const sendMessage = async (content: string, parentMessageId?: string) => {
    if (!activeChannelId) return;

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

    if (!socket?.connected) {
      const deleted = await authRequest<Message>(`/channels/${activeChannelId}/messages/${messageId}`, {
        method: 'DELETE'
      });
      upsertMessageLocal(deleted);
      return;
    }

    socket.emit('message:delete', { channelId: activeChannelId, messageId });
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
      setActiveServerId(joined.server.id);
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
                  <Button variant="soft" className="hidden sm:inline-flex" onClick={() => setActionsOpen((current) => !current)}>
                    {actionsOpen ? 'Hide Actions' : 'Workspace Actions'}
                  </Button>
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
            onOpenServer={openServerWidget}
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
              collapsed={sidebarCollapsed}
              onOpenServer={openServerWidget}
              className="h-[calc(100vh-7.5rem)]"
            />
          </div>

          <main className="min-w-0 flex-1 space-y-6">
            {user && error ? (
              <section className="rounded-2xl border border-red-400/40 bg-red-500/10 p-4 text-sm text-red-200">{error}</section>
            ) : null}

            {activeServer ? (
              <section className={cn(styles.surfaceStrong, styles.fadeIn, 'rounded-3xl border p-6')}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.22em] text-emerald-100/70">Server</p>
                    <h2 className="mt-2 text-2xl font-semibold text-white">{activeServer.name}</h2>
                    <p className="mt-1 text-sm text-slate-200/90">
                      {activeChannel ? `Channel: #${activeChannel.name}` : 'Select a channel to start chatting.'}
                    </p>
                  </div>
                  <Button variant="soft" onClick={() => setActiveServerId(null)}>
                    Close
                  </Button>
                </div>

                <div className="mt-6 grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
                  <aside className="rounded-2xl border border-white/10 bg-black/15 p-3">
                    <p className="mb-3 px-1 text-xs uppercase tracking-[0.2em] text-slate-400">Channels</p>
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
                          <span>#{channel.name}</span>
                          <span className="text-xs text-slate-400">{channel.type === 'TEXT' ? 'Text' : 'Voice'}</span>
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
                      activeChannel.type === 'VOICE' && socket ? (
                        <VoiceRoom channelId={activeChannel.id} socket={socket} />
                      ) : (
                        <div className={`grid gap-4 ${threadParent ? 'lg:grid-cols-[1.6fr_1fr]' : ''}`}>
                          <div>
                            <MessageList
                              messages={messages}
                              currentUserId={user?.id}
                              onEdit={editMessage}
                              onDelete={deleteMessage}
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
                </div>
              </section>
            ) : (
              <section className={cn(styles.surface, styles.fadeIn, 'rounded-3xl border p-6')}>
                <p className="text-sm text-slate-300">Select a server from the left sidebar to open Channels and messages here.</p>
              </section>
            )}

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
