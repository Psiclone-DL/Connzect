import { z } from 'zod';

export const createMessageSchema = z.object({
  body: z.object({
    content: z.string().min(1).max(2000),
    parentMessageId: z.string().uuid().optional()
  })
});

export const updateMessageSchema = z.object({
  body: z.object({
    content: z.string().min(1).max(2000)
  })
});

export const messageHistorySchema = z.object({
  query: z.object({
    cursor: z.string().datetime().optional(),
    limit: z.coerce.number().min(1).max(100).default(50),
    parentMessageId: z.string().uuid().optional()
  })
});
