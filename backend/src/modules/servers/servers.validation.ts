import { z } from 'zod';

export const createServerSchema = z.object({
  body: z.object({
    name: z.string().min(2).max(80)
  })
});

export const addMemberSchema = z.object({
  body: z.object({
    email: z.string().email()
  })
});

export const updateServerSchema = z.object({
  body: z.object({
    name: z.string().min(2).max(80).optional()
  })
});
