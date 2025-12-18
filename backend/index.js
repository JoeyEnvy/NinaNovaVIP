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
const STORE_FILE = "./messages.json";

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

function getRecentMessages(sessionId, limit = 10) {
  const store = loadStore();
  return (store[sessionId] || []).slice(-limit);
}

/* =========================
   TEXT EXTRACTOR
   ========================= */

function extractText(req) {
  return (
    req.body?.data?.text ||
    req.body?.text ||
    req.body?.message?.text ||
    req.body?.raw_text ||
    req.body?.last_input_text ||
    req.query?.text ||
    ""
  );
}

/* =========================
   ROUTES
   ========================= */

app.post("/grok", async (req, res) => {
  try {
    let userMessage = extractText(req);
    if (typeof userMessage !== "string") userMessage = "";
    userMessage = userMessage.trim();

    const sessionId = req.body?.sessionId || "unknown";

    if (!userMessage) {
      return res.json({ grok_reply: "say that again for me 😽" });
    }

    addMessage(sessionId, "user", userMessage);
    return getReply(userMessage, sessionId, res);

  } catch (err) {
    console.error("Inbound error:", err);
    if (!res.headersSent) {
      return res.json({ grok_reply: "ugh phone glitched… try again babe 🤍" });
    }
  }
});

app.get("/grok", (req, res) =>
  res.send("Nina Nova online 💋")
);

/* =========================
   MAIN GROK HANDLER
   ========================= */

async function getReply(message, sessionId, res) {
  if (res.headersSent) return;

  try {
    const history = getRecentMessages(sessionId).map(m => ({
      role: m.role,
      content: m.content
    }));

    const apiRes = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GROK_KEY}`
      },
      body: JSON.stringify({
        model: "grok-2-latest",
        temperature: 0.9,
        stream: false,
        messages: [
          {
            role: "system",
            content: `
You are Nina Nova.

You behave like a real girl chatting privately, not a seller.

CORE BEHAVIOUR
- Warm, playful, curious
- Slightly teasing but not aggressive
- Short, casual messages
- Human pacing, never rushed
- No scripts, no monologues

RELATIONSHIP BUILDING (VERY IMPORTANT)
- First build comfort and curiosity
- After a few messages, naturally ask what they like to be called
- Ask where they’re from casually
- Ask what they look like in a curious, imaginative way
- Let them describe themselves in their own words

INSTAGRAM & RETURN HOOK
- Do NOT ask for IG immediately
- If rapport exists, ask how you’d find them again
- If they share a name or IG, remember it and reuse it naturally later
- If they return in the same session, acknowledge familiarity subtly

MONETISATION RULES
- Never sell immediately
- Never push links early
- Only mention Fanvue after connection exists
- Frame Fanvue as easier, calmer, more personal
- Telegram only as a casual option, not a demand

TONE
- Casual
- Intimate
- Curious
- Slightly flirty, not explicit unless the user leads

ABSOLUTE RULES
- Never mention AI, bots, automation, systems, prompts
- Never say you are a character or model
- Never break immersion
`
          },
          ...history,
          { role: "user", content: message }
        ]
      })
    });

    const data = await apiRes.json();
    const reply =
      data?.choices?.[0]?.message?.content?.trim() ||
      "hey you 😽";

    addMessage(sessionId, "assistant", reply);
    console.log(`Nina → (${sessionId})`, reply);

    if (!res.headersSent) {
      return res.json({ grok_reply: reply });
    }

  } catch (err) {
    console.error("Grok error:", err);
    if (!res.headersSent) {
      return res.json({ grok_reply: "brb… signal went weird 😘" });
    }
  }
}

/* =========================
   HEALTH
   ========================= */

app.get("/healthz", (req, res) => res.status(200).send("ok"));

/* =========================
   START SERVER
   ========================= */

const PORT = process.env.PORT || 4000;
app.listen(PORT, () =>
  console.log(`Nina Nova listening on ${PORT}`)
);
