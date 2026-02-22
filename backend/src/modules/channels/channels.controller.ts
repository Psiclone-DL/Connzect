import { Request, Response } from 'express';
import { ChannelType, VideoQuality } from '@prisma/client';
import { StatusCodes } from 'http-status-codes';
import { prisma } from '../../config/prisma';
import { HttpError } from '../../utils/httpError';
import { routeParam } from '../../utils/params';
import { Permission, hasPermission } from '../../utils/permissions';
import { applyChannelOverrides, getMemberContext, requireServerPermission } from '../servers/server-access';

const DEFAULT_VOICE_BITRATE = 64000;
const DEFAULT_VOICE_VIDEO_QUALITY: VideoQuality = 'AUTO';

const resolveCategoryId = async (
  serverId: string,
  rawCategoryId: unknown,
  channelId?: string
): Promise<string | null | undefined> => {
  if (rawCategoryId === undefined) {
    return undefined;
  }

  if (rawCategoryId === null || rawCategoryId === '') {
    return null;
  }

  if (typeof rawCategoryId !== 'string') {
    throw new HttpError(400, 'categoryId must be a string');
  }

  const category = await prisma.channel.findUnique({ where: { id: rawCategoryId } });
  if (!category || category.serverId !== serverId || category.type !== ChannelType.CATEGORY) {
    throw new HttpError(400, 'Invalid categoryId');
  }

  if (channelId && category.id === channelId) {
    throw new HttpError(400, 'Channel cannot be its own category');
  }

  return category.id;
};

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

  const type = req.body.type as ChannelType;
  const name = String(req.body.name).trim();
  if (name.length < 2 || name.length > 50) {
    throw new HttpError(400, 'Channel name must be between 2 and 50 characters');
  }

  const resolvedCategoryId = type === ChannelType.CATEGORY ? null : await resolveCategoryId(serverId, req.body.categoryId);
  const slowModeSeconds = type === ChannelType.TEXT ? Number(req.body.slowModeSeconds ?? 0) : 0;
  const bitrate = type === ChannelType.VOICE ? Number(req.body.bitrate ?? DEFAULT_VOICE_BITRATE) : null;
  const videoQuality = type === ChannelType.VOICE ? (req.body.videoQuality as VideoQuality | undefined) ?? DEFAULT_VOICE_VIDEO_QUALITY : null;
  const parsedUserLimit = type === ChannelType.VOICE ? Number(req.body.userLimit ?? 0) : 0;
  const userLimit = type === ChannelType.VOICE && parsedUserLimit > 0 ? parsedUserLimit : null;

  const channel = await prisma.channel.create({
    data: {
      serverId,
      name,
      type,
      categoryId: resolvedCategoryId ?? null,
      slowModeSeconds,
      bitrate,
      videoQuality,
      userLimit,
      position: (highestPosition?.position ?? -1) + 1
    }
  });

  res.status(StatusCodes.CREATED).json(channel);
};

export const updateChannel = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) throw new HttpError(401, 'Unauthorized');

  const serverId = routeParam(req.params.serverId);
  const channelId = routeParam(req.params.channelId);
  await requireServerPermission(serverId, req.user.id, Permission.MANAGE_SERVER);

  const channel = await prisma.channel.findUnique({ where: { id: channelId } });
  if (!channel || channel.serverId !== serverId) {
    throw new HttpError(404, 'Channel not found');
  }

  const nextName = typeof req.body.name === 'string' ? req.body.name.trim() : undefined;
  if (nextName !== undefined && (nextName.length < 2 || nextName.length > 50)) {
    throw new HttpError(400, 'Channel name must be between 2 and 50 characters');
  }

  if (channel.type === ChannelType.CATEGORY && req.body.categoryId !== undefined && req.body.categoryId !== null) {
    throw new HttpError(400, 'Category channels cannot belong to another category');
  }

  const resolvedCategoryId =
    channel.type === ChannelType.CATEGORY
      ? null
      : await resolveCategoryId(serverId, req.body.categoryId, channel.id);

  const nextSlowModeSeconds =
    channel.type === ChannelType.TEXT
      ? req.body.slowModeSeconds === undefined
        ? channel.slowModeSeconds
        : Number(req.body.slowModeSeconds)
      : 0;

  const nextBitrate =
    channel.type === ChannelType.VOICE
      ? req.body.bitrate === undefined
        ? channel.bitrate ?? DEFAULT_VOICE_BITRATE
        : Number(req.body.bitrate)
      : null;

  const nextVideoQuality =
    channel.type === ChannelType.VOICE
      ? req.body.videoQuality === undefined
        ? channel.videoQuality ?? DEFAULT_VOICE_VIDEO_QUALITY
        : (req.body.videoQuality as VideoQuality)
      : null;

  const nextUserLimit =
    channel.type === ChannelType.VOICE
      ? req.body.userLimit === undefined
        ? channel.userLimit
        : Number(req.body.userLimit) > 0
          ? Number(req.body.userLimit)
          : null
      : null;

  const hasAnyUpdate =
    nextName !== undefined ||
    req.body.categoryId !== undefined ||
    req.body.slowModeSeconds !== undefined ||
    req.body.bitrate !== undefined ||
    req.body.videoQuality !== undefined ||
    req.body.userLimit !== undefined;

  if (!hasAnyUpdate) {
    throw new HttpError(400, 'No channel updates were provided');
  }

  const updated = await prisma.channel.update({
    where: { id: channelId },
    data: {
      name: nextName ?? channel.name,
      categoryId:
        channel.type === ChannelType.CATEGORY
          ? null
          : resolvedCategoryId === undefined
            ? channel.categoryId
            : resolvedCategoryId,
      slowModeSeconds: nextSlowModeSeconds,
      bitrate: nextBitrate,
      videoQuality: nextVideoQuality,
      userLimit: nextUserLimit
    }
  });

  res.status(StatusCodes.OK).json(updated);
};

export const reorderChannels = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) throw new HttpError(401, 'Unauthorized');

  const serverId = routeParam(req.params.serverId);
  await requireServerPermission(serverId, req.user.id, Permission.MOVE_CHANNELS);

  const items = req.body.items as Array<{ id: string; position: number; categoryId?: string | null }>;
  const channelIds = items.map((item) => item.id);
  const uniqueIds = new Set(channelIds);
  if (uniqueIds.size !== channelIds.length) {
    throw new HttpError(400, 'Duplicate channel ids are not allowed');
  }

  const channels = await prisma.channel.findMany({
    where: {
      serverId,
      id: { in: channelIds }
    }
  });

  if (channels.length !== channelIds.length) {
    throw new HttpError(400, 'Some channels were not found in this server');
  }

  const channelById = new Map(channels.map((channel) => [channel.id, channel]));

  const categoryIds = Array.from(
    new Set(items.map((item) => item.categoryId).filter((categoryId): categoryId is string => Boolean(categoryId)))
  );

  let validCategoryIds = new Set<string>();
  if (categoryIds.length > 0) {
    const categories = await prisma.channel.findMany({
      where: {
        serverId,
        id: { in: categoryIds },
        type: ChannelType.CATEGORY
      },
      select: { id: true }
    });
    validCategoryIds = new Set(categories.map((category) => category.id));
  }

  for (const item of items) {
    const current = channelById.get(item.id);
    if (!current) {
      throw new HttpError(400, `Channel ${item.id} does not exist`);
    }

    if (current.type === ChannelType.CATEGORY) {
      if (item.categoryId !== undefined && item.categoryId !== null) {
        throw new HttpError(400, 'Category channels cannot belong to another category');
      }
      continue;
    }

    if (item.categoryId === undefined || item.categoryId === null) {
      continue;
    }

    if (!validCategoryIds.has(item.categoryId)) {
      throw new HttpError(400, `Invalid categoryId for channel ${item.id}`);
    }
  }

  await prisma.$transaction(
    items.map((item) =>
      prisma.channel.update({
        where: { id: item.id },
        data: {
          position: item.position,
          categoryId:
            channelById.get(item.id)?.type === ChannelType.CATEGORY
              ? null
              : item.categoryId === undefined
                ? channelById.get(item.id)!.categoryId
                : item.categoryId
        }
      })
    )
  );

  const updatedChannels = await prisma.channel.findMany({
    where: { serverId },
    orderBy: { position: 'asc' }
  });

  res.status(StatusCodes.OK).json(updatedChannels);
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
