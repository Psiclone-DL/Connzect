import { z } from 'zod';

const passwordSchema = z
  .string()
  .min(8)
  .max(72)
  .regex(/[A-Z]/, 'Password must include an uppercase letter')
  .regex(/[a-z]/, 'Password must include a lowercase letter')
  .regex(/[0-9]/, 'Password must include a number');

export const registerSchema = z.object({
  body: z.object({
    displayName: z.string().min(2).max(32),
    email: z.string().email().max(256),
    password: passwordSchema
  })
});

export const loginSchema = z.object({
  body: z.object({
    email: z.string().email().max(256),
    password: z.string().min(8).max(72)
  })
});
