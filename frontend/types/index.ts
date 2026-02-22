export interface User {
  id: string;
  email: string;
  displayName: string;
  avatarUrl?: string | null;
}

export interface ConnzectServer {
  id: string;
  name: string;
  iconUrl?: string | null;
  ownerId: string;
  createdAt: string;
}

export type ChannelType = 'CATEGORY' | 'TEXT' | 'VOICE';
export type VideoQuality = 'AUTO' | 'HD' | 'FULL_HD';

export interface Channel {
  id: string;
  serverId: string;
  categoryId?: string | null;
  name: string;
  type: ChannelType;
  slowModeSeconds: number;
  bitrate?: number | null;
  videoQuality?: VideoQuality | null;
  userLimit?: number | null;
  position: number;
}

export interface Role {
  id: string;
  name: string;
  color?: string | null;
  mentionable: boolean;
  permissions: string;
  isDefault: boolean;
  position: number;
}

export interface ServerMember {
  id: string;
  userId: string;
  nickname?: string | null;
  user: User;
}

export interface Message {
  id: string;
  channelId: string;
  authorId: string;
  content: string;
  parentMessageId?: string | null;
  createdAt: string;
  editedAt?: string | null;
  deletedAt?: string | null;
  author: Pick<User, 'id' | 'displayName' | 'avatarUrl'>;
}

export interface DirectMessage {
  id: string;
  conversationId: string;
  authorId: string;
  content: string;
  parentMessageId?: string | null;
  createdAt: string;
  editedAt?: string | null;
  deletedAt?: string | null;
  author: Pick<User, 'id' | 'displayName' | 'avatarUrl'>;
}

export interface DirectConversation {
  id: string;
  participants: User[];
  updatedAt: string;
  lastMessage?: DirectMessage | null;
}

export interface Invite {
  id: string;
  code: string;
  serverId: string;
  maxUses?: number | null;
  uses: number;
  expiresAt?: string | null;
  revokedAt?: string | null;
  createdAt: string;
}

export interface ServerDetails extends ConnzectServer {
  channels: Channel[];
  roles: Role[];
  members: Array<
    ServerMember & {
      memberRoles: Array<{
        roleId: string;
        role: Role;
      }>;
    }
  >;
}

export interface VoiceParticipant {
  socketId: string;
  userId: string;
  displayName: string;
  avatarUrl?: string | null;
}
