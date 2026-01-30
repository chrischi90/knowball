# Running NBA Roster Wheel on macOS (MacBook Pro)

Step-by-step guide for **up-to-date MacBook Pro** (Apple Silicon M1/M2/M3 or Intel). Uses Terminal (zsh).

---

## 1. Prerequisites

You need **Node.js** and **Python 3.10+** (3.11 or 3.12 is a safe choice; 3.14 often works on Mac too, since numpy usually has pre-built wheels for macOS).

### Option A: Install with Homebrew (recommended)

If you don’t have Homebrew: install from https://brew.sh (one-line install command on that page).

Then run:

```bash
brew install node
brew install python@3.12
```

After installing Python 3.12 via Homebrew, add it to your PATH (add this line to `~/.zshrc` if you use zsh, or `~/.bash_profile` if you use bash):

```bash
echo 'export PATH="/opt/homebrew/opt/python@3.12/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

(On Intel Macs, the path is often `/usr/local/opt/python@3.12/bin` instead of `/opt/homebrew/opt/python@3.12/bin`.)

### Option B: Direct downloads

- **Node.js:** https://nodejs.org — download the **LTS** version, run the installer.
- **Python:** https://www.python.org/downloads/ — download **Python 3.12.x**. Run the installer and ensure “Add to PATH” (or equivalent) is checked if offered.

### Check versions

Open **Terminal** (Applications → Utilities → Terminal, or Cmd+Space → “Terminal”) and run:

```bash
node --version
npm --version
python3 --version
```

You should see e.g. `v20.x`, `10.x`, and `Python 3.x`. On Mac, Python 3.14 is usually fine (numpy has wheels); if you hit install errors, try Python 3.12.

---

## 2. Clone the repo and go to the project

If you haven’t cloned yet:

```bash
cd ~
git clone https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git nba-roster-wheel
cd nba-roster-wheel
```

If you already cloned:

```bash
cd /path/to/nba-roster-wheel
```

---

## 3. Start the Python NBA service (first terminal)

**In Terminal**, run these **one at a time**:

```bash
cd nba-service
```

Create a virtual environment:

```bash
python3 -m venv .venv
```

(Use `python3.12 -m venv .venv` if you have multiple Python versions and want to pin 3.12.)

Activate the virtual environment (macOS/Linux):

```bash
source .venv/bin/activate
```

Your prompt should show `(.venv)` at the start.

Install dependencies:

```bash
pip install -r requirements.txt
```

Start the service:

```bash
uvicorn main:app --reload --port 8000
```

You should see:

```
INFO:     Uvicorn running on http://127.0.0.1:8000
```

**Leave this terminal open.**

---

## 4. Start the Next.js app (second terminal)

Open a **new Terminal window or tab** (Cmd+N or Cmd+T), then:

```bash
cd /path/to/nba-roster-wheel
```

(Use the real path, e.g. `cd ~/nba-roster-wheel` or `cd ~/Projects/nba-roster-wheel`.)

Install dependencies (first time only):

```bash
npm install
```

Start the app:

```bash
npm run dev
```

You should see:

```
> Ready on http://localhost:3000
```

**Leave this terminal open.**

---

## 5. Open the game in your browser

1. Open **Safari** or **Chrome** and go to: **http://localhost:3000**
2. **Create Game** in one window, then **Join Game** in another (same or different device on the same network).
3. Click **Start Draft** when both players are in, then take turns spinning and picking players. When both rosters are full, click **Run Simulation**.

---

## 6. Stopping the app

- In the **Python** terminal: press **Ctrl+C**.
- In the **Next.js** terminal: press **Ctrl+C**.

---

## Requirements summary (macOS)

| Requirement | Version / notes |
|-------------|------------------|
| macOS | 12 (Monterey) or newer (Sonoma, Sequoia) |
| Node.js | 18+ (LTS recommended) |
| npm | Comes with Node.js |
| Python | 3.10+ (3.12 is a safe choice; 3.14 usually works on Mac) |
| Browser | Safari, Chrome, or Firefox |

---

## Troubleshooting (Mac)

| Problem | What to try |
|--------|-------------|
| `node` or `npm` not found | Install Node from https://nodejs.org or run `brew install node`. Restart Terminal. |
| `python3` missing or wrong version | Install Python: `brew install python@3.12` (or `brew install python`) and add it to PATH (see Option A above). |
| `python3 -m venv` fails | Run `python3 --version`; use 3.10 or newer. On Mac, 3.14 is usually fine. |
| Port 3000 or 8000 in use | Quit the app using that port, or change it (e.g. `PORT=3001 npm run dev`). |
| Teams/players don’t load | Make sure the Python service is running in the first terminal (`uvicorn main:app --reload --port 8000`). |
| “Failed to fetch” / 502 | Start the Python service first, then the Next.js app. |

---

## Apple Silicon (M1/M2/M3) notes

- Node, Python, and the project work on Apple Silicon. No extra steps needed.
- If you use Homebrew, it installs to `/opt/homebrew`. Use that path in any PATH instructions above.
