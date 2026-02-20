import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { prisma } from '../../config/prisma';
import { HttpError } from '../../utils/httpError';
import { routeParam } from '../../utils/params';
import { Permission, hasPermission } from '../../utils/permissions';
import { applyChannelOverrides, getMemberContext } from '../servers/server-access';

const includeAuthor = {
  author: {
    select: {
      id: true,
      displayName: true,
      avatarUrl: true
    }
  }
} as const;

const ensureChannelAccess = async (channelId: string, userId: string) => {
  const channel = await prisma.channel.findUnique({ where: { id: channelId } });

  if (!channel) {
    throw new HttpError(404, 'Channel not found');
  }

  const context = await getMemberContext(channel.serverId, userId);
  const effective = await applyChannelOverrides(channelId, context.roleIds, context.permissions);

  if (!hasPermission(effective, Permission.VIEW_CHANNEL)) {
    throw new HttpError(403, 'Channel is not visible for this member');
  }

  return { channel, effective };
};

const assertParentBelongsToChannel = async (channelId: string, parentMessageId: string): Promise<void> => {
  const parentMessage = await prisma.message.findFirst({
    where: {
      id: parentMessageId,
      channelId
    }
  });

  if (!parentMessage) {
    throw new HttpError(400, 'parentMessageId does not belong to this channel');
  }
};

export const getMessages = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) throw new HttpError(401, 'Unauthorized');

  const channelId = routeParam(req.params.channelId);
  const limit = Number(req.query.limit ?? 50);
  const parentMessageId = typeof req.query.parentMessageId === 'string' ? req.query.parentMessageId : undefined;

  await ensureChannelAccess(channelId, req.user.id);

  if (parentMessageId) {
    await assertParentBelongsToChannel(channelId, parentMessageId);
  }

  const cursor = typeof req.query.cursor === 'string' ? new Date(req.query.cursor) : undefined;

  const messages = await prisma.message.findMany({
    where: {
      channelId,
      parentMessageId: parentMessageId ?? null,
      ...(cursor ? { createdAt: { lt: cursor } } : {})
    },
    take: limit,
    orderBy: { createdAt: 'desc' },
    include: includeAuthor
  });

  res.status(StatusCodes.OK).json(messages.reverse());
};

export const createMessage = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) throw new HttpError(401, 'Unauthorized');

  const channelId = routeParam(req.params.channelId);
  const parentMessageId = req.body.parentMessageId as string | undefined;
  const { effective } = await ensureChannelAccess(channelId, req.user.id);

  if (!hasPermission(effective, Permission.SEND_MESSAGE)) {
    throw new HttpError(403, 'Missing SEND_MESSAGE permission');
  }

  if (parentMessageId) {
    await assertParentBelongsToChannel(channelId, parentMessageId);
  }

  const message = await prisma.message.create({
    data: {
      channelId,
      authorId: req.user.id,
      content: req.body.content.trim(),
      parentMessageId: parentMessageId ?? null
    },
    include: includeAuthor
  });

  res.status(StatusCodes.CREATED).json(message);
};

export const updateMessage = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) throw new HttpError(401, 'Unauthorized');

  const channelId = routeParam(req.params.channelId);
  const messageId = routeParam(req.params.messageId);
  const { effective } = await ensureChannelAccess(channelId, req.user.id);

  const message = await prisma.message.findFirst({
    where: {
      id: messageId,
      channelId
    }
  });

  if (!message) {
    throw new HttpError(404, 'Message not found');
  }

  const canManage = hasPermission(effective, Permission.MANAGE_SERVER);

  if (message.authorId !== req.user.id && !canManage) {
    throw new HttpError(403, 'Cannot edit another member message');
  }

  if (message.deletedAt) {
    throw new HttpError(400, 'Deleted message cannot be edited');
  }

  const updated = await prisma.message.update({
    where: { id: messageId },
    data: {
      content: req.body.content.trim(),
      editedAt: new Date()
    },
    include: includeAuthor
  });

  res.status(StatusCodes.OK).json(updated);
};

export const deleteMessage = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) throw new HttpError(401, 'Unauthorized');

  const channelId = routeParam(req.params.channelId);
  const messageId = routeParam(req.params.messageId);
  const { effective } = await ensureChannelAccess(channelId, req.user.id);

  const message = await prisma.message.findFirst({
    where: {
      id: messageId,
      channelId
    }
  });

  if (!message) {
    throw new HttpError(404, 'Message not found');
  }

  const canManage = hasPermission(effective, Permission.MANAGE_SERVER);

  if (message.authorId !== req.user.id && !canManage) {
    throw new HttpError(403, 'Cannot delete another member message');
  }

  const deleted = await prisma.message.update({
    where: { id: messageId },
    data: {
      content: '[deleted]',
      deletedAt: new Date()
    },
    include: includeAuthor
  });

  res.status(StatusCodes.OK).json(deleted);
};
