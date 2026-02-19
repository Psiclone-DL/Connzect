import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { prisma } from '../../config/prisma';
import { HttpError } from '../../utils/httpError';
import { Permission } from '../../utils/permissions';
import { requireServerPermission } from '../servers/server-access';

export const createRole = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) throw new HttpError(401, 'Unauthorized');

  const { serverId } = req.params;
  await requireServerPermission(serverId, req.user.id, Permission.CREATE_ROLE);

  const highestPosition = await prisma.role.findFirst({
    where: { serverId },
    orderBy: { position: 'desc' }
  });

  const role = await prisma.role.create({
    data: {
      serverId,
      name: req.body.name,
      color: req.body.color ?? null,
      permissions: BigInt(req.body.permissions),
      position: (highestPosition?.position ?? 0) + 1
    }
  });

  res.status(StatusCodes.CREATED).json({
    ...role,
    permissions: role.permissions.toString()
  });
};

export const updateRole = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) throw new HttpError(401, 'Unauthorized');

  const { serverId, roleId } = req.params;
  await requireServerPermission(serverId, req.user.id, Permission.MANAGE_PERMISSIONS);

  const role = await prisma.role.findUnique({ where: { id: roleId } });

  if (!role || role.serverId !== serverId) {
    throw new HttpError(404, 'Role not found');
  }

  if (role.isDefault && req.body.permissions) {
    throw new HttpError(400, 'Cannot directly change default role permissions');
  }

  const updated = await prisma.role.update({
    where: { id: roleId },
    data: {
      name: req.body.name ?? role.name,
      color: req.body.color === undefined ? role.color : req.body.color,
      permissions: req.body.permissions ? BigInt(req.body.permissions) : role.permissions
    }
  });

  res.status(StatusCodes.OK).json({
    ...updated,
    permissions: updated.permissions.toString()
  });
};

export const deleteRole = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) throw new HttpError(401, 'Unauthorized');

  const { serverId, roleId } = req.params;
  await requireServerPermission(serverId, req.user.id, Permission.DELETE_ROLE);

  const role = await prisma.role.findUnique({ where: { id: roleId } });

  if (!role || role.serverId !== serverId) {
    throw new HttpError(404, 'Role not found');
  }

  if (role.isDefault) {
    throw new HttpError(400, 'Default role cannot be deleted');
  }

  await prisma.role.delete({ where: { id: roleId } });

  res.status(StatusCodes.OK).json({ message: 'Role deleted' });
};

export const assignRole = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) throw new HttpError(401, 'Unauthorized');

  const { serverId, roleId, memberId } = req.params;
  await requireServerPermission(serverId, req.user.id, Permission.MANAGE_PERMISSIONS);

  const [role, member] = await Promise.all([
    prisma.role.findUnique({ where: { id: roleId } }),
    prisma.serverMember.findUnique({ where: { id: memberId } })
  ]);

  if (!role || role.serverId !== serverId) {
    throw new HttpError(404, 'Role not found');
  }

  if (!member || member.serverId !== serverId) {
    throw new HttpError(404, 'Member not found');
  }

  const assignment = await prisma.memberRole.upsert({
    where: {
      memberId_roleId: {
        memberId,
        roleId
      }
    },
    create: {
      memberId,
      roleId
    },
    update: {}
  });

  res.status(StatusCodes.OK).json(assignment);
};

export const removeRole = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) throw new HttpError(401, 'Unauthorized');

  const { serverId, roleId, memberId } = req.params;
  await requireServerPermission(serverId, req.user.id, Permission.MANAGE_PERMISSIONS);

  const role = await prisma.role.findUnique({ where: { id: roleId } });
  if (!role || role.serverId !== serverId) {
    throw new HttpError(404, 'Role not found');
  }

  await prisma.memberRole.deleteMany({
    where: {
      memberId,
      roleId
    }
  });

  res.status(StatusCodes.OK).json({ message: 'Role removed from member' });
};
