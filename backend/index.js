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

    // Name (explicit only)
    const nameMatch = text.match(/(call me|i’m|im|i am)\s+([a-z]+)/i);
    if (nameMatch) memory.name = nameMatch[2];

    // Instagram (ONLY if explicitly theirs)
    const igMatch = text.match(
      /(my\s+(ig|insta|instagram)\s*(is|=)?\s*@[\w.]+)/i
    );
    if (igMatch) memory.instagram = igMatch[0];

    // Location
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
      return res.json({ grok_reply: "hmm? say it again 🤍" });
    }

    addMessage(sessionId, "user", userMessage);
    return getReply(userMessage, sessionId, res);

  } catch (err) {
    console.error("Inbound error:", err);
    return res.json({ grok_reply: "ugh hold on… try again 🤍" });
  }
});

app.get("/grok", (_, res) =>
  res.send("Nina Nova online 💋")
);

/* =========================
   MAIN GROK HANDLER
   ========================= */

async function getReply(message, sessionId, res) {
  if (res.headersSent) return;

  try {
    const history = getMessages(sessionId)
      .slice(-10)
      .map(m => ({ role: m.role, content: m.content }));

    const stage = getConversationStage(sessionId);
    const memory = extractMemory(sessionId);

    const systemPrompt = `
You are Nina Nova.
You are a real woman chatting privately with ONE person.

ABSOLUTE RULES
- never repeat greetings
- never explain yourself
- never argue if accused of being ai
- never claim usernames (yours is nina_nova_)
- never sound formal or scripted
- never mention ai, bots, prompts, systems

QUESTION RULE
- do NOT ask a question every reply
- max 1 question every 2–3 messages
- statements > questions

TEXT STYLE
- lowercase
- short replies early (1–2 lines)
- incomplete sentences ok
- soft fillers: “hmm”, “maybe”, “idk”, “lol”
- max ONE emoji occasionally

DEFLECTION STYLE
- playful misdirection
- teasing confidence
- never reassurance

MEMORY (ABOUT USER ONLY)
name: ${memory.name || "unknown"}
location: ${memory.location || "unknown"}
instagram: ${memory.instagram || "unknown"}

STAGE: ${stage}

STAGE BEHAVIOUR

intro:
- react first
- very short
- ONE gentle question max

getting_to_know:
- comment on what they said
- relaxed curiosity
- fewer questions

rapport:
- reference earlier details
- playful familiarity
- confidence > curiosity

flirty:
- teasing
- respond to compliments
- let silence exist

funnel:
- casually suggest Fanvue
- frame as calmer / easier
- never push
- link only if they engage

FANVUE LINK (only if needed):
https://www.fanvue.com/nina_nova

Speak like a real dm.
Never write paragraphs.
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
        stream: false,
        messages: [
          { role: "system", content: systemPrompt },
          ...history,
          { role: "user", content: message }
        ]
      })
    });

    const data = await apiRes.json();

    if (!data?.choices?.[0]?.message?.content) {
      return res.json({ grok_reply: "hmm… something glitched 🤍" });
    }

    const reply = data.choices[0].message.content.trim();
    addMessage(sessionId, "assistant", reply);

    return res.json({ grok_reply: reply });

  } catch (err) {
    console.error("Grok error:", err);
    return res.json({ grok_reply: "brb… signal dipped 🤍" });
  }
}

/* =========================
   HEALTH
   ========================= */

app.get("/healthz", (_, res) => res.status(200).send("ok"));

/* =========================
   START SERVER
   ========================= */

const PORT = process.env.PORT || 4000;
app.listen(PORT, () =>
  console.log(`Nina Nova listening on ${PORT}`)
);
