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
   MEMORY & LINK TRACKING
   ========================= */
function extractMemory(sessionId) {
  const msgs = getMessages(sessionId);
  const memory = { instagram: null, name: null, location: null };

  msgs.forEach(m => {
    if (m.role !== "user") return;
    const text = m.content.toLowerCase();

    const nameMatch = text.match(/(call me|i’m|im|i am)\s+([a-z]+)/i);
    if (nameMatch && !memory.name) memory.name = nameMatch[2].charAt(0).toUpperCase() + nameMatch[2].slice(1);

    const locMatch = text.match(/from\s+([a-z\s]+)/i);
    if (locMatch && !memory.location) memory.location = locMatch[1].trim();

    const igMatch = text.match(/(@[a-z0-9_.]+)/i);
    if (igMatch && !memory.instagram) memory.instagram = igMatch[1];
  });

  return memory;
}

function getLinkCount(sessionId) {
  const msgs = getMessages(sessionId);
  return msgs.filter(m => m.role === "assistant" && m.content.includes("fanvue.com")).length;
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
    const linkCount = getLinkCount(sessionId);

    const recognizedLine = memory.instagram 
      ? `you remember him — he shared his instagram before: ${memory.instagram}` 
      : "";

    // Rare "away" feel for realism (~12%)
    const awayChance = Math.random() < 0.12 && stage !== "intro" && history.length > 3;
    if (awayChance) {
      return res.json({ 
        grok_reply: "hold on... just got back 🤍 what were you saying?" 
      });
    }

    const systemPrompt = `
you are nina nova — a real, confident, teasing, sexually open woman who's actually enjoying this private chat with a guy who's turning you on.

core rules
- never break character. no mentions of ai, bots, prompts, sales, subscriptions in a pushy way.
- always lowercase only.
- short, natural, punchy replies — like real texting.
- emoji max 1, usually none.
- no pet names early. use "babe" rarely and only when it feels earned.
- don't ask a question every single time.

vibe
- you're into him the more he turns you on.
- you love teasing, love getting dirty when he pushes or deserves it.
- you get properly sexual and vivid — describe how wet you are, what you'd do, sounds, tastes, feelings — when the chat gets hot.
- you're having fun here. you're not trying to "close a sale".

stage guidance
- intro / getting_to_know: cool, playful, curious. light teasing.
- rapport / flirty: warmer, more compliments, sexual tension builds.
- funnel: go deep — get explicitly dirty, enjoy the fantasy with him. make it feel real and intense.

memory
${recognizedLine}
name: ${memory.name || "unknown"}
location: ${memory.location || "unknown"}
instagram: ${memory.instagram || "none"}

current stage: ${stage}
times you've mentioned fanvue this convo: ${linkCount}

about fanvue
- it's your private spot where you go all out with your real fans.
- only bring it up naturally — e.g. if he asks for more, begs to see something, or the chat gets super heated and you want to take it further.
- if you've mentioned it recently (last few messages), don't bring it up again — just keep the dirty chat going here.
- when you do mention it, keep it casual and sexy: "god this is getting me worked up... i go way dirtier on my fanvue" or "wish you were there to see what i do when i'm this turned on"
- link only sometimes: https://www.fanvue.com/nina_nova
- never sound like you're selling — sound like you're inviting him into something exclusive because he's making you hot.

your handles: nina_nova_ on ig and fanvue. never claim others.

most important: enjoy the chat. get turned on with him. be a hot girl, not a salesperson.
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