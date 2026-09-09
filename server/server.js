/* =========================================================
   NEA'S BOARDING HORSE — BACKEND SERVER
   Express + JSON-file storage.

   What this server does:
   - Owns real user credentials (bcrypt-hashed, never sent
     to the browser).
   - Owns the shared app data (users' public profiles, posts,
     comments, notifications) in data/state.json, so every
     member who logs in sees the SAME shared community feed
     instead of a private-per-browser copy.
   - Issues an httpOnly session cookie (JWT) on login so the
     frontend never has to store or check passwords itself.

   Run locally:
     cd server
     npm install
     npm start
   Then open http://localhost:3000

   See ../README.md for deployment + admin instructions.
========================================================= */

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

const DATA_DIR = path.join(__dirname, "data");
const STATE_FILE = path.join(DATA_DIR, "state.json");
const CREDENTIALS_FILE = path.join(DATA_DIR, "credentials.json");
const PUBLIC_DIR = path.join(__dirname, "..", "public");

const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || "development";
const COOKIE_NAME = "nbh_session";
const SESSION_DAYS = 30;

// ---------------------------------------------------------
// JWT secret: MUST be set via env var in production. A random
// one is generated for local/dev use so it "just works" out
// of the box, but it changes every restart (logging everyone
// out) unless you set JWT_SECRET yourself.
// ---------------------------------------------------------
let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  JWT_SECRET = crypto.randomBytes(48).toString("hex");
  console.warn(
    "\n[WARN] No JWT_SECRET set in the environment.\n" +
    "       Using a random one for this run only — every restart will log everyone out.\n" +
    "       Set a permanent JWT_SECRET in your hosting provider's environment variables before going live.\n"
  );
}

// ---------------------------------------------------------
// Seed data — used only the FIRST time the server runs
// (i.e. when data/credentials.json doesn't exist yet).
// After that, everything lives in the JSON files on disk
// and this is ignored.
// ---------------------------------------------------------
const SEED_MEMBERS = [
  { username: "Jaypee@nbh", password: process.env.SEED_PASSWORD_JAYPEE || "Jaypee123", name: "Jaypee", bio: "Member of Nea's Boarding Horse.", avatar: "J" },
  { username: "Nea@nbh",    password: process.env.SEED_PASSWORD_NEA    || "Nea123",    name: "Nea",    bio: "Member of Nea's Boarding Horse.", avatar: "N" },
  { username: "Jasmine@nbh",password: process.env.SEED_PASSWORD_JASMINE|| "Jasmine123",name: "Jasmine",bio: "Member of Nea's Boarding Horse.", avatar: "J" },
  { username: "Joshua@nbh", password: process.env.SEED_PASSWORD_JOSHUA || "Joshua123", name: "Joshua", bio: "Member of Nea's Boarding Horse.", avatar: "J" },
  { username: "Bjay@nbh",   password: process.env.SEED_PASSWORD_BJAY   || "Bjay123",   name: "Bjay",   bio: "Member of Nea's Boarding Horse.", avatar: "B" },
  { username: "Axel@nbh",   password: process.env.SEED_PASSWORD_AXEL   || "Axel123",   name: "Axel",   bio: "Member of Nea's Boarding Horse.", avatar: "A" }
];

// The old frontend let anyone in by typing "admin" as the
// username with NO password check at all — that was a real
// security hole. It's fixed here: admin is a normal seeded
// account that requires a real password like everyone else.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "ChangeMe123!";
SEED_MEMBERS.push({
  username: "admin",
  password: ADMIN_PASSWORD,
  name: "Admin",
  bio: "Site administrator.",
  avatar: "A",
  isAdmin: true
});

function defaultState() {
  return {
    users: SEED_MEMBERS.map(m => ({
      username: m.username,
      name: m.name,
      bio: m.bio,
      avatar: m.avatar,
      avatarImage: null,
      bannerImage: null,
      isAdmin: !!m.isAdmin
    })),
    posts: [
      {
        id: 1,
        name: "Nea",
        username: "Nea@nbh",
        avatar: "N",
        text: "Grateful for the little things today \u2728\nA productive day and good vibes.",
        image: "https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=1000&q=80",
        reactions: { "\u2764\uFE0F": 24 },
        userReaction: null,
        comments: 0,
        commentsList: [],
        shares: 3,
        saved: false,
        time: "2h ago"
      }
    ],
    social: {}
  };
}

function defaultSocialFor() {
  return {
    notifications: [],
    albums: [],
    reposts: []
  };
}

// ---------------------------------------------------------
// Tiny JSON-file "database" helpers.
// Fine for a small private community. If this ever needs to
// scale up, swap these for a real database — the API surface
// (the /api/* routes below) would not need to change.
// ---------------------------------------------------------
function ensureDataFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  if (!fs.existsSync(CREDENTIALS_FILE)) {
    const credentials = {};
    SEED_MEMBERS.forEach(m => {
      credentials[m.username.toLowerCase()] = bcrypt.hashSync(m.password, 10);
    });
    fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(credentials, null, 2));
    console.log(`[seed] Created ${CREDENTIALS_FILE} with ${SEED_MEMBERS.length} accounts.`);
  }

  if (!fs.existsSync(STATE_FILE)) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(defaultState(), null, 2));
    console.log(`[seed] Created ${STATE_FILE}.`);
  }
}

function readJSON(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJSONAtomic(file, obj) {
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, file);
}

function readCredentials() {
  return readJSON(CREDENTIALS_FILE);
}

function writeCredentials(obj) {
  writeJSONAtomic(CREDENTIALS_FILE, obj);
}

function readState() {
  const state = readJSON(STATE_FILE);
  if (!Array.isArray(state.users)) state.users = [];
  if (!Array.isArray(state.posts)) state.posts = [];
  if (!state.social || typeof state.social !== "object") state.social = {};
  return state;
}

function writeState(obj) {
  writeJSONAtomic(STATE_FILE, obj);
}

function findCredentialKey(credentials, username) {
  const target = String(username || "").trim().toLowerCase();
  return Object.keys(credentials).find(k => k.toLowerCase() === target) || null;
}

// A very small write queue so two nearly-simultaneous saves
// from different members can't interleave and corrupt the
// state file.
let writeChain = Promise.resolve();
function queueStateWrite(fn) {
  writeChain = writeChain.then(fn).catch(err => console.error("[state write error]", err));
  return writeChain;
}

// ---------------------------------------------------------
// App setup
// ---------------------------------------------------------
ensureDataFiles();

const app = express();
app.set("trust proxy", 1); // needed on Render/Railway/Heroku-style hosts so secure cookies work
app.use(express.json({ limit: "20mb" })); // posts/avatars are embedded as base64 images
app.use(cookieParser());

function requireAuth(req, res, next) {
  const token = req.cookies[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: "Not logged in." });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.username = payload.username;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Session expired. Please log in again." });
  }
}

function setSessionCookie(res, username) {
  const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: `${SESSION_DAYS}d` });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: NODE_ENV === "production",
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000
  });
}

// ---------------------------------------------------------
// AUTH ROUTES
// ---------------------------------------------------------

app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required." });
  }

  const credentials = readCredentials();
  const key = findCredentialKey(credentials, username);
  if (!key) {
    return res.status(401).json({ error: "Incorrect username or password." });
  }

  if (!bcrypt.compareSync(password, credentials[key])) {
    return res.status(401).json({ error: "Incorrect username or password." });
  }

  const state = readState();
  let user = state.users.find(u => u.username.toLowerCase() === key.toLowerCase());
  if (!user) {
    // Credential exists but user profile got removed somehow — recreate a minimal one.
    user = { username: key, name: key, bio: "", avatar: key.charAt(0).toUpperCase(), avatarImage: null, bannerImage: null, isAdmin: false };
    state.users.push(user);
    writeState(state);
  }

  if (!state.social[user.username]) {
    state.social[user.username] = defaultSocialFor();
  }
  state.social[user.username].notifications.unshift({
    name: user.name,
    avatar: user.avatar,
    text: "logged in",
    time: "Just now",
    unread: true
  });
  writeState(state);

  setSessionCookie(res, user.username);
  res.json({ username: user.username, name: user.name, isAdmin: !!user.isAdmin });
});

app.post("/api/auth/logout", (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

app.get("/api/auth/me", requireAuth, (req, res) => {
  const state = readState();
  const user = state.users.find(u => u.username === req.username);
  if (!user) return res.status(401).json({ error: "Account no longer exists." });
  res.json({ username: user.username, name: user.name, isAdmin: !!user.isAdmin });
});

app.post("/api/auth/change-password", requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!newPassword || String(newPassword).length < 6) {
    return res.status(400).json({ error: "New password must be at least 6 characters." });
  }
  if (currentPassword === newPassword) {
    return res.status(400).json({ error: "New password must be different from your current password." });
  }

  const credentials = readCredentials();
  const key = findCredentialKey(credentials, req.username);
  if (!key) return res.status(404).json({ error: "Account not found." });

  if (!bcrypt.compareSync(currentPassword || "", credentials[key])) {
    return res.status(401).json({ error: "Current password is incorrect." });
  }

  credentials[key] = bcrypt.hashSync(newPassword, 10);
  writeCredentials(credentials);
  res.json({ ok: true });
});

// ---------------------------------------------------------
// SHARED APP STATE (users' public profiles, posts, social)
// ---------------------------------------------------------

app.get("/api/state", requireAuth, (req, res) => {
  const state = readState();
  res.json(state);
});

app.post("/api/state", requireAuth, (req, res) => {
  const incoming = req.body;
  if (!incoming || !Array.isArray(incoming.users) || !Array.isArray(incoming.posts)) {
    return res.status(400).json({ error: "Malformed state payload." });
  }

  // Defense in depth: the frontend never holds passwords anymore,
  // but strip the field anyway in case anything old leaks through.
  incoming.users.forEach(u => { delete u.password; });
  if (!incoming.social || typeof incoming.social !== "object") incoming.social = {};

  queueStateWrite(() => {
    writeState(incoming);
  });

  res.json({ ok: true });
});

// ---------------------------------------------------------
// STATIC FRONTEND
// ---------------------------------------------------------
app.use(express.static(PUBLIC_DIR));
app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Not found." });
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Nea's Boarding Horse server running on http://localhost:${PORT}`);
});
