# NBA Roster Wheel

Two-player online NBA roster draft game: spin a wheel of teams, pick players from the landed team for your roster (PG, SG, SF, PF, C), then run a stats-based simulation to determine a winner.

**On Windows?** See **[WINDOWS_SETUP.md](WINDOWS_SETUP.md)** for a step-by-step walkthrough.  
**On Mac?** See **[MAC_SETUP.md](MAC_SETUP.md)** for macOS (MacBook Pro, Apple Silicon or Intel).

## Stack

- **Frontend**: Next.js 14 (App Router), React, Tailwind CSS
- **Real-time**: Node custom server + Socket.io
- **NBA data**: Python FastAPI service (FastAPI + nba_api + Basketball Reference)
- **Database**: Neon Postgres (teams + rosters)

## Prerequisites

- **Node.js** 18+ (LTS recommended) — [nodejs.org](https://nodejs.org) or `brew install node` on Mac
- **Python** 3.10+ — [python.org](https://www.python.org/downloads/) or `brew install python@3.12` on Mac (on Windows, use 3.10–3.12; see [WINDOWS_SETUP.md](WINDOWS_SETUP.md))
- **npm** (included with Node.js)
- **DATABASE_URL** — Neon Postgres connection string (get this from the project owner or the Neon dashboard)

## Local development setup

Local dev requires **two terminals running simultaneously**: the Python NBA service and the Next.js app.

### Terminal 1 — Python NBA service

```bash
cd nba-service
python3 -m venv .venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt

DATABASE_URL="<your-neon-connection-string>" uvicorn main:app --reload
```

The service runs at http://localhost:8000. Keep this terminal open.

> **Tip:** To avoid typing the connection string every time, create `nba-service/.env.local` with `DATABASE_URL=<your-neon-connection-string>` and use [`python-dotenv`](https://pypi.org/project/python-dotenv/) or export it in your shell profile.

### Terminal 2 — Next.js app

From the project root:

```bash
npm install
npm run dev
```

Runs the custom Node server (Next.js + Socket.io) at http://localhost:3000.

### Play

1. Open http://localhost:3000 in two browser windows (or two devices on the same network).
2. In one window: **Create Game** and share the game code.
3. In the other: **Join Game** with that code.
4. When both are in: **Start Draft**.
5. Take turns: **Spin** the wheel, then pick a player from the landed team and assign a position.
6. When both rosters are full (5 players each): **Run Simulation** to see the stats-based winner.

## Environment variables

| Variable | Service | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | nba-service | — | Neon Postgres connection string (required) |
| `NBA_SERVICE_URL` | Next.js | `http://localhost:8000` | URL of the Python NBA service |
| `PORT` | Next.js | `3000` | Port for the Next.js/Socket.io server |

## Database seeding

Teams and rosters are stored in Neon Postgres. The DB is pre-seeded — you don't need to run this unless you're adding a new season or fixing missing players.

```bash
cd nba-service
pip install -r seed_requirements.txt
DATABASE_URL="<your-neon-connection-string>" python seed_db.py
```

The seed script is idempotent (safe to re-run). It pulls historical rosters from Basketball Reference and supplements with live team roster pages to capture injured/inactive players.

## Project structure

- `app/` – Next.js App Router (pages, API routes)
- `components/` – Wheel, PlayerList, RosterGrid, SimulationResult
- `lib/` – NBA API client, game types, socket client
- `server/` – Game state store, Socket.io handlers
- `server.js` – Custom Node server (Next.js + Socket.io)
- `nba-service/` – Python FastAPI service (teams, rosters, player stats)
- `nba-service/seed_db.py` – One-time DB seeding script (run locally only)
- `nba-service/schema.sql` – Postgres schema
