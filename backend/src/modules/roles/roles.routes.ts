import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import * as controller from './roles.controller';
import { createRoleSchema, updateRoleSchema } from './roles.validation';

const router = Router();

router.use(requireAuth);
router.post('/:serverId/roles', validate(createRoleSchema), controller.createRole);
router.patch('/:serverId/roles/:roleId', validate(updateRoleSchema), controller.updateRole);
router.delete('/:serverId/roles/:roleId', controller.deleteRole);
router.post('/:serverId/roles/:roleId/assign/:memberId', controller.assignRole);
router.delete('/:serverId/roles/:roleId/assign/:memberId', controller.removeRole);

export default router;
