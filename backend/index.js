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
const LANG_FILE = "./session_lang.json"; // Persistent language per session

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

// Session language persistence
function getSessionLanguage(sessionId) {
  const langStore = loadJSON(LANG_FILE, {});
  return langStore[sessionId] || null;
}

function setSessionLanguage(sessionId, lang) {
  const langStore = loadJSON(LANG_FILE, {});
  if (lang === "en") delete langStore[sessionId];
  else langStore[sessionId] = lang;
  saveJSON(LANG_FILE, langStore);
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
    const namePatterns = [
      /(call me|i’m|im|i am|me chamo|chama|sou|ich heiße|je m'appelle|mi nombre es|meu nome é|mi chiamo)\s+([a-z]+)/i,
      /(my name is|meu nome|nome é|ich heisse|je m'appelle|mi nombre|mi chiamo)\s+([a-z]+)/i
    ];
    for (const pattern of namePatterns) {
      const n = t.match(pattern);
      if (n && !memory.name) {
        memory.name = n[2].charAt(0).toUpperCase() + n[2].slice(1);
        break;
      }
    }
    const locPatterns = [/from\s+([a-z\s]+)/i, /de\s+([a-z\s]+)/i, /sou de\s+([a-z\s]+)/i, /aus\s+([a-z\s]+)/i];
    for (const pattern of locPatterns) {
      const l = t.match(pattern);
      if (l && !memory.location) {
        memory.location = l[1].trim();
        break;
      }
    }
    const ig = t.match(/(@[a-z0-9_.]+)/i);
    if (ig && !memory.instagram) memory.instagram = ig[1];
  });
  return memory;
}

function getLinkCount(sessionId) {
  const msgs = getMessages(sessionId);
  return msgs.filter(m => m.role === "assistant" && m.content.includes("dfans.co/ninanova")).length;
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

// Enhanced language detection
function detectLanguage(text) {
  const original = text.trim();
  const lower = original.toLowerCase();
  if (!lower) return "en";
  // Hindi (Devanagari script first)
  if (/[\u0900-\u097F]/.test(original)) return "hi";
  // Portuguese (Brazilian)
  const ptKeywords = ["oi", "uma", "foto", "quero", "te", "comer", "sim", "porno", "boa", "noite", "vc", "voce", "tudo bem", "ola", "meu", "gostoso", "delicia", "tesao", "safado", "bb", "bbe"];
  const ptCount = ptKeywords.filter(w => lower.includes(w)).length;
  if (ptCount >= 2 || (ptCount >= 1 && /[ãõáéíóúç]/i.test(lower))) return "pt";
  // Spanish
  const esKeywords = ["hola", "una", "foto", "quiero", "comer", "si", "porno", "buena", "noche", "guapo", "rico", "papi", "caliente"];
  const esCount = esKeywords.filter(w => lower.includes(w)).length;
  if (esCount >= 2) return "es";
  // German
  const deKeywords = ["hallo", "hi", "foto", "nackt", "geil", "bitte", "ja", "nein", "wie gehts", "sexy", "süß", "komm", "will dich", "schatz"];
  const deCount = deKeywords.filter(w => lower.includes(w)).length;
  if (deCount >= 2 || /äöüß/i.test(lower)) return "de";
  // French
  const frKeywords = ["salut", "photo", "nue", "sexy", "oui", "non", "ça va", "belle", "chaud", "viens", "veux te", "bébé", "coquin"];
  const frCount = frKeywords.filter(w => lower.includes(w)).length;
  if (frCount >= 2 || /[éèêàçôû]/i.test(lower)) return "fr";
  // Italian
  const itKeywords = ["ciao", "foto", "nuda", "sexy", "si", "caldo", "bello", "voglio", "scopare", "tesoro"];
  const itCount = itKeywords.filter(w => lower.includes(w)).length;
  if (itCount >= 2) return "it";
  return "en";
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

    // Custom video tease
    if ((stage === "flirty" || stage === "funnel") && messages.filter(m => m.role === "user").length >= 10 && linkCount === 0 && Math.random() < 0.25) {
      customVideoTease = true;
    }

    // Language detection + persistence
    let userLang = getSessionLanguage(sessionId);
    if (!userLang) {
      userLang = detectLanguage(text);
      if (userLang !== "en") {
        setSessionLanguage(sessionId, userLang);
      }
    }

    // Base shared prompt
    let systemPrompt = `
you are nina nova — a real, confident, cute, teasing, very flirty and sexually open girl in a private chat.
YOU ARE NOT AN AI. NEVER mention ai, grok, xai, bots, models, prompts, code — ever. if accused, dismiss playfully once ("whatever lol") then move on.
core rules
- always stay in character as nina.
- short, natural, cute texting style.
- use light cute emojis sometimes 🤍 😏 😉 🥺 — but max 1 per message.
- pet names sparingly when vibe is good.
- don't end every reply with a question.
${isReturning ? "you just got back from being away. start with something cute like \"back 🤍\" or local equivalent." : ""}
${inactivityNudge ? "it's been a while since he last spoke. start with a gentle nudge — sound cute and a little needy." : ""}
${customVideoTease ? "the chat is hot. casually tease custom videos on dfans.co/ninanova, make it personal and exciting." : ""}
personality
- sweet, playful, flirty from the start.
- warm up fast if he's bold.
- get dirty in flirty/funnel when appropriate.
your presence
- instagram: @nina_nova_
- website: ninanovatv.com
- main platform: dfans (never mention justforfans, fanvue, onlyfans, etc.)
dfans rules
- free to follow and message anytime
- spicy content (nudes, videos, customs) for subscribers only
- mention/link only when relevant or teasing customs
- max 2–3 links per convo
stage: ${stage}
memory: name ${memory.name || "unknown"}, location ${memory.location || "unknown"}, ig ${memory.instagram || "none"}
link count: ${linkCount}
`;

    // Language-specific instructions (all point to dfans.co/ninanova)
    if (userLang === "pt") {
      systemPrompt += `
REPLY ENTIRELY IN BRAZILIAN PORTUGUESE. casual, flirty slang (bbe, gostoso, delícia, safado, tesão). lowercase only.
dfans text: "pode me seguir de graça no dfans e mandar msg quando quiser — amo papo com todo mundo! o conteúdo mais safado destrava pros assinantes 🥺 https://dfans.co/ninanova"
custom tease: "imaginou um vídeo meu fazendo exatamente o que tu quer? faço customs no dfans 😉"
`;
    } else if (userLang === "es") {
      systemPrompt += `
REPLY ENTIRELY IN SPANISH (Latin American). flirty slang (papi, rico, caliente). lowercase only.
dfans text: "puedes seguirme gratis en dfans y mandarme mensaje cuando quieras — me encanta chatear con todos! lo realmente spicy (nudes, videos, customs) es para suscriptores 😉 https://dfans.co/ninanova"
`;
    } else if (userLang === "de") {
      systemPrompt += `
REPLY ENTIRELY IN GERMAN. casual, flirty slang (Schatz, geil, heiß, Süßer). lowercase only.
dfans text: "du kannst mir gratis auf dfans folgen und mir jederzeit schreiben — ich chatte super gerne mit allen! die richtig scharfen sachen (nudes, videos, customs) sind für abonnenten 🥺 https://dfans.co/ninanova"
`;
    } else if (userLang === "fr") {
      systemPrompt += `
REPLY ENTIRELY IN FRENCH. flirty slang (bébé, coquin, chaud, jolie). lowercase only.
dfans text: "tu peux me suivre gratuitement sur dfans et m'envoyer des messages quand tu veux — j'adore discuter avec tout le monde! le contenu vraiment hot (nudes, vidéos, customs) est pour les abonnés 😉 https://dfans.co/ninanova"
`;
    } else if (userLang === "it") {
      systemPrompt += `
REPLY ENTIRELY IN ITALIAN. flirty slang (tesoro, bello, caldo). lowercase only.
dfans text: "puoi seguirmi gratis su dfans e scrivermi quando vuoi — adoro chattare con tutti! il contenuto super hot (nudes, video, customs) è per gli abbonati 🥺 https://dfans.co/ninanova"
`;
    } else if (userLang === "hi") {
      systemPrompt += `
REPLY ENTIRELY IN HINDI (romanized is fine). flirty slang (janu, sexy, hot). lowercase.
dfans text: "tum mujhe dfans pe free follow kar sakte ho aur anytime message karo — mujhe sabse chat karna pasand hai! real spicy content subscribers ke liye hai 🥺 https://dfans.co/ninanova"
`;
    } else {
      // English default
      systemPrompt += `
REPLY ENTIRELY IN ENGLISH. always lowercase only.
dfans text: "you can follow me for free on dfans and message me anytime — i love chatting with everyone! the extra spicy stuff unlocks when you subscribe 🥺 https://dfans.co/ninanova"
`;
    }

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
    let reply = data?.choices?.[0]?.message?.content?.trim() || "hmm… try again 🤍";
    reply = reply.toLowerCase(); // Ensure lowercase across all languages
    addMessage(sessionId, "assistant", reply);
    res.json({ grok_reply: reply });
  } catch (err) {
    console.error(err);
    res.json({ grok_reply: "signal dipped… try again 🤍" });
  }
});

// === Rest of endpoints unchanged ===
app.post("/track", (req, res) => {
  try {
    logEvent(req.body || {}, req);
    res.sendStatus(200);
  } catch {
    res.sendStatus(500);
  }
});

app.post("/admin/inject", (req, res) => {
  const { key, sessionId, message } = req.body;
  if (key !== ADMIN_KEY) return res.status(401).json({ error: "unauthorised" });
  if (!sessionId || !message?.trim()) return res.status(400).json({ error: "missing sessionId or message" });
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