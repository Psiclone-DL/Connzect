import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import * as authService from './auth.service';

const buildRefreshCookieOptions = (req: Request) => {
  const forwardedProto = req.headers['x-forwarded-proto'];
  const isSecureRequest = req.secure || forwardedProto === 'https';

  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: isSecureRequest,
    path: '/api/auth',
    maxAge: 7 * 24 * 60 * 60 * 1000
  };
};

export const register = async (req: Request, res: Response): Promise<void> => {
  const { displayName, email, password } = req.body;
  const user = await authService.register(displayName, email.toLowerCase(), password);
  res.status(StatusCodes.CREATED).json(user);
};

export const login = async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body;
  const result = await authService.login(email.toLowerCase(), password);

  res.cookie('refreshToken', result.refreshToken, buildRefreshCookieOptions(req));
  res.status(StatusCodes.OK).json({
    accessToken: result.accessToken,
    user: result.user
  });
};

export const refresh = async (req: Request, res: Response): Promise<void> => {
  const refreshToken = req.cookies.refreshToken as string | undefined;

  if (!refreshToken) {
    res.status(StatusCodes.UNAUTHORIZED).json({ message: 'No refresh token provided' });
    return;
  }

  const result = await authService.refreshSession(refreshToken);
  res.cookie('refreshToken', result.refreshToken, buildRefreshCookieOptions(req));

  res.status(StatusCodes.OK).json({
    accessToken: result.accessToken,
    user: result.user
  });
};

export const logout = async (req: Request, res: Response): Promise<void> => {
  const refreshToken = req.cookies.refreshToken as string | undefined;
  if (refreshToken) {
    await authService.logout(refreshToken);
  }

  res.clearCookie('refreshToken', {
    ...buildRefreshCookieOptions(req),
    maxAge: undefined
  });

  res.status(StatusCodes.OK).json({ message: 'Logged out' });
};

export const me = async (req: Request, res: Response): Promise<void> => {
  res.status(StatusCodes.OK).json({ user: req.user });
};
