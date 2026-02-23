import crypto from 'crypto';
import { HttpError } from '../../utils/httpError';

type InviteCodeLookup = {
  invite: {
    findUnique: (args: { where: { code: string } }) => Promise<{ id: string } | null>;
  };
};

const generateInviteCode = (): string => {
  // URL-safe compact code used for public invite links.
  return crypto.randomBytes(7).toString('base64url');
};

export const pickInviteCode = async (db: InviteCodeLookup): Promise<string> => {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const code = generateInviteCode();
    const existing = await db.invite.findUnique({ where: { code } });
    if (!existing) {
      return code;
    }
  }

  throw new HttpError(500, 'Could not generate unique invite code');
};
