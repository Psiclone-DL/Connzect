import { Router } from 'express';
import authRoutes from '../modules/auth/auth.routes';
import serversRoutes from '../modules/servers/servers.routes';
import rolesRoutes from '../modules/roles/roles.routes';
import channelsRoutes from '../modules/channels/channels.routes';
import membersRoutes from '../modules/members/members.routes';
import messagingRoutes from '../modules/messaging/messaging.routes';
import invitesRoutes from '../modules/invites/invites.routes';
import dmRoutes from '../modules/dm/dm.routes';

const router = Router();

router.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

router.use('/auth', authRoutes);
router.use('/servers', serversRoutes);
router.use('/servers', rolesRoutes);
router.use('/servers', channelsRoutes);
router.use('/servers', membersRoutes);
router.use('/', messagingRoutes);
router.use('/', invitesRoutes);
router.use('/', dmRoutes);

export default router;
