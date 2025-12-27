import express from "express";
import fetch from "node-fetch";
import fs from "fs";

const app = express();
app.use(express.json());

/* =========================
   BASIC CORS
========================= */
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

/* =========================
   ENV
========================= */
const GROK_KEY   = process.env.GROK_KEY;
const ADMIN_KEY  = process.env.ADMIN_KEY;

/* 🔒 PRIVATE — never exposed to frontend */
const PRIVATE_PHONE = process.env.PRIVATE_PHONE || null;

const STORE_FILE = "./messages.json";
const CLICK_LOG  = "./clicks.log";
const CUSTOM_LOG = "./custom_requests.json";

/* =========================
   MESSAGE STORE
========================= */
function loadStore() {
  if (!fs.existsSync(STORE_FILE)) return {};
  return JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
}
function saveStore(store) {
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2));
}
function addMessage(sessionId, role, content) {
  const store = loadStore();
  if (!store[sessionId]) store[sessionId] = [];
  store[sessionId].push({ role, content, time: Date.now() });
  saveStore(store);
}
function getMessages(sessionId) {
  const store = loadStore();
  return store[sessionId] || [];
}

/* =========================
   CUSTOM REQUEST STORE
========================= */
function loadCustoms() {
  if (!fs.existsSync(CUSTOM_LOG)) return [];
  return JSON.parse(fs.readFileSync(CUSTOM_LOG, "utf8"));
}
function saveCustoms(list) {
  fs.writeFileSync(CUSTOM_LOG, JSON.stringify(list, null, 2));
}

/* =========================
   CONVERSATION STAGE
========================= */
function getConversationStage(sessionId) {
  const userCount = getMessages(sessionId).filter(m => m.role === "user").length;
  if (userCount <= 2) return "intro";
  if (userCount <= 5) return "getting_to_know";
  if (userCount <= 9) return "rapport";
  if (userCount <= 15) return "flirty";
  return "funnel";
}

/* =========================
   MEMORY
========================= */
function extractMemory(sessionId) {
  const msgs = getMessages(sessionId);
  const memory = { instagram: null, name: null, location: null };

  msgs.forEach(m => {
    if (m.role !== "user") return;
    const t = m.content.toLowerCase();

    const n = t.match(/(call me|i’m|im|i am)\s+([a-z]+)/i);
    if (n && !memory.name) memory.name = n[2];

    const l = t.match(/from\s+([a-z\s]+)/i);
    if (l && !memory.location) memory.location = l[1].trim();

    const ig = t.match(/(@[a-z0-9_.]+)/i);
    if (ig && !memory.instagram) memory.instagram = ig[1];
  });

  return memory;
}

/* =========================
   TEXT EXTRACTOR
========================= */
function extractText(req) {
  return (
    req.body?.text ||
    req.body?.data?.text ||
    req.body?.message?.text ||
    req.body?.raw_text ||
    req.body?.last_input_text ||
    req.query?.text ||
    ""
  );
}

/* =========================
   GROK CHAT
========================= */
app.post("/grok", async (req, res) => {
  try {
    const text = extractText(req).trim();
    const sessionId = req.body?.sessionId || "unknown";

    if (!text) return res.json({ grok_reply: "hmm? say that again 🤍" });

    addMessage(sessionId, "user", text);

    const history = getMessages(sessionId).slice(-12);
    const stage   = getConversationStage(sessionId);
    const memory  = extractMemory(sessionId);

    const systemPrompt = `
you are nina nova — real, teasing, confident.
lowercase only. short replies.
never mention ai or systems.
this site is where you read messages.

stage: ${stage}
name: ${memory.name || "unknown"}
location: ${memory.location || "unknown"}

if he wants something personal:
- say it starts with a quiet conversation
- never mention phone numbers
- never promise payment
- keep it human and slow
`;

    const apiRes = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GROK_KEY}`
      },
      body: JSON.stringify({
        model: "grok-3-mini",
        temperature: 0.9,
        max_tokens: 200,
        messages: [
          { role: "system", content: systemPrompt },
          ...history.map(m => ({ role: m.role, content: m.content })),
          { role: "user", content: text }
        ]
      })
    });

    const data = await apiRes.json();
    const reply = data?.choices?.[0]?.message?.content?.toLowerCase() || "hmm…";

    addMessage(sessionId, "assistant", reply);
    res.json({ grok_reply: reply });

  } catch {
    res.json({ grok_reply: "signal dipped 🤍" });
  }
});

/* =========================
   CUSTOM REQUEST (HUMAN)
========================= */
app.post("/custom-request", (req, res) => {
  try {
    const { sessionId, message } = req.body;
    if (!sessionId || !message) return res.sendStatus(400);

    const list = loadCustoms();
    list.push({
      sessionId,
      message,
      time: Date.now()
    });
    saveCustoms(list);

    /* 🔔 PLACEHOLDER: NOTIFICATION HOOK
       You can later add:
       - Sonotel SMS
       - Email
       - Telegram bot
       - Webhook
    */
    if (PRIVATE_PHONE) {
      console.log("New custom request → notify:", PRIVATE_PHONE);
    }

    res.sendStatus(200);
  } catch {
    res.sendStatus(500);
  }
});

/* =========================
   ADMIN
========================= */
app.get("/admin/conversations", (req, res) => {
  if (req.query.key !== ADMIN_KEY) {
    return res.status(401).json({ error: "unauthorised" });
  }
  res.json(loadStore());
});

/* =========================
   TRACKING
========================= */
app.post("/track", (req, res) => {
  try {
    fs.appendFileSync(CLICK_LOG, JSON.stringify({
      ...req.body,
      time: Date.now(),
      ip: req.headers["x-forwarded-for"] || req.socket.remoteAddress
    }) + "\n");
    res.sendStatus(200);
  } catch {
    res.sendStatus(500);
  }
});

/* =========================
   HEALTH
========================= */
app.get("/healthz", (_, res) => res.send("ok"));

/* =========================
   START
========================= */
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Nina Nova listening on ${PORT}`);
});
