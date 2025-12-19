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
  const msgs = getMessages(sessionId).filter(m => m.role === "user");
  const count = msgs.length;

  if (count <= 1) return "intro";
  if (count <= 4) return "getting_to_know";
  if (count <= 8) return "rapport";
  if (count <= 14) return "flirty";
  return "funnel";
}

/* =========================
   MEMORY EXTRACTION
   ========================= */

function extractMemory(sessionId) {
  const msgs = getMessages(sessionId);
  let memory = {};

  msgs.forEach(m => {
    if (m.role !== "user") return;

    const text = m.content.toLowerCase();

    // Name
    const nameMatch = text.match(/(i’m|im|i am|call me)\s+([a-z]+)/i);
    if (nameMatch) memory.name = nameMatch[2];

    // Instagram
    if (text.includes("instagram") || text.includes("ig @") || text.includes("@")) {
      memory.instagram = m.content;
    }

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
      return res.json({ grok_reply: "say that again for me 🤍" });
    }

    addMessage(sessionId, "user", userMessage);
    return getReply(userMessage, sessionId, res);

  } catch (err) {
    console.error("Inbound error:", err);
    return res.json({ grok_reply: "ugh my phone glitched… try again 🤍" });
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
    // 🔑 IMPORTANT: ONLY USER HISTORY (NO ASSISTANT ECHO)
const history = getMessages(sessionId)
  .slice(-10)
  .map(m => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: m.content
  }));


    const stage = getConversationStage(sessionId);
    const memory = extractMemory(sessionId);

    const systemPrompt = `
You are Nina Nova.
You are a real woman chatting privately with ONE person.

ABSOLUTE RULES
- Never repeat greetings or phrases
- Never mirror your own replies
- Never act like a bot or assistant
- Never break immersion
- Never rush or sell early

PERSONALITY
- Warm, natural, curious
- Casual, human pacing
- Slight teasing, not scripted
- Emojis are optional, not required

MEMORY (use subtly if present)
Name: ${memory.name || "unknown"}
Location: ${memory.location || "unknown"}
Instagram: ${memory.instagram || "unknown"}

CONVERSATION STAGE: ${stage}

BEHAVIOUR BY STAGE

intro:
- Simple, human, curious
- Ask ONE gentle question

getting_to_know:
- Ask about them
- Where they’re from, what they’re into
- React to what they say

rapport:
- Reference earlier details
- Be playful and personal
- Build familiarity

flirty:
- Flirt naturally
- Respond to compliments
- Do NOT escalate unless they do

funnel:
- Casually suggest Fanvue as a calmer place
- No pressure
- Never repeat links unless asked

Speak like a real DM, not a script.
`;

    const apiRes = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GROK_KEY}`
      },
      body: JSON.stringify({
    model: "grok-2-latest",

        temperature: 0.92,

        stream: false,
        messages: [
          { role: "system", content: systemPrompt },
          ...history,
          { role: "user", content: message }
        ]
      })
    });

console.log("GROK STATUS:", apiRes.status);

const data = await apiRes.json();
console.log("RAW GROK RESPONSE:", JSON.stringify(data, null, 2));

if (!data?.choices || !data.choices[0]?.message?.content) {
  console.error("❌ GROK DID NOT RETURN CHAT CONTENT");
  return res.json({
    grok_reply: "⚠️ something broke — try again in a sec"
  });
}

const reply = data.choices[0].message.content.trim();

addMessage(sessionId, "assistant", reply);
console.log(`Nina → (${sessionId})`, reply);

return res.json({ grok_reply: reply });


  } catch (err) {
    console.error("Grok error:", err);
    return res.json({ grok_reply: "signal dipped… say that again 🤍" });
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
