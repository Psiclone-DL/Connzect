import { z } from 'zod';

const channelTypeEnum = z.enum(['TEXT', 'VOICE', 'CATEGORY']);
const videoQualityEnum = z.enum(['AUTO', 'HD', 'FULL_HD']);

export const createChannelSchema = z.object({
  body: z.object({
    name: z.string().min(2).max(50),
    type: channelTypeEnum,
    categoryId: z.string().uuid().nullable().optional(),
    slowModeSeconds: z.number().int().min(0).max(21600).optional(),
    bitrate: z.number().int().min(8000).max(256000).optional(),
    videoQuality: videoQualityEnum.optional(),
    userLimit: z.number().int().min(0).max(99).optional()
  })
});

export const updateChannelSchema = z.object({
  body: z.object({
    name: z.string().min(2).max(50).optional(),
    categoryId: z.string().uuid().nullable().optional(),
    slowModeSeconds: z.number().int().min(0).max(21600).optional(),
    bitrate: z.number().int().min(8000).max(256000).optional(),
    videoQuality: videoQualityEnum.optional(),
    userLimit: z.number().int().min(0).max(99).optional()
  })
});

export const updateChannelPermissionSchema = z.object({
  body: z.object({
    allowBits: z.string().regex(/^\d+$/),
    denyBits: z.string().regex(/^\d+$/)
  })
});
