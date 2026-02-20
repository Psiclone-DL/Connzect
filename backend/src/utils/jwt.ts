import { randomUUID } from 'crypto';
import jwt, { SignOptions } from 'jsonwebtoken';
import { env } from '../config/env';

export interface AuthTokenPayload {
  sub: string;
  email: string;
  type: 'access' | 'refresh';
}

const signToken = (
  payload: AuthTokenPayload,
  secret: string,
  expiresIn: string,
  withJti = false
): string => {
  const options: SignOptions = {
    expiresIn: expiresIn as SignOptions['expiresIn']
  };

  if (withJti) {
    options.jwtid = randomUUID();
  }

  return jwt.sign(payload, secret, options);
};

export const signAccessToken = (sub: string, email: string): string =>
  signToken({ sub, email, type: 'access' }, env.JWT_ACCESS_SECRET, env.JWT_ACCESS_EXPIRES_IN);

export const signRefreshToken = (sub: string, email: string): string =>
  signToken({ sub, email, type: 'refresh' }, env.JWT_REFRESH_SECRET, env.JWT_REFRESH_EXPIRES_IN, true);

export const verifyAccessToken = (token: string): AuthTokenPayload =>
  jwt.verify(token, env.JWT_ACCESS_SECRET) as AuthTokenPayload;

export const verifyRefreshToken = (token: string): AuthTokenPayload =>
  jwt.verify(token, env.JWT_REFRESH_SECRET) as AuthTokenPayload;
