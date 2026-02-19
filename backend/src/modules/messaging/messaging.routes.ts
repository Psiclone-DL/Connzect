import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import * as controller from './messaging.controller';
import { createMessageSchema, messageHistorySchema, updateMessageSchema } from './messaging.validation';

const router = Router();

router.use(requireAuth);
router.get('/channels/:channelId/messages', validate(messageHistorySchema), controller.getMessages);
router.post('/channels/:channelId/messages', validate(createMessageSchema), controller.createMessage);
router.patch('/channels/:channelId/messages/:messageId', validate(updateMessageSchema), controller.updateMessage);
router.delete('/channels/:channelId/messages/:messageId', controller.deleteMessage);

export default router;
