import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { prisma } from '../../config/prisma';
import { HttpError } from '../../utils/httpError';
import { routeParam } from '../../utils/params';
import { Permission } from '../../utils/permissions';
import { notifyServerMemberActivity } from '../servers/server-activity';
import { requireServerPermission } from '../servers/server-access';

const ensureNotOwner = async (serverId: string, memberId: string) => {
  const member = await prisma.serverMember.findUnique({
    where: { id: memberId },
    include: {
      user: {
        select: {
          id: true,
          displayName: true
        }
      }
    }
  });
  if (!member || member.serverId !== serverId) {
    throw new HttpError(404, 'Member not found');
  }

  const server = await prisma.server.findUnique({ where: { id: serverId } });
  if (!server) {
    throw new HttpError(404, 'Server not found');
  }

  if (server.ownerId === member.userId) {
    throw new HttpError(400, 'Cannot target server owner');
  }

  return member;
};

export const kickMember = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) throw new HttpError(401, 'Unauthorized');

  const serverId = routeParam(req.params.serverId);
  const memberId = routeParam(req.params.memberId);
  await requireServerPermission(serverId, req.user.id, Permission.KICK_MEMBER);

  const member = await ensureNotOwner(serverId, memberId);

  await prisma.serverMember.delete({ where: { id: member.id } });
  await notifyServerMemberActivity({
    serverId,
    userId: member.user.id,
    displayName: member.user.displayName,
    activity: 'leave'
  });

  res.status(StatusCodes.OK).json({ message: 'Member kicked' });
};

export const banMember = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) throw new HttpError(401, 'Unauthorized');

  const serverId = routeParam(req.params.serverId);
  const memberId = routeParam(req.params.memberId);
  await requireServerPermission(serverId, req.user.id, Permission.BAN_MEMBER);

  const member = await ensureNotOwner(serverId, memberId);

  await prisma.serverMember.update({
    where: { id: member.id },
    data: {
      isBanned: true
    }
  });

  if (!member.isBanned) {
    await notifyServerMemberActivity({
      serverId,
      userId: member.user.id,
      displayName: member.user.displayName,
      activity: 'leave'
    });
  }

  res.status(StatusCodes.OK).json({ message: 'Member banned' });
};

export const leaveServer = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) throw new HttpError(401, 'Unauthorized');

  const serverId = routeParam(req.params.serverId);
  const server = await prisma.server.findUnique({ where: { id: serverId } });
  if (!server) {
    throw new HttpError(404, 'Server not found');
  }

  const member = await prisma.serverMember.findUnique({
    where: {
      serverId_userId: {
        serverId,
        userId: req.user.id
      }
    },
    include: {
      user: {
        select: {
          id: true,
          displayName: true
        }
      }
    }
  });

  if (!member) {
    throw new HttpError(404, 'Membership not found');
  }

  if (server.ownerId === req.user.id) {
    const nextOwnerMember = await prisma.serverMember.findFirst({
      where: {
        serverId,
        isBanned: false,
        userId: {
          not: req.user.id
        }
      },
      orderBy: {
        createdAt: 'asc'
      }
    });

    await prisma.$transaction(async (tx) => {
      if (nextOwnerMember) {
        await tx.server.update({
          where: { id: serverId },
          data: { ownerId: nextOwnerMember.userId }
        });
        await tx.serverMember.delete({ where: { id: member.id } });
        return;
      }

      await tx.server.delete({ where: { id: serverId } });
    });

    if (nextOwnerMember) {
      await notifyServerMemberActivity({
        serverId,
        userId: member.user.id,
        displayName: member.user.displayName,
        activity: 'leave'
      });
    }

    res.status(StatusCodes.OK).json({
      message: nextOwnerMember
        ? 'Ownership transferred and you left the server'
        : 'Server deleted because owner left with no remaining members'
    });
    return;
  }

  await prisma.serverMember.delete({ where: { id: member.id } });
  await notifyServerMemberActivity({
    serverId,
    userId: member.user.id,
    displayName: member.user.displayName,
    activity: 'leave'
  });

  res.status(StatusCodes.OK).json({ message: 'Left server' });
};
