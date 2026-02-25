import { prisma } from '../../config/prisma';
import { getSocketServer } from '../../config/socket-server';

type MemberActivity = 'join' | 'leave';

const includeAuthor = {
  author: {
    select: {
      id: true,
      displayName: true,
      avatarUrl: true
    }
  }
} as const;

const systemJoinMessages = [
  '$user just enteret the chat.',
  '$user slid into this room ready to chat.',
  '$user popped by to say hello.',
  '$user has scored a spot in the conversation.',
  '$user is here to make the server pop.'
] as const;

const getRandomJoinMessage = (displayName: string): string => {
  const template = systemJoinMessages[Math.floor(Math.random() * systemJoinMessages.length)];
  return template.replace('$user', displayName);
};

const formatActivityMessage = (displayName: string, activity: MemberActivity): string =>
  activity === 'join'
    ? `System: ${getRandomJoinMessage(displayName)}`
    : `System: ${displayName} left the server.`;

export const emitServerMembersChanged = (serverId: string): void => {
  const io = getSocketServer();
  if (!io) return;

  io.to(`server:${serverId}`).emit('server:members:changed', { serverId });
};

const postMembershipSystemMessage = async (params: {
  serverId: string;
  userId: string;
  displayName: string;
  activity: MemberActivity;
}): Promise<void> => {
  const server = await prisma.server.findUnique({
    where: { id: params.serverId },
    select: { systemMessageChannelId: true }
  });

  const channelId = server?.systemMessageChannelId ?? null;
  if (!channelId) return;

  const channel = await prisma.channel.findFirst({
    where: {
      id: channelId,
      serverId: params.serverId,
      type: 'TEXT'
    },
    select: { id: true }
  });

  if (!channel) return;

  const message = await prisma.message.create({
    data: {
      channelId: channel.id,
      authorId: params.userId,
      content: formatActivityMessage(params.displayName, params.activity)
    },
    include: includeAuthor
  });

  const io = getSocketServer();
  if (!io) return;
  io.to(`channel:${channel.id}`).emit('message:new', message);
};

export const notifyServerMemberActivity = async (params: {
  serverId: string;
  userId: string;
  displayName: string;
  activity: MemberActivity;
}): Promise<void> => {
  emitServerMembersChanged(params.serverId);

  try {
    await postMembershipSystemMessage(params);
  } catch {
    // Membership operation should not fail if system channel notification fails.
  }
};
