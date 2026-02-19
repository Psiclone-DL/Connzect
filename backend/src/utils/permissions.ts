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

export const ALL_PERMISSIONS = Object.values(Permission).reduce((acc, bit) => acc | bit, 0n);

export type PermissionValue = (typeof Permission)[keyof typeof Permission];

export const hasPermission = (permissions: bigint, permission: PermissionValue): boolean =>
  (permissions & permission) === permission;

export const combinePermissions = (permissions: bigint[]): bigint =>
  permissions.reduce((acc, permission) => acc | permission, 0n);

export const sanitizePermissionBits = (value: unknown): bigint => {
  if (typeof value === 'bigint') {
    return value;
  }

  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    return BigInt(value);
  }

  if (typeof value === 'string' && /^\d+$/.test(value)) {
    return BigInt(value);
  }

  return 0n;
};
