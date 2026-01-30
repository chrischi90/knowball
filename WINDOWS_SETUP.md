# Running NBA Roster Wheel on Windows 10

Step-by-step guide to run the project locally on **Windows 10**.

---

## 1. Prerequisites

You need **Node.js** and **Python** installed.

### Check if you have them

Open **PowerShell** or **Command Prompt** (search for "PowerShell" or "cmd" in the Start menu) and run:

```powershell
node --version
npm --version
python --version
```

- If you see version numbers (e.g. `v20.x`, `10.x`, `Python 3.11`), you're good. Skip to step 2.
- If you see "not recognized" or an error, install as below.

### Install Node.js (if needed)

1. Go to https://nodejs.org/
2. Download the **LTS** version (e.g. "20.x LTS").
3. Run the installer. Leave default options checked (including "Add to PATH").
4. Close and reopen PowerShell, then run  `node --version` again.

### Install Python (if needed)

**Use Python 3.10, 3.11, or 3.12.** Do **not** use Python 3.14 (or 3.13 on some setups) — numpy and other packages often don’t have pre-built Windows wheels yet, so pip will try to build from source and fail unless you have Visual Studio build tools.

1. Go to https://www.python.org/downloads/
2. Download **Python 3.12** (e.g. "Download Python 3.12.x") — or 3.11 / 3.10. Avoid 3.14 for this project.
3. Run the installer.
4. **Important:** On the first screen, check **"Add python.exe to PATH"**, then click "Install Now".
5. Close and reopen PowerShell, then run `python --version` and confirm you see 3.10, 3.11, or 3.12.

---

## 2. Open a terminal in the project folder

1. Open **File Explorer** and go to: `C:\Users\chris\nba-roster-wheel`
2. **Option A:** Click the address bar, type `powershell`, and press Enter.  
   **Option B (Windows 10):** Hold **Shift**, right-click in the folder, then click **"Open PowerShell window here"**.  
   **Option C:** If you see **"Open in Terminal"** in the right-click menu, use that (same idea).

You should see a prompt like:

```text
PS C:\Users\chris\nba-roster-wheel>
```

---

## 3. Start the Python NBA service (first terminal)

The game needs the Python service running so it can load teams and players.

**Do this first (one time only):** If you haven’t already, allow PowerShell to run scripts. In PowerShell run:

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

When it asks “Do you want to change the execution policy?”, type **Y** and press Enter.

**Then**, in the same PowerShell window, go to the NBA service folder and set up the virtual environment:

```powershell
cd C:\Users\chris\nba-roster-wheel\nba-service
```

```powershell
python -m venv .venv
```

This creates a virtual environment (folder `.venv`). You only need to do this once.

```powershell
.\.venv\Scripts\Activate.ps1
```

Your prompt should change to show `(.venv)` at the start. If you still get “running scripts is disabled”, run the `Set-ExecutionPolicy` command above, then try the Activate command again.

```powershell
pip install -r requirements.txt
```

Wait for it to finish (may take a minute).

```powershell
uvicorn main:app --reload --port 8000
```

You should see something like:

```text
INFO:     Uvicorn running on http://127.0.0.1:8000
```

**Leave this window open.** The Python service must keep running while you play.

---

## 4. Start the Next.js app (second terminal)

You need a **second** terminal for the web app.

1. Open a **new** PowerShell window (or new tab in Terminal).
2. Go to the project folder again:

```powershell
cd C:\Users\chris\nba-roster-wheel
```

3. Install dependencies (only needed the first time):

```powershell
npm install
```

4. Start the app:

```powershell
npm run dev
```

You should see something like:

```text
> Ready on http://localhost:3000
```

**Leave this window open too.**

---

## 5. Open the game in your browser

1. Open **Chrome** or **Edge** (or any browser).
2. Go to: **http://localhost:3000**

You should see the NBA Roster Wheel lobby ("Create Game" / "Join Game").

### Playing with two players (same PC)

1. In the first browser window: click **Create Game**. You’ll get a short code (e.g. `AB12CD34`).
2. Open a **second** browser window (or a new tab) and go to **http://localhost:3000**.
3. In the second window: paste the code and click **Join Game**.
4. Back in the first window: click **Start Draft** when both are in.
5. Take turns: **Spin** → pick a player from the team that comes up → assign a position. When both have 5 players, click **Run Simulation** to see the winner.

---

## 6. Stopping the app

- In the **Python** terminal: press **Ctrl+C** to stop the NBA service.
- In the **Next.js** terminal: press **Ctrl+C** to stop the web app.

---

## Windows 10 notes

- **PowerShell:** Windows 10 ships with PowerShell 5.1. The commands in this guide work with it. If you ever see script execution errors, use the `Set-ExecutionPolicy` command in step 3.
- **Python from python.org** is recommended on Windows 10 so `venv` and `pip` work without extra setup. If you installed Python from the Microsoft Store, the same steps should work; if `python` is not found, try `python3` or ensure Python is in your PATH.
- **Python version:** Use **3.10, 3.11, or 3.12**. If you see errors about building numpy or "Unknown compiler", you are likely on Python 3.14 (or 3.13); install Python 3.12 and use that for this project (see Troubleshooting).

---

## Troubleshooting

| Problem | What to try |
|--------|-------------|
| `node` or `npm` not recognized | Install Node.js and make sure "Add to PATH" was checked. Restart PowerShell. |
| `python` not recognized | Install Python and check "Add python.exe to PATH". Restart PowerShell. |
| "Cannot run scripts" when activating `.venv` | Run `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser` in PowerShell. |
| Port 3000 or 8000 already in use | Close any other app using that port, or change the port (e.g. `npm run dev` then set `PORT=3001` in env if you need 3001). |
| Teams or players don’t load | Make sure the Python service is running in the first terminal (`uvicorn main:app --reload --port 8000`) and you see "Uvicorn running on http://127.0.0.1:8000". |
| "Failed to fetch" or 502 errors | The Next.js app talks to the Python app at `http://localhost:8000`. Start the Python service first, then the Next.js app. |
| **numpy / "Unknown compiler" / "metadata-generation-failed"** when running `pip install -r requirements.txt` | You’re likely on **Python 3.14** (or 3.13). There are no pre-built Windows wheels for numpy on 3.14 yet, so pip tries to build from source and fails. **Fix:** Install **Python 3.12** (see “Fix: Use Python 3.12” below) and recreate the venv. |

If something still doesn’t work, say which step you’re on and what message you see (copy-paste is best).

---

### Fix: Use Python 3.12 (after numpy / compiler error)

1. Install **Python 3.12** from https://www.python.org/downloads/ — choose “Python 3.12.x”, run the installer, and check **“Add python.exe to PATH”**.
2. Close all PowerShell windows and open a **new** one.
3. Go to the NBA service folder and **remove the old venv**:
   ```powershell
   cd C:\Users\chris\nba-roster-wheel\nba-service
   Remove-Item -Recurse -Force .venv
   ```
4. Create a new venv **with Python 3.12**. If `py` is available (Windows launcher), use:
   ```powershell
   py -3.12 -m venv .venv
   ```
   If you only have 3.12 installed and it’s on PATH:
   ```powershell
   python -m venv .venv
   ```
5. Activate and install:
   ```powershell
   .\.venv\Scripts\Activate.ps1
   pip install -r requirements.txt
   uvicorn main:app --reload --port 8000
   ```
