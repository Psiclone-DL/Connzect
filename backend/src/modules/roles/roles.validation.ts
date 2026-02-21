import { z } from 'zod';

export const createRoleSchema = z.object({
  body: z.object({
    name: z.string().min(2).max(32),
    color: z.string().regex(/^#([A-Fa-f0-9]{6})$/).optional(),
    permissions: z.string().regex(/^\d+$/),
    mentionable: z.boolean().optional()
  })
});

export const updateRoleSchema = z.object({
  body: z.object({
    name: z.string().min(2).max(32).optional(),
    color: z.string().regex(/^#([A-Fa-f0-9]{6})$/).optional().nullable(),
    permissions: z.string().regex(/^\d+$/).optional(),
    mentionable: z.boolean().optional()
  })
});
