import { NextFunction, Request, Response } from 'express';
import { HttpError } from '../utils/httpError';

export const errorHandler = (
  error: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void => {
  if (error instanceof HttpError) {
    res.status(error.statusCode).json({ message: error.message });
    return;
  }

  // eslint-disable-next-line no-console
  console.error(error);
  res.status(500).json({ message: 'Internal server error' });
};
