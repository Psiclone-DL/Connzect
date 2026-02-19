import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import path from 'path';
import { env } from './config/env';
import router from './routes';
import { errorHandler } from './middleware/error-handler';

export const buildApp = () => {
  const app = express();

  app.use(
    cors({
      origin: env.CLIENT_ORIGIN,
      credentials: true
    })
  );

  app.use(
    helmet({
      crossOriginResourcePolicy: false
    })
  );

  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.use('/uploads', express.static(path.resolve(process.cwd(), 'uploads')));

  app.use('/api', router);

  app.use(errorHandler);

  return app;
};
