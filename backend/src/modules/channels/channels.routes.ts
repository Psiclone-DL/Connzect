import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import * as controller from './channels.controller';
import {
  createChannelSchema,
  updateChannelPermissionSchema,
  updateChannelSchema
} from './channels.validation';

const router = Router();

router.use(requireAuth);
router.get('/:serverId/channels', controller.listVisibleChannels);
router.post('/:serverId/channels', validate(createChannelSchema), controller.createChannel);
router.patch('/:serverId/channels/:channelId', validate(updateChannelSchema), controller.renameChannel);
router.delete('/:serverId/channels/:channelId', controller.deleteChannel);
router.patch(
  '/:serverId/channels/:channelId/permissions/:roleId',
  validate(updateChannelPermissionSchema),
  controller.updateRoleChannelPermissions
);

export default router;
