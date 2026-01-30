# Copilot instructions for NBA Roster Wheel

## Architecture & data flow
- Two-process dev setup: Next.js app + Socket.io custom server in [server.js](server.js), and a separate FastAPI NBA data service in [nba-service/main.py](nba-service/main.py).
- Game state is **in-memory** only (no DB). The source of truth is [server/game-store.js](server/game-store.js), keyed by 8-char `gameId` and broadcast via Socket.io in [server/socket-handlers.js](server/socket-handlers.js).
- Client uses Socket.io from [lib/socket.ts](lib/socket.ts); it is **client-only** (`"use client"`) and throws if called server-side.
- NBA data is fetched from the Python service via [lib/nba-api.ts](lib/nba-api.ts), then proxied through Next.js API routes in [app/api](app/api) (e.g., teams/players/stats).
- Simulation is handled by the Next.js API route in [app/api/simulate/route.ts](app/api/simulate/route.ts) using a power-score formula; results are sent back to the room via the `simulation_result` socket event.

## Key real-time patterns
- Socket events are the API: `create_game`, `join_game`, `start_draft`, `spin`, `pick`, `simulation_result`, and server push `game_state` / `wheel_result` (see [server/socket-handlers.js](server/socket-handlers.js)).
- `spin` is server-authoritative; clients animate to a server-selected team index. Teams are cached on the server via `cache_teams` to keep server-side random selection aligned with client wheel order.
- Game phases: `lobby` → `drafting` → `simulation` → `completed` defined in [lib/game-types.ts](lib/game-types.ts). UI logic is driven by these phases in [app/game/[id]/page.tsx](app/game/[id]/page.tsx).

## Developer workflows (critical)
- Start Python service first (FastAPI + nba_api): `cd nba-service && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt && uvicorn main:app --reload --port 8000`.
- Start Next.js + Socket.io server: `npm install && npm run dev` (uses [server.js](server.js)).
- Env vars: `NBA_SERVICE_URL` (defaults to http://localhost:8000) and `PORT` (defaults to 3000) documented in [README.md](README.md).

## Project-specific conventions
- API routes in [app/api](app/api) **proxy** the Python service; don’t call nba_api directly from the Next.js server/components.
- The game store is plain JS and shared only via Socket.io; keep changes in [server/game-store.js](server/game-store.js) and ensure broadcasts in [server/socket-handlers.js](server/socket-handlers.js).
- Team order matters: the wheel assumes the sorted order from the Python service; avoid re-sorting on the client or server unless you update both.

## Useful references
- Lobby/game UI flow: [app/page.tsx](app/page.tsx), [app/game/[id]/page.tsx](app/game/[id]/page.tsx)
- UI components: [components/Wheel.tsx](components/Wheel.tsx), [components/PlayerList.tsx](components/PlayerList.tsx), [components/RosterGrid.tsx](components/RosterGrid.tsx)
