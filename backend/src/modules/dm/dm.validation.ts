import { z } from 'zod';

export const createConversationSchema = z
  .object({
    body: z.object({
      targetUserId: z.string().uuid().optional(),
      email: z.string().email().optional()
    })
  })
  .refine(
    ({ body }) => Boolean(body.targetUserId || body.email),
    'Either targetUserId or email must be provided'
  );

export const createDirectMessageSchema = z.object({
  body: z.object({
    content: z.string().min(1).max(2000),
    parentMessageId: z.string().uuid().optional()
  })
});

export const directMessageHistorySchema = z.object({
  query: z.object({
    cursor: z.string().datetime().optional(),
    limit: z.coerce.number().min(1).max(100).default(50),
    parentMessageId: z.string().uuid().optional()
  })
});

export const updateDirectMessageSchema = z.object({
  body: z.object({
    content: z.string().min(1).max(2000)
  })
});
