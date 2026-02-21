import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().url(),
  CLIENT_ORIGIN: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d')
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment variables', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const clientOrigins = parsed.data.CLIENT_ORIGIN.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

if (clientOrigins.length === 0) {
  // eslint-disable-next-line no-console
  console.error('Invalid CLIENT_ORIGIN: no origins provided');
  process.exit(1);
}

for (const origin of clientOrigins) {
  try {
    // Validate each configured origin URL.
    new URL(origin);
  } catch {
    // eslint-disable-next-line no-console
    console.error(`Invalid CLIENT_ORIGIN entry: ${origin}`);
    process.exit(1);
  }
}

export const env = {
  ...parsed.data,
  CLIENT_ORIGINS: clientOrigins
};
