'use client';

import { ChangeEvent, DragEvent, FormEvent, MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AuthGuard } from '@/components/layout/auth-guard';
import { CreateServerForm } from '@/components/forms/create-server-form';
import { MessageInput, type MentionSuggestion } from '@/components/chat/message-input';
import { MessageList } from '@/components/chat/message-list';
import { VoiceRoom } from '@/components/voice/voice-room';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth-context';
import { resolveAssetUrl } from '@/lib/assets';
import { useSocket } from '@/hooks/use-socket';
import type {
  Channel,
  ConnzectServer,
  DirectConversation,
  Message,
  Role,
  ServerDetails,
  User,
  VideoQuality,
  VoiceParticipant
} from '@/types';
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

const toAudioLabel = (device: MediaDeviceInfo, fallbackPrefix: 'Microphone' | 'Speaker', index: number): string => {
  const trimmed = device.label.trim();
  if (trimmed) return trimmed;
  return `${fallbackPrefix} ${index + 1}`;
};

const ROLE_PERMISSION_FLAGS = {
  kickMember: 1n << 8n,
  banMember: 1n << 7n,
  muteChat: 1n << 1n,
  muteVoice: 1n << 2n,
  moveChannels: 1n << 11n
} as const;

const SERVER_PERMISSION_FLAGS = {
  createChannel: 1n << 3n,
  manageServer: 1n << 9n,
  moveChannels: 1n << 11n
} as const;

const ROLE_PERMISSION_OPTIONS: Array<{ key: keyof RolePermissionDraft; label: string }> = [
  { key: 'kickMember', label: 'Kick' },
  { key: 'banMember', label: 'Ban' },
  { key: 'muteChat', label: 'Mute chat' },
  { key: 'muteVoice', label: 'Mute voice' },
  { key: 'moveChannels', label: 'Move channels' }
];

const VOICE_VIDEO_QUALITY_OPTIONS: Array<{ value: VideoQuality; label: string }> = [
  { value: 'AUTO', label: 'Auto' },
  { value: 'HD', label: 'HD (720p)' },
  { value: 'FULL_HD', label: 'Full HD (1080p)' }
];

const SERVER_ORDER_STORAGE_PREFIX = 'connzect:server-order:';

type RolePermissionDraft = {
  kickMember: boolean;
  banMember: boolean;
  muteChat: boolean;
  muteVoice: boolean;
  moveChannels: boolean;
};

type EditableRoleDraft = {
  name: string;
  mentionable: boolean;
  permissions: RolePermissionDraft;
};

const hasPermissionFlag = (value: bigint, flag: bigint): boolean => (value & flag) === flag;

const toRolePermissionDraft = (permissions?: string): RolePermissionDraft => {
  const bits = parsePermissionValue(permissions);
  return {
    kickMember: hasPermissionFlag(bits, ROLE_PERMISSION_FLAGS.kickMember),
    banMember: hasPermissionFlag(bits, ROLE_PERMISSION_FLAGS.banMember),
    muteChat: hasPermissionFlag(bits, ROLE_PERMISSION_FLAGS.muteChat),
    muteVoice: hasPermissionFlag(bits, ROLE_PERMISSION_FLAGS.muteVoice),
    moveChannels: hasPermissionFlag(bits, ROLE_PERMISSION_FLAGS.moveChannels)
  };
};

const toPermissionBits = (draft: RolePermissionDraft): string => {
  let bits = 0n;
  if (draft.kickMember) bits |= ROLE_PERMISSION_FLAGS.kickMember;
  if (draft.banMember) bits |= ROLE_PERMISSION_FLAGS.banMember;
  if (draft.muteChat) bits |= ROLE_PERMISSION_FLAGS.muteChat;
  if (draft.muteVoice) bits |= ROLE_PERMISSION_FLAGS.muteVoice;
  if (draft.moveChannels) bits |= ROLE_PERMISSION_FLAGS.moveChannels;
  return bits.toString();
};

const toMentionKey = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[^a-z0-9._-]/g, '');

type RankedMemberEntry = {
  id: string;
  userId: string;
  userEmail: string;
  displayName: string;
  initials: string;
  isOwner: boolean;
  category: string;
  roleLabel: string;
  roleColor: string | null;
  power: bigint;
  rank: number;
};

type ContextMenuState =
  | {
      type: 'channel';
      x: number;
      y: number;
      channel: Channel;
    }
  | {
      type: 'server';
      x: number;
      y: number;
      server: ConnzectServer;
    }
  | {
      type: 'member';
      x: number;
      y: number;
      member: RankedMemberEntry;
    }
  | {
      type: 'channelList';
      x: number;
      y: number;
    }
  | null;

type ChannelEditorState = {
  mode: 'create' | 'edit';
  channelId?: string;
  type: 'CATEGORY' | 'TEXT' | 'VOICE';
  name: string;
  categoryId: string | null;
  slowModeSeconds: number;
  bitrate: number;
  videoQuality: VideoQuality;
  userLimit: number;
};

type DragOverTarget =
  | { kind: 'category'; id: string | null; position: 'before' | 'after' }
  | { kind: 'channel'; id: string }
  | { kind: 'uncategorized' };

type AudioDeviceOption = {
  id: string;
  label: string;
};

export const LandingPage = ({ requireAuth = false }: LandingPageProps) => {
  const router = useRouter();
  const { user, loading, logout, authRequest, accessToken, updateUser } = useAuth();
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
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [isOutputMuted, setIsOutputMuted] = useState(false);
  const [isSharingScreen, setIsSharingScreen] = useState(false);
  const [isVoiceSettingsOpen, setIsVoiceSettingsOpen] = useState(false);
  const [voiceSettingsError, setVoiceSettingsError] = useState<string | null>(null);
  const [voiceSettingsSuccess, setVoiceSettingsSuccess] = useState<string | null>(null);
  const [isSavingProfilePhoto, setIsSavingProfilePhoto] = useState(false);
  const [audioInputDevices, setAudioInputDevices] = useState<AudioDeviceOption[]>([]);
  const [audioOutputDevices, setAudioOutputDevices] = useState<AudioDeviceOption[]>([]);
  const [selectedAudioInputId, setSelectedAudioInputId] = useState('');
  const [selectedAudioOutputId, setSelectedAudioOutputId] = useState('');

  const [activeServerId, setActiveServerId] = useState<string | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [serverMembers, setServerMembers] = useState<ServerDetails['members']>([]);
  const [serverRoles, setServerRoles] = useState<Role[]>([]);
  const [activeChannelId, setActiveChannelId] = useState('');
  const [activeTextChannelId, setActiveTextChannelId] = useState('');
  const [connectedVoiceChannelId, setConnectedVoiceChannelId] = useState('');
  const [connectedVoiceChannelName, setConnectedVoiceChannelName] = useState('');
  const [voiceParticipants, setVoiceParticipants] = useState<VoiceParticipant[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [threadParent, setThreadParent] = useState<Message | null>(null);
  const [threadMessages, setThreadMessages] = useState<Message[]>([]);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [channelProperties, setChannelProperties] = useState<Channel | null>(null);
  const [memberAudioSettings, setMemberAudioSettings] = useState<Record<string, { volume: number; muted: boolean }>>({});
  const [channelEditor, setChannelEditor] = useState<ChannelEditorState | null>(null);
  const [isSavingChannelEditor, setIsSavingChannelEditor] = useState(false);
  const [collapsedCategoryIds, setCollapsedCategoryIds] = useState<Record<string, boolean>>({});
  const [draggedChannelId, setDraggedChannelId] = useState<string | null>(null);
  const [dragOverTarget, setDragOverTarget] = useState<DragOverTarget | null>(null);
  const [isReorderingChannels, setIsReorderingChannels] = useState(false);
  const [serverSettingsOpen, setServerSettingsOpen] = useState(false);
  const [serverSettingsTab, setServerSettingsTab] = useState<'general' | 'permissions'>('general');
  const [serverSettingsName, setServerSettingsName] = useState('');
  const [serverSettingsIconFile, setServerSettingsIconFile] = useState<File | null>(null);
  const [isSavingServerSettings, setIsSavingServerSettings] = useState(false);
  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleMentionable, setNewRoleMentionable] = useState(true);
  const [newRolePermissions, setNewRolePermissions] = useState<RolePermissionDraft>({
    kickMember: false,
    banMember: false,
    muteChat: false,
    muteVoice: false,
    moveChannels: false
  });
  const [isCreatingRole, setIsCreatingRole] = useState(false);
  const [roleDrafts, setRoleDrafts] = useState<Record<string, EditableRoleDraft>>({});
  const [roleBusyState, setRoleBusyState] = useState<Record<string, boolean>>({});

  const [inviteCode, setInviteCode] = useState('');
  const closeTimerRef = useRef<number | null>(null);
  const openTimerRef = useRef<number | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const voiceSettingsRef = useRef<HTMLDivElement | null>(null);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const lastDragEndedAtRef = useRef(0);
  const activeChannel = useMemo(
    () => channels.find((channel) => channel.id === activeChannelId) ?? null,
    [activeChannelId, channels]
  );
  const draggedChannel = useMemo(
    () => (draggedChannelId ? channels.find((channel) => channel.id === draggedChannelId) ?? null : null),
    [channels, draggedChannelId]
  );
  const isDraggingCategory = draggedChannel?.type === 'CATEGORY';
  const activeChatChannelId = useMemo(
    () => (activeChannel?.type === 'TEXT' ? activeChannel.id : activeTextChannelId),
    [activeChannel?.id, activeChannel?.type, activeTextChannelId]
  );
  const activeChatChannel = useMemo(
    () => channels.find((channel) => channel.id === activeChatChannelId) ?? null,
    [activeChatChannelId, channels]
  );
  const isVoiceConnected = Boolean(connectedVoiceChannelId);
  const canShowVoiceActions = Boolean(isVoiceConnected && user);
  const displayedVoiceParticipants = useMemo(() => {
    if (!isVoiceConnected || !user) return voiceParticipants;
    if (voiceParticipants.some((participant) => participant.userId === user.id)) return voiceParticipants;
    return [
      {
        socketId: `local-${user.id}`,
        userId: user.id,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl ?? null
      },
      ...voiceParticipants
    ];
  }, [isVoiceConnected, user, voiceParticipants]);
  const accountAvatarUrl = useMemo(() => resolveAssetUrl(user?.avatarUrl ?? null), [user?.avatarUrl]);
  const accountInitial = useMemo(() => user?.displayName.trim().charAt(0).toUpperCase() || '?', [user?.displayName]);
  const serverOrderStorageKey = useMemo(
    () => (user?.id ? `${SERVER_ORDER_STORAGE_PREFIX}${user.id}` : null),
    [user?.id]
  );
  const audioInputStorageKey = useMemo(() => (user?.id ? `connzect:audio-input:${user.id}` : null), [user?.id]);
  const audioOutputStorageKey = useMemo(() => (user?.id ? `connzect:audio-output:${user.id}` : null), [user?.id]);

  const loadAudioDevices = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
      setAudioInputDevices([]);
      setAudioOutputDevices([]);
      return;
    }

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices
        .filter((device) => device.kind === 'audioinput')
        .map((device, index) => ({
          id: device.deviceId,
          label: toAudioLabel(device, 'Microphone', index)
        }));
      const outputs = devices
        .filter((device) => device.kind === 'audiooutput')
        .map((device, index) => ({
          id: device.deviceId,
          label: toAudioLabel(device, 'Speaker', index)
        }));

      setAudioInputDevices(inputs);
      setAudioOutputDevices(outputs);
      setSelectedAudioInputId((previous) => (inputs.some((entry) => entry.id === previous) ? previous : ''));
      setSelectedAudioOutputId((previous) => (outputs.some((entry) => entry.id === previous) ? previous : ''));
    } catch (nextError) {
      setVoiceSettingsError(nextError instanceof Error ? nextError.message : 'Failed to load audio devices');
    }
  }, []);

  const applyStoredServerOrder = useCallback(
    (input: ConnzectServer[]): ConnzectServer[] => {
      if (!serverOrderStorageKey || typeof window === 'undefined') return input;

      try {
        const raw = window.localStorage.getItem(serverOrderStorageKey);
        if (!raw) return input;
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return input;

        const preferredIds = parsed.filter((value): value is string => typeof value === 'string');
        if (preferredIds.length === 0) return input;

        const pool = new Map(input.map((server) => [server.id, server]));
        const ordered: ConnzectServer[] = [];

        for (const serverId of preferredIds) {
          const server = pool.get(serverId);
          if (!server) continue;
          ordered.push(server);
          pool.delete(serverId);
        }

        for (const server of input) {
          if (!pool.has(server.id)) continue;
          ordered.push(server);
          pool.delete(server.id);
        }

        return ordered;
      } catch {
        return input;
      }
    },
    [serverOrderStorageKey]
  );

  const persistServerOrder = useCallback(
    (orderedServers: ConnzectServer[]) => {
      if (!serverOrderStorageKey || typeof window === 'undefined' || orderedServers.length === 0) return;
      try {
        window.localStorage.setItem(serverOrderStorageKey, JSON.stringify(orderedServers.map((server) => server.id)));
      } catch {
        // Ignore localStorage failures; ordering still works in-memory.
      }
    },
    [serverOrderStorageKey]
  );

  const refreshServers = useCallback(async () => {
    const data = await authRequest<ConnzectServer[]>('/servers');
    const ordered = applyStoredServerOrder(data);
    setServers(ordered);
    persistServerOrder(ordered);
    return ordered;
  }, [applyStoredServerOrder, authRequest, persistServerOrder]);

  useEffect(() => {
    if (loading || !user) {
      if (openTimerRef.current) {
        window.clearTimeout(openTimerRef.current);
        openTimerRef.current = null;
      }
      setServers([]);
      setError(null);
      setActiveServerId(null);
      setConnectedVoiceChannelId('');
      setConnectedVoiceChannelName('');
      setIsOpeningServerView(false);
      setJoinModalOpen(false);
      setServerModalTab('join');
      return;
    }

    refreshServers()
      .catch((nextError) => {
        setError(nextError instanceof Error ? nextError.message : 'Failed to load servers');
      });
  }, [loading, refreshServers, user]);

  useEffect(() => {
    persistServerOrder(servers);
  }, [persistServerOrder, servers]);

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
    if (!audioInputStorageKey || typeof window === 'undefined') {
      setSelectedAudioInputId('');
      return;
    }

    try {
      setSelectedAudioInputId(window.localStorage.getItem(audioInputStorageKey) ?? '');
    } catch {
      setSelectedAudioInputId('');
    }
  }, [audioInputStorageKey]);

  useEffect(() => {
    if (!audioOutputStorageKey || typeof window === 'undefined') {
      setSelectedAudioOutputId('');
      return;
    }

    try {
      setSelectedAudioOutputId(window.localStorage.getItem(audioOutputStorageKey) ?? '');
    } catch {
      setSelectedAudioOutputId('');
    }
  }, [audioOutputStorageKey]);

  useEffect(() => {
    if (!audioInputStorageKey || typeof window === 'undefined') return;
    try {
      if (selectedAudioInputId) {
        window.localStorage.setItem(audioInputStorageKey, selectedAudioInputId);
      } else {
        window.localStorage.removeItem(audioInputStorageKey);
      }
    } catch {
      // Ignore localStorage failures.
    }
  }, [audioInputStorageKey, selectedAudioInputId]);

  useEffect(() => {
    if (!audioOutputStorageKey || typeof window === 'undefined') return;
    try {
      if (selectedAudioOutputId) {
        window.localStorage.setItem(audioOutputStorageKey, selectedAudioOutputId);
      } else {
        window.localStorage.removeItem(audioOutputStorageKey);
      }
    } catch {
      // Ignore localStorage failures.
    }
  }, [audioOutputStorageKey, selectedAudioOutputId]);

  useEffect(() => {
    if (!isVoiceSettingsOpen) return;
    setVoiceSettingsError(null);
    setVoiceSettingsSuccess(null);
    loadAudioDevices().catch(() => undefined);

    const mediaDevices = typeof navigator === 'undefined' ? null : navigator.mediaDevices;
    if (!mediaDevices?.addEventListener) return;

    const handleDeviceChange = () => {
      loadAudioDevices().catch(() => undefined);
    };

    mediaDevices.addEventListener('devicechange', handleDeviceChange);
    return () => {
      mediaDevices.removeEventListener('devicechange', handleDeviceChange);
    };
  }, [isVoiceSettingsOpen, loadAudioDevices]);

  useEffect(() => {
    if (!isVoiceSettingsOpen) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (voiceSettingsRef.current && target && !voiceSettingsRef.current.contains(target)) {
        setIsVoiceSettingsOpen(false);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsVoiceSettingsOpen(false);
      }
    };

    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isVoiceSettingsOpen]);

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
    if (!serverSettingsOpen) return;

    const onEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setServerSettingsOpen(false);
      }
    };

    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [serverSettingsOpen]);

  useEffect(() => {
    if (!channelEditor) return;

    const onEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setChannelEditor(null);
      }
    };

    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [channelEditor]);

  useEffect(() => {
    if (!activeServerId) return;
    if (!servers.some((server) => server.id === activeServerId)) {
      setActiveServerId(null);
    }
  }, [activeServerId, servers]);

  useEffect(() => {
    if (!activeServerId) return;
    const selected = servers.find((server) => server.id === activeServerId);
    if (!selected) return;
    setServerSettingsName(selected.name);
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
    if (!contextMenu) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (contextMenuRef.current && target && !contextMenuRef.current.contains(target)) {
        setContextMenu(null);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setContextMenu(null);
      }
    };

    const dismiss = () => setContextMenu(null);

    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', dismiss);
    window.addEventListener('scroll', dismiss, true);

    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('scroll', dismiss, true);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!activeServerId) {
      setChannels([]);
      setServerMembers([]);
      setServerRoles([]);
      setCollapsedCategoryIds({});
      setActiveChannelId('');
      setActiveTextChannelId('');
      setMessages([]);
      setThreadParent(null);
      setThreadMessages([]);
      setServerSettingsOpen(false);
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
        setServerRoles(serverDetails.roles);
      })
      .catch((nextError) => {
        if (cancelled) return;
        setError(nextError instanceof Error ? nextError.message : 'Failed loading channels');
        setChannels([]);
        setServerMembers([]);
        setServerRoles([]);
      });

    return () => {
      cancelled = true;
    };
  }, [activeServerId, authRequest]);

  useEffect(() => {
    if (channels.length === 0) {
      setActiveChannelId('');
      setActiveTextChannelId('');
      setMessages([]);
      setThreadParent(null);
      setThreadMessages([]);
      return;
    }

    const firstText = channels.find((channel) => channel.type === 'TEXT');
    const firstConversationChannel = firstText ?? channels.find((channel) => channel.type !== 'CATEGORY') ?? channels[0];
    if (!firstText) {
      setActiveTextChannelId('');
    } else if (!channels.some((channel) => channel.id === activeTextChannelId && channel.type === 'TEXT')) {
      setActiveTextChannelId(firstText.id);
    }

    if (channels.some((channel) => channel.id === activeChannelId)) return;
    setActiveChannelId(firstConversationChannel.id);
  }, [activeChannelId, activeTextChannelId, channels]);

  useEffect(() => {
    if (!activeChannel || activeChannel.type !== 'TEXT') return;
    if (activeTextChannelId === activeChannel.id) return;
    setActiveTextChannelId(activeChannel.id);
  }, [activeChannel, activeTextChannelId]);

  useEffect(() => {
    if (isVoiceConnected) return;
    setVoiceParticipants([]);
    setIsSharingScreen(false);
    setIsVoiceSettingsOpen(false);
  }, [isVoiceConnected]);

  useEffect(() => {
    if (!activeChatChannelId || !activeChatChannel || activeChatChannel.type !== 'TEXT') {
      setMessages([]);
      setThreadParent(null);
      setThreadMessages([]);
      return;
    }

    authRequest<Message[]>(`/channels/${activeChatChannelId}/messages?limit=50`)
      .then((loadedMessages) => {
        setMessages(loadedMessages);
        setThreadParent(null);
        setThreadMessages([]);
      })
      .catch((nextError) => {
        setError(nextError instanceof Error ? nextError.message : 'Failed loading messages');
      });
  }, [activeChatChannel, activeChatChannelId, authRequest]);

  useEffect(() => {
    if (!threadParent || !activeChatChannelId || !activeChatChannel || activeChatChannel.type !== 'TEXT') return;

    authRequest<Message[]>(`/channels/${activeChatChannelId}/messages?limit=50&parentMessageId=${threadParent.id}`)
      .then(setThreadMessages)
      .catch((nextError) => setError(nextError instanceof Error ? nextError.message : 'Failed loading thread'));
  }, [activeChatChannel, activeChatChannelId, authRequest, threadParent]);

  useEffect(() => {
    if (!socket || !activeChatChannelId || !activeChatChannel || activeChatChannel.type !== 'TEXT') return;

    const joinChannel = () => {
      socket.emit('channel:join', { channelId: activeChatChannelId });
    };

    if (socket.connected) {
      joinChannel();
    }

    const onMessage = (message: Message) => {
      if (message.channelId !== activeChatChannelId) return;

      if (message.parentMessageId) {
        if (threadParent && message.parentMessageId === threadParent.id) {
          setThreadMessages((previous) => [...previous, message]);
        }
        return;
      }

      setMessages((previous) => [...previous, message]);
    };

    const onMessageUpdated = (message: Message) => {
      if (message.channelId !== activeChatChannelId) return;

      setMessages((previous) => previous.map((entry) => (entry.id === message.id ? message : entry)));
      setThreadMessages((previous) => previous.map((entry) => (entry.id === message.id ? message : entry)));
      setThreadParent((previous) => (previous?.id === message.id ? message : previous));
    };

    const onMessageDeleted = (payload: { id: string; channelId: string }) => {
      if (payload.channelId !== activeChatChannelId) return;
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
      socket.emit('channel:leave', { channelId: activeChatChannelId });
      socket.off('message:new', onMessage);
      socket.off('message:updated', onMessageUpdated);
      socket.off('message:deleted', onMessageDeleted);
      socket.off('error:event', onError);
      socket.off('connect', joinChannel);
    };
  }, [activeChatChannel, activeChatChannelId, socket, threadParent]);

  const activeServer = useMemo(
    () => (activeServerId ? servers.find((server) => server.id === activeServerId) ?? null : null),
    [activeServerId, servers]
  );
  const sortedServerRoles = useMemo(() => [...serverRoles].sort((left, right) => right.position - left.position), [serverRoles]);
  const currentMember = useMemo(
    () => (user ? serverMembers.find((member) => member.userId === user.id) ?? null : null),
    [serverMembers, user]
  );
  const currentMemberPermissions = useMemo(() => {
    if (!currentMember) return 0n;
    return currentMember.memberRoles.reduce((acc, entry) => acc | parsePermissionValue(entry.role.permissions), 0n);
  }, [currentMember]);
  const canCreateChannels = useMemo(() => {
    if (!activeServer || !user) return false;
    if (activeServer.ownerId === user.id) return true;
    return hasPermissionFlag(currentMemberPermissions, SERVER_PERMISSION_FLAGS.createChannel);
  }, [activeServer, currentMemberPermissions, user]);
  const canManageChannels = useMemo(() => {
    if (!activeServer || !user) return false;
    if (activeServer.ownerId === user.id) return true;
    return hasPermissionFlag(currentMemberPermissions, SERVER_PERMISSION_FLAGS.manageServer);
  }, [activeServer, currentMemberPermissions, user]);
  const canMoveChannels = useMemo(() => {
    if (!activeServer || !user) return false;
    if (activeServer.ownerId === user.id) return true;
    return hasPermissionFlag(currentMemberPermissions, SERVER_PERMISSION_FLAGS.moveChannels);
  }, [activeServer, currentMemberPermissions, user]);
  const canOpenServerSettings = useMemo(() => {
    if (!activeServer || !user) return false;
    if (activeServer.ownerId === user.id) return true;
    return hasPermissionFlag(currentMemberPermissions, SERVER_PERMISSION_FLAGS.manageServer);
  }, [activeServer, currentMemberPermissions, user]);
  const categoryChannels = useMemo(
    () => channels.filter((channel) => channel.type === 'CATEGORY').sort((left, right) => left.position - right.position),
    [channels]
  );
  const groupedChannels = useMemo(() => {
    const categoryMap = new Map<string, Channel[]>();
    for (const category of categoryChannels) {
      categoryMap.set(category.id, []);
    }

    const uncategorized: Channel[] = [];

    for (const channel of channels) {
      if (channel.type === 'CATEGORY') continue;
      const categoryId = channel.categoryId ?? null;
      if (!categoryId || !categoryMap.has(categoryId)) {
        uncategorized.push(channel);
        continue;
      }
      categoryMap.get(categoryId)!.push(channel);
    }

    for (const list of categoryMap.values()) {
      list.sort((left, right) => left.position - right.position);
    }
    uncategorized.sort((left, right) => left.position - right.position);

    return {
      categoryMap,
      uncategorized
    };
  }, [categoryChannels, channels]);

  useEffect(() => {
    setCollapsedCategoryIds((previous) => {
      const next: Record<string, boolean> = {};
      for (const category of categoryChannels) {
        if (previous[category.id]) {
          next[category.id] = true;
        }
      }
      return next;
    });
  }, [categoryChannels]);

  useEffect(() => {
    if (!activeServer) {
      setServerSettingsName('');
      setServerSettingsIconFile(null);
      return;
    }

    setServerSettingsName(activeServer.name);
    setServerSettingsIconFile(null);
  }, [activeServer]);

  useEffect(() => {
    const nextDrafts: Record<string, EditableRoleDraft> = {};
    for (const role of serverRoles) {
      nextDrafts[role.id] = {
        name: role.name,
        mentionable: role.mentionable,
        permissions: toRolePermissionDraft(role.permissions)
      };
    }
    setRoleDrafts(nextDrafts);
  }, [serverRoles]);

  const mentionSuggestions = useMemo<MentionSuggestion[]>(() => {
    const dedup = new Map<string, MentionSuggestion>();

    for (const member of serverMembers) {
      const nameLabel = member.nickname?.trim() || member.user.displayName;
      const normalizedName = toMentionKey(nameLabel);
      if (normalizedName && !dedup.has(normalizedName)) {
        dedup.set(normalizedName, {
          id: `user-name-${member.userId}`,
          label: nameLabel,
          insertText: normalizedName,
          type: 'user',
          secondaryLabel: 'name'
        });
      }
      const userIdKey = member.userId.toLowerCase();
      if (!dedup.has(userIdKey)) {
        dedup.set(userIdKey, {
          id: `user-id-${member.userId}`,
          label: nameLabel,
          insertText: member.userId,
          type: 'user',
          secondaryLabel: 'id'
        });
      }
    }

    for (const role of sortedServerRoles) {
      if (!role.mentionable) continue;
      const normalizedRole = toMentionKey(role.name);
      if (!normalizedRole || dedup.has(normalizedRole)) continue;
      dedup.set(normalizedRole, {
        id: `role-${role.id}`,
        label: role.name,
        insertText: normalizedRole,
        type: 'role'
      });
    }

    return Array.from(dedup.values());
  }, [serverMembers, sortedServerRoles]);

  const mentionResolver = useMemo(() => {
    const lookup = new Map<string, { label: string; type: 'user' | 'role' }>();
    for (const suggestion of mentionSuggestions) {
      lookup.set(suggestion.insertText.toLowerCase(), {
        label: suggestion.label,
        type: suggestion.type
      });
    }
    return (token: string) => lookup.get(token.toLowerCase()) ?? null;
  }, [mentionSuggestions]);

  const rankedMembers = useMemo<RankedMemberEntry[]>(() => {
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
          userId: member.userId,
          userEmail: member.user.email,
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

  const resolveContextMenuPosition = useCallback((clientX: number, clientY: number) => {
    const menuWidth = 288;
    const menuHeight = 320;
    const x = Math.min(clientX, window.innerWidth - menuWidth);
    const y = Math.min(clientY, window.innerHeight - menuHeight);
    return {
      x: Math.max(8, x),
      y: Math.max(8, y)
    };
  }, []);

  const openChannel = useCallback(
    (channel: Channel, options?: { forceVoiceJoin?: boolean }) => {
      if (channel.type === 'CATEGORY') {
        return;
      }
      setActiveChannelId(channel.id);
      if (channel.type === 'TEXT') {
        setActiveTextChannelId(channel.id);
        return;
      }

      if (options?.forceVoiceJoin || connectedVoiceChannelId !== channel.id) {
        setConnectedVoiceChannelId(channel.id);
        setConnectedVoiceChannelName(channel.name);
      }
    },
    [connectedVoiceChannelId]
  );

  const openChannelContextMenu = (event: MouseEvent<HTMLButtonElement>, channel: Channel) => {
    event.preventDefault();
    event.stopPropagation();
    const { x, y } = resolveContextMenuPosition(event.clientX, event.clientY);
    setContextMenu({ type: 'channel', x, y, channel });
  };

  const openChannelListContextMenu = (event: MouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('[data-channel-item="true"]')) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const { x, y } = resolveContextMenuPosition(event.clientX, event.clientY);
    setContextMenu({ type: 'channelList', x, y });
  };

  const openMemberContextMenu = (event: MouseEvent<HTMLDivElement>, member: RankedMemberEntry) => {
    event.preventDefault();
    const { x, y } = resolveContextMenuPosition(event.clientX, event.clientY);
    setContextMenu({ type: 'member', x, y, member });
  };

  const openServerContextMenu = (event: MouseEvent<HTMLButtonElement>, server: ConnzectServer) => {
    event.preventDefault();
    event.stopPropagation();
    const { x, y } = resolveContextMenuPosition(event.clientX, event.clientY);
    setContextMenu({ type: 'server', x, y, server });
  };

  const openCreateChannelEditor = (type: ChannelEditorState['type'], categoryId: string | null = null) => {
    if (!canCreateChannels) return;
    setChannelEditor({
      mode: 'create',
      type,
      name: '',
      categoryId: type === 'CATEGORY' ? null : categoryId,
      slowModeSeconds: 0,
      bitrate: 64000,
      videoQuality: 'AUTO',
      userLimit: 0
    });
  };

  const openEditChannelEditor = (channel: Channel) => {
    if (!canManageChannels) return;
    setChannelEditor({
      mode: 'edit',
      channelId: channel.id,
      type: channel.type,
      name: channel.name,
      categoryId: channel.type === 'CATEGORY' ? null : channel.categoryId ?? null,
      slowModeSeconds: channel.slowModeSeconds ?? 0,
      bitrate: channel.bitrate ?? 64000,
      videoQuality: channel.videoQuality ?? 'AUTO',
      userLimit: channel.userLimit ?? 0
    });
  };

  const refreshActiveChannels = useCallback(async () => {
    if (!activeServerId) return;
    const loadedChannels = await authRequest<Channel[]>(`/servers/${activeServerId}/channels`);
    setChannels(loadedChannels);
  }, [activeServerId, authRequest]);

  const persistChannelReorder = useCallback(
    async (updatedChannels: Channel[]) => {
      if (!activeServerId) return;

      setChannels(updatedChannels);
      setIsReorderingChannels(true);
      try {
        const items = updatedChannels.map((channel, index) => ({
          id: channel.id,
          position: index,
          categoryId: channel.type === 'CATEGORY' ? null : channel.categoryId ?? null
        }));
        await authRequest<Channel[]>(`/servers/${activeServerId}/channels/reorder`, {
          method: 'PATCH',
          body: JSON.stringify({ items })
        });
        setError(null);
      } catch (nextError) {
        await refreshActiveChannels();
        setError(nextError instanceof Error ? nextError.message : 'Failed to reorder channels');
      } finally {
        setIsReorderingChannels(false);
      }
    },
    [activeServerId, authRequest, refreshActiveChannels]
  );

  const buildReorderedChannels = useCallback(
    (
      dragId: string,
      dropTarget:
        | { kind: 'category'; categoryId: string | null; position?: 'before' | 'after' }
        | { kind: 'channel'; channelId: string }
    ) => {
      const source = channels.find((channel) => channel.id === dragId);
      if (!source) return null;

      const categories = channels
        .filter((channel) => channel.type === 'CATEGORY')
        .sort((left, right) => left.position - right.position);
      const grouped = new Map<string, Channel[]>();
      for (const category of categories) {
        grouped.set(category.id, []);
      }
      const uncategorized: Channel[] = [];

      for (const channel of channels) {
        if (channel.type === 'CATEGORY') continue;
        const categoryId = channel.categoryId ?? null;
        if (!categoryId || !grouped.has(categoryId)) {
          uncategorized.push(channel);
        } else {
          grouped.get(categoryId)!.push(channel);
        }
      }

      for (const list of grouped.values()) {
        list.sort((left, right) => left.position - right.position);
      }
      uncategorized.sort((left, right) => left.position - right.position);

      if (source.type === 'CATEGORY') {
        const nextCategories = categories.filter((entry) => entry.id !== source.id);

        if (dropTarget.kind === 'category') {
          if (!dropTarget.categoryId) {
            nextCategories.push(source);
          } else {
            if (dropTarget.categoryId === source.id) return null;
            const targetIndex = nextCategories.findIndex((entry) => entry.id === dropTarget.categoryId);
            if (targetIndex < 0) return null;
            const insertIndex = dropTarget.position === 'after' ? targetIndex + 1 : targetIndex;
            nextCategories.splice(insertIndex, 0, source);
          }
        } else {
          const target = channels.find((channel) => channel.id === dropTarget.channelId);
          if (!target || target.id === source.id) return null;

          if (target.type === 'CATEGORY') {
            const targetIndex = nextCategories.findIndex((entry) => entry.id === target.id);
            if (targetIndex < 0) return null;
            nextCategories.splice(targetIndex, 0, source);
          } else {
            const parentCategoryId = target.categoryId ?? null;
            if (!parentCategoryId) {
              nextCategories.push(source);
            } else {
              const targetIndex = nextCategories.findIndex((entry) => entry.id === parentCategoryId);
              if (targetIndex < 0) return null;
              nextCategories.splice(targetIndex, 0, source);
            }
          }
        }

        let position = 0;
        const nextChannels: Channel[] = [];
        for (const category of nextCategories) {
          nextChannels.push({
            ...category,
            categoryId: null,
            position: position++
          });
          const children = grouped.get(category.id) ?? [];
          for (const child of children) {
            nextChannels.push({
              ...child,
              categoryId: category.id,
              position: position++
            });
          }
        }
        for (const channel of uncategorized) {
          nextChannels.push({
            ...channel,
            categoryId: null,
            position: position++
          });
        }
        return nextChannels;
      }

      const removeFromLists = (channelId: string) => {
        for (const [categoryId, list] of grouped.entries()) {
          const index = list.findIndex((entry) => entry.id === channelId);
          if (index >= 0) {
            list.splice(index, 1);
            return categoryId;
          }
        }
        const uncategorizedIndex = uncategorized.findIndex((entry) => entry.id === channelId);
        if (uncategorizedIndex >= 0) {
          uncategorized.splice(uncategorizedIndex, 1);
        }
        return null;
      };

      removeFromLists(source.id);

      if (dropTarget.kind === 'category') {
        if (!dropTarget.categoryId) {
          uncategorized.push({ ...source, categoryId: null });
        } else {
          const destination = grouped.get(dropTarget.categoryId);
          if (!destination) return null;
          destination.push({ ...source, categoryId: dropTarget.categoryId });
        }
      } else {
        const target = channels.find((channel) => channel.id === dropTarget.channelId);
        if (!target || target.id === source.id) return null;

        if (target.type === 'CATEGORY') {
          const destination = grouped.get(target.id);
          if (!destination) return null;
          destination.push({ ...source, categoryId: target.id });
        } else {
          const destinationKey = target.categoryId ?? null;
          const destinationList = destinationKey ? grouped.get(destinationKey) : uncategorized;
          if (!destinationList) return null;
          const targetIndex = destinationList.findIndex((entry) => entry.id === target.id);
          if (targetIndex < 0) {
            destinationList.push({ ...source, categoryId: destinationKey });
          } else {
            destinationList.splice(targetIndex, 0, { ...source, categoryId: destinationKey });
          }
        }
      }

      let position = 0;
      const nextChannels: Channel[] = [];
      for (const category of categories) {
        nextChannels.push({
          ...category,
          categoryId: null,
          position: position++
        });
        const children = grouped.get(category.id) ?? [];
        for (const child of children) {
          nextChannels.push({
            ...child,
            categoryId: category.id,
            position: position++
          });
        }
      }
      for (const channel of uncategorized) {
        nextChannels.push({
          ...channel,
          categoryId: null,
          position: position++
        });
      }

      return nextChannels;
    },
    [channels]
  );

  const handleDragStart = (channelId: string) => {
    if (!canMoveChannels) return;
    setDraggedChannelId(channelId);
    setDragOverTarget(null);
  };

  const handleDragEnd = () => {
    lastDragEndedAtRef.current = Date.now();
    setDraggedChannelId(null);
    setDragOverTarget(null);
  };

  const shouldIgnoreClickAfterDrag = () => Date.now() - lastDragEndedAtRef.current < 180;

  const resolveCategoryDropPosition = (event: DragEvent<HTMLElement>): 'before' | 'after' => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return event.clientY <= bounds.top + bounds.height / 2 ? 'before' : 'after';
  };

  const dropOnCategory = async (categoryId: string | null, position: 'before' | 'after' = 'after') => {
    if (!canMoveChannels || !draggedChannelId) return;
    const next = buildReorderedChannels(draggedChannelId, { kind: 'category', categoryId, position });
    setDraggedChannelId(null);
    setDragOverTarget(null);
    if (!next) return;
    await persistChannelReorder(next);
  };

  const dropBeforeChannel = async (channelId: string) => {
    if (!canMoveChannels || !draggedChannelId) return;
    const next = buildReorderedChannels(draggedChannelId, { kind: 'channel', channelId });
    setDraggedChannelId(null);
    setDragOverTarget(null);
    if (!next) return;
    await persistChannelReorder(next);
  };

  const copyValue = useCallback(
    async (value: string, label: string) => {
      try {
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(value);
          return;
        }

        if (typeof document === 'undefined') {
          throw new Error(`Clipboard is unavailable for ${label}`);
        }

        const textarea = document.createElement('textarea');
        textarea.value = value;
        textarea.setAttribute('readonly', 'true');
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        textarea.setSelectionRange(0, textarea.value.length);

        const copied = document.execCommand('copy');
        document.body.removeChild(textarea);

        if (!copied) {
          throw new Error(`Failed to copy ${label}`);
        }
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : `Failed to copy ${label}`);
      }
    },
    []
  );

  const markChannelAsRead = useCallback(
    (channel: Channel) => {
      if (channel.type === 'TEXT' && activeChatChannelId === channel.id) {
        setThreadParent(null);
        setThreadMessages([]);
      }
    },
    [activeChatChannelId]
  );

  const messageMember = useCallback(
    async (member: RankedMemberEntry) => {
      if (member.userId === user?.id) {
        return;
      }

      try {
        const conversation = await authRequest<DirectConversation>('/dm/conversations', {
          method: 'POST',
          body: JSON.stringify({ email: member.userEmail })
        });
        router.push(`/dm/${conversation.id}`);
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : 'Failed to start conversation');
      }
    },
    [authRequest, router, user?.id]
  );

  const updateMemberVolume = useCallback((memberUserId: string, volume: number) => {
    setMemberAudioSettings((previous) => ({
      ...previous,
      [memberUserId]: {
        volume,
        muted: volume === 0
      }
    }));
  }, []);

  const toggleMemberMute = useCallback(
    (member: RankedMemberEntry) => {
      setMemberAudioSettings((previous) => {
        const current = previous[member.userId] ?? { volume: 100, muted: false };
        const muted = !current.muted;
        return {
          ...previous,
          [member.userId]: {
            volume: muted ? 0 : current.volume === 0 ? 100 : current.volume,
            muted
          }
        };
      });
    },
    []
  );

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

  const changeProfilePhoto = async (file: File) => {
    if (!user || isSavingProfilePhoto) return;
    if (!file.type.startsWith('image/')) {
      setVoiceSettingsError('Please select an image file.');
      return;
    }

    const payload = new FormData();
    payload.append('avatar', file);

    setIsSavingProfilePhoto(true);
    setVoiceSettingsError(null);
    setVoiceSettingsSuccess(null);

    try {
      const response = await authRequest<{ user: User }>('/auth/me', {
        method: 'PATCH',
        body: payload
      });
      updateUser(response.user);
      setVoiceSettingsSuccess('Profile photo updated.');
    } catch (nextError) {
      setVoiceSettingsError(nextError instanceof Error ? nextError.message : 'Failed to update profile photo');
    } finally {
      setIsSavingProfilePhoto(false);
    }
  };

  const onAvatarFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    void changeProfilePhoto(file);
    event.target.value = '';
  };

  const disconnectVoice = () => {
    if (!isVoiceConnected) return;
    socket?.emit('voice:leave');
    setIsSharingScreen(false);
    setVoiceParticipants([]);
    setConnectedVoiceChannelId('');
    setConnectedVoiceChannelName('');
    if (activeTextChannelId) {
      setActiveChannelId(activeTextChannelId);
      return;
    }
    const firstText = channels.find((channel) => channel.type === 'TEXT');
    if (firstText) {
      setActiveTextChannelId(firstText.id);
      setActiveChannelId(firstText.id);
      return;
    }
    setActiveChannelId('');
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
    if (!activeChatChannelId || !activeChatChannel || activeChatChannel.type !== 'TEXT') return;

    if (!socket?.connected) {
      const created = await authRequest<Message>(`/channels/${activeChatChannelId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content, parentMessageId })
      });
      upsertMessageLocal(created);
      return;
    }

    socket.emit('message:send', { channelId: activeChatChannelId, content, parentMessageId });
  };

  const editMessage = async (messageId: string, content: string) => {
    if (!activeChatChannelId || !activeChatChannel || activeChatChannel.type !== 'TEXT') return;

    if (!socket?.connected) {
      const updated = await authRequest<Message>(`/channels/${activeChatChannelId}/messages/${messageId}`, {
        method: 'PATCH',
        body: JSON.stringify({ content })
      });
      upsertMessageLocal(updated);
      return;
    }

    socket.emit('message:edit', { channelId: activeChatChannelId, messageId, content });
  };

  const deleteMessage = async (messageId: string) => {
    if (!activeChatChannelId || !activeChatChannel || activeChatChannel.type !== 'TEXT') return;

    if (!socket?.connected) {
      const deleted = await authRequest<{ id: string }>(`/channels/${activeChatChannelId}/messages/${messageId}`, {
        method: 'DELETE'
      });
      removeMessageLocal(deleted.id);
      return;
    }

    socket.emit('message:delete', { channelId: activeChatChannelId, messageId });
  };

  const refreshActiveServerDetails = useCallback(
    async (serverId: string) => {
      const details = await authRequest<ServerDetails>(`/servers/${serverId}`);
      setServerMembers(details.members);
      setServerRoles(details.roles);
    },
    [authRequest]
  );

  const saveServerSettings = async (event: FormEvent) => {
    event.preventDefault();
    if (!activeServer || isSavingServerSettings) return;

    const trimmedName = serverSettingsName.trim();
    const hasNameChange = trimmedName.length > 0 && trimmedName !== activeServer.name;
    const hasIconChange = Boolean(serverSettingsIconFile);

    if (!hasNameChange && !hasIconChange) {
      setError('No server changes to save.');
      return;
    }

    if (hasNameChange && (trimmedName.length < 2 || trimmedName.length > 80)) {
      setError('Server name must be between 2 and 80 characters.');
      return;
    }

    const payload = new FormData();
    if (hasNameChange) payload.append('name', trimmedName);
    if (serverSettingsIconFile) payload.append('icon', serverSettingsIconFile);

    setIsSavingServerSettings(true);
    try {
      const updated = await authRequest<ConnzectServer>(`/servers/${activeServer.id}`, {
        method: 'PATCH',
        body: payload
      });
      setServers((previous) => previous.map((server) => (server.id === updated.id ? { ...server, ...updated } : server)));
      setServerSettingsName(updated.name);
      setServerSettingsIconFile(null);
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to update server settings');
    } finally {
      setIsSavingServerSettings(false);
    }
  };

  const updateRoleDraft = (roleId: string, updater: (draft: EditableRoleDraft) => EditableRoleDraft) => {
    setRoleDrafts((previous) => {
      const existing = previous[roleId];
      if (!existing) return previous;
      return {
        ...previous,
        [roleId]: updater(existing)
      };
    });
  };

  const setRoleBusy = (roleId: string, busy: boolean) => {
    setRoleBusyState((previous) => ({
      ...previous,
      [roleId]: busy
    }));
  };

  const createRole = async (event: FormEvent) => {
    event.preventDefault();
    if (!activeServer || isCreatingRole) return;

    const trimmedName = newRoleName.trim();
    if (trimmedName.length < 2 || trimmedName.length > 32) {
      setError('Role name must be between 2 and 32 characters.');
      return;
    }

    setIsCreatingRole(true);
    try {
      await authRequest<Role>(`/servers/${activeServer.id}/roles`, {
        method: 'POST',
        body: JSON.stringify({
          name: trimmedName,
          mentionable: newRoleMentionable,
          permissions: toPermissionBits(newRolePermissions)
        })
      });
      await refreshActiveServerDetails(activeServer.id);
      setNewRoleName('');
      setNewRoleMentionable(true);
      setNewRolePermissions({
        kickMember: false,
        banMember: false,
        muteChat: false,
        muteVoice: false,
        moveChannels: false
      });
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to create role');
    } finally {
      setIsCreatingRole(false);
    }
  };

  const saveRole = async (roleId: string) => {
    if (!activeServer) return;
    const draft = roleDrafts[roleId];
    if (!draft) return;

    const trimmedName = draft.name.trim();
    if (trimmedName.length < 2 || trimmedName.length > 32) {
      setError('Role name must be between 2 and 32 characters.');
      return;
    }

    setRoleBusy(roleId, true);
    try {
      await authRequest<Role>(`/servers/${activeServer.id}/roles/${roleId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: trimmedName,
          mentionable: draft.mentionable,
          permissions: toPermissionBits(draft.permissions)
        })
      });
      await refreshActiveServerDetails(activeServer.id);
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to update role');
    } finally {
      setRoleBusy(roleId, false);
    }
  };

  const deleteRole = async (role: Role) => {
    if (!activeServer || role.isDefault || roleBusyState[role.id]) return;
    if (!window.confirm(`Delete role "${role.name}"?`)) return;

    setRoleBusy(role.id, true);
    try {
      await authRequest(`/servers/${activeServer.id}/roles/${role.id}`, {
        method: 'DELETE'
      });
      await refreshActiveServerDetails(activeServer.id);
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to delete role');
    } finally {
      setRoleBusy(role.id, false);
    }
  };

  const saveChannelEditor = async (event: FormEvent) => {
    event.preventDefault();
    if (!activeServer || !channelEditor || isSavingChannelEditor) return;

    const trimmedName = channelEditor.name.trim();
    if (trimmedName.length < 2 || trimmedName.length > 50) {
      setError('Channel name must be between 2 and 50 characters.');
      return;
    }

    const body: Record<string, unknown> = {
      name: trimmedName
    };

    if (channelEditor.type !== 'CATEGORY') {
      body.categoryId = channelEditor.categoryId ?? null;
    }

    if (channelEditor.type === 'TEXT') {
      body.slowModeSeconds = Math.max(0, Math.min(21600, Math.floor(channelEditor.slowModeSeconds)));
    }

    if (channelEditor.type === 'VOICE') {
      body.bitrate = Math.max(8000, Math.min(256000, Math.floor(channelEditor.bitrate)));
      body.videoQuality = channelEditor.videoQuality;
      body.userLimit = Math.max(0, Math.min(99, Math.floor(channelEditor.userLimit)));
    }

    if (channelEditor.mode === 'create') {
      body.type = channelEditor.type;
    }

    setIsSavingChannelEditor(true);
    try {
      if (channelEditor.mode === 'create') {
        const created = await authRequest<Channel>(`/servers/${activeServer.id}/channels`, {
          method: 'POST',
          body: JSON.stringify(body)
        });
        await refreshActiveChannels();
        if (created.type !== 'CATEGORY') {
          openChannel(created);
        }
      } else if (channelEditor.channelId) {
        await authRequest<Channel>(`/servers/${activeServer.id}/channels/${channelEditor.channelId}`, {
          method: 'PATCH',
          body: JSON.stringify(body)
        });
        await refreshActiveChannels();
      }

      setChannelEditor(null);
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to save channel');
    } finally {
      setIsSavingChannelEditor(false);
    }
  };

  const deleteChannel = async (channel: Channel) => {
    if (!activeServer || !canManageChannels) return;

    const label = channel.type === 'CATEGORY' ? 'category' : 'channel';
    if (!window.confirm(`Delete ${label} "${channel.name}"?`)) {
      return;
    }

    try {
      await authRequest(`/servers/${activeServer.id}/channels/${channel.id}`, {
        method: 'DELETE'
      });

      if (connectedVoiceChannelId === channel.id) {
        setConnectedVoiceChannelId('');
        setConnectedVoiceChannelName('');
        setVoiceParticipants([]);
        setIsSharingScreen(false);
      }

      if (activeChannelId === channel.id) {
        setActiveChannelId('');
      }

      if (activeTextChannelId === channel.id) {
        setActiveTextChannelId('');
      }

      await refreshActiveChannels();
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : `Failed to delete ${label}`);
    }
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

  const openServerOptions = (server: ConnzectServer) => {
    if (activeServerId !== server.id) {
      openServerWidget(server.id);
      window.setTimeout(() => {
        setServerSettingsTab('general');
        setServerSettingsOpen(true);
      }, 240);
      return;
    }

    setServerSettingsTab('general');
    setServerSettingsOpen(true);
  };

  const leaveServer = async (serverToLeave?: ConnzectServer) => {
    const targetServer = serverToLeave ?? activeServer;
    if (!targetServer || !user || isLeavingServer) return;

    const ownerExitWarning =
      targetServer.ownerId === user.id
        ? 'You are the owner. Leaving will transfer ownership to another member, or delete the server if you are alone.\n\n'
        : '';

    if (!window.confirm(`${ownerExitWarning}Leave "${targetServer.name}"?`)) {
      return;
    }

    setIsLeavingServer(true);
    try {
      await authRequest(`/servers/${targetServer.id}/members/me`, {
        method: 'DELETE'
      });
      setError(null);
      setServers((previous) => previous.filter((server) => server.id !== targetServer.id));
      if (activeServerId === targetServer.id) {
        if (closeTimerRef.current) {
          window.clearTimeout(closeTimerRef.current);
          closeTimerRef.current = null;
        }
        setActiveServerId(null);
        setIsClosingServerView(false);
        setIsOpeningServerView(false);
      }
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

  const handleReorderServers = useCallback((orderedServerIds: string[]) => {
    setServers((previous) => {
      const byId = new Map(previous.map((server) => [server.id, server]));
      const next: ConnzectServer[] = [];

      for (const serverId of orderedServerIds) {
        const server = byId.get(serverId);
        if (!server) continue;
        next.push(server);
        byId.delete(serverId);
      }

      for (const server of previous) {
        if (!byId.has(server.id)) continue;
        next.push(server);
        byId.delete(server.id);
      }

      return next;
    });
  }, []);

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
            <div className="flex items-center gap-2">
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

              {user ? (
                <div className={cn(styles.surface, 'flex items-center gap-2 rounded-2xl border px-2 py-2 sm:gap-3 sm:px-3')}>
                  {accountAvatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={accountAvatarUrl} alt={user.displayName} className="h-9 w-9 rounded-xl object-cover" />
                  ) : (
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/15 bg-white/5 text-sm font-semibold text-slate-100">
                      {accountInitial}
                    </div>
                  )}

                  <div className="hidden min-w-0 sm:flex sm:w-44 sm:flex-col sm:gap-1">
                    <p className="truncate text-sm font-semibold text-white">{user.displayName}</p>
                    {isVoiceConnected ? (
                      <div className="truncate rounded-md border border-emerald-200/30 bg-emerald-300/15 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-emerald-100">
                        Voice: {connectedVoiceChannelName || 'Connected'}
                      </div>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      aria-label="Mute microfon"
                      title="Mute microfon"
                      aria-pressed={isMicMuted}
                      onClick={() => setIsMicMuted((current) => !current)}
                      className={cn(
                        'inline-flex h-8 w-8 items-center justify-center rounded-lg border text-slate-100 transition',
                        isMicMuted ? 'border-red-300/40 bg-red-500/20' : 'border-white/15 bg-white/5 hover:bg-white/10'
                      )}
                    >
                      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 14a3 3 0 0 0 3-3V7a3 3 0 1 0-6 0v4a3 3 0 0 0 3 3Z" />
                        <path d="M19 11a7 7 0 0 1-14 0" />
                        <path d="M12 18v3" />
                        <path d="M8 21h8" />
                      </svg>
                    </button>

                    <button
                      type="button"
                      aria-label="Mute auz"
                      title="Mute auz"
                      aria-pressed={isOutputMuted}
                      onClick={() => setIsOutputMuted((current) => !current)}
                      className={cn(
                        'inline-flex h-8 w-8 items-center justify-center rounded-lg border text-slate-100 transition',
                        isOutputMuted ? 'border-red-300/40 bg-red-500/20' : 'border-white/15 bg-white/5 hover:bg-white/10'
                      )}
                    >
                      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M11 5 6 9H2v6h4l5 4V5Z" />
                        <path d="M16 9l5 5" />
                        <path d="M21 9l-5 5" />
                      </svg>
                    </button>

                    <div ref={voiceSettingsRef} className="relative">
                      <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={onAvatarFileChange} />
                      <button
                        type="button"
                        aria-label="Voice settings"
                        title="Voice settings"
                        aria-pressed={isVoiceSettingsOpen}
                        onClick={() => setIsVoiceSettingsOpen((current) => !current)}
                        className={cn(
                          'inline-flex h-8 w-8 items-center justify-center rounded-lg border text-slate-100 transition',
                          isVoiceSettingsOpen ? 'border-emerald-200/40 bg-emerald-300/20' : 'border-white/15 bg-white/5 hover:bg-white/10'
                        )}
                      >
                        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="12" cy="12" r="3" />
                          <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.82l.02.02a2 2 0 0 1-2.82 2.82l-.02-.02A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1V21a2 2 0 1 1-4 0v-.04a1.7 1.7 0 0 0-.4-1 1.7 1.7 0 0 0-1-.6 1.7 1.7 0 0 0-1.82.34l-.02.02a2 2 0 1 1-2.82-2.82l.02-.02A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1-.4H3a2 2 0 1 1 0-4h.04a1.7 1.7 0 0 0 1-.4 1.7 1.7 0 0 0 .6-1 1.7 1.7 0 0 0-.34-1.82l-.02-.02a2 2 0 1 1 2.82-2.82l.02.02A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1V3a2 2 0 1 1 4 0v.04a1.7 1.7 0 0 0 .4 1 1.7 1.7 0 0 0 1 .6 1.7 1.7 0 0 0 1.82-.34l.02-.02a2 2 0 1 1 2.82 2.82l-.02.02A1.7 1.7 0 0 0 19.4 9c.29.3.47.68.6 1 .08.32.1.66.06 1 .04.34.02.68-.06 1-.13.32-.31.7-.6 1Z" />
                        </svg>
                      </button>

                      {isVoiceSettingsOpen ? (
                        <div className="absolute left-0 top-10 z-[72] w-80 rounded-2xl border border-emerald-200/25 bg-slate-950/95 p-3 shadow-[0_20px_60px_-25px_rgba(16,185,129,0.65)] backdrop-blur-md">
                          <div className="rounded-xl border border-white/10 bg-black/25 p-2.5">
                            <button
                              type="button"
                              onClick={() => avatarInputRef.current?.click()}
                              disabled={isSavingProfilePhoto}
                              className="inline-flex w-full items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-left text-xs font-medium text-slate-100 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              <span>{isSavingProfilePhoto ? 'Updating photo...' : 'Change profile photo'}</span>
                              <span className="text-[10px] text-emerald-100/80">Upload</span>
                            </button>
                          </div>

                          <div className="mt-2.5 rounded-xl border border-white/10 bg-black/25 p-2.5">
                            <p className="text-[10px] uppercase tracking-[0.14em] text-slate-400">Input microphone</p>
                            <select
                              value={selectedAudioInputId}
                              onChange={(event) => setSelectedAudioInputId(event.target.value)}
                              className="mt-1.5 w-full rounded-lg border border-white/10 bg-black/30 px-2.5 py-2 text-xs text-slate-100 outline-none transition"
                            >
                              <option value="">System default</option>
                              {audioInputDevices.map((device) => (
                                <option key={device.id} value={device.id}>
                                  {device.label}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="mt-2.5 rounded-xl border border-white/10 bg-black/25 p-2.5">
                            <p className="text-[10px] uppercase tracking-[0.14em] text-slate-400">Output speaker</p>
                            <select
                              value={selectedAudioOutputId}
                              onChange={(event) => setSelectedAudioOutputId(event.target.value)}
                              className="mt-1.5 w-full rounded-lg border border-white/10 bg-black/30 px-2.5 py-2 text-xs text-slate-100 outline-none transition"
                            >
                              <option value="">System default</option>
                              {audioOutputDevices.map((device) => (
                                <option key={device.id} value={device.id}>
                                  {device.label}
                                </option>
                              ))}
                            </select>
                          </div>

                          {voiceSettingsError ? <p className="mt-2 text-xs text-red-300">{voiceSettingsError}</p> : null}
                          {voiceSettingsSuccess ? <p className="mt-2 text-xs text-emerald-100">{voiceSettingsSuccess}</p> : null}
                        </div>
                      ) : null}
                    </div>

                    {canShowVoiceActions ? (
                      <>
                        <button
                          type="button"
                          aria-label="Share screen"
                          title="Share screen"
                          aria-pressed={isSharingScreen}
                          onClick={() => setIsSharingScreen((current) => !current)}
                          className={cn(
                            'inline-flex h-8 w-8 items-center justify-center rounded-lg border text-slate-100 transition',
                            isSharingScreen ? 'border-emerald-200/40 bg-emerald-300/20' : 'border-white/15 bg-white/5 hover:bg-white/10'
                          )}
                        >
                          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="3" y="4" width="18" height="13" rx="2" />
                            <path d="M8 20h8" />
                            <path d="M12 17v3" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          aria-label="Disconnect voice"
                          title="Disconnect voice"
                          onClick={disconnectVoice}
                          className="inline-flex h-9 items-center gap-2 rounded-lg border border-red-300/40 bg-red-500/20 px-3 text-xs font-semibold text-slate-100 transition hover:bg-red-500/30"
                        >
                          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M4 15c4-4 12-4 16 0" />
                            <path d="M10 15l-2 4" />
                            <path d="M14 15l2 4" />
                          </svg>
                          <span>Disconnect</span>
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>

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
              onServerContextMenu={openServerContextMenu}
              onReorderServers={handleReorderServers}
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
              onServerContextMenu={openServerContextMenu}
              onReorderServers={handleReorderServers}
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
                    {canOpenServerSettings ? (
                      <Button
                        variant="soft"
                        onClick={() => {
                          setServerSettingsTab('general');
                          setServerSettingsOpen(true);
                        }}
                      >
                        Server Settings
                      </Button>
                    ) : null}
                    <Button
                      variant="danger"
                      onClick={() => {
                        void leaveServer();
                      }}
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
                  <aside className="rounded-2xl border border-white/10 bg-black/15 p-3" onContextMenu={openChannelListContextMenu}>
                    {canMoveChannels ? (
                      <p className="mb-2 rounded-lg border border-emerald-300/20 bg-emerald-300/10 px-2 py-1 text-[10px] uppercase tracking-[0.1em] text-emerald-100/70">
                        Drag categories and channels to reorder
                      </p>
                    ) : null}
                    <div className="soft-scroll max-h-[56vh] space-y-2 overflow-y-auto pr-1">
                      {categoryChannels.map((category) => {
                        const categoryCollapsed = Boolean(collapsedCategoryIds[category.id]);
                        const categoryItems = groupedChannels.categoryMap.get(category.id) ?? [];

                        return (
                          <section
                            key={category.id}
                            className={cn(
                              'space-y-1 rounded-xl transition',
                              dragOverTarget?.kind === 'category' && dragOverTarget.id === category.id
                                ? 'ring-1 ring-emerald-200/55 bg-emerald-300/10'
                                : ''
                            )}
                            onDragOver={(event) => {
                              if (!canMoveChannels) return;
                              event.preventDefault();
                              setDragOverTarget({ kind: 'category', id: category.id, position: 'after' });
                            }}
                            onDragLeave={(event) => {
                              if (!canMoveChannels) return;
                              const nextTarget = event.relatedTarget as Node | null;
                              if (nextTarget && event.currentTarget.contains(nextTarget)) return;
                              setDragOverTarget((previous) =>
                                previous?.kind === 'category' && previous.id === category.id ? null : previous
                              );
                            }}
                            onDrop={(event) => {
                              if (!canMoveChannels) return;
                              event.preventDefault();
                              event.stopPropagation();
                              void dropOnCategory(category.id, 'after');
                            }}
                          >
                            <button
                              type="button"
                              data-channel-item="true"
                              draggable={canMoveChannels}
                              onDragStart={() => handleDragStart(category.id)}
                              onDragEnd={handleDragEnd}
                              onDragOver={(event) => {
                                if (!canMoveChannels) return;
                                event.preventDefault();
                                event.stopPropagation();
                                if (isDraggingCategory) {
                                  setDragOverTarget({
                                    kind: 'category',
                                    id: category.id,
                                    position: resolveCategoryDropPosition(event)
                                  });
                                  return;
                                }
                                setDragOverTarget({ kind: 'channel', id: category.id });
                              }}
                              onDragLeave={(event) => {
                                if (!canMoveChannels) return;
                                const nextTarget = event.relatedTarget as Node | null;
                                if (nextTarget && event.currentTarget.contains(nextTarget)) return;
                                setDragOverTarget((previous) =>
                                  (previous?.kind === 'channel' && previous.id === category.id) ||
                                  (previous?.kind === 'category' && previous.id === category.id)
                                    ? null
                                    : previous
                                );
                              }}
                              onDrop={(event) => {
                                if (!canMoveChannels) return;
                                event.preventDefault();
                                event.stopPropagation();
                                if (isDraggingCategory) {
                                  void dropOnCategory(category.id, resolveCategoryDropPosition(event));
                                  return;
                                }
                                void dropBeforeChannel(category.id);
                              }}
                              onClick={() => {
                                if (shouldIgnoreClickAfterDrag()) return;
                                setCollapsedCategoryIds((previous) => ({
                                  ...previous,
                                  [category.id]: !previous[category.id]
                                }));
                              }}
                              onContextMenu={(event) => openChannelContextMenu(event, category)}
                              className={cn(
                                'flex w-full items-center justify-between rounded-xl border border-transparent px-3 py-2 text-sm uppercase tracking-[0.12em] transition hover:border-white/20 hover:bg-white/5',
                                canMoveChannels ? 'cursor-grab active:cursor-grabbing' : '',
                                draggedChannelId === category.id ? 'border-emerald-200/45 bg-emerald-300/10 opacity-65' : '',
                                dragOverTarget?.kind === 'category' &&
                                  dragOverTarget.id === category.id &&
                                  dragOverTarget.position === 'before'
                                  ? 'border-t-2 border-t-emerald-200'
                                  : '',
                                dragOverTarget?.kind === 'category' &&
                                  dragOverTarget.id === category.id &&
                                  dragOverTarget.position === 'after'
                                  ? 'border-b-2 border-b-emerald-200'
                                  : '',
                                dragOverTarget?.kind === 'channel' && dragOverTarget.id === category.id
                                  ? 'border-emerald-200/65 bg-emerald-300/15'
                                  : ''
                              )}
                            >
                              <span className="inline-flex items-center gap-2">
                                {canMoveChannels ? <span className="text-[10px] text-emerald-100/45">::</span> : null}
                                <span className="text-emerald-100/85">{categoryCollapsed ? '>' : 'v'}</span>
                                <span>{category.name}</span>
                              </span>
                              {draggedChannelId === category.id ? <span className="text-[10px] text-emerald-100/70">Moving</span> : null}
                            </button>

                            {!categoryCollapsed
                              ? categoryItems.map((channel) => (
                                  <div key={channel.id} className="space-y-1 pl-3">
                                    <button
                                      type="button"
                                      data-channel-item="true"
                                      draggable={canMoveChannels}
                                      onDragStart={() => handleDragStart(channel.id)}
                                      onDragEnd={handleDragEnd}
                                      onDragOver={(event) => {
                                        if (!canMoveChannels) return;
                                        event.preventDefault();
                                        setDragOverTarget({ kind: 'channel', id: channel.id });
                                      }}
                                      onDragLeave={(event) => {
                                        if (!canMoveChannels) return;
                                        const nextTarget = event.relatedTarget as Node | null;
                                        if (nextTarget && event.currentTarget.contains(nextTarget)) return;
                                        setDragOverTarget((previous) =>
                                          previous?.kind === 'channel' && previous.id === channel.id ? null : previous
                                        );
                                      }}
                                      onDrop={(event) => {
                                        if (!canMoveChannels) return;
                                        event.preventDefault();
                                        event.stopPropagation();
                                        void dropBeforeChannel(channel.id);
                                      }}
                                      onClick={() => {
                                        if (shouldIgnoreClickAfterDrag()) return;
                                        openChannel(channel);
                                      }}
                                      onContextMenu={(event) => openChannelContextMenu(event, channel)}
                                      className={cn(
                                        'flex w-full items-center justify-between rounded-xl border px-3 py-2 text-sm transition',
                                        canMoveChannels ? 'cursor-grab active:cursor-grabbing' : '',
                                        draggedChannelId === channel.id ? 'border-emerald-200/45 bg-emerald-300/10 opacity-65' : '',
                                        activeChannelId === channel.id
                                          ? 'border-emerald-200/45 bg-white/10'
                                          : 'border-transparent hover:border-white/20 hover:bg-white/5',
                                        dragOverTarget?.kind === 'channel' && dragOverTarget.id === channel.id
                                          ? 'border-emerald-200/65 bg-emerald-300/15'
                                          : ''
                                      )}
                                    >
                                      <span className="inline-flex items-center gap-2">
                                        {canMoveChannels ? <span className="text-[10px] text-emerald-100/45">::</span> : null}
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

                                    {channel.type === 'VOICE' &&
                                    connectedVoiceChannelId === channel.id &&
                                    displayedVoiceParticipants.length > 0 ? (
                                      <div className="flex items-center gap-1.5 px-2">
                                        {displayedVoiceParticipants.map((participant) => {
                                          const avatarUrl = resolveAssetUrl(participant.avatarUrl ?? null);
                                          return avatarUrl ? (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img
                                              key={participant.socketId}
                                              src={avatarUrl}
                                              alt={participant.displayName}
                                              title={participant.displayName}
                                              className="h-6 w-6 rounded-full border border-white/20 object-cover"
                                            />
                                          ) : (
                                            <span
                                              key={participant.socketId}
                                              title={participant.displayName}
                                              className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-white/20 bg-white/5 text-[9px] font-semibold"
                                            >
                                              {participant.displayName.trim().charAt(0).toUpperCase() || '?'}
                                            </span>
                                          );
                                        })}
                                      </div>
                                    ) : null}
                                  </div>
                                ))
                              : null}
                          </section>
                        );
                      })}

                      {groupedChannels.uncategorized.length > 0 ? (
                        <section
                          className={cn(
                            'space-y-1 rounded-xl transition',
                            dragOverTarget?.kind === 'uncategorized' ? 'ring-1 ring-emerald-200/55 bg-emerald-300/10' : ''
                          )}
                          onDragOver={(event) => {
                            if (!canMoveChannels) return;
                            event.preventDefault();
                            setDragOverTarget({ kind: 'uncategorized' });
                          }}
                          onDragLeave={(event) => {
                            if (!canMoveChannels) return;
                            const nextTarget = event.relatedTarget as Node | null;
                            if (nextTarget && event.currentTarget.contains(nextTarget)) return;
                            setDragOverTarget((previous) => (previous?.kind === 'uncategorized' ? null : previous));
                          }}
                          onDrop={(event) => {
                            if (!canMoveChannels) return;
                            event.preventDefault();
                            event.stopPropagation();
                            void dropOnCategory(null, 'after');
                          }}
                        >
                          {groupedChannels.uncategorized.map((channel) => (
                            <div key={channel.id} className="space-y-1">
                              <button
                                type="button"
                                data-channel-item="true"
                                draggable={canMoveChannels}
                                onDragStart={() => handleDragStart(channel.id)}
                                onDragEnd={handleDragEnd}
                                onDragOver={(event) => {
                                  if (!canMoveChannels) return;
                                  event.preventDefault();
                                  setDragOverTarget({ kind: 'channel', id: channel.id });
                                }}
                                onDragLeave={(event) => {
                                  if (!canMoveChannels) return;
                                  const nextTarget = event.relatedTarget as Node | null;
                                  if (nextTarget && event.currentTarget.contains(nextTarget)) return;
                                  setDragOverTarget((previous) =>
                                    previous?.kind === 'channel' && previous.id === channel.id ? null : previous
                                  );
                                }}
                                onDrop={(event) => {
                                  if (!canMoveChannels) return;
                                  event.preventDefault();
                                  event.stopPropagation();
                                  void dropBeforeChannel(channel.id);
                                }}
                                onClick={() => {
                                  if (shouldIgnoreClickAfterDrag()) return;
                                  openChannel(channel);
                                }}
                                onContextMenu={(event) => openChannelContextMenu(event, channel)}
                                className={cn(
                                  'flex w-full items-center justify-between rounded-xl border px-3 py-2 text-sm transition',
                                  canMoveChannels ? 'cursor-grab active:cursor-grabbing' : '',
                                  draggedChannelId === channel.id ? 'border-emerald-200/45 bg-emerald-300/10 opacity-65' : '',
                                  activeChannelId === channel.id
                                    ? 'border-emerald-200/45 bg-white/10'
                                    : 'border-transparent hover:border-white/20 hover:bg-white/5',
                                  dragOverTarget?.kind === 'channel' && dragOverTarget.id === channel.id
                                    ? 'border-emerald-200/65 bg-emerald-300/15'
                                    : ''
                                )}
                              >
                                <span className="inline-flex items-center gap-2">
                                  {canMoveChannels ? <span className="text-[10px] text-emerald-100/45">::</span> : null}
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

                              {channel.type === 'VOICE' &&
                              connectedVoiceChannelId === channel.id &&
                              displayedVoiceParticipants.length > 0 ? (
                                <div className="flex items-center gap-1.5 px-2">
                                  {displayedVoiceParticipants.map((participant) => {
                                    const avatarUrl = resolveAssetUrl(participant.avatarUrl ?? null);
                                    return avatarUrl ? (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img
                                        key={participant.socketId}
                                        src={avatarUrl}
                                        alt={participant.displayName}
                                        title={participant.displayName}
                                        className="h-6 w-6 rounded-full border border-white/20 object-cover"
                                      />
                                    ) : (
                                      <span
                                        key={participant.socketId}
                                        title={participant.displayName}
                                        className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-white/20 bg-white/5 text-[9px] font-semibold"
                                      >
                                        {participant.displayName.trim().charAt(0).toUpperCase() || '?'}
                                      </span>
                                    );
                                  })}
                                </div>
                              ) : null}
                            </div>
                          ))}
                        </section>
                      ) : null}

                      {channels.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-white/20 p-4 text-xs text-slate-400">
                          No channels available for this server.
                        </div>
                      ) : null}
                    </div>
                  </aside>

                  <section className="rounded-2xl border border-white/10 bg-black/15 p-4">
                    {connectedVoiceChannelId && socket ? (
                      <div className="sr-only" aria-hidden="true">
                        <VoiceRoom
                          channelId={connectedVoiceChannelId}
                          socket={socket}
                          preferredInputDeviceId={selectedAudioInputId || undefined}
                          preferredOutputDeviceId={selectedAudioOutputId || undefined}
                          onParticipantsChange={setVoiceParticipants}
                        />
                      </div>
                    ) : null}
                    {activeChannel ? (
                      <>
                        {activeChannel.type === 'VOICE' && !isVoiceConnected ? (
                          <div className="mb-3 rounded-2xl border border-dashed border-white/20 p-4 text-sm text-slate-300">
                            Voice channel selected. Realtime connection is required to join voice.
                          </div>
                        ) : null}
                        {activeChannel.type === 'CATEGORY' ? (
                          <div className="mb-3 rounded-2xl border border-dashed border-white/20 p-4 text-sm text-slate-300">
                            Category selected. Pick a text or voice channel under it.
                          </div>
                        ) : null}

                        {activeChatChannel ? (
                        <div className={`grid gap-4 ${threadParent ? 'lg:grid-cols-[1.6fr_1fr]' : ''}`}>
                          <div>
                            {activeChatChannel.type === 'TEXT' && activeChatChannel.slowModeSeconds > 0 ? (
                              <div className="mb-2 rounded-xl border border-amber-200/30 bg-amber-300/10 px-3 py-2 text-xs text-amber-100">
                                Slow mode: {activeChatChannel.slowModeSeconds}s between messages.
                              </div>
                            ) : null}
                            <MessageList
                              messages={messages}
                              currentUserId={user?.id}
                              onEdit={editMessage}
                              onDelete={deleteMessage}
                              allowDeleteOthers={activeServer.ownerId === user?.id}
                              onOpenThread={(message) => setThreadParent(message as Message)}
                              activeThreadParentId={threadParent?.id ?? null}
                              resolveMention={mentionResolver}
                            />
                            <MessageInput
                              onSend={(content) => sendMessage(content)}
                              placeholder="Type in channel"
                              mentionSuggestions={mentionSuggestions}
                            />
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
                                resolveMention={mentionResolver}
                              />
                              <MessageInput
                                onSend={(content) => sendMessage(content, threadParent.id)}
                                placeholder="Reply in thread"
                                submitLabel="Reply"
                                mentionSuggestions={mentionSuggestions}
                              />
                            </div>
                          ) : null}
                        </div>
                        ) : (
                          <div className="rounded-2xl border border-dashed border-white/20 p-6 text-sm text-slate-300">
                            No text channel available. Open or create a text channel to keep chat visible while in voice.
                          </div>
                        )}
                      </>
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
                                onContextMenu={(event) => openMemberContextMenu(event, member)}
                                className="flex items-center justify-between gap-2 rounded-lg border border-transparent px-2 py-1.5 transition hover:border-white/15 hover:bg-white/5"
                              >
                                <div className="min-w-0 flex items-center gap-2">
                                  <span className="w-6 text-[10px] text-slate-400">#{member.rank}</span>
                                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-white/15 bg-white/5 text-[10px] font-semibold tracking-[0.08em] text-slate-200">
                                    {member.initials}
                                  </span>
                                  <span
                                    className={cn(
                                      'truncate text-sm',
                                      memberAudioSettings[member.userId]?.muted || memberAudioSettings[member.userId]?.volume === 0
                                        ? 'text-red-300'
                                        : 'text-slate-100'
                                    )}
                                  >
                                    {member.displayName}
                                  </span>
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

        {contextMenu ? (
          <div
            ref={contextMenuRef}
            className="fixed z-[76] w-72 rounded-2xl border border-emerald-200/30 bg-slate-950/95 p-2 shadow-[0_18px_55px_-20px_rgba(16,185,129,0.7)] backdrop-blur-md"
            style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
            onContextMenu={(event) => event.preventDefault()}
          >
            {contextMenu.type === 'channelList' ? (
              <>
                <p className="px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-emerald-100/80">Channels</p>
                <button
                  type="button"
                  disabled={!canCreateChannels}
                  onClick={() => {
                    openCreateChannelEditor('TEXT');
                    setContextMenu(null);
                  }}
                  className="mt-1 flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-slate-100 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span>Create text channel</span>
                  <span className="text-xs text-slate-400">#</span>
                </button>
                <button
                  type="button"
                  disabled={!canCreateChannels}
                  onClick={() => {
                    openCreateChannelEditor('VOICE');
                    setContextMenu(null);
                  }}
                  className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-slate-100 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span>Create voice channel</span>
                  <span className="text-xs text-slate-400">Voice</span>
                </button>
                <button
                  type="button"
                  disabled={!canCreateChannels}
                  onClick={() => {
                    openCreateChannelEditor('CATEGORY');
                    setContextMenu(null);
                  }}
                  className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-slate-100 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span>Create category</span>
                  <span className="text-xs text-slate-400">::</span>
                </button>
              </>
            ) : contextMenu.type === 'channel' ? (
              <>
                <p className="px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-emerald-100/80">
                  {contextMenu.channel.type === 'CATEGORY' ? 'Category' : 'Channel'}: {contextMenu.channel.name}
                </p>
                {canManageChannels ? (
                  <button
                    type="button"
                    onClick={() => {
                      openEditChannelEditor(contextMenu.channel);
                      setContextMenu(null);
                    }}
                    className="mt-1 flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-slate-100 transition hover:bg-white/10"
                  >
                    <span>{contextMenu.channel.type === 'CATEGORY' ? 'Edit category' : 'Edit channel'}</span>
                    <span className="text-xs text-slate-400">Edit</span>
                  </button>
                ) : null}
                {canManageChannels ? (
                  <button
                    type="button"
                    onClick={() => {
                      void deleteChannel(contextMenu.channel);
                      setContextMenu(null);
                    }}
                    className="mt-1 flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-red-200 transition hover:bg-red-500/15"
                  >
                    <span>{contextMenu.channel.type === 'CATEGORY' ? 'Delete category' : 'Delete channel'}</span>
                    <span className="text-xs text-red-300/80">Delete</span>
                  </button>
                ) : null}
                {contextMenu.channel.type === 'VOICE' ? (
                  <button
                    type="button"
                    onClick={() => {
                      openChannel(contextMenu.channel, { forceVoiceJoin: true });
                      setContextMenu(null);
                    }}
                    className="mt-1 flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-slate-100 transition hover:bg-white/10"
                  >
                    <span>Join channel</span>
                    <span className="text-xs text-slate-400">Enter</span>
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    void copyValue(contextMenu.channel.id, 'Channel ID');
                    setContextMenu(null);
                  }}
                  className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-slate-100 transition hover:bg-white/10"
                >
                  <span>Copy channel id</span>
                  <span className="text-xs text-slate-400">ID</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setChannelProperties(contextMenu.channel);
                    setContextMenu(null);
                  }}
                  className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-slate-100 transition hover:bg-white/10"
                >
                  <span>Properties</span>
                  <span className="text-xs text-slate-400">Info</span>
                </button>
                {contextMenu.channel.type === 'TEXT' ? (
                  <button
                    type="button"
                    onClick={() => {
                      markChannelAsRead(contextMenu.channel);
                      setContextMenu(null);
                    }}
                    className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-slate-100 transition hover:bg-white/10"
                  >
                    <span>Mark as read</span>
                    <span className="text-xs text-slate-400">Done</span>
                  </button>
                ) : null}
              </>
            ) : contextMenu.type === 'server' ? (
              <>
                <p className="px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-emerald-100/80">Server: {contextMenu.server.name}</p>
                <button
                  type="button"
                  onClick={() => {
                    openServerOptions(contextMenu.server);
                    setContextMenu(null);
                  }}
                  className="mt-1 flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-slate-100 transition hover:bg-white/10"
                >
                  <span>Options</span>
                  <span className="text-xs text-slate-400">Settings</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void leaveServer(contextMenu.server);
                    setContextMenu(null);
                  }}
                  className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-red-200 transition hover:bg-red-500/15"
                >
                  <span>Leave server</span>
                  <span className="text-xs text-red-300/80">Leave</span>
                </button>
              </>
            ) : (() => {
                const audio = memberAudioSettings[contextMenu.member.userId] ?? { volume: 100, muted: false };
                return (
                  <>
                    <p className="px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-emerald-100/80">{contextMenu.member.displayName}</p>
                    <button
                      type="button"
                      onClick={() => {
                        void messageMember(contextMenu.member);
                        setContextMenu(null);
                      }}
                      disabled={contextMenu.member.userId === user?.id}
                      className="mt-1 flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-slate-100 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <span>Message user</span>
                      <span className="text-xs text-slate-400">DM</span>
                    </button>
                    <div className="mt-1 rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                      <div className="mb-2 flex items-center justify-between text-[11px] text-slate-300">
                        <span>Volume slider</span>
                        <span>{audio.volume}%</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={audio.volume}
                        onChange={(event) => updateMemberVolume(contextMenu.member.userId, Number(event.target.value))}
                        className="h-1.5 w-full accent-emerald-300"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleMemberMute(contextMenu.member)}
                      className="mt-1 flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-slate-100 transition hover:bg-white/10"
                    >
                      <span>{audio.muted || audio.volume === 0 ? 'Unmute user' : 'Mute user'}</span>
                      <span className="text-xs text-slate-400">{audio.muted || audio.volume === 0 ? 'On' : 'Off'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void copyValue(contextMenu.member.userId, 'User ID');
                        setContextMenu(null);
                      }}
                      className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-slate-100 transition hover:bg-white/10"
                    >
                      <span>Copy User ID</span>
                      <span className="text-xs text-slate-400">ID</span>
                    </button>
                  </>
                );
              })()}
          </div>
        ) : null}

        {user && activeServer && channelEditor ? (
          <div className="fixed inset-0 z-[77] flex items-center justify-center p-4">
            <button
              type="button"
              className="absolute inset-0 bg-black/70 backdrop-blur-sm"
              onClick={() => setChannelEditor(null)}
              aria-label="Close channel editor"
            />
            <section className={cn(styles.surfaceStrong, 'relative z-[78] w-full max-w-lg rounded-3xl border p-5')}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-emerald-100/70">
                    {channelEditor.mode === 'create' ? 'Create' : 'Edit'} {channelEditor.type.toLowerCase()}
                  </p>
                  <h3 className="mt-2 text-xl font-semibold text-white">
                    {channelEditor.mode === 'create'
                      ? `New ${channelEditor.type === 'CATEGORY' ? 'Category' : 'Channel'}`
                      : channelEditor.name}
                  </h3>
                </div>
                <button
                  type="button"
                  className="rounded-lg border border-white/15 bg-white/5 px-2 py-1 text-xs text-slate-200 transition hover:bg-white/10"
                  onClick={() => setChannelEditor(null)}
                >
                  Close
                </button>
              </div>

              <form className="mt-4 space-y-3" onSubmit={saveChannelEditor}>
                <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <p className="text-[10px] uppercase tracking-[0.14em] text-slate-400">
                    {channelEditor.type === 'CATEGORY' ? 'Category name' : 'Channel name'}
                  </p>
                  <Input
                    className="mt-2"
                    value={channelEditor.name}
                    onChange={(event) =>
                      setChannelEditor((previous) =>
                        previous
                          ? {
                              ...previous,
                              name: event.target.value
                            }
                          : previous
                      )
                    }
                    maxLength={50}
                    required
                  />
                </div>

                {channelEditor.type !== 'CATEGORY' ? (
                  <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                    <p className="text-[10px] uppercase tracking-[0.14em] text-slate-400">Category</p>
                    <select
                      value={channelEditor.categoryId ?? ''}
                      onChange={(event) =>
                        setChannelEditor((previous) =>
                          previous
                            ? {
                                ...previous,
                                categoryId: event.target.value || null
                              }
                            : previous
                        )
                      }
                      className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-100 outline-none transition"
                    >
                      <option value="">No category</option>
                      {categoryChannels
                        .filter((entry) => (channelEditor.mode === 'edit' ? entry.id !== channelEditor.channelId : true))
                        .map((category) => (
                          <option key={category.id} value={category.id}>
                            {category.name}
                          </option>
                        ))}
                    </select>
                  </div>
                ) : null}

                {channelEditor.type === 'TEXT' ? (
                  <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                    <p className="text-[10px] uppercase tracking-[0.14em] text-slate-400">Slow mode (seconds)</p>
                    <input
                      type="number"
                      min={0}
                      max={21600}
                      value={channelEditor.slowModeSeconds}
                      onChange={(event) =>
                        setChannelEditor((previous) =>
                          previous
                            ? {
                                ...previous,
                                slowModeSeconds: Number(event.target.value)
                              }
                            : previous
                        )
                      }
                      className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-100 outline-none transition"
                    />
                  </div>
                ) : null}

                {channelEditor.type === 'VOICE' ? (
                  <div className="space-y-3 rounded-xl border border-white/10 bg-white/5 p-3">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.14em] text-slate-400">Bitrate</p>
                      <input
                        type="number"
                        min={8000}
                        max={256000}
                        step={1000}
                        value={channelEditor.bitrate}
                        onChange={(event) =>
                          setChannelEditor((previous) =>
                            previous
                              ? {
                                  ...previous,
                                  bitrate: Number(event.target.value)
                                }
                              : previous
                          )
                        }
                        className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-100 outline-none transition"
                      />
                    </div>

                    <div>
                      <p className="text-[10px] uppercase tracking-[0.14em] text-slate-400">Video quality (screenshare)</p>
                      <select
                        value={channelEditor.videoQuality}
                        onChange={(event) =>
                          setChannelEditor((previous) =>
                            previous
                              ? {
                                  ...previous,
                                  videoQuality: event.target.value as VideoQuality
                                }
                              : previous
                          )
                        }
                        className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-100 outline-none transition"
                      >
                        {VOICE_VIDEO_QUALITY_OPTIONS.map((entry) => (
                          <option key={entry.value} value={entry.value}>
                            {entry.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <p className="text-[10px] uppercase tracking-[0.14em] text-slate-400">User limit (0 = unlimited)</p>
                      <input
                        type="number"
                        min={0}
                        max={99}
                        value={channelEditor.userLimit}
                        onChange={(event) =>
                          setChannelEditor((previous) =>
                            previous
                              ? {
                                  ...previous,
                                  userLimit: Number(event.target.value)
                                }
                              : previous
                          )
                        }
                        className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-100 outline-none transition"
                      />
                    </div>
                  </div>
                ) : null}

                <div className="mt-4 flex justify-end gap-2">
                  <Button type="button" variant="soft" onClick={() => setChannelEditor(null)}>
                    Cancel
                  </Button>
                  <Button variant="soft" disabled={isSavingChannelEditor}>
                    {isSavingChannelEditor ? 'Saving...' : channelEditor.mode === 'create' ? 'Create' : 'Save'}
                  </Button>
                </div>
              </form>
            </section>
          </div>
        ) : null}

        {channelProperties ? (
          <div className="fixed inset-0 z-[77] flex items-center justify-center p-4">
            <button
              type="button"
              className="absolute inset-0 bg-black/70 backdrop-blur-sm"
              onClick={() => setChannelProperties(null)}
              aria-label="Close channel properties"
            />
            <section className={cn(styles.surfaceStrong, 'relative z-[78] w-full max-w-sm rounded-3xl border p-5')}>
              <p className="text-xs uppercase tracking-[0.2em] text-emerald-100/70">Channel Properties</p>
              <h3 className="mt-2 text-xl font-semibold text-white">#{channelProperties.name}</h3>
              <dl className="mt-4 space-y-2 text-sm text-slate-200">
                <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                  <dt className="text-[10px] uppercase tracking-[0.14em] text-slate-400">Channel ID</dt>
                  <dd className="mt-1 break-all font-mono text-xs">{channelProperties.id}</dd>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                  <dt className="text-[10px] uppercase tracking-[0.14em] text-slate-400">Type</dt>
                  <dd className="mt-1">{channelProperties.type}</dd>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                  <dt className="text-[10px] uppercase tracking-[0.14em] text-slate-400">Position</dt>
                  <dd className="mt-1">{channelProperties.position}</dd>
                </div>
              </dl>
              <div className="mt-4 flex justify-end">
                <Button variant="soft" onClick={() => setChannelProperties(null)}>
                  Close
                </Button>
              </div>
            </section>
          </div>
        ) : null}

        {user && activeServer && serverSettingsOpen ? (
          <div className="fixed inset-0 z-[74] flex items-center justify-center p-4">
            <button
              type="button"
              className="absolute inset-0 bg-black/70 backdrop-blur-sm"
              onClick={() => setServerSettingsOpen(false)}
              aria-label="Close server settings"
            />
            <section className={cn(styles.surfaceStrong, styles.fadeIn, 'relative z-[75] w-full max-w-3xl rounded-3xl border p-5')}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.22em] text-emerald-100/70">Server Settings</p>
                  <h3 className="mt-2 text-xl font-semibold text-white">{activeServer.name}</h3>
                </div>
                <button
                  type="button"
                  className="rounded-lg border border-white/15 bg-white/5 px-2 py-1 text-xs text-slate-200 transition hover:bg-white/10"
                  onClick={() => setServerSettingsOpen(false)}
                >
                  Close
                </button>
              </div>

              <div className="mt-4 flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 p-1">
                <button
                  type="button"
                  onClick={() => setServerSettingsTab('general')}
                  className={cn(
                    'flex-1 rounded-lg px-3 py-2 text-sm transition',
                    serverSettingsTab === 'general' ? 'bg-emerald-200/15 text-emerald-50' : 'text-slate-300 hover:bg-white/5'
                  )}
                >
                  General
                </button>
                <button
                  type="button"
                  onClick={() => setServerSettingsTab('permissions')}
                  className={cn(
                    'flex-1 rounded-lg px-3 py-2 text-sm transition',
                    serverSettingsTab === 'permissions' ? 'bg-emerald-200/15 text-emerald-50' : 'text-slate-300 hover:bg-white/5'
                  )}
                >
                  Permissions
                </button>
              </div>

              {serverSettingsTab === 'general' ? (
                <form className="mt-5 space-y-4" onSubmit={saveServerSettings}>
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                    <p className="text-[10px] uppercase tracking-[0.16em] text-slate-400">Server icon</p>
                    <div className="mt-3 flex items-center gap-3">
                      {resolveAssetUrl(activeServer.iconUrl ?? null) ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={resolveAssetUrl(activeServer.iconUrl ?? null) ?? ''}
                          alt={`${activeServer.name} icon`}
                          className="h-14 w-14 rounded-xl border border-white/20 object-cover"
                        />
                      ) : (
                        <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-white/15 bg-white/5 text-lg font-semibold text-slate-100">
                          {activeServer.name.trim().charAt(0).toUpperCase() || 'S'}
                        </div>
                      )}
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(event) => setServerSettingsIconFile(event.target.files?.[0] ?? null)}
                        className="block w-full text-xs text-slate-300 file:mr-3 file:rounded-lg file:border file:border-white/15 file:bg-white/10 file:px-3 file:py-2 file:text-xs file:text-slate-100 hover:file:bg-white/15"
                      />
                    </div>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                    <p className="text-[10px] uppercase tracking-[0.16em] text-slate-400">Server name</p>
                    <Input
                      value={serverSettingsName}
                      onChange={(event) => setServerSettingsName(event.target.value)}
                      maxLength={80}
                      className="mt-3"
                    />
                  </div>

                  <div className="flex items-center justify-end gap-2">
                    <Button type="button" variant="soft" onClick={() => setServerSettingsOpen(false)}>
                      Cancel
                    </Button>
                    <Button variant="soft" disabled={isSavingServerSettings}>
                      {isSavingServerSettings ? 'Saving...' : 'Save Changes'}
                    </Button>
                  </div>
                </form>
              ) : (
                <div className="mt-5 space-y-4">
                  <form className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-4" onSubmit={createRole}>
                    <p className="text-[10px] uppercase tracking-[0.16em] text-slate-400">Create custom rank</p>
                    <Input
                      value={newRoleName}
                      onChange={(event) => setNewRoleName(event.target.value)}
                      placeholder="Rank name"
                      maxLength={32}
                    />
                    <label className="inline-flex items-center gap-2 text-xs text-slate-200">
                      <input
                        type="checkbox"
                        checked={newRoleMentionable}
                        onChange={(event) => setNewRoleMentionable(event.target.checked)}
                        className="h-3.5 w-3.5 accent-emerald-300"
                      />
                      Mentionable rank (@Rank)
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {ROLE_PERMISSION_OPTIONS.map((option) => (
                        <label
                          key={`new-role-${option.key}`}
                          className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-slate-200"
                        >
                          <input
                            type="checkbox"
                            checked={newRolePermissions[option.key]}
                            onChange={(event) =>
                              setNewRolePermissions((previous) => ({
                                ...previous,
                                [option.key]: event.target.checked
                              }))
                            }
                            className="h-3.5 w-3.5 accent-emerald-300"
                          />
                          {option.label}
                        </label>
                      ))}
                    </div>
                    <div className="flex justify-end">
                      <Button variant="soft" disabled={isCreatingRole}>
                        {isCreatingRole ? 'Creating...' : 'Create Rank'}
                      </Button>
                    </div>
                  </form>

                  <div className="soft-scroll max-h-[45vh] space-y-3 overflow-y-auto pr-1">
                    {sortedServerRoles.map((role) => {
                      const draft = roleDrafts[role.id] ?? {
                        name: role.name,
                        mentionable: role.mentionable,
                        permissions: toRolePermissionDraft(role.permissions)
                      };
                      const isBusy = Boolean(roleBusyState[role.id]);
                      const isDefaultRole = role.isDefault;

                      return (
                        <article key={role.id} className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-4">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-xs font-semibold text-slate-100">{role.name}</p>
                            {isDefaultRole ? (
                              <span className="rounded-md border border-amber-200/30 bg-amber-300/15 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-amber-100">
                                Default
                              </span>
                            ) : null}
                          </div>

                          <Input
                            value={draft.name}
                            disabled={isDefaultRole || isBusy}
                            onChange={(event) =>
                              updateRoleDraft(role.id, (previous) => ({
                                ...previous,
                                name: event.target.value
                              }))
                            }
                            maxLength={32}
                          />

                          <label className="inline-flex items-center gap-2 text-xs text-slate-200">
                            <input
                              type="checkbox"
                              checked={draft.mentionable}
                              disabled={isDefaultRole || isBusy}
                              onChange={(event) =>
                                updateRoleDraft(role.id, (previous) => ({
                                  ...previous,
                                  mentionable: event.target.checked
                                }))
                              }
                              className="h-3.5 w-3.5 accent-emerald-300"
                            />
                            Mentionable rank (@Rank)
                          </label>

                          <div className="flex flex-wrap gap-2">
                            {ROLE_PERMISSION_OPTIONS.map((option) => (
                              <label
                                key={`${role.id}-${option.key}`}
                                className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-slate-200"
                              >
                                <input
                                  type="checkbox"
                                  checked={draft.permissions[option.key]}
                                  disabled={isDefaultRole || isBusy}
                                  onChange={(event) =>
                                    updateRoleDraft(role.id, (previous) => ({
                                      ...previous,
                                      permissions: {
                                        ...previous.permissions,
                                        [option.key]: event.target.checked
                                      }
                                    }))
                                  }
                                  className="h-3.5 w-3.5 accent-emerald-300"
                                />
                                {option.label}
                              </label>
                            ))}
                          </div>

                          <div className="flex items-center justify-end gap-2">
                            <Button
                              type="button"
                              variant="soft"
                              disabled={isDefaultRole || isBusy}
                              onClick={() => saveRole(role.id)}
                            >
                              {isBusy ? 'Saving...' : 'Save'}
                            </Button>
                            {!isDefaultRole ? (
                              <Button type="button" variant="danger" disabled={isBusy} onClick={() => deleteRole(role)}>
                                Delete
                              </Button>
                            ) : null}
                          </div>
                        </article>
                      );
                    })}

                    {sortedServerRoles.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-white/20 p-4 text-xs text-slate-400">
                        No roles found for this server.
                      </div>
                    ) : null}
                  </div>
                </div>
              )}
            </section>
          </div>
        ) : null}

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
