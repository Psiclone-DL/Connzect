import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { prisma } from '../../config/prisma';
import { HttpError } from '../../utils/httpError';
import { routeParam } from '../../utils/params';
import { Permission, hasPermission } from '../../utils/permissions';
import { applyChannelOverrides, getMemberContext, requireServerPermission } from '../servers/server-access';

export const listVisibleChannels = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) throw new HttpError(401, 'Unauthorized');

  const serverId = routeParam(req.params.serverId);
  const context = await getMemberContext(serverId, req.user.id);

  const channels = await prisma.channel.findMany({
    where: { serverId },
    orderBy: { position: 'asc' }
  });

  const visibleChannels = [] as typeof channels;

  for (const channel of channels) {
    const effectivePermissions = await applyChannelOverrides(channel.id, context.roleIds, context.permissions);
    if (hasPermission(effectivePermissions, Permission.VIEW_CHANNEL)) {
      visibleChannels.push(channel);
    }
  }

  res.status(StatusCodes.OK).json(visibleChannels);
};

export const createChannel = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) throw new HttpError(401, 'Unauthorized');

  const serverId = routeParam(req.params.serverId);
  await requireServerPermission(serverId, req.user.id, Permission.CREATE_CHANNEL);

  const highestPosition = await prisma.channel.findFirst({
    where: { serverId },
    orderBy: { position: 'desc' }
  });

  const channel = await prisma.channel.create({
    data: {
      serverId,
      name: req.body.name,
      type: req.body.type,
      position: (highestPosition?.position ?? -1) + 1
    }
  });

  res.status(StatusCodes.CREATED).json(channel);
};

export const renameChannel = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) throw new HttpError(401, 'Unauthorized');

  const serverId = routeParam(req.params.serverId);
  const channelId = routeParam(req.params.channelId);
  await requireServerPermission(serverId, req.user.id, Permission.MANAGE_SERVER);

  const channel = await prisma.channel.findUnique({ where: { id: channelId } });
  if (!channel || channel.serverId !== serverId) {
    throw new HttpError(404, 'Channel not found');
  }

  const updated = await prisma.channel.update({
    where: { id: channelId },
    data: {
      name: req.body.name
    }
  });

  res.status(StatusCodes.OK).json(updated);
};

export const deleteChannel = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) throw new HttpError(401, 'Unauthorized');

  const serverId = routeParam(req.params.serverId);
  const channelId = routeParam(req.params.channelId);
  await requireServerPermission(serverId, req.user.id, Permission.DELETE_CHANNEL);

  const channel = await prisma.channel.findUnique({ where: { id: channelId } });
  if (!channel || channel.serverId !== serverId) {
    throw new HttpError(404, 'Channel not found');
  }

  await prisma.channel.delete({ where: { id: channelId } });

  res.status(StatusCodes.OK).json({ message: 'Channel deleted' });
};

export const updateRoleChannelPermissions = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) throw new HttpError(401, 'Unauthorized');

  const serverId = routeParam(req.params.serverId);
  const channelId = routeParam(req.params.channelId);
  const roleId = routeParam(req.params.roleId);
  await requireServerPermission(serverId, req.user.id, Permission.MANAGE_PERMISSIONS);

  const [channel, role] = await Promise.all([
    prisma.channel.findUnique({ where: { id: channelId } }),
    prisma.role.findUnique({ where: { id: roleId } })
  ]);

  if (!channel || channel.serverId !== serverId) {
    throw new HttpError(404, 'Channel not found');
  }

  if (!role || role.serverId !== serverId) {
    throw new HttpError(404, 'Role not found');
  }

  const override = await prisma.channelRolePermission.upsert({
    where: {
      channelId_roleId: {
        channelId,
        roleId
      }
    },
    create: {
      channelId,
      roleId,
      allowBits: BigInt(req.body.allowBits),
      denyBits: BigInt(req.body.denyBits)
    },
    update: {
      allowBits: BigInt(req.body.allowBits),
      denyBits: BigInt(req.body.denyBits)
    }
  });

  res.status(StatusCodes.OK).json({
    ...override,
    allowBits: override.allowBits.toString(),
    denyBits: override.denyBits.toString()
  });
};
