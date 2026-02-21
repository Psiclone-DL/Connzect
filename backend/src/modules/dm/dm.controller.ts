import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { prisma } from '../../config/prisma';
import { HttpError } from '../../utils/httpError';
import { routeParam } from '../../utils/params';

const includeAuthor = {
  author: {
    select: {
      id: true,
      displayName: true,
      avatarUrl: true
    }
  }
} as const;

const ensureConversationMember = async (conversationId: string, userId: string): Promise<void> => {
  const participant = await prisma.directParticipant.findUnique({
    where: {
      conversationId_userId: {
        conversationId,
        userId
      }
    }
  });

  if (!participant) {
    throw new HttpError(403, 'Not a participant in this conversation');
  }
};

const findOrCreateConversation = async (userA: string, userB: string) => {
  const existing = await prisma.directConversation.findMany({
    where: {
      participants: {
        some: { userId: userA }
      },
      AND: {
        participants: {
          some: { userId: userB }
        }
      }
    },
    include: {
      participants: true
    }
  });

  const exact = existing.find((conversation) => conversation.participants.length === 2);

  if (exact) {
    return exact;
  }

  return prisma.directConversation.create({
    data: {
      participants: {
        create: [{ userId: userA }, { userId: userB }]
      }
    },
    include: {
      participants: true
    }
  });
};

export const listConversations = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) throw new HttpError(401, 'Unauthorized');

  const memberships = await prisma.directParticipant.findMany({
    where: {
      userId: req.user.id
    },
    include: {
      conversation: {
        include: {
          participants: {
            include: {
              user: {
                select: {
                  id: true,
                  displayName: true,
                  email: true,
                  avatarUrl: true
                }
              }
            }
          },
          messages: {
            where: {
              deletedAt: null
            },
            take: 1,
            orderBy: { createdAt: 'desc' },
            include: includeAuthor
          }
        }
      }
    },
    orderBy: { joinedAt: 'desc' }
  });

  const conversations = memberships.map((membership) => {
    const participants = membership.conversation.participants.map((participant) => participant.user);

    return {
      id: membership.conversation.id,
      participants,
      lastMessage: membership.conversation.messages[0] ?? null,
      updatedAt: membership.conversation.updatedAt
    };
  });

  res.status(StatusCodes.OK).json(conversations);
};

export const createConversation = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) throw new HttpError(401, 'Unauthorized');

  let targetUserId = req.body.targetUserId as string | undefined;

  if (!targetUserId && req.body.email) {
    const targetByEmail = await prisma.user.findUnique({ where: { email: (req.body.email as string).toLowerCase() } });
    if (!targetByEmail) {
      throw new HttpError(404, 'Target user not found');
    }
    targetUserId = targetByEmail.id;
  }

  if (!targetUserId) {
    throw new HttpError(400, 'Target user is required');
  }

  if (targetUserId === req.user.id) {
    throw new HttpError(400, 'Cannot create DM with yourself');
  }

  const target = await prisma.user.findUnique({ where: { id: targetUserId } });
  if (!target) {
    throw new HttpError(404, 'Target user not found');
  }

  const conversation = await findOrCreateConversation(req.user.id, targetUserId);

  const withUsers = await prisma.directConversation.findUnique({
    where: { id: conversation.id },
    include: {
      participants: {
        include: {
          user: {
            select: {
              id: true,
              displayName: true,
              email: true,
              avatarUrl: true
            }
          }
        }
      }
    }
  });

  if (!withUsers) {
    throw new HttpError(404, 'Conversation not found');
  }

  res.status(StatusCodes.CREATED).json({
    id: withUsers.id,
    participants: withUsers.participants.map((participant) => participant.user),
    updatedAt: withUsers.updatedAt,
    lastMessage: null
  });
};

export const getMessages = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) throw new HttpError(401, 'Unauthorized');

  const conversationId = routeParam(req.params.conversationId);
  const limit = Number(req.query.limit ?? 50);
  const parentMessageId = typeof req.query.parentMessageId === 'string' ? req.query.parentMessageId : undefined;

  await ensureConversationMember(conversationId, req.user.id);

  if (parentMessageId) {
    const parentMessage = await prisma.directMessage.findFirst({
      where: {
        id: parentMessageId,
        conversationId
      }
    });

    if (!parentMessage) {
      throw new HttpError(400, 'parentMessageId does not belong to this conversation');
    }
  }

  const cursor = typeof req.query.cursor === 'string' ? new Date(req.query.cursor) : undefined;

  const messages = await prisma.directMessage.findMany({
    where: {
      conversationId,
      parentMessageId: parentMessageId ?? null,
      deletedAt: null,
      ...(cursor ? { createdAt: { lt: cursor } } : {})
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: includeAuthor
  });

  res.status(StatusCodes.OK).json(messages.reverse());
};

export const createMessage = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) throw new HttpError(401, 'Unauthorized');

  const conversationId = routeParam(req.params.conversationId);
  const parentMessageId = req.body.parentMessageId as string | undefined;

  await ensureConversationMember(conversationId, req.user.id);

  if (parentMessageId) {
    const parentMessage = await prisma.directMessage.findFirst({
      where: {
        id: parentMessageId,
        conversationId
      }
    });

    if (!parentMessage) {
      throw new HttpError(400, 'parentMessageId does not belong to this conversation');
    }
  }

  const message = await prisma.directMessage.create({
    data: {
      conversationId,
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

  const conversationId = routeParam(req.params.conversationId);
  const messageId = routeParam(req.params.messageId);
  await ensureConversationMember(conversationId, req.user.id);

  const message = await prisma.directMessage.findFirst({
    where: {
      id: messageId,
      conversationId
    }
  });

  if (!message) {
    throw new HttpError(404, 'Message not found');
  }

  if (message.authorId !== req.user.id) {
    throw new HttpError(403, 'Cannot edit another user message');
  }

  if (message.deletedAt) {
    throw new HttpError(400, 'Deleted message cannot be edited');
  }

  const updated = await prisma.directMessage.update({
    where: { id: message.id },
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

  const conversationId = routeParam(req.params.conversationId);
  const messageId = routeParam(req.params.messageId);
  await ensureConversationMember(conversationId, req.user.id);

  const message = await prisma.directMessage.findFirst({
    where: {
      id: messageId,
      conversationId
    }
  });

  if (!message) {
    throw new HttpError(404, 'Message not found');
  }

  if (message.authorId !== req.user.id) {
    throw new HttpError(403, 'Cannot delete another user message');
  }

  const deleted = await prisma.directMessage.delete({
    where: { id: message.id },
    select: {
      id: true
    }
  });

  res.status(StatusCodes.OK).json(deleted);
};
