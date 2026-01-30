# NBA Roster Wheel

Two-player online NBA roster draft game: spin a wheel of teams, pick players from the landed team for your roster (PG, SG, SF, PF, C), then run a stats-based simulation to determine a winner.

**On Windows?** See **[WINDOWS_SETUP.md](WINDOWS_SETUP.md)** for a step-by-step walkthrough.  
**On Mac?** See **[MAC_SETUP.md](MAC_SETUP.md)** for macOS (MacBook Pro, Apple Silicon or Intel).

## Stack

- **Frontend**: Next.js 14 (App Router), React, Tailwind CSS
- **Real-time**: Node custom server + Socket.io
- **NBA data**: Python FastAPI service using [nba_api](https://github.com/swar/nba_api)

## Prerequisites

- **Node.js** 18+ (LTS recommended) — [nodejs.org](https://nodejs.org) or `brew install node` on Mac
- **Python** 3.10+ — [python.org](https://www.python.org/downloads/) or `brew install python@3.12` on Mac (on Windows, use 3.10–3.12; see [WINDOWS_SETUP.md](WINDOWS_SETUP.md))
- **npm** (included with Node.js)

## Setup

### 1. Python NBA service

```bash
cd nba-service
python3 -m venv .venv
# Windows (PowerShell):  .\.venv\Scripts\Activate.ps1
# macOS / Linux:        source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Leave this running (default: http://localhost:8000).

### 2. Next.js app

From the project root:

```bash
npm install
npm run dev
```

Runs the custom server (Next.js + Socket.io) at http://localhost:3000.

### 3. Play

1. Open http://localhost:3000 in two browser windows (or two devices on the same network).
2. In one window: **Create Game** and share the game code.
3. In the other: **Join Game** with that code.
4. When both are in: **Start Draft**.
5. Take turns: **Spin** the wheel, then pick a player from the landed team and assign a position.
6. When both rosters are full (5 players each): **Run Simulation** to see the stats-based winner.

## Environment

- `NBA_SERVICE_URL`: URL of the Python NBA service (default: http://localhost:8000). Set this if the service runs elsewhere (e.g. in production).
- `PORT`: Port for the Next.js server (default: 3000).

## Project structure

- `app/` – Next.js App Router (pages, API routes)
- `components/` – Wheel, PlayerList, RosterGrid, SimulationResult
- `lib/` – NBA API client, game types, socket client
- `server/` – Game state store, Socket.io handlers
- `server.js` – Custom Node server (Next.js + Socket.io)
- `nba-service/` – Python FastAPI app using nba_api (teams, team players, player stats)
