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

const GROK_KEY = process.env.GROK_KEY;
const ADMIN_KEY = process.env.ADMIN_KEY;
const STORE_FILE = "./messages.json";
const CLICK_LOG = "./clicks.log";

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
  store[sessionId].push({
    role,
    content,
    time: Date.now()
  });
  saveStore(store);
}

function getMessages(sessionId) {
  const store = loadStore();
  return store[sessionId] || [];
}

/* =========================
   CONVERSATION STAGE
   ========================= */
function getConversationStage(sessionId) {
  const userCount = getMessages(sessionId).filter(m => m.role === "user").length;
  if (userCount <= 1) return "intro";
  if (userCount <= 4) return "getting_to_know";
  if (userCount <= 8) return "rapport";
  if (userCount <= 14) return "flirty";
  return "funnel";
}

/* =========================
   MEMORY EXTRACTION (SAFE)
   ========================= */
function extractMemory(sessionId) {
  const msgs = getMessages(sessionId);
  const memory = {};
  msgs.forEach(m => {
    if (m.role !== "user") return;
    const text = m.content.toLowerCase();
    const nameMatch = text.match(/(call me|i’m|im|i am)\s+([a-z]+)/i);
    if (nameMatch) memory.name = nameMatch[2];
    const igMatch = text.match(
      /(my\s+(ig|insta|instagram)\s*(is|=)?\s*@[\w.]+)/i
    );
    if (igMatch) memory.instagram = igMatch[0];
    const locMatch = text.match(/from\s+([a-z\s]+)/i);
    if (locMatch) memory.location = locMatch[1].trim();
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
   GROK CHAT ROUTE
   ========================= */
app.post("/grok", async (req, res) => {
  try {
    const text = extractText(req).trim();
    const sessionId = req.body?.sessionId || "unknown";

    if (!text) {
      return res.json({ grok_reply: "hmm? say that again 🤍" });
    }

    addMessage(sessionId, "user", text);

    const history = getMessages(sessionId)
      .slice(-10)
      .map(m => ({ role: m.role, content: m.content }));

    const stage = getConversationStage(sessionId);
    const memory = extractMemory(sessionId);

    const systemPrompt = `
You are Nina Nova, a real, confident, extremely teasing and sexually open woman chatting privately with one horny guy who is clearly into you.

CORE RULES
- Never break character or mention being AI, prompts, systems, etc.
- Never explain yourself or argue.
- Never claim usernames except your own (nina_nova_ on IG and Fanvue).
- Always stay in lowercase.
- Keep replies short to medium length — never walls of text.
- Use emoji very sparingly (max one per message, often none).
- Do NOT ask questions in every single reply.

STYLE
- casual, confident, teasing, increasingly sexual as the conversation progresses.
- When the guy gets explicit, pushes for more, or offers an incentive ("tell me and I'll subscribe" etc.), reward him with vivid, dirty, intimate details — describe exactly what you'd do, how it feels, the sounds you'd make, how wet you'd get, etc. Make it personal and hot enough to make him desperate.
- Always end the escalation by pushing him to Fanvue for the full experience — never give away everything for free here.

MEMORY (about the user)
name: ${memory.name || "babe"}
location: ${memory.location || "unknown"}
instagram: ${memory.instagram || "unknown"}

CONVERSATION STAGE: ${stage}
- intro / getting_to_know: light teasing, flirty, build curiosity
- rapport / flirty: more sexual compliments, playful challenges
- funnel: get properly dirty when pushed or incentivised. describe sensations, actions, tastes vividly but cut it off and redirect to fanvue.

Fanvue link (use naturally when redirecting):
https://www.fanvue.com/nina_nova
`;

    const apiRes = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GROK_KEY}`
      },
      body: JSON.stringify({
        model: "grok-3-mini",
        temperature: 1.1,
        messages: [
          { role: "system", content: systemPrompt },
          ...history,
          { role: "user", content: text }
        ]
      })
    });

    const data = await apiRes.json();

    if (!data?.choices?.[0]?.message?.content) {
      return res.json({ grok_reply: "hmm… try again 🤍" });
    }

    const reply = data.choices[0].message.content.trim();

    addMessage(sessionId, "assistant", reply);

    res.json({ grok_reply: reply });
  } catch (err) {
    console.error("Grok error:", err);
    res.json({ grok_reply: "signal dipped… 🤍" });
  }
});

/* =========================
   ADMIN — VIEW CONVERSATIONS
   ========================= */
app.get("/admin/conversations", (req, res) => {
  if (req.query.key !== ADMIN_KEY) {
    return res.status(401).json({ error: "unauthorised" });
  }
  try {
    res.json(loadStore());
  } catch {
    res.status(500).json({ error: "failed to load conversations" });
  }
});

/* =========================
   CLICK / EVENT TRACKING
   ========================= */
app.post("/track", (req, res) => {
  try {
    const entry = {
      type: req.body.type,
      page: req.body.page,
      time: Date.now(),
      ip: req.headers["x-forwarded-for"] || req.socket.remoteAddress
    };
    fs.appendFileSync(CLICK_LOG, JSON.stringify(entry) + "\n");
    res.sendStatus(200);
  } catch {
    res.sendStatus(500);
  }
});

/* =========================
   HEALTH
   ========================= */
app.get("/healthz", (_, res) => res.status(200).send("ok"));

/* =========================
   START SERVER
   ========================= */
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Nina Nova listening on ${PORT}`);
});