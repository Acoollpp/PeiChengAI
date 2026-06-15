# TB AI Platform

Small Node.js web platform for launching DingTalk TB project creation and
change tasks through the server-side Codex CLI.

## Current Deployment

The live service currently runs on the PACE server at:

- Runtime path: `/home/gpt/tb-ai-platform`
- PM2 process: `tb-ai-platform`
- Default port: `8787`

## Repository Scope

This folder is the source-controlled copy of the TB platform. Runtime-only files
are intentionally excluded:

- `.env`
- `data/`
- `backups/`
- PM2 logs

Use `.env.example` as the configuration template.

## Commands

```bash
npm install
```

```bash
npm start
```

```bash
npm test
```

## Configuration

Copy `.env.example` to `.env` on the server and set the runtime values:

- `PORT` and `HOST`: HTTP listen settings
- `CODEX_BIN`: path to the server-side Codex CLI
- `CCH_DATABASE_URL`: host-reachable Postgres URL for the CCH database
- `SESSION_SECRET`: random secret for signed session cookies
- `SESSION_TTL_HOURS`: login lifetime, default 24
- `CCH_SYNC_INTERVAL_MS`: CCH user/key sync interval, default 60000

The CCH database URL used inside Docker may contain an internal container
hostname. For the PM2 deployment, use the host-published localhost port instead.

## CCH Login

Users log in with their CCH key. The service syncs CCH `users` and `keys` into a
local SQLite database at startup and every minute afterward. Runtime state lives
under `data/` and is not committed.

The design for CCH key-based login and one-minute user/key synchronization is in:

`docs/superpowers/specs/2026-06-15-cch-key-login-sync-design.md`
