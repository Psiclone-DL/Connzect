import { z } from 'zod';

const optionalSystemChannelSchema = z.preprocess(
  (value) => {
    if (value === '' || value === null || value === 'null') return null;
    return value;
  },
  z.string().uuid().nullable().optional()
);

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
    name: z.string().min(2).max(80).optional(),
    systemMessageChannelId: optionalSystemChannelSchema
  })
});
