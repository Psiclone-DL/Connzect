import { Server, Socket } from 'socket.io';
import { prisma } from './prisma';
import { verifyAccessToken } from '../utils/jwt';
import { Permission, hasPermission } from '../utils/permissions';
import { applyChannelOverrides, getMemberContext } from '../modules/servers/server-access';

type AuthenticatedSocket = Socket & {
  data: {
    userId: string;
    email: string;
    displayName: string;
    voiceChannelId?: string;
  };
};

type VoiceParticipant = {
  socketId: string;
  userId: string;
  displayName: string;
};

const includeAuthor = {
  author: {
    select: {
      id: true,
      displayName: true,
      avatarUrl: true
    }
  }
} as const;

const voiceParticipants = new Map<string, Map<string, VoiceParticipant>>();

const broadcastVoiceParticipants = (io: Server, channelId: string): void => {
  const participants = Array.from(voiceParticipants.get(channelId)?.values() ?? []);
  io.to(`voice:${channelId}`).emit('voice:participants', participants);
};

const ensureChannelMessagingAccess = async (channelId: string, userId: string) => {
  const channel = await prisma.channel.findUnique({ where: { id: channelId } });
  if (!channel) {
    throw new Error('Channel not found');
  }

  const context = await getMemberContext(channel.serverId, userId);
  const effective = await applyChannelOverrides(channelId, context.roleIds, context.permissions);

  if (!hasPermission(effective, Permission.VIEW_CHANNEL)) {
    throw new Error('Missing VIEW_CHANNEL permission');
  }

  return { channel, effective };
};

const ensureConversationAccess = async (conversationId: string, userId: string): Promise<void> => {
  const membership = await prisma.directParticipant.findUnique({
    where: {
      conversationId_userId: {
        conversationId,
        userId
      }
    }
  });

  if (!membership) {
    throw new Error('Not a participant in this conversation');
  }
};

export const setupSocket = (io: Server): void => {
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token as string | undefined;
      if (!token) {
        next(new Error('Authentication required'));
        return;
      }

      const payload = verifyAccessToken(token);
      if (payload.type !== 'access') {
        next(new Error('Invalid token type'));
        return;
      }

      const user = await prisma.user.findUnique({ where: { id: payload.sub } });
      if (!user) {
        next(new Error('User not found'));
        return;
      }

      (socket as AuthenticatedSocket).data.userId = user.id;
      (socket as AuthenticatedSocket).data.email = user.email;
      (socket as AuthenticatedSocket).data.displayName = user.displayName;
      next();
    } catch {
      next(new Error('Unauthorized socket'));
    }
  });

  io.on('connection', (socket) => {
    const authedSocket = socket as AuthenticatedSocket;

    authedSocket.on('channel:join', async ({ channelId }: { channelId: string }) => {
      try {
        await ensureChannelMessagingAccess(channelId, authedSocket.data.userId);
        authedSocket.join(`channel:${channelId}`);
      } catch (error) {
        authedSocket.emit('error:event', {
          scope: 'channel:join',
          message: error instanceof Error ? error.message : 'Failed to join channel'
        });
      }
    });

    authedSocket.on('channel:leave', ({ channelId }: { channelId: string }) => {
      authedSocket.leave(`channel:${channelId}`);
    });

    authedSocket.on(
      'message:send',
      async (payload: { channelId: string; content: string; parentMessageId?: string }) => {
        try {
          const trimmedContent = payload.content.trim();
          if (!trimmedContent || trimmedContent.length > 2000) {
            throw new Error('Message must be between 1 and 2000 characters');
          }

          const { effective } = await ensureChannelMessagingAccess(payload.channelId, authedSocket.data.userId);
          if (!hasPermission(effective, Permission.SEND_MESSAGE)) {
            throw new Error('Missing SEND_MESSAGE permission');
          }

          if (payload.parentMessageId) {
            const parentMessage = await prisma.message.findFirst({
              where: {
                id: payload.parentMessageId,
                channelId: payload.channelId
              }
            });

            if (!parentMessage) {
              throw new Error('parentMessageId does not belong to this channel');
            }
          }

          const message = await prisma.message.create({
            data: {
              channelId: payload.channelId,
              authorId: authedSocket.data.userId,
              content: trimmedContent,
              parentMessageId: payload.parentMessageId ?? null
            },
            include: includeAuthor
          });

          io.to(`channel:${payload.channelId}`).emit('message:new', message);
        } catch (error) {
          authedSocket.emit('error:event', {
            scope: 'message:send',
            message: error instanceof Error ? error.message : 'Failed to send message'
          });
        }
      }
    );

    authedSocket.on(
      'message:edit',
      async (payload: { channelId: string; messageId: string; content: string }) => {
        try {
          const trimmedContent = payload.content.trim();
          if (!trimmedContent || trimmedContent.length > 2000) {
            throw new Error('Message must be between 1 and 2000 characters');
          }

          const { effective } = await ensureChannelMessagingAccess(payload.channelId, authedSocket.data.userId);

          const message = await prisma.message.findFirst({
            where: {
              id: payload.messageId,
              channelId: payload.channelId
            }
          });

          if (!message) {
            throw new Error('Message not found');
          }

          const canManage = hasPermission(effective, Permission.MANAGE_SERVER);
          if (message.authorId !== authedSocket.data.userId && !canManage) {
            throw new Error('Cannot edit this message');
          }

          if (message.deletedAt) {
            throw new Error('Deleted message cannot be edited');
          }

          const updated = await prisma.message.update({
            where: { id: message.id },
            data: {
              content: trimmedContent,
              editedAt: new Date()
            },
            include: includeAuthor
          });

          io.to(`channel:${payload.channelId}`).emit('message:updated', updated);
        } catch (error) {
          authedSocket.emit('error:event', {
            scope: 'message:edit',
            message: error instanceof Error ? error.message : 'Failed to edit message'
          });
        }
      }
    );

    authedSocket.on('message:delete', async (payload: { channelId: string; messageId: string }) => {
      try {
        const { effective } = await ensureChannelMessagingAccess(payload.channelId, authedSocket.data.userId);

        const message = await prisma.message.findFirst({
          where: {
            id: payload.messageId,
            channelId: payload.channelId
          }
        });

        if (!message) {
          throw new Error('Message not found');
        }

        const canManage = hasPermission(effective, Permission.MANAGE_SERVER);
        if (message.authorId !== authedSocket.data.userId && !canManage) {
          throw new Error('Cannot delete this message');
        }

        const deleted = await prisma.message.update({
          where: { id: message.id },
          data: {
            content: '[deleted]',
            deletedAt: new Date()
          },
          include: includeAuthor
        });

        io.to(`channel:${payload.channelId}`).emit('message:updated', deleted);
      } catch (error) {
        authedSocket.emit('error:event', {
          scope: 'message:delete',
          message: error instanceof Error ? error.message : 'Failed to delete message'
        });
      }
    });

    authedSocket.on('dm:join', async ({ conversationId }: { conversationId: string }) => {
      try {
        await ensureConversationAccess(conversationId, authedSocket.data.userId);
        authedSocket.join(`dm:${conversationId}`);
      } catch (error) {
        authedSocket.emit('error:event', {
          scope: 'dm:join',
          message: error instanceof Error ? error.message : 'Failed to join DM'
        });
      }
    });

    authedSocket.on('dm:leave', ({ conversationId }: { conversationId: string }) => {
      authedSocket.leave(`dm:${conversationId}`);
    });

    authedSocket.on(
      'dm:message:send',
      async (payload: { conversationId: string; content: string; parentMessageId?: string }) => {
        try {
          const trimmedContent = payload.content.trim();
          if (!trimmedContent || trimmedContent.length > 2000) {
            throw new Error('Message must be between 1 and 2000 characters');
          }

          await ensureConversationAccess(payload.conversationId, authedSocket.data.userId);

          if (payload.parentMessageId) {
            const parentMessage = await prisma.directMessage.findFirst({
              where: {
                id: payload.parentMessageId,
                conversationId: payload.conversationId
              }
            });

            if (!parentMessage) {
              throw new Error('parentMessageId does not belong to this conversation');
            }
          }

          const message = await prisma.directMessage.create({
            data: {
              conversationId: payload.conversationId,
              authorId: authedSocket.data.userId,
              content: trimmedContent,
              parentMessageId: payload.parentMessageId ?? null
            },
            include: includeAuthor
          });

          io.to(`dm:${payload.conversationId}`).emit('dm:message:new', message);
        } catch (error) {
          authedSocket.emit('error:event', {
            scope: 'dm:message:send',
            message: error instanceof Error ? error.message : 'Failed to send DM message'
          });
        }
      }
    );

    authedSocket.on(
      'dm:message:edit',
      async (payload: { conversationId: string; messageId: string; content: string }) => {
        try {
          const trimmedContent = payload.content.trim();
          if (!trimmedContent || trimmedContent.length > 2000) {
            throw new Error('Message must be between 1 and 2000 characters');
          }

          await ensureConversationAccess(payload.conversationId, authedSocket.data.userId);

          const message = await prisma.directMessage.findFirst({
            where: {
              id: payload.messageId,
              conversationId: payload.conversationId
            }
          });

          if (!message) {
            throw new Error('Message not found');
          }

          if (message.authorId !== authedSocket.data.userId) {
            throw new Error('Cannot edit this message');
          }

          if (message.deletedAt) {
            throw new Error('Deleted message cannot be edited');
          }

          const updated = await prisma.directMessage.update({
            where: { id: message.id },
            data: {
              content: trimmedContent,
              editedAt: new Date()
            },
            include: includeAuthor
          });

          io.to(`dm:${payload.conversationId}`).emit('dm:message:updated', updated);
        } catch (error) {
          authedSocket.emit('error:event', {
            scope: 'dm:message:edit',
            message: error instanceof Error ? error.message : 'Failed to edit DM message'
          });
        }
      }
    );

    authedSocket.on('dm:message:delete', async (payload: { conversationId: string; messageId: string }) => {
      try {
        await ensureConversationAccess(payload.conversationId, authedSocket.data.userId);

        const message = await prisma.directMessage.findFirst({
          where: {
            id: payload.messageId,
            conversationId: payload.conversationId
          }
        });

        if (!message) {
          throw new Error('Message not found');
        }

        if (message.authorId !== authedSocket.data.userId) {
          throw new Error('Cannot delete this message');
        }

        const deleted = await prisma.directMessage.update({
          where: { id: message.id },
          data: {
            content: '[deleted]',
            deletedAt: new Date()
          },
          include: includeAuthor
        });

        io.to(`dm:${payload.conversationId}`).emit('dm:message:updated', deleted);
      } catch (error) {
        authedSocket.emit('error:event', {
          scope: 'dm:message:delete',
          message: error instanceof Error ? error.message : 'Failed to delete DM message'
        });
      }
    });

    authedSocket.on('voice:join', async ({ channelId }: { channelId: string }) => {
      try {
        const { channel, effective } = await ensureChannelMessagingAccess(channelId, authedSocket.data.userId);

        if (channel.type !== 'VOICE') {
          throw new Error('Channel is not a voice channel');
        }

        if (!hasPermission(effective, Permission.CONNECT_VOICE)) {
          throw new Error('Missing CONNECT_VOICE permission');
        }

        if (authedSocket.data.voiceChannelId && authedSocket.data.voiceChannelId !== channelId) {
          const previousChannel = authedSocket.data.voiceChannelId;
          authedSocket.leave(`voice:${previousChannel}`);
          const previousBucket = voiceParticipants.get(previousChannel);
          previousBucket?.delete(authedSocket.id);
          if (previousBucket && previousBucket.size === 0) {
            voiceParticipants.delete(previousChannel);
          }
          broadcastVoiceParticipants(io, previousChannel);
        }

        authedSocket.data.voiceChannelId = channelId;
        authedSocket.join(`voice:${channelId}`);

        const channelParticipants = voiceParticipants.get(channelId) ?? new Map<string, VoiceParticipant>();
        channelParticipants.set(authedSocket.id, {
          socketId: authedSocket.id,
          userId: authedSocket.data.userId,
          displayName: authedSocket.data.displayName
        });
        voiceParticipants.set(channelId, channelParticipants);

        broadcastVoiceParticipants(io, channelId);
      } catch (error) {
        authedSocket.emit('error:event', {
          scope: 'voice:join',
          message: error instanceof Error ? error.message : 'Failed to join voice channel'
        });
      }
    });

    authedSocket.on('voice:leave', () => {
      const voiceChannelId = authedSocket.data.voiceChannelId;
      if (!voiceChannelId) return;

      authedSocket.leave(`voice:${voiceChannelId}`);
      const channelParticipants = voiceParticipants.get(voiceChannelId);
      channelParticipants?.delete(authedSocket.id);

      if (channelParticipants && channelParticipants.size === 0) {
        voiceParticipants.delete(voiceChannelId);
      }

      authedSocket.data.voiceChannelId = undefined;
      broadcastVoiceParticipants(io, voiceChannelId);
    });

    authedSocket.on(
      'webrtc:signal',
      (payload: { toSocketId: string; type: 'offer' | 'answer' | 'ice-candidate'; data: unknown }) => {
        io.to(payload.toSocketId).emit('webrtc:signal', {
          fromSocketId: authedSocket.id,
          type: payload.type,
          data: payload.data
        });
      }
    );

    authedSocket.on('disconnect', () => {
      const voiceChannelId = authedSocket.data.voiceChannelId;
      if (!voiceChannelId) return;

      const channelParticipants = voiceParticipants.get(voiceChannelId);
      channelParticipants?.delete(authedSocket.id);
      if (channelParticipants && channelParticipants.size === 0) {
        voiceParticipants.delete(voiceChannelId);
      }
      broadcastVoiceParticipants(io, voiceChannelId);
    });
  });
};
