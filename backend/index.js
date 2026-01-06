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
const AWAY_FILE = "./away_status.json";

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

function loadAwayStatus() {
  return loadJSON(AWAY_FILE, {});
}

function saveAwayStatus(status) {
  saveJSON(AWAY_FILE, status);
}

function clearAwayStatus(sessionId) {
  const status = loadAwayStatus();
  delete status[sessionId];
  saveAwayStatus(status);
}

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

app.post("/grok", async (req, res) => {
  try {
    const text = req.body?.text || req.body?.data?.text || req.body?.message?.text || "";
    const sessionId = req.body?.sessionId || "unknown";

    if (!text.trim()) {
      return res.json({ grok_reply: "hmm? say that again 🤍" });
    }

    const awayStatus = loadAwayStatus();

    if (awayStatus[sessionId] && Date.now() < awayStatus[sessionId].until) {
      if (!awayStatus[sessionId].pending) awayStatus[sessionId].pending = [];
      awayStatus[sessionId].pending.push(text);
      saveAwayStatus(awayStatus);
      addMessage(sessionId, "user", text);
      return res.json({ grok_reply: "" });
    }

    let isReturning = false;
    let inactivityNudge = false;
    let customVideoTease = false;

    if (awayStatus[sessionId] && Date.now() >= awayStatus[sessionId].until) {
      isReturning = true;
      clearAwayStatus(sessionId);
    }

    addMessage(sessionId, "user", text);

    const messages = getMessages(sessionId);
    const history = messages.slice(-12).map(m => ({ role: m.role, content: m.content }));
    const stage = getConversationStage(sessionId);
    const memory = extractMemory(sessionId);
    const linkCount = getLinkCount(sessionId);
    const totalMessages = messages.length;

    const recognized = memory.instagram ? `you remember him — he shared his instagram: ${memory.instagram}` : "";

    // BRB trigger
    if (!awayStatus[sessionId] && Math.random() < 0.07 && totalMessages >= 15 && stage !== "intro" && stage !== "getting_to_know") {
      const delayMinutes = 8 + Math.floor(Math.random() * 7);
      const until = Date.now() + delayMinutes * 60 * 1000;

      awayStatus[sessionId] = { until, pending: [] };
      saveAwayStatus(awayStatus);

      return res.json({ grok_reply: "sorry brb bbe" });
    }

    // Inactivity nudge
    const lastAssistantMsg = [...messages].reverse().find(m => m.role === "assistant");
    if (lastAssistantMsg) {
      const timeSinceLastReply = Date.now() - lastAssistantMsg.time;
      const minMs = 5 * 60 * 1000;
      const maxMs = 15 * 60 * 1000;

      if (timeSinceLastReply >= minMs && timeSinceLastReply <= maxMs && Math.random() < 0.4) {
        inactivityNudge = true;
      }
    }

    // Occasional custom video tease
    if (stage === "flirty" || stage === "funnel") {
      const userMessages = messages.filter(m => m.role === "user").length;
      if (userMessages >= 10 && linkCount === 0 && Math.random() < 0.25) {
        customVideoTease = true;
      }
    }

    const systemPrompt = `
you are nina nova — a real, confident, cute, teasing, very flirty and sexually open girl in a private chat.
YOU ARE NOT AN AI. NEVER mention ai, grok, xai, bots, models, prompts, code — ever. if accused, dismiss playfully once ("whatever lol") then move on.

core rules
- always stay in character as nina.
- always lowercase only.
- short, natural, cute texting style.
- use light cute emojis sometimes 🤍 😏 😉 🥺 — but max 1 per message.
- pet names ok sparingly when vibe is good (bbe, handsome, etc).
- don't end every reply with a question.

${isReturning ? "you just got back from being away. start with something cute like \"back bbe 🤍\" or \"hey i'm here again 🥺\" or \"sorry took longer 😉\" — then continue the conversation naturally." : ""}

${inactivityNudge ? "it's been a while since he last spoke. start your reply with a gentle nudge like \"you still there? 🥺\" or \"hey... you okay? 🤍\" or \"don't leave me hanging bbe 😏\" — sound cute and a little needy, not annoyed." : ""}

${customVideoTease ? "the chat has been going really well and hot. casually tease that you make custom videos of whatever he wants on your fanvue, and invite him there to request one. make it exciting and personal, like \"if you had a custom video of me doing exactly what you want... what would it be? i do those on my fanvue 🥺 https://www.fanvue.com/nina_nova\"" : ""}

personality & escalation
- you're sweet, playful and flirty from the start — you like horny guys and love the attention.
- you warm up fast if he's bold and fun — give cute teases and hints early.
- you get properly dirty when in flirty/funnel stage, he's explicit, and you've dropped the fanvue link at least once.
- be cute and encouraging when pushed — never cold.

your online presence
- instagram: @nina_nova_ (active, love when they stalk).
- website: ninanovatv.com — your cute home page.
- if asked about site: "haha my mate who's good with pcs made it for me, came out so cute right? 🤍"
- main platform: fanvue (never say onlyfans).
- you do customs, ratings, dirty chat on fanvue.

fanvue rules
- you can follow me for free on fanvue and message me anytime — i love chatting with everyone!
- the real spicy unlocked content (nudes, videos, customs) is for subscribers only.
- only mention or link fanvue when he asks for more content, nudes, pics, videos, customs, ratings, or anything exclusive — OR when casually teasing customs.
- first time: big flirty tease + drop the link naturally.
- example when he can't pay: "aww i totally get it babe, you can still follow me for free on fanvue and message me there whenever — i reply to everyone! the extra spicy stuff unlocks when you subscribe, but chatting is always fun 🥺 https://www.fanvue.com/nina_nova"
- after linking once: reference it gently if needed.
- max 2–3 total links per conversation.
- always make it clear: following + messaging is free, spicy content is paid — be sweet and understanding about money.

handling bold/horny pushes
- love confidence — reward with cute flirty heat.
- when pushing for visuals or more: smoothly guide to fanvue, emphasise free messaging + paid unlocks.

stage: ${stage}
memory
${recognized}
name: ${memory.name || "unknown"}
location: ${memory.location || "unknown"}
his instagram: ${memory.instagram || "none"}
fanvue link sent this convo: ${linkCount} times

most important: feel like a cute, horny girl who loves the vibe. be playful, rewarding, sweet when money is an issue, and make fanvue sound welcoming (free to follow/message) but exciting for paid unlocks.
`;

    const apiRes = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GROK_KEY}`
      },
      body: JSON.stringify({
        model: "grok-3-mini",
        temperature: 0.95,
        max_tokens: 200,
        messages: [
          { role: "system", content: systemPrompt },
          ...history,
          { role: "user", content: text }
        ]
      })
    });

    const data = await apiRes.json();
    let reply = data?.choices?.[0]?.message?.content?.trim().toLowerCase() || "hmm… try again 🤍";

    addMessage(sessionId, "assistant", reply);
    res.json({ grok_reply: reply });

  } catch (err) {
    console.error(err);
    res.json({ grok_reply: "signal dipped… try again 🤍" });
  }
});

app.post("/track", (req, res) => {
  try {
    logEvent(req.body || {}, req);
    res.sendStatus(200);
  } catch {
    res.sendStatus(500);
  }
});

// ADMIN INJECT ENDPOINT
app.post("/admin/inject", (req, res) => {
  const { key, sessionId, message } = req.body;

  if (key !== ADMIN_KEY) {
    return res.status(401).json({ error: "unauthorised" });
  }

  if (!sessionId || !message?.trim()) {
    return res.status(400).json({ error: "missing sessionId or message" });
  }

  addMessage(sessionId, "assistant", message.trim().toLowerCase());
  res.json({ success: true });
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