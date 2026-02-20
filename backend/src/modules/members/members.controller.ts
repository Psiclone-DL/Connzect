import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { prisma } from '../../config/prisma';
import { HttpError } from '../../utils/httpError';
import { routeParam } from '../../utils/params';
import { Permission } from '../../utils/permissions';
import { requireServerPermission } from '../servers/server-access';

const ensureNotOwner = async (serverId: string, memberId: string) => {
  const member = await prisma.serverMember.findUnique({ where: { id: memberId } });
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

  res.status(StatusCodes.OK).json({ message: 'Member banned' });
};
