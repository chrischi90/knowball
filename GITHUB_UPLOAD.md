# Push this project to your private GitHub repo

Run these commands in **PowerShell** from the project folder:  
`C:\Users\chris\nba-roster-wheel`

---

## 1. Install Git (if you don’t have it)

- If `git --version` works in PowerShell, skip to step 2.
- Download **Git for Windows**: https://git-scm.com/download/win  
- Run the installer (defaults are fine). Restart PowerShell after installing.

---

## 2. Open PowerShell in the project folder

```powershell
cd C:\Users\chris\nba-roster-wheel
```

---

## 3. Initialize Git and make the first commit

Copy and run **one block at a time**:

```powershell
git init
```

```powershell
git add .
```

```powershell
git status
```

You should see the project files listed (not `node_modules`, `.venv`, or `.next` — those are ignored).

```powershell
git commit -m "Initial commit: NBA Roster Wheel game (Next.js, Socket.io, Python nba_api service)"
```

---

## 4. Add your GitHub repo as remote and push

Replace `YOUR_USERNAME` and `YOUR_REPO_NAME` with your GitHub username and the repo name you created (e.g. `nba-roster-wheel`).

**HTTPS (recommended if you don’t use SSH):**

```powershell
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
```

**If your repo is under an organization:**

```powershell
git remote add origin https://github.com/ORG_NAME/YOUR_REPO_NAME.git
```

**Set the default branch and push:**

```powershell
git branch -M main
git push -u origin main
```

---

## 5. If GitHub asks for login

- **Username:** your GitHub username  
- **Password:** use a **Personal Access Token**, not your GitHub password  
  - GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)  
  - Generate new token, check `repo`, copy it  
  - Paste the token when PowerShell asks for “Password”

---

## Example

If your GitHub username is `chris` and the repo is `nba-roster-wheel`:

```powershell
git remote add origin https://github.com/chris/nba-roster-wheel.git
git branch -M main
git push -u origin main
```

Done. Your code will be in the private repo.

---

## Fix: "Permission denied (publickey)" on push

This happens when your remote uses **SSH** (`git@github.com:...`) but you don't have an SSH key set up (or GitHub doesn't have it). Easiest fix: **use HTTPS instead**.

**1. See your current remote:**

```powershell
git remote -v
```

You’ll see something like `origin  git@github.com:USERNAME/REPO.git`.

**2. Switch the remote to HTTPS** (replace `USERNAME` and `REPO` with your GitHub username and repo name):

```powershell
git remote set-url origin https://github.com/USERNAME/REPO.git
```

Example: `git remote set-url origin https://github.com/chris/nba-roster-wheel.git`

**3. Push again:**

```powershell
git push -u origin main
```

**4. When PowerShell asks for credentials:**

- **Username:** your GitHub username  
- **Password:** a **Personal Access Token** (not your GitHub password)  
  - On GitHub: **Settings** → **Developer settings** → **Personal access tokens** → **Tokens (classic)** → **Generate new token**  
  - Check the **repo** scope, generate, then **copy the token**  
  - Paste that token when Git asks for "Password"

After this, push will use HTTPS and your token, and the "Permission denied (publickey)" error goes away.
