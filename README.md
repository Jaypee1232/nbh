# Nea's Boarding Horse — full site (frontend + backend)

This turns the original frontend-only prototype (which only saved
data in your own browser's `localStorage`, so no two members ever
actually saw the same feed) into a real, publishable site: one
Node.js/Express server, shared by every member, with real
password checking.

```
nbh/
├── public/           the website itself (served as-is by the server)
│   ├── index.html
│   ├── style.css
│   └── script.js
├── server/
│   ├── server.js      the whole backend (Express + JSON-file storage)
│   ├── package.json
│   ├── .env.example
│   └── data/          created automatically on first run (not in git)
└── README.md
```

## What changed from the version you uploaded

- **A real backend.** Login now checks a password against a
  bcrypt hash on the server — the browser never sees anyone's
  password. Posts, comments, reactions and notifications are
  stored server-side in `server/data/`, so every member who logs
  in (from any device) sees the **same shared feed**, instead of
  each browser having its own private copy.
- **Security fix:** the old frontend let *anyone* log in by typing
  `admin` as the username with no password at all. That's gone —
  admin now needs a real password too (see `ADMIN_PASSWORD` below).
- **Live-ish updates.** While the app is open it quietly checks the
  server every 7 seconds for new posts/comments/reactions from
  other members and refreshes the feed.
- Everything else — the look, the posting/commenting/reactions/
  albums/notifications/profile UI — is untouched.

## Run it locally

You'll need [Node.js](https://nodejs.org) 18 or newer.

```bash
cd server
npm install
npm start
```

Then open **http://localhost:3000** in your browser.

On the very first run, the server seeds six member accounts plus
an admin account using the same usernames/passwords as your
original prototype (`Jaypee@nbh` / `Jaypee123`, `Nea@nbh` /
`Nea123`, etc., and `admin` / `ChangeMe123!`). After that first
run, everything lives in `server/data/` (two files:
`credentials.json` and `state.json`) and the seed list is ignored.

**Change the admin password and set a real `JWT_SECRET` before you
invite anyone** — see `server/.env.example` for how, and the
"Before you publish this" section below.

## Deploying it so members can actually reach it

This is a normal Node.js app, so it runs on any host that runs
Node — pick whichever is easiest for you:

- **Render** ([render.com](https://render.com)) — free tier
  available. Create a "Web Service", point it at this repo, set
  **Root Directory** to `server`, **Build Command** to
  `npm install`, **Start Command** to `npm start`, and add the
  environment variables below.
- **Railway** ([railway.app](https://railway.app)) — similar to
  Render; deploy the `server` folder the same way.
- **Fly.io**, **a DigitalOcean droplet**, **your own VPS** — also
  work fine; just make sure `npm start` runs from inside `server/`.

Whichever you pick, you'll want a **persistent disk/volume**
mounted at `server/data` — some free-tier hosts wipe the
filesystem on every redeploy, which would delete all posts and
accounts. Render and Railway both support attaching a small
persistent volume; look for "Disks" or "Volumes" in their
dashboard and mount it at `/opt/render/project/src/server/data`
(Render) or the equivalent path they show you.

### Environment variables to set on your host

| Variable | Required | What it's for |
|---|---|---|
| `JWT_SECRET` | **Yes** | Long random string that signs login sessions. Generate one with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`. Without it, everyone gets logged out every time you redeploy. |
| `ADMIN_PASSWORD` | Strongly recommended | Sets the admin account's password the first time the server runs. Defaults to `ChangeMe123!` if not set — change it. |
| `NODE_ENV` | Recommended | Set to `production`. Makes the session cookie `secure` (HTTPS-only), which every host above provides automatically. |
| `PORT` | No | Most hosts set this for you automatically. |

## Before you publish this for real

A few things worth doing since this now holds real people's
posts and photos:

1. **Set `JWT_SECRET` and `ADMIN_PASSWORD`** as above — don't run
   with the defaults.
2. **Use HTTPS.** Every host listed above gives you HTTPS for
   free; just make sure `NODE_ENV=production` is set so the login
   cookie requires it.
3. **Back up `server/data/`** periodically (it's just two JSON
   files) — that's the entire database.
4. **Storage growth:** photos are still stored as compressed
   base64 text inside the JSON files (same approach the original
   prototype used), which is simple but not efficient for a lot
   of photos. If the community grows or posts lots of images,
   the next upgrade would be moving image storage to something
   like S3/Cloudflare R2 and swapping the two JSON files for a
   real database (e.g. SQLite or Postgres) — the frontend
   wouldn't need to change for that, only `server/server.js`.
5. There's still no public sign-up (by design, matching the
   original) — new members are added by editing
   `server/data/credentials.json` and `state.json` directly, or
   by extending the admin account with a simple "add member" API
   route if you'd like that instead. Ask if you'd like that built.
