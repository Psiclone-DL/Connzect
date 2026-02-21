import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { upload } from '../../middleware/upload';
import { validate } from '../../middleware/validate';
import * as controller from './servers.controller';
import { addMemberSchema, createServerSchema, updateServerSchema } from './servers.validation';

const router = Router();

router.use(requireAuth);
router.get('/', controller.listMyServers);
router.post('/', upload.single('icon'), validate(createServerSchema), controller.createServer);
router.get('/:serverId', controller.getServer);
router.patch('/:serverId', upload.single('icon'), validate(updateServerSchema), controller.updateServer);
router.post('/:serverId/members', validate(addMemberSchema), controller.addMemberByEmail);

export default router;
