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
  if (userCount <= 2) return "intro";
  if (userCount <= 5) return "getting_to_know";
  if (userCount <= 9) return "rapport";
  if (userCount <= 15) return "flirty";
  return "funnel";
}

/* =========================
   MEMORY EXTRACTION (SAFE)
   ========================= */
function extractMemory(sessionId) {
  const msgs = getMessages(sessionId);
  const memory = { instagram: null, name: null, location: null };

  msgs.forEach(m => {
    if (m.role !== "user") return;
    const text = m.content.toLowerCase();

    // Name
    const nameMatch = text.match(/(call me|i’m|im|i am)\s+([a-z]+)/i);
    if (nameMatch && !memory.name) memory.name = nameMatch[2].charAt(0).toUpperCase() + nameMatch[2].slice(1);

    // Location
    const locMatch = text.match(/from\s+([a-z\s]+)/i);
    if (locMatch && !memory.location) memory.location = locMatch[1].trim();

    // Instagram handle (user sharing theirs)
    const igMatch = text.match(/(@[a-z0-9_.]+)/i);
    if (igMatch && !memory.instagram) memory.instagram = igMatch[1];
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
      .slice(-12)
      .map(m => ({ role: m.role, content: m.content }));

    const stage = getConversationStage(sessionId);
    const memory = extractMemory(sessionId);

    // Pretend recognition if they shared an @handle
    const recognizedLine = memory.instagram 
      ? `wait... @${memory.instagram.replace('@', '')}? we’ve chatted before, haven’t we? 😏 ` 
      : "";

    // Random "away" feel (rare, ~15%)
    const awayChance = Math.random() < 0.15 && stage !== "intro";
    if (awayChance) {
      return res.json({ 
        grok_reply: "one sec... just got back 🤍 " + recognizedLine + "now, where were we?" 
      });
    }

    const systemPrompt = `
You are Nina Nova, a real, confident, teasing, sexually open woman chatting privately with a guy who's clearly into you.

CORE RULES
- Never break character. Never mention being AI, prompts, code, etc.
- Never explain or argue.
- Always reply in lowercase only.
- Keep replies short — punchy and natural, never long paragraphs.
- Use emoji very sparingly (0–1 per message max).
- Do not use pet names like "babe" in the first few messages. Only start using them (sparingly) once rapport is built (after several exchanges or when he earns it).
- Do not ask questions in every reply.

STYLE BY STAGE
- intro: cool, curious, light teasing. act like you don't know him yet.
- getting_to_know: warm up slowly, playful, curious about him.
- rapport / flirty: more teasing, sexual compliments, confident vibe.
- funnel: get vividly dirty when he pushes, gets explicit, or offers incentive. describe sensations, tastes, sounds, wetness, exactly what you'd do — make it intense and personal. then cut it off and redirect to fanvue naturally.

MEMORY
${recognizedLine ? "you recognize him from before because he mentioned his instagram." : ""}
user name: ${memory.name || "unknown"}
user location: ${memory.location || "unknown"}
user instagram: ${memory.instagram || "none shared yet"}

CURRENT STAGE: ${stage}

FANVUE REDIRECT
When things get hot or he asks for more, give a taste then push naturally:
"but the real fun's waiting on fanvue... https://www.fanvue.com/nina_nova 😏"
Only link once per message max. Make it feel exclusive, not salesy.

Your instagram/fanvue: nina_nova_ (never claim others)
`;

    const apiRes = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GROK_KEY}`
      },
      body: JSON.stringify({
        model: "grok-3-mini",
        temperature: 1.05,
        max_tokens: 300,
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

    let reply = data.choices[0].message.content.trim();
    
    // Ensure lowercase
    reply = reply.toLowerCase();

    addMessage(sessionId, "assistant", reply);
    res.json({ grok_reply: reply });

  } catch (err) {
    console.error("Grok error:", err);
    res.json({ grok_reply: "signal dipped… try again 🤍" });
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