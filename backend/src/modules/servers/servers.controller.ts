import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { prisma } from '../../config/prisma';
import { HttpError } from '../../utils/httpError';
import { routeParam } from '../../utils/params';
import { ALL_PERMISSIONS, Permission } from '../../utils/permissions';
import { pickInviteCode } from '../invites/invite-code';
import { notifyServerMemberActivity } from './server-activity';
import { requireServerPermission } from './server-access';

const EVERYONE_ROLE_NAME = '@everyone';
const SERVER_OWNER_ROLE_NAME = 'Server Owner';

const serializeRole = <T extends { permissions: bigint }>(role: T) => ({
  ...role,
  permissions: role.permissions.toString()
});

const ensureSystemRolesForServer = async (serverId: string): Promise<void> => {
  await prisma.$transaction(async (tx) => {
    const server = await tx.server.findUnique({
      where: { id: serverId },
      select: { id: true, ownerId: true }
    });
    if (!server) {
      return;
    }

    let serverOwnerRole = await tx.role.findFirst({
      where: {
        serverId,
        isDefault: true,
        name: SERVER_OWNER_ROLE_NAME
      },
      select: { id: true }
    });

    if (!serverOwnerRole) {
      const highestPosition = await tx.role.findFirst({
        where: { serverId },
        orderBy: { position: 'desc' },
        select: { position: true }
      });

      serverOwnerRole = await tx.role.create({
        data: {
          serverId,
          name: SERVER_OWNER_ROLE_NAME,
          position: (highestPosition?.position ?? 0) + 1,
          isDefault: true,
          permissions: ALL_PERMISSIONS
        },
        select: { id: true }
      });
    }

    const ownerMember = await tx.serverMember.findUnique({
      where: {
        serverId_userId: {
          serverId,
          userId: server.ownerId
        }
      },
      select: { id: true }
    });

    if (!ownerMember) {
      return;
    }

    await tx.memberRole.upsert({
      where: {
        memberId_roleId: {
          memberId: ownerMember.id,
          roleId: serverOwnerRole.id
        }
      },
      create: {
        memberId: ownerMember.id,
        roleId: serverOwnerRole.id
      },
      update: {}
    });
  });
};

export const createServer = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    throw new HttpError(401, 'Unauthorized');
  }

  const iconUrl = req.file ? `/uploads/${req.file.filename}` : null;

  const created = await prisma.$transaction(async (tx) => {
    const server = await tx.server.create({
      data: {
        name: req.body.name,
        iconUrl,
        ownerId: req.user!.id
      }
    });

    const ownerMember = await tx.serverMember.create({
      data: {
        serverId: server.id,
        userId: req.user!.id
      }
    });

    const everyoneRole = await tx.role.create({
      data: {
        serverId: server.id,
        name: EVERYONE_ROLE_NAME,
        position: 0,
        isDefault: true,
        permissions: Permission.VIEW_CHANNEL | Permission.SEND_MESSAGE | Permission.CONNECT_VOICE
      }
    });

    const serverOwnerRole = await tx.role.create({
      data: {
        serverId: server.id,
        name: SERVER_OWNER_ROLE_NAME,
        position: 1,
        isDefault: true,
        permissions: ALL_PERMISSIONS
      }
    });

    await tx.memberRole.create({
      data: {
        memberId: ownerMember.id,
        roleId: everyoneRole.id
      }
    });
    await tx.memberRole.create({
      data: {
        memberId: ownerMember.id,
        roleId: serverOwnerRole.id
      }
    });

    await tx.channel.createMany({
      data: [
        { serverId: server.id, name: 'general', type: 'TEXT', position: 0 },
        { serverId: server.id, name: 'lounge', type: 'VOICE', position: 1 }
      ]
    });

    const inviteCode = await pickInviteCode(tx);
    await tx.invite.create({
      data: {
        code: inviteCode,
        serverId: server.id,
        createdById: req.user!.id
      }
    });

    return server;
  });

  res.status(StatusCodes.CREATED).json(created);
};

export const listMyServers = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    throw new HttpError(401, 'Unauthorized');
  }

  const memberships = await prisma.serverMember.findMany({
    where: {
      userId: req.user.id,
      isBanned: false
    },
    include: {
      server: true
    }
  });

  const servers = memberships.map((entry) => entry.server);
  res.status(StatusCodes.OK).json(servers);
};

export const getServer = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    throw new HttpError(401, 'Unauthorized');
  }

  const serverId = routeParam(req.params.serverId);
  await requireServerPermission(serverId, req.user.id, Permission.VIEW_CHANNEL);
  await ensureSystemRolesForServer(serverId);

  const server = await prisma.server.findUnique({
    where: { id: serverId },
    include: {
      channels: {
        orderBy: { position: 'asc' }
      },
      roles: {
        orderBy: { position: 'desc' }
      },
      members: {
        where: { isBanned: false },
        include: {
          user: {
            select: {
              id: true,
              displayName: true,
              email: true,
              avatarUrl: true
            }
          },
          memberRoles: {
            include: {
              role: true
            }
          }
        }
      }
    }
  });

  if (!server) {
    throw new HttpError(404, 'Server not found');
  }

  res.status(StatusCodes.OK).json({
    ...server,
    roles: server.roles.map((role) => serializeRole(role)),
    members: server.members.map((member) => ({
      ...member,
      memberRoles: member.memberRoles.map((memberRole) => ({
        ...memberRole,
        role: serializeRole(memberRole.role)
      }))
    }))
  });
};

export const updateServer = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    throw new HttpError(401, 'Unauthorized');
  }

  const serverId = routeParam(req.params.serverId);
  await requireServerPermission(serverId, req.user.id, Permission.MANAGE_SERVER);

  const existing = await prisma.server.findUnique({ where: { id: serverId } });
  if (!existing) {
    throw new HttpError(404, 'Server not found');
  }

  const nextName = typeof req.body.name === 'string' ? req.body.name.trim() : undefined;
  if (nextName !== undefined && (nextName.length < 2 || nextName.length > 80)) {
    throw new HttpError(400, 'Server name must be between 2 and 80 characters');
  }

  const hasSystemMessageChannelInput = Object.prototype.hasOwnProperty.call(req.body, 'systemMessageChannelId');
  const nextSystemMessageChannelId = hasSystemMessageChannelInput
    ? typeof req.body.systemMessageChannelId === 'string'
      ? req.body.systemMessageChannelId.trim() || null
      : req.body.systemMessageChannelId === null
        ? null
        : existing.systemMessageChannelId
    : existing.systemMessageChannelId;

  if (hasSystemMessageChannelInput && nextSystemMessageChannelId) {
    const channel = await prisma.channel.findFirst({
      where: {
        id: nextSystemMessageChannelId,
        serverId,
        type: 'TEXT'
      },
      select: { id: true }
    });

    if (!channel) {
      throw new HttpError(400, 'System message channel must be a text channel in this server');
    }
  }

  const nextIconUrl = req.file ? `/uploads/${req.file.filename}` : undefined;
  const hasSystemMessageChannelChange = nextSystemMessageChannelId !== existing.systemMessageChannelId;

  if (!nextName && !nextIconUrl && !hasSystemMessageChannelChange) {
    throw new HttpError(400, 'No server settings changes were provided');
  }

  const updated = await prisma.server.update({
    where: { id: serverId },
    data: {
      name: nextName ?? existing.name,
      iconUrl: nextIconUrl ?? existing.iconUrl,
      systemMessageChannelId: nextSystemMessageChannelId
    }
  });

  res.status(StatusCodes.OK).json(updated);
};

export const addMemberByEmail = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    throw new HttpError(401, 'Unauthorized');
  }

  const serverId = routeParam(req.params.serverId);
  await requireServerPermission(serverId, req.user.id, Permission.MANAGE_SERVER);

  const user = await prisma.user.findUnique({ where: { email: req.body.email.toLowerCase() } });
  if (!user) {
    throw new HttpError(404, 'User not found');
  }

  const existingMembership = await prisma.serverMember.findUnique({
    where: {
      serverId_userId: {
        serverId,
        userId: user.id
      }
    },
    select: {
      id: true,
      isBanned: true
    }
  });

  const defaultRole = await prisma.role.findFirst({
    where: {
      serverId,
      isDefault: true,
      name: EVERYONE_ROLE_NAME
    }
  });

  if (!defaultRole) {
    throw new HttpError(500, 'Default role missing');
  }

  const member = await prisma.serverMember.upsert({
    where: {
      serverId_userId: {
        serverId,
        userId: user.id
      }
    },
    create: {
      serverId,
      userId: user.id,
      isBanned: false,
      memberRoles: {
        create: {
          roleId: defaultRole.id
        }
      }
    },
    update: {
      isBanned: false
    },
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
  });

  const joinedNow = !existingMembership || existingMembership.isBanned;
  if (joinedNow) {
    await notifyServerMemberActivity({
      serverId,
      userId: user.id,
      displayName: user.displayName,
      activity: 'join'
    });
  }

  res.status(StatusCodes.CREATED).json(member);
};
