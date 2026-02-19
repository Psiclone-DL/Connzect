export const Permission = {
  VIEW_CHANNEL: 1n << 0n,
  SEND_MESSAGE: 1n << 1n,
  CONNECT_VOICE: 1n << 2n,
  CREATE_CHANNEL: 1n << 3n,
  DELETE_CHANNEL: 1n << 4n,
  CREATE_ROLE: 1n << 5n,
  DELETE_ROLE: 1n << 6n,
  BAN_MEMBER: 1n << 7n,
  KICK_MEMBER: 1n << 8n,
  MANAGE_SERVER: 1n << 9n,
  MANAGE_PERMISSIONS: 1n << 10n
} as const;

export const allPermissionsValue = Object.values(Permission).reduce((acc, permission) => acc | permission, 0n);
