import { z } from 'zod';

export const createInviteSchema = z.object({
  body: z.object({
    maxUses: z.number().int().positive().max(100_000).optional(),
    expiresInHours: z.number().int().positive().max(24 * 365).optional()
  })
});

export const joinInviteSchema = z.object({
  params: z.object({
    code: z.string().min(6).max(64)
  })
});
