'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AuthGuard } from '@/components/layout/auth-guard';
import { ServerSidebar } from '@/components/layout/server-sidebar';
import { ChannelList } from '@/components/layout/channel-list';
import { MessageList } from '@/components/chat/message-list';
import { MessageInput } from '@/components/chat/message-input';
import { VoiceRoom } from '@/components/voice/voice-room';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Panel } from '@/components/ui/panel';
import { useAuth } from '@/lib/auth-context';
import { allPermissionsValue } from '@/lib/permissions';
import { useSocket } from '@/hooks/use-socket';
import type { Channel, ConnzectServer, Invite, Message, ServerDetails } from '@/types';

export default function ChannelPage() {
  const router = useRouter();
  const params = useParams<{ serverId: string; channelId: string }>();
  const { user, accessToken, logout, authRequest } = useAuth();
  const socket = useSocket(accessToken);

  const [serverId, setServerId] = useState('');
  const [channelId, setChannelId] = useState('');

  const [servers, setServers] = useState<ConnzectServer[]>([]);
  const [serverDetails, setServerDetails] = useState<ServerDetails | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [threadParent, setThreadParent] = useState<Message | null>(null);
  const [threadMessages, setThreadMessages] = useState<Message[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [newChannelName, setNewChannelName] = useState('');
  const [newChannelType, setNewChannelType] = useState<'TEXT' | 'VOICE'>('TEXT');
  const [inviteEmail, setInviteEmail] = useState('');
  const [roleName, setRoleName] = useState('');
  const [inviteMaxUses, setInviteMaxUses] = useState('');
  const [inviteExpiryHours, setInviteExpiryHours] = useState('');

  useEffect(() => {
    if (params.serverId) setServerId(params.serverId);
    if (params.channelId) setChannelId(params.channelId);
  }, [params.channelId, params.serverId]);

  useEffect(() => {
    if (!serverId) return;

    authRequest<ConnzectServer[]>('/servers')
      .then(setServers)
      .catch((nextError) => setError(nextError instanceof Error ? nextError.message : 'Failed loading servers'));
  }, [authRequest, serverId]);

  useEffect(() => {
    if (!serverId) return;

    Promise.all([
      authRequest<ServerDetails>(`/servers/${serverId}`),
      authRequest<Channel[]>(`/servers/${serverId}/channels`)
    ])
      .then(([details, visibleChannels]) => {
        setServerDetails(details);
        setChannels(visibleChannels);
      })
      .catch((nextError) => setError(nextError instanceof Error ? nextError.message : 'Failed loading server'));

    authRequest<Invite[]>(`/servers/${serverId}/invites`)
      .then(setInvites)
      .catch(() => setInvites([]));
  }, [authRequest, serverId]);

  useEffect(() => {
    if (!channelId) return;

    authRequest<Message[]>(`/channels/${channelId}/messages?limit=50`)
      .then((loaded) => {
        setMessages(loaded);
        setThreadParent(null);
        setThreadMessages([]);
      })
      .catch((nextError) => setError(nextError instanceof Error ? nextError.message : 'Failed loading messages'));
  }, [authRequest, channelId]);

  useEffect(() => {
    if (!threadParent || !channelId) return;

    authRequest<Message[]>(`/channels/${channelId}/messages?limit=50&parentMessageId=${threadParent.id}`)
      .then(setThreadMessages)
      .catch((nextError) => setError(nextError instanceof Error ? nextError.message : 'Failed loading thread'));
  }, [authRequest, channelId, threadParent]);

  useEffect(() => {
    if (!socket || !channelId) return;

    socket.emit('channel:join', { channelId });

    const onMessage = (message: Message) => {
      if (message.channelId !== channelId) return;

      if (message.parentMessageId) {
        if (threadParent && message.parentMessageId === threadParent.id) {
          setThreadMessages((prev) => [...prev, message]);
        }
        return;
      }

      setMessages((prev) => [...prev, message]);
    };

    const onMessageUpdated = (message: Message) => {
      if (message.channelId !== channelId) return;

      setMessages((prev) => prev.map((entry) => (entry.id === message.id ? message : entry)));
      setThreadMessages((prev) => prev.map((entry) => (entry.id === message.id ? message : entry)));
      setThreadParent((prev) => (prev?.id === message.id ? message : prev));
    };

    const onError = (payload: { scope: string; message: string }) => {
      setError(`${payload.scope}: ${payload.message}`);
    };

    socket.on('message:new', onMessage);
    socket.on('message:updated', onMessageUpdated);
    socket.on('error:event', onError);

    return () => {
      socket.emit('channel:leave', { channelId });
      socket.off('message:new', onMessage);
      socket.off('message:updated', onMessageUpdated);
      socket.off('error:event', onError);
    };
  }, [channelId, socket, threadParent]);

  const activeChannel = useMemo(
    () => channels.find((channel) => channel.id === channelId) ?? serverDetails?.channels.find((channel) => channel.id === channelId),
    [channelId, channels, serverDetails?.channels]
  );

  const upsertMessageLocal = (message: Message) => {
    if (message.parentMessageId) {
      setThreadMessages((prev) => {
        if (prev.some((entry) => entry.id === message.id)) {
          return prev.map((entry) => (entry.id === message.id ? message : entry));
        }
        return [...prev, message];
      });
      return;
    }

    setMessages((prev) => {
      if (prev.some((entry) => entry.id === message.id)) {
        return prev.map((entry) => (entry.id === message.id ? message : entry));
      }
      return [...prev, message];
    });
  };

  const sendMessage = async (content: string, parentMessageId?: string) => {
    if (!channelId) return;

    if (!socket) {
      const created = await authRequest<Message>(`/channels/${channelId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content, parentMessageId })
      });
      upsertMessageLocal(created);
      return;
    }

    socket.emit('message:send', { channelId, content, parentMessageId });
  };

  const editMessage = async (messageId: string, content: string) => {
    if (!channelId) return;

    if (!socket) {
      const updated = await authRequest<Message>(`/channels/${channelId}/messages/${messageId}`, {
        method: 'PATCH',
        body: JSON.stringify({ content })
      });
      upsertMessageLocal(updated);
      return;
    }

    socket.emit('message:edit', { channelId, messageId, content });
  };

  const deleteMessage = async (messageId: string) => {
    if (!channelId) return;

    if (!socket) {
      const deleted = await authRequest<Message>(`/channels/${channelId}/messages/${messageId}`, {
        method: 'DELETE'
      });
      upsertMessageLocal(deleted);
      return;
    }

    socket.emit('message:delete', { channelId, messageId });
  };

  const createChannel = async (event: FormEvent) => {
    event.preventDefault();
    if (!serverId) return;

    try {
      const channel = await authRequest<Channel>(`/servers/${serverId}/channels`, {
        method: 'POST',
        body: JSON.stringify({ name: newChannelName, type: newChannelType })
      });
      setChannels((prev) => [...prev, channel]);
      setNewChannelName('');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to create channel');
    }
  };

  const inviteMember = async (event: FormEvent) => {
    event.preventDefault();
    if (!serverId) return;

    try {
      await authRequest(`/servers/${serverId}/members`, {
        method: 'POST',
        body: JSON.stringify({ email: inviteEmail })
      });
      setInviteEmail('');
      const refreshed = await authRequest<ServerDetails>(`/servers/${serverId}`);
      setServerDetails(refreshed);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to invite member');
    }
  };

  const createRole = async (event: FormEvent) => {
    event.preventDefault();
    if (!serverId) return;

    try {
      await authRequest(`/servers/${serverId}/roles`, {
        method: 'POST',
        body: JSON.stringify({
          name: roleName,
          permissions: allPermissionsValue.toString(),
          color: '#77213A'
        })
      });
      setRoleName('');
      const refreshed = await authRequest<ServerDetails>(`/servers/${serverId}`);
      setServerDetails(refreshed);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to create role');
    }
  };

  const createInvite = async (event: FormEvent) => {
    event.preventDefault();
    if (!serverId) return;

    try {
      const payload: { maxUses?: number; expiresInHours?: number } = {};
      if (inviteMaxUses.trim()) payload.maxUses = Number(inviteMaxUses);
      if (inviteExpiryHours.trim()) payload.expiresInHours = Number(inviteExpiryHours);

      const created = await authRequest<Invite>(`/servers/${serverId}/invites`, {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      setInvites((prev) => [created, ...prev]);
      setInviteMaxUses('');
      setInviteExpiryHours('');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to create invite');
    }
  };

  const revokeInvite = async (inviteId: string) => {
    if (!serverId) return;

    try {
      await authRequest(`/servers/${serverId}/invites/${inviteId}`, {
        method: 'DELETE'
      });
      setInvites((prev) => prev.map((invite) => (invite.id === inviteId ? { ...invite, revokedAt: new Date().toISOString() } : invite)));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to revoke invite');
    }
  };

  const deleteRole = async (roleId: string) => {
    if (!serverId) return;

    try {
      await authRequest(`/servers/${serverId}/roles/${roleId}`, {
        method: 'DELETE'
      });
      setServerDetails((prev) =>
        prev
          ? {
              ...prev,
              roles: prev.roles.filter((role) => role.id !== roleId)
            }
          : prev
      );
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to delete role');
    }
  };

  const assignRole = async (roleId: string, memberId: string) => {
    if (!serverId) return;

    try {
      await authRequest(`/servers/${serverId}/roles/${roleId}/assign/${memberId}`, {
        method: 'POST'
      });
      const refreshed = await authRequest<ServerDetails>(`/servers/${serverId}`);
      setServerDetails(refreshed);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to assign role');
    }
  };

  const moderateMember = async (memberId: string, action: 'kick' | 'ban') => {
    if (!serverId) return;

    try {
      await authRequest(`/servers/${serverId}/members/${memberId}/${action}`, {
        method: 'POST'
      });
      const refreshed = await authRequest<ServerDetails>(`/servers/${serverId}`);
      setServerDetails(refreshed);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : `Failed to ${action} member`);
    }
  };

  return (
    <AuthGuard>
      <main className="mx-auto min-h-screen w-full max-w-[1640px] px-4 py-4 md:px-8 md:py-6">
        <div className="grid gap-4 xl:grid-cols-[16rem_16rem_1fr_22rem]">
          <ServerSidebar servers={servers} activeServerId={serverId} />

          <ChannelList serverId={serverId} channels={channels} activeChannelId={channelId} />

          <section className="space-y-4">
            <Panel className="p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Server</p>
                  <h1 className="text-2xl font-semibold">{serverDetails?.name ?? 'Loading...'}</h1>
                  <p className="text-sm text-slate-400">Channel: {activeChannel ? `#${activeChannel.name}` : 'Unknown'}</p>
                </div>
                <div className="flex gap-2">
                  <Button variant="soft" onClick={() => router.push('/dm')}>
                    DMs
                  </Button>
                  <Button variant="soft" onClick={() => router.push('/app')}>
                    Dashboard
                  </Button>
                  <Button
                    variant="soft"
                    onClick={() => {
                      logout().then(() => router.replace('/login'));
                    }}
                  >
                    Logout
                  </Button>
                </div>
              </div>
              {error ? <p className="mt-3 text-sm text-red-400">{error}</p> : null}
            </Panel>

            <Panel className="p-5">
              {activeChannel?.type === 'VOICE' && socket ? (
                <VoiceRoom channelId={channelId} socket={socket} />
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
              )}
            </Panel>
          </section>

          <aside className="space-y-4">
            <Panel className="space-y-3 p-4">
              <h2 className="text-sm font-semibold">Channel Management</h2>
              <form className="space-y-2" onSubmit={createChannel}>
                <Input
                  required
                  placeholder="Channel name"
                  value={newChannelName}
                  onChange={(event) => setNewChannelName(event.target.value)}
                />
                <select
                  value={newChannelType}
                  onChange={(event) => setNewChannelType(event.target.value as 'TEXT' | 'VOICE')}
                  className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm"
                >
                  <option value="TEXT">Text</option>
                  <option value="VOICE">Voice</option>
                </select>
                <Button className="w-full" variant="soft">
                  Create channel
                </Button>
              </form>
            </Panel>

            <Panel className="space-y-3 p-4">
              <h2 className="text-sm font-semibold">Invite Links</h2>
              <form className="space-y-2" onSubmit={createInvite}>
                <Input
                  type="number"
                  min={1}
                  placeholder="Max uses (optional)"
                  value={inviteMaxUses}
                  onChange={(event) => setInviteMaxUses(event.target.value)}
                />
                <Input
                  type="number"
                  min={1}
                  placeholder="Expiry hours (optional)"
                  value={inviteExpiryHours}
                  onChange={(event) => setInviteExpiryHours(event.target.value)}
                />
                <Button className="w-full" variant="soft">
                  Create invite link
                </Button>
              </form>

              <div className="space-y-2">
                {invites.map((invite) => (
                  <div key={invite.id} className="glass rounded-xl p-2 text-xs">
                    <p className="font-mono text-slate-200">{invite.code}</p>
                    <p className="mt-1 text-slate-400">
                      Uses: {invite.uses}
                      {invite.maxUses ? ` / ${invite.maxUses}` : ''}
                    </p>
                    {invite.expiresAt ? <p className="text-slate-400">Expires: {new Date(invite.expiresAt).toLocaleString()}</p> : null}
                    {invite.revokedAt ? (
                      <p className="text-red-400">Revoked</p>
                    ) : (
                      <div className="mt-2 flex gap-2">
                        <Button
                          type="button"
                          className="flex-1 px-2 py-1 text-xs"
                          variant="soft"
                          onClick={() => navigator.clipboard.writeText(invite.code).catch(() => undefined)}
                        >
                          Copy code
                        </Button>
                        <Button type="button" className="flex-1 px-2 py-1 text-xs" variant="danger" onClick={() => revokeInvite(invite.id)}>
                          Revoke
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Panel>

            <Panel className="space-y-3 p-4">
              <h2 className="text-sm font-semibold">Member Management</h2>
              <form className="space-y-2" onSubmit={inviteMember}>
                <Input
                  required
                  type="email"
                  placeholder="Invite by email"
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                />
                <Button className="w-full" variant="soft">
                  Add member
                </Button>
              </form>
              <div className="space-y-2">
                {serverDetails?.members.map((member) => (
                  <div key={member.id} className="glass rounded-xl p-2 text-xs">
                    <p className="text-sm text-slate-200">{member.user.displayName}</p>
                    <div className="mt-2 flex gap-2">
                      <Button
                        type="button"
                        className="flex-1"
                        variant="soft"
                        onClick={() => moderateMember(member.id, 'kick')}
                      >
                        Kick
                      </Button>
                      <Button
                        type="button"
                        className="flex-1"
                        variant="danger"
                        onClick={() => moderateMember(member.id, 'ban')}
                      >
                        Ban
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel className="space-y-3 p-4">
              <h2 className="text-sm font-semibold">Roles & Permissions</h2>
              <form className="space-y-2" onSubmit={createRole}>
                <Input
                  required
                  placeholder="Role name"
                  value={roleName}
                  onChange={(event) => setRoleName(event.target.value)}
                />
                <Button className="w-full" variant="soft">
                  Create role
                </Button>
              </form>
              <div className="space-y-2">
                {serverDetails?.roles.map((role) => (
                  <div key={role.id} className="glass rounded-xl p-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm text-slate-200">{role.name}</p>
                      {!role.isDefault ? (
                        <Button type="button" variant="danger" className="px-2 py-1 text-xs" onClick={() => deleteRole(role.id)}>
                          Delete
                        </Button>
                      ) : null}
                    </div>
                    <p className="mt-1 text-slate-400">Permissions bits: {role.permissions}</p>
                    <div className="mt-2 space-y-1">
                      {serverDetails.members.map((member) => (
                        <button
                          key={`${role.id}:${member.id}`}
                          className="w-full rounded-lg border border-white/10 px-2 py-1 text-left transition hover:border-white/20"
                          onClick={() => assignRole(role.id, member.id)}
                          type="button"
                        >
                          Assign to {member.user.displayName}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel className="p-4 text-xs text-slate-400">
              Signed in as <span className="text-slate-200">{user?.displayName}</span>
            </Panel>
          </aside>
        </div>
      </main>
    </AuthGuard>
  );
}
