import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { prisma } from '../../config/prisma';
import { HttpError } from '../../utils/httpError';
import { routeParam } from '../../utils/params';
import { Permission } from '../../utils/permissions';
import { pickInviteCode } from './invite-code';
import { requireServerPermission } from '../servers/server-access';

export const createInvite = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) throw new HttpError(401, 'Unauthorized');

  const serverId = routeParam(req.params.serverId);
  await requireServerPermission(serverId, req.user.id, Permission.MANAGE_SERVER);

  const code = await pickInviteCode(prisma);
  const maxUses = req.body.maxUses as number | undefined;
  const expiresInHours = req.body.expiresInHours as number | undefined;

  const invite = await prisma.invite.create({
    data: {
      code,
      serverId,
      createdById: req.user.id,
      maxUses: maxUses ?? null,
      expiresAt: expiresInHours ? new Date(Date.now() + expiresInHours * 3_600_000) : null
    },
    include: {
      server: {
        select: {
          id: true,
          name: true,
          iconUrl: true
        }
      }
    }
  });

  res.status(StatusCodes.CREATED).json(invite);
};

export const listInvites = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) throw new HttpError(401, 'Unauthorized');

  const serverId = routeParam(req.params.serverId);
  await requireServerPermission(serverId, req.user.id, Permission.MANAGE_SERVER);

  const invites = await prisma.invite.findMany({
    where: { serverId },
    orderBy: { createdAt: 'desc' }
  });

  res.status(StatusCodes.OK).json(invites);
};

export const revokeInvite = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) throw new HttpError(401, 'Unauthorized');

  const serverId = routeParam(req.params.serverId);
  const inviteId = routeParam(req.params.inviteId);
  await requireServerPermission(serverId, req.user.id, Permission.MANAGE_SERVER);

  const invite = await prisma.invite.findUnique({ where: { id: inviteId } });
  if (!invite || invite.serverId !== serverId) {
    throw new HttpError(404, 'Invite not found');
  }

  await prisma.invite.update({
    where: { id: inviteId },
    data: {
      revokedAt: new Date()
    }
  });

  res.status(StatusCodes.OK).json({ message: 'Invite revoked' });
};

export const joinByInvite = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) throw new HttpError(401, 'Unauthorized');

  const code = routeParam(req.params.code);

  const joined = await prisma.$transaction(async (tx) => {
    const invite = await tx.invite.findUnique({
      where: { code },
      include: { server: true }
    });

    if (!invite) {
      throw new HttpError(404, 'Invite not found');
    }

    if (invite.revokedAt) {
      throw new HttpError(400, 'Invite is revoked');
    }

    if (invite.expiresAt && invite.expiresAt < new Date()) {
      throw new HttpError(400, 'Invite has expired');
    }

    if (invite.maxUses !== null && invite.uses >= invite.maxUses) {
      throw new HttpError(400, 'Invite usage limit reached');
    }

    const existing = await tx.serverMember.findUnique({
      where: {
        serverId_userId: {
          serverId: invite.serverId,
          userId: req.user!.id
        }
      }
    });

    if (existing && !existing.isBanned) {
      return {
        joined: false,
        server: invite.server,
        memberId: existing.id
      };
    }

    const defaultRole = await tx.role.findFirst({
      where: {
        serverId: invite.serverId,
        isDefault: true
      }
    });

    if (!defaultRole) {
      throw new HttpError(500, 'Default role missing');
    }

    const member = existing
      ? await tx.serverMember.update({
          where: { id: existing.id },
          data: { isBanned: false }
        })
      : await tx.serverMember.create({
          data: {
            serverId: invite.serverId,
            userId: req.user!.id
          }
        });

    await tx.memberRole.upsert({
      where: {
        memberId_roleId: {
          memberId: member.id,
          roleId: defaultRole.id
        }
      },
      create: {
        memberId: member.id,
        roleId: defaultRole.id
      },
      update: {}
    });

    await tx.invite.update({
      where: { id: invite.id },
      data: {
        uses: {
          increment: 1
        }
      }
    });

    return {
      joined: true,
      server: invite.server,
      memberId: member.id
    };
  });

  res.status(StatusCodes.OK).json(joined);
};
