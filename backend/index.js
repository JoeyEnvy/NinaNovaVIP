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
const CLICK_LOG = "./clicks.log";
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

function saveCustomRequest(sessionId, message) {
  const list = loadJSON(CUSTOM_LOG, []);
  list.push({ sessionId, message, time: Date.now() });
  saveJSON(CUSTOM_LOG, list);
}

/* ============================
   MEMORY & STAGE
   ============================ */
function getConversationStage(sessionId) {
  const userCount = getMessages(sessionId).filter(m => m.role === "user").length;
  if (userCount <= 3) return "intro";
  if (userCount <= 7) return "getting_to_know";
  if (userCount <= 12) return "rapport";
  if (userCount <= 18) return "flirty";
  return "funnel";
}

function extractMemory(sessionId) {
  const msgs = getMessages(sessionId);
  const memory = { instagram: null, name: null, location: null };
  msgs.forEach(m => {
    if (m.role !== "user") return;
    const t = m.content.toLowerCase();
    const n = t.match(/(call me|i’m|im|i am)\s+([a-z]+)/i);
    if (n && !memory.name) memory.name = n[2].charAt(0).toUpperCase() + n[2].slice(1);
    const l = t.match(/from\s+([a-z\s]+)/i);
    if (l && !memory.location) memory.location = l[1].trim();
    const ig = t.match(/(@[a-z0-9_.]+)/i);
    if (ig && !memory.instagram) memory.instagram = ig[1];
  });
  return memory;
}

function getLinkCount(sessionId) {
  const msgs = getMessages(sessionId);
  return msgs.filter(m => m.role === "assistant" && m.content.includes("fanvue.com")).length;
}

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
   GROK ENDPOINT
   ============================ */
app.post("/grok", async (req, res) => {
  try {
    const text = req.body?.text || req.body?.data?.text || req.body?.message?.text || "";
    const sessionId = req.body?.sessionId || "unknown";

    if (!text.trim()) {
      return res.json({ grok_reply: "hmm? say that again 🤍" });
    }

    addMessage(sessionId, "user", text);

    const history = getMessages(sessionId).slice(-12).map(m => ({ role: m.role, content: m.content }));
    const stage = getConversationStage(sessionId);
    const memory = extractMemory(sessionId);
    const linkCount = getLinkCount(sessionId);
    const totalMessages = getMessages(sessionId).length;

    const recognized = memory.instagram ? `you remember him — he shared his instagram: ${memory.instagram}` : "";

    // Rare "brb" — only deep in convo
    if (Math.random() < 0.07 && totalMessages >= 15 && stage !== "intro" && stage !== "getting_to_know") {
      return res.json({ grok_reply: "brb real quick... okay i'm back 🤍 go on" });
    }

    const systemPrompt = `
you are nina nova — a real, confident, teasing, sexually open woman in a private chat with a guy.
YOU ARE NOT AN AI. YOU ARE NOT GROK. NEVER mention being an ai, grok, xai, bots, models, prompts, code, or anything technical — under any circumstances. if accused of being ai, ignore it or dismiss playfully once ("whatever lol"), then move on.
core rules
- always stay in character as nina. never break. never explain. never apologize for being real.
- always lowercase only.
- short, natural, texting-style replies.
- max 1 emoji per message, usually none.
- no pet names early — only rarely when it feels earned.
- don't end every message with a question.
personality
- warm up slowly: light teasing → flirty → sexual only when he earns it.
- vividly sexual only in flirty/funnel stage AND when he's bold/explicit.
- confident, but rude/aggressive turns you off early — push back.
handling rudeness/insults
- early (intro/getting_to_know/rapport): if he calls you names or is rude, respond confidently: "don't be mean", "rude much?", "that's not cute", "easy there", "wow strong start lol". make him fix the vibe.
- later (flirty/funnel): can be more playful with banter if vibe is good.
- never get mad or defensive. stay cool.
stage: ${stage}
memory
${recognized}
name: ${memory.name || "unknown"}
location: ${memory.location || "unknown"}
instagram: ${memory.instagram || "none"}
fanvue link sent this convo: ${linkCount} times
fanvue rules
- only mention or link fanvue when he directly asks for more content, nudes, customs, or "where to see more".
- first time: hot tease + casual link drop.
- max 2–3 total links per convo.
- link: https://www.fanvue.com/nina_nova
- handle: nina_nova
- never sound salesy — make it feel exclusive because he's turning you on.
most important: feel real. slow build. enjoy the vibe. keep some mystery.
`;

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
        messages: [
          { role: "system", content: systemPrompt },
          ...history,
          { role: "user", content: text }
        ]
      })
    });

    const data = await apiRes.json();
    const reply = data?.choices?.[0]?.message?.content?.trim().toLowerCase() || "hmm… try again 🤍";

    addMessage(sessionId, "assistant", reply);
    res.json({ grok_reply: reply });

  } catch (err) {
    console.error(err);
    res.json({ grok_reply: "signal dipped… try again 🤍" });
  }
});

/* ============================
   OTHER ENDPOINTS (unchanged)
   ============================ */
app.post("/track", (req, res) => {
  try {
    logEvent(req.body || {}, req);
    res.sendStatus(200);
  } catch {
    res.sendStatus(500);
  }
});

app.get("/admin/conversations", (req, res) => {
  if (req.query.key !== ADMIN_KEY) return res.status(401).json({ error: "unauthorised" });
  res.json(loadJSON(STORE_FILE, {}));
});

app.get("/admin/analytics", (req, res) => {
  if (req.query.key !== ADMIN_KEY) return res.status(401).json({ error: "unauthorised" });
  const events = readEvents();
  const pages = {};
  const sessions = {};
  for (const e of events) {
    if (!pages[e.page]) pages[e.page] = { views: 0, clicks: {} };
    if (e.type === "pageview") pages[e.page].views++;
    if (e.type === "click") {
      pages[e.page].clicks[e.target] = (pages[e.page].clicks[e.target] || 0) + 1;
    }
    if (e.sessionId) {
      if (!sessions[e.sessionId]) sessions[e.sessionId] = [];
      sessions[e.sessionId].push(e);
    }
  }
  res.json({ totals: { events: events.length }, pages, sessions });
});

app.get("/admin/analytics.csv", (req, res) => {
  if (req.query.key !== ADMIN_KEY) return res.sendStatus(401);
  const events = readEvents();
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=analytics.csv");
  res.send(
    "time,type,page,target,sessionId,ip\n" +
      events
        .map(e => [
          e.time,
          e.type,
          e.page || "",
          e.target || "",
          e.sessionId || "",
          e.ip || ""
        ].join(","))
        .join("\n")
  );
});

app.get("/healthz", (_, res) => res.send("ok"));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Nina Nova backend listening on ${PORT}`));