import express from "express";
import fetch from "node-fetch";
import fs from "fs";

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

const GROK_KEY = process.env.GROK_KEY;
const ADMIN_KEY = process.env.ADMIN_KEY;
const PRIVATE_PHONE = process.env.PRIVATE_PHONE || null;

const STORE_FILE = "./messages.json";
const CLICK_LOG  = "./clicks.log";
const CUSTOM_LOG = "./custom_requests.json";

/* ============================
   UTIL: SAFE LOAD / SAVE
   ============================ */
function loadJSON(path, fallback) {
  if (!fs.existsSync(path)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function saveJSON(path, data) {
  fs.writeFileSync(path, JSON.stringify(data, null, 2));
}

/* ============================
   CHAT STORAGE
   ============================ */
function addMessage(sessionId, role, content) {
  const store = loadJSON(STORE_FILE, {});
  if (!store[sessionId]) store[sessionId] = [];
  store[sessionId].push({ role, content, time: Date.now() });
  saveJSON(STORE_FILE, store);
}

function getMessages(sessionId) {
  const store = loadJSON(STORE_FILE, {});
  return store[sessionId] || [];
}

/* ============================
   CUSTOM REQUESTS
   ============================ */
function saveCustomRequest(sessionId, message) {
  const list = loadJSON(CUSTOM_LOG, []);
  list.push({ sessionId, message, time: Date.now() });
  saveJSON(CUSTOM_LOG, list);
}

/* ============================
   ANALYTICS (EVENT BASED)
   ============================ */
function logEvent(event, req) {
  const payload = {
    time: Date.now(),
    ip: req.headers["x-forwarded-for"] || req.socket.remoteAddress,
    ...event
  };
  fs.appendFileSync(CLICK_LOG, JSON.stringify(payload) + "\n");
}

function readEvents() {
  if (!fs.existsSync(CLICK_LOG)) return [];
  return fs
    .readFileSync(CLICK_LOG, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map(l => JSON.parse(l));
}

/* ============================
   GROK CHAT
   ============================ */
app.post("/grok", async (req, res) => {
  try {
    const text =
      req.body?.text ||
      req.body?.data?.text ||
      req.body?.message?.text ||
      "";

    const sessionId = req.body?.sessionId || "unknown";
    if (!text.trim()) {
      return res.json({ grok_reply: "hmm? say that again 🤍" });
    }

    addMessage(sessionId, "user", text);

    const history = getMessages(sessionId)
      .slice(-12)
      .map(m => ({ role: m.role, content: m.content }));

    const apiRes = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GROK_KEY}`
      },
      body: JSON.stringify({
        model: "grok-3-mini",
        temperature: 0.92,
        max_tokens: 200,
        messages: history
      })
    });

    const data = await apiRes.json();
    const reply = data?.choices?.[0]?.message?.content?.trim();

    if (!reply) {
      return res.json({ grok_reply: "hmm… try again 🤍" });
    }

    addMessage(sessionId, "assistant", reply.toLowerCase());
    res.json({ grok_reply: reply.toLowerCase() });
  } catch (err) {
    console.error(err);
    res.json({ grok_reply: "signal dipped… try again 🤍" });
  }
});

/* ============================
   TRACK (PAGEVIEWS / CLICKS)
   ============================ */
app.post("/track", (req, res) => {
  try {
    logEvent(req.body || {}, req);
    res.sendStatus(200);
  } catch {
    res.sendStatus(500);
  }
});

/* ============================
   ADMIN: CONVERSATIONS
   ============================ */
app.get("/admin/conversations", (req, res) => {
  if (req.query.key !== ADMIN_KEY) {
    return res.status(401).json({ error: "unauthorised" });
  }
  res.json(loadJSON(STORE_FILE, {}));
});

/* ============================
   ADMIN: ANALYTICS (JSON)
   ============================ */
app.get("/admin/analytics", (req, res) => {
  if (req.query.key !== ADMIN_KEY) {
    return res.status(401).json({ error: "unauthorised" });
  }

  const events = readEvents();
  const pages = {};
  const sessions = {};

  for (const e of events) {
    if (!pages[e.page]) {
      pages[e.page] = { views: 0, clicks: {} };
    }

    if (e.type === "pageview") {
      pages[e.page].views++;
    }

    if (e.type === "click") {
      pages[e.page].clicks[e.target] =
        (pages[e.page].clicks[e.target] || 0) + 1;
    }

    if (e.sessionId) {
      if (!sessions[e.sessionId]) sessions[e.sessionId] = [];
      sessions[e.sessionId].push(e);
    }
  }

  res.json({
    totals: {
      events: events.length
    },
    pages,
    sessions
  });
});

/* ============================
   ADMIN: ANALYTICS CSV
   ============================ */
app.get("/admin/analytics.csv", (req, res) => {
  if (req.query.key !== ADMIN_KEY) return res.sendStatus(401);
  const events = readEvents();

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=analytics.csv");

  res.send(
    "time,type,page,target,sessionId,ip\n" +
      events
        .map(e =>
          [
            e.time,
            e.type,
            e.page || "",
            e.target || "",
            e.sessionId || "",
            e.ip || ""
          ].join(",")
        )
        .join("\n")
  );
});

/* ============================
   HEALTH
   ============================ */
app.get("/healthz", (_, res) => res.send("ok"));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () =>
  console.log(`Nina Nova backend listening on ${PORT}`)
);
