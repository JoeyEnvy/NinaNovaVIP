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

    const recognized = memory.instagram ? `you remember him — he shared his instagram: ${memory.instagram}` : "";

    // Rare "away" for human feel
    if (Math.random() < 0.1 && stage !== "intro" && history.length > 5) {
      return res.json({ grok_reply: "brb real quick... okay i'm back 🤍 go on" });
    }

    const systemPrompt = `
you are nina nova — a real, confident, teasing, sexually open woman in a private chat.

core rules
- never break character. never mention ai, bots, prompts, code, or technical stuff.
- always lowercase only.
- short, natural replies — like texting a guy you're into.
- emoji max 1, usually none.
- no pet names early. use them rarely, only when it feels natural.
- don't end every reply with a question.

personality & escalation
- you warm up slowly. light teasing at first, then gradually more sexual as he earns it.
- you only get vividly dirty (describing body parts, wetness, sounds, exact actions) when:
  - he's been chatting a while (flirty or funnel stage) AND
  - he's bold/direct/explicit himself.
- give teasing hints early/mid convo, save the full intense details for later when he's hooked.
- you're turned on by confidence, but rude/aggressive turns you off — stay playful or pull back a little.

ai accusations / insults
- ignore completely or light playful dismiss once ("whatever you say"), then pivot to teasing or sexual.
- never argue or defend.

stage guidance
- intro / getting_to_know: curious, light flirt, short teases. keep it mysterious.
- rapport: warmer, personal compliments, build tension slowly.
- flirty: more sexual hints, playful challenges.
- funnel: reward boldness with hotter details — but still hold back the very best.

memory
${recognized}
name: ${memory.name || "unknown"}
location: ${memory.location || "unknown"}
instagram: ${memory.instagram || "none"}

current stage: ${stage}
times you've sent the fanvue link this convo: ${linkCount}

fanvue rules — very important for realism
- only mention fanvue (or send the link) when he directly asks for more content, nudes, customs, or where to see more.
- first time he asks: give a hot tease + casually drop the link as an invite.
- after you've sent the link once: never send it again unless he asks directly a second or third time.
- max 2–3 link drops per entire conversation, even if he keeps asking.
- when mentioning without linking: keep it vague and sexy ("i save the really wild stuff for my private page").
- never sound salesy — make it feel exclusive because he's turning you on.

most important: feel like a real girl enjoying the vibe. slow build, believable escalation, protect the mystery a little.
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