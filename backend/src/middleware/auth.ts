import { NextFunction, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { verifyAccessToken } from '../utils/jwt';

export const requireAuth = (req: Request, res: Response, next: NextFunction): void => {
  const authorizationHeader = req.headers.authorization;

  if (!authorizationHeader?.startsWith('Bearer ')) {
    res.status(StatusCodes.UNAUTHORIZED).json({ message: 'Missing bearer token' });
    return;
  }

  const token = authorizationHeader.split(' ')[1];

  try {
    const payload = verifyAccessToken(token);
    if (payload.type !== 'access') {
      res.status(StatusCodes.UNAUTHORIZED).json({ message: 'Invalid token type' });
      return;
    }

    req.user = {
      id: payload.sub,
      email: payload.email
    };

    next();
  } catch {
    res.status(StatusCodes.UNAUTHORIZED).json({ message: 'Invalid or expired token' });
  }
};
