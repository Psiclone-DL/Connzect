import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import * as controller from './members.controller';

const router = Router();

router.use(requireAuth);
router.delete('/:serverId/members/me', controller.leaveServer);
router.post('/:serverId/members/:memberId/kick', controller.kickMember);
router.post('/:serverId/members/:memberId/ban', controller.banMember);

export default router;
