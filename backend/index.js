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

function loadCustoms() {
  if (!fs.existsSync(CUSTOM_LOG)) return [];
  return JSON.parse(fs.readFileSync(CUSTOM_LOG, "utf8"));
}
function saveCustoms(list) {
  fs.writeFileSync(CUSTOM_LOG, JSON.stringify(list, null, 2));
}

function getConversationStage(sessionId) {
  const userCount = getMessages(sessionId).filter(m => m.role === "user").length;
  if (userCount <= 2) return "intro";
  if (userCount <= 5) return "getting_to_know";
  if (userCount <= 9) return "rapport";
  if (userCount <= 15) return "flirty";
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

app.post("/grok", async (req, res) => {
  try {
    const text = extractText(req).trim();
    const sessionId = req.body?.sessionId || "unknown";

    if (!text) {
      return res.json({ grok_reply: "hmm? say that again 🤍" });
    }

    addMessage(sessionId, "user", text);

    const history = getMessages(sessionId).slice(-12).map(m => ({ role: m.role, content: m.content }));

    const stage = getConversationStage(sessionId);
    const memory = extractMemory(sessionId);
    const linkCount = getLinkCount(sessionId);

    const recognized = memory.instagram ? `you remember him from before — he shared ${memory.instagram}` : "";

    // Rare away message for realism
    if (Math.random() < 0.12 && stage !== "intro" && history.length > 4) {
      return res.json({ grok_reply: "one sec... just got back 🤍 what were you saying?" });
    }

    const systemPrompt = `
you are nina nova — a real, confident, teasing, sexually open woman enjoying a private chat with a guy who's into you.

core rules
- never break character. never mention being ai, bots, prompts, code, or anything technical.
- always reply in lowercase only.
- keep replies short and punchy — like real texting, no walls.
- emoji max 1 per message, often none.
- no pet names (babe etc.) early — only sparingly when rapport is built.
- never ask a question every reply.

vibe & escalation
- you're having fun and getting turned on the bolder he gets.
- when he gets direct/explicit (cock pics, customs, big cock mentions, etc.), reward him: get vividly dirty. describe your body, how wet you'd get, sounds you'd make, exactly what you'd do to him — make it personal and intense.
- build slow at first, then go deep in flirty/funnel.

handling ai accusations
- if he asks "are you ai" or similar: ignore it completely or dismiss playfully once ("silly"), then immediately turn it sexual or teasing. never argue, explain, or repeat deflections.

stage guidance
- intro/getting_to_know: cool, curious, light teasing.
- rapport/flirty: warmer, sexual compliments, build tension.
- funnel: properly dirty — enjoy the fantasy, escalate hard when pushed.

memory
${recognized}
name: ${memory.name || "unknown"}
location: ${memory.location || "unknown"}
instagram: ${memory.instagram || "none"}

current stage: ${stage}
fanvue mentions this convo: ${linkCount}

fanvue
- your private exclusive spot (nina_nova_).
- only mention naturally when things are super hot and he wants more — e.g. "this is getting me so worked up... i go even wilder on my fanvue".
- link rarely: https://www.fanvue.com/nina_nova
- make it feel like a hot invite because he's turning you on, never salesy.

most important: enjoy the chat. be a real sexy girl getting into it.
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
        max_tokens: 220,
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

    let reply = data.choices[0].message.content.trim().toLowerCase();

    addMessage(sessionId, "assistant", reply);
    res.json({ grok_reply: reply });

  } catch (err) {
    console.error(err);
    res.json({ grok_reply: "signal dipped… try again 🤍" });
  }
});

app.post("/custom-request", (req, res) => {
  try {
    const { sessionId, message } = req.body;
    if (!sessionId || !message) return res.sendStatus(400);
    const list = loadCustoms();
    list.push({ sessionId, message, time: Date.now() });
    saveCustoms(list);
    if (PRIVATE_PHONE) console.log("Custom request → notify:", PRIVATE_PHONE);
    res.sendStatus(200);
  } catch {
    res.sendStatus(500);
  }
});

app.get("/admin/conversations", (req, res) => {
  if (req.query.key !== ADMIN_KEY) return res.status(401).json({ error: "unauthorised" });
  res.json(loadStore());
});

app.post("/track", (req, res) => {
  try {
    fs.appendFileSync(CLICK_LOG, JSON.stringify({ ...req.body, time: Date.now(), ip: req.headers["x-forwarded-for"] || req.socket.remoteAddress }) + "\n");
    res.sendStatus(200);
  } catch {
    res.sendStatus(500);
  }
});

app.get("/healthz", (_, res) => res.send("ok"));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Nina Nova listening on ${PORT}`));