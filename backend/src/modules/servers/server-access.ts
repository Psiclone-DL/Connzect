import { prisma } from '../../config/prisma';
import { HttpError } from '../../utils/httpError';
import { ALL_PERMISSIONS, PermissionValue, combinePermissions, hasPermission } from '../../utils/permissions';

export interface MemberContext {
  serverId: string;
  memberId: string;
  roleIds: string[];
  permissions: bigint;
  isOwner: boolean;
}

export const getMemberContext = async (serverId: string, userId: string): Promise<MemberContext> => {
  const server = await prisma.server.findUnique({ where: { id: serverId } });

  if (!server) {
    throw new HttpError(404, 'Server not found');
  }

  const member = await prisma.serverMember.findUnique({
    where: {
      serverId_userId: {
        serverId,
        userId
      }
    },
    include: {
      memberRoles: {
        include: {
          role: true
        }
      }
    }
  });

  if (!member || member.isBanned) {
    throw new HttpError(403, 'You are not an active member of this server');
  }

  const isOwner = server.ownerId === userId;

  if (isOwner) {
    return {
      serverId,
      memberId: member.id,
      roleIds: member.memberRoles.map((entry) => entry.roleId),
      permissions: ALL_PERMISSIONS,
      isOwner: true
    };
  }

  const permissionPool = member.memberRoles.map((entry) => entry.role.permissions);
  const permissions = combinePermissions(permissionPool);

  return {
    serverId,
    memberId: member.id,
    roleIds: member.memberRoles.map((entry) => entry.roleId),
    permissions,
    isOwner: false
  };
};

export const requireServerPermission = async (
  serverId: string,
  userId: string,
  permission: PermissionValue
): Promise<MemberContext> => {
  const context = await getMemberContext(serverId, userId);
  if (!hasPermission(context.permissions, permission)) {
    throw new HttpError(403, 'Missing required permission');
  }

  return context;
};

export const applyChannelOverrides = async (
  channelId: string,
  roleIds: string[],
  basePermissions: bigint
): Promise<bigint> => {
  const overrides = await prisma.channelRolePermission.findMany({
    where: {
      channelId,
      roleId: {
        in: roleIds
      }
    }
  });

  let allowBits = 0n;
  let denyBits = 0n;

  for (const override of overrides) {
    allowBits |= override.allowBits;
    denyBits |= override.denyBits;
  }

  return (basePermissions & ~denyBits) | allowBits;
};
