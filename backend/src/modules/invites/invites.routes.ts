import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import * as controller from './invites.controller';
import { createInviteSchema, joinInviteSchema } from './invites.validation';

const router = Router();

router.use(requireAuth);
router.post('/servers/:serverId/invites', validate(createInviteSchema), controller.createInvite);
router.get('/servers/:serverId/invites', controller.listInvites);
router.delete('/servers/:serverId/invites/:inviteId', controller.revokeInvite);
router.post('/invites/:code/join', validate(joinInviteSchema), controller.joinByInvite);

export default router;
