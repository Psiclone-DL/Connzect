import http from 'http';
import { Server } from 'socket.io';
import { buildApp } from './app';
import { env } from './config/env';
import { prisma } from './config/prisma';
import { setupSocket } from './config/socket';

const app = buildApp();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: env.CLIENT_ORIGINS,
    credentials: true
  }
});

setupSocket(io);

server.listen(env.PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Connzect API listening on port ${env.PORT}`);
});

const gracefulShutdown = async () => {
  await prisma.$disconnect();
  server.close(() => process.exit(0));
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
