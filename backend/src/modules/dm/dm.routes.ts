import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import * as controller from './dm.controller';
import {
  createConversationSchema,
  createDirectMessageSchema,
  directMessageHistorySchema,
  updateDirectMessageSchema
} from './dm.validation';

const router = Router();

router.use(requireAuth);
router.get('/dm/conversations', controller.listConversations);
router.post('/dm/conversations', validate(createConversationSchema), controller.createConversation);
router.get('/dm/conversations/:conversationId/messages', validate(directMessageHistorySchema), controller.getMessages);
router.post('/dm/conversations/:conversationId/messages', validate(createDirectMessageSchema), controller.createMessage);
router.patch(
  '/dm/conversations/:conversationId/messages/:messageId',
  validate(updateDirectMessageSchema),
  controller.updateMessage
);
router.delete('/dm/conversations/:conversationId/messages/:messageId', controller.deleteMessage);

export default router;
