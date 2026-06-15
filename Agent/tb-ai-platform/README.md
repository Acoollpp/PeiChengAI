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
npm start
```

```bash
node test/no-token-run.test.js
```

## CCH Login Plan

The design for CCH key-based login and one-minute user/key synchronization is in:

`docs/superpowers/specs/2026-06-15-cch-key-login-sync-design.md`
