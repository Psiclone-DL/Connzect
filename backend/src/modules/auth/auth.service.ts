import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { StatusCodes } from 'http-status-codes';
import { prisma } from '../../config/prisma';
import { HttpError } from '../../utils/httpError';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../../utils/jwt';

const publicUserSelect = {
  id: true,
  displayName: true,
  email: true,
  avatarUrl: true
} as const;

const hashRefreshToken = (token: string): string =>
  crypto.createHash('sha256').update(token).digest('hex');

const parseRefreshExpiry = (): Date => {
  const now = Date.now();
  const value = process.env.JWT_REFRESH_EXPIRES_IN ?? '7d';

  const match = /^(\d+)([smhd])$/.exec(value);
  if (!match) {
    return new Date(now + 7 * 24 * 60 * 60 * 1000);
  }

  const amount = Number(match[1]);
  const unit = match[2];
  const multiplier = unit === 's' ? 1000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;

  return new Date(now + amount * multiplier);
};

export const register = async (displayName: string, email: string, password: string) => {
  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    throw new HttpError(StatusCodes.CONFLICT, 'Email is already registered');
  }

  const passwordHash = await bcrypt.hash(password, 12);

  return prisma.user.create({
    data: {
      displayName,
      email,
      passwordHash
    },
    select: {
      id: true,
      displayName: true,
      email: true,
      createdAt: true
    }
  });
};

export const login = async (email: string, password: string) => {
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    throw new HttpError(StatusCodes.UNAUTHORIZED, 'Invalid credentials');
  }

  const passwordMatches = await bcrypt.compare(password, user.passwordHash);

  if (!passwordMatches) {
    throw new HttpError(StatusCodes.UNAUTHORIZED, 'Invalid credentials');
  }

  const accessToken = signAccessToken(user.id, user.email);
  const refreshToken = signRefreshToken(user.id, user.email);

  await prisma.refreshToken.create({
    data: {
      tokenHash: hashRefreshToken(refreshToken),
      userId: user.id,
      expiresAt: parseRefreshExpiry()
    }
  });

  return {
    accessToken,
    refreshToken,
    user: await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: publicUserSelect
    })
  };
};

export const refreshSession = async (refreshToken: string) => {
  const payload = verifyRefreshToken(refreshToken);

  if (payload.type !== 'refresh') {
    throw new HttpError(StatusCodes.UNAUTHORIZED, 'Invalid token type');
  }

  const tokenHash = hashRefreshToken(refreshToken);

  const storedToken = await prisma.refreshToken.findUnique({ where: { tokenHash } });

  if (!storedToken || storedToken.revokedAt || storedToken.expiresAt < new Date()) {
    throw new HttpError(StatusCodes.UNAUTHORIZED, 'Refresh token invalid');
  }

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });

  if (!user) {
    throw new HttpError(StatusCodes.UNAUTHORIZED, 'User no longer exists');
  }

  const newAccessToken = signAccessToken(user.id, user.email);
  const newRefreshToken = signRefreshToken(user.id, user.email);

  await prisma.$transaction([
    prisma.refreshToken.update({
      where: { tokenHash },
      data: { revokedAt: new Date() }
    }),
    prisma.refreshToken.create({
      data: {
        tokenHash: hashRefreshToken(newRefreshToken),
        userId: user.id,
        expiresAt: parseRefreshExpiry()
      }
    })
  ]);

  return {
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
    user: await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: publicUserSelect
    })
  };
};

export const logout = async (refreshToken: string): Promise<void> => {
  const tokenHash = hashRefreshToken(refreshToken);

  await prisma.refreshToken.updateMany({
    where: {
      tokenHash,
      revokedAt: null
    },
    data: {
      revokedAt: new Date()
    }
  });
};

export const getMe = async (userId: string) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: publicUserSelect
  });

  if (!user) {
    throw new HttpError(StatusCodes.UNAUTHORIZED, 'User no longer exists');
  }

  return user;
};

export const updateMe = async (
  userId: string,
  updates: {
    displayName?: string;
    avatarUrl?: string;
  }
) => {
  const displayName = typeof updates.displayName === 'string' ? updates.displayName.trim() : undefined;
  if (displayName !== undefined && (displayName.length < 2 || displayName.length > 32)) {
    throw new HttpError(StatusCodes.BAD_REQUEST, 'Display name must be between 2 and 32 characters');
  }

  const existing = await prisma.user.findUnique({
    where: { id: userId },
    select: publicUserSelect
  });

  if (!existing) {
    throw new HttpError(StatusCodes.UNAUTHORIZED, 'User no longer exists');
  }

  const hasDisplayNameChange = displayName !== undefined && displayName !== existing.displayName;
  const hasAvatarChange = updates.avatarUrl !== undefined && updates.avatarUrl !== existing.avatarUrl;

  if (!hasDisplayNameChange && !hasAvatarChange) {
    throw new HttpError(StatusCodes.BAD_REQUEST, 'No profile changes were provided');
  }

  return prisma.user.update({
    where: { id: userId },
    data: {
      displayName: hasDisplayNameChange ? displayName : existing.displayName,
      avatarUrl: hasAvatarChange ? updates.avatarUrl : existing.avatarUrl
    },
    select: publicUserSelect
  });
};
