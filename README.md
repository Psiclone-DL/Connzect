# Connzect

Connzect is a full-stack real-time communication platform with server-based architecture, role permissions, text channels, and voice channels.

## Stack

- Frontend: Next.js (React + TypeScript) + TailwindCSS
- Backend: Node.js + Express + Socket.io + TypeScript
- Database: PostgreSQL + Prisma ORM
- Auth: JWT access token + rotating refresh token (httpOnly cookie)

## Monorepo Structure

```text
Connzect/
  backend/
    prisma/
    src/
      config/
      middleware/
      modules/
      routes/
      utils/
  frontend/
    app/
    components/
    hooks/
    lib/
    styles/
```

## Core Features Implemented

- Authentication
  - Register / Login / Logout / Session refresh
  - Password hashing with bcrypt
  - Email/password validation
  - JWT access tokens + refresh token rotation and revocation

- Server System
  - Create servers with icon upload
  - Server owner + member list
  - Add members by email

- Roles and Permissions
  - Role create / edit / delete
  - Assign and remove role on members
  - Permission bitmask model (boolean flags via bits)
  - Server moderation endpoints (kick / ban)

- Channels
  - Text and voice channel creation
  - Channel rename / delete
  - Channel-level role permission overrides (allow/deny bitmasks)
  - Permission-based channel visibility

- Text Messaging
  - Real-time messages via Socket.io
  - Message history via REST API
  - Thread replies (`parentMessageId`)
  - Message edit / soft delete
  - Author + timestamp persisted in PostgreSQL

- Voice Channels
  - Join/leave voice channels in real time
  - Active participants list
  - WebRTC signaling over Socket.io (`offer`, `answer`, `ice-candidate`)

- Invite Links
  - Create/list/revoke server invite codes
  - Join servers by invite code
  - Optional max-uses and expiry controls

- Direct Messages
  - 1:1 conversation creation
  - Real-time DM messaging
  - DM message threads + edit/delete

## Permission Bit Flags

Defined in `backend/src/utils/permissions.ts`:

- `VIEW_CHANNEL`
- `SEND_MESSAGE`
- `CONNECT_VOICE`
- `CREATE_CHANNEL`
- `DELETE_CHANNEL`
- `CREATE_ROLE`
- `DELETE_ROLE`
- `BAN_MEMBER`
- `KICK_MEMBER`
- `MANAGE_SERVER`
- `MANAGE_PERMISSIONS`

## Setup

### 1) Start PostgreSQL

Use Docker:

```bash
docker compose up -d
```

### 2) Backend setup

```bash
cd backend
cp .env.example .env
npm install
npx prisma generate
npx prisma migrate dev --name init
npm run dev
```

Backend runs on `http://localhost:4000`.

### 3) Frontend setup

```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev
```

Frontend runs on `http://localhost:3000`.

## Desktop (.exe) Build

Connzect desktop is a thin Electron client that opens the VPS web app.

### Prerequisites (Windows PC)

- Node.js 20+
- Access to the VPS URL (default in app: `http://5.75.169.93:3002`)
- Project dependencies installed in root

### 1) Install dependencies

From project root:

```bash
npm install
```

### 2) Build Windows installer

```bash
npm run dist:win
```

Output:

- `desktop-dist/Connzect Setup *.exe`

### Useful desktop scripts

- `npm run dev:desktop`:
  - Launches Electron against `http://127.0.0.1:3000` (for local frontend dev)

- `npm run desktop`:
  - Launches Electron with default VPS URL

### Runtime notes (Desktop)

- Override target URL with environment variable:
  - `CONNZECT_WEB_URL=http://your-vps:3002`
- Auto-update is enabled for packaged Windows app (GitHub Releases).

### Auto-update Release Flow

Desktop updates are distributed from GitHub Releases (repo public).

1. Increase app version in root:

```bash
npm version patch
```

2. Publish installer + update metadata to GitHub:

```bash
# Windows PowerShell
$env:GH_TOKEN="your_github_token"
npm run dist:win:publish
```

3. Push commit and tag:

```bash
git push
git push --tags
```

When users open the app, it checks for updates at startup and every 30 minutes, downloads automatically, then asks for restart.

## API Overview

Base URL: `http://localhost:4000/api`

- Auth:
  - `POST /auth/register`
  - `POST /auth/login`
  - `POST /auth/refresh`
  - `POST /auth/logout`
  - `GET /auth/me`

- Servers:
  - `GET /servers`
  - `POST /servers` (multipart form-data with optional `icon`)
  - `GET /servers/:serverId`
  - `POST /servers/:serverId/members`

- Roles:
  - `POST /servers/:serverId/roles`
  - `PATCH /servers/:serverId/roles/:roleId`
  - `DELETE /servers/:serverId/roles/:roleId`
  - `POST /servers/:serverId/roles/:roleId/assign/:memberId`
  - `DELETE /servers/:serverId/roles/:roleId/assign/:memberId`

- Members:
  - `POST /servers/:serverId/members/:memberId/kick`
  - `POST /servers/:serverId/members/:memberId/ban`

- Channels:
  - `GET /servers/:serverId/channels`
  - `POST /servers/:serverId/channels`
  - `PATCH /servers/:serverId/channels/:channelId`
  - `DELETE /servers/:serverId/channels/:channelId`
  - `PATCH /servers/:serverId/channels/:channelId/permissions/:roleId`

- Messages:
  - `GET /channels/:channelId/messages`
  - `POST /channels/:channelId/messages`
  - `PATCH /channels/:channelId/messages/:messageId`
  - `DELETE /channels/:channelId/messages/:messageId`

- Invites:
  - `POST /servers/:serverId/invites`
  - `GET /servers/:serverId/invites`
  - `DELETE /servers/:serverId/invites/:inviteId`
  - `POST /invites/:code/join`

- Direct Messages:
  - `GET /dm/conversations`
  - `POST /dm/conversations`
  - `GET /dm/conversations/:conversationId/messages`
  - `POST /dm/conversations/:conversationId/messages`
  - `PATCH /dm/conversations/:conversationId/messages/:messageId`
  - `DELETE /dm/conversations/:conversationId/messages/:messageId`

## Socket Events

- Text:
  - `channel:join`
  - `channel:leave`
  - `message:send`
  - `message:edit`
  - `message:delete`
  - `message:new` (server event)
  - `message:updated` (server event)

- DM:
  - `dm:join`
  - `dm:leave`
  - `dm:message:send`
  - `dm:message:edit`
  - `dm:message:delete`
  - `dm:message:new` (server event)
  - `dm:message:updated` (server event)

- Voice:
  - `voice:join`
  - `voice:leave`
  - `voice:participants` (server event)
  - `webrtc:signal`

## Security Notes

- Passwords are hashed with bcrypt (`saltRounds=12`).
- Refresh tokens are stored hashed (SHA-256) and revocable.
- Access control is enforced server-side for channel/server actions.
- Permissions are checked before role/channel/member mutations.
- Use strong production secrets for JWT keys.
- Configure TLS and secure cookies in production.

## Production Hardening Suggestions

- Add rate limiting and auth attempt throttling.
- Add structured logging and request IDs.
- Add unit/integration tests for auth and permission checks.
- Add object storage (S3-compatible) for server icons.
- Add TURN servers for reliable NAT traversal in voice.
