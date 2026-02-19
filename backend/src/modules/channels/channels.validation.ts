import { z } from 'zod';

export const createChannelSchema = z.object({
  body: z.object({
    name: z.string().min(2).max(50),
    type: z.enum(['TEXT', 'VOICE'])
  })
});

export const updateChannelSchema = z.object({
  body: z.object({
    name: z.string().min(2).max(50)
  })
});

export const updateChannelPermissionSchema = z.object({
  body: z.object({
    allowBits: z.string().regex(/^\d+$/),
    denyBits: z.string().regex(/^\d+$/)
  })
});
