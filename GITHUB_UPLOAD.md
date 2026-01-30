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
