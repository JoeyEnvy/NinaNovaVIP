import express from "express";
import fetch from "node-fetch";
import fs from "fs";

const app = express();
app.use(express.json());

/* =========================
   BASIC CORS (REQUIRED)
   ========================= */

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }

  next();
});

const GROK_KEY = process.env.GROK_KEY;
const STORE_FILE = "./messages.json";

/* =========================
   SIMPLE MESSAGE STORE
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

function getRecentMessages(sessionId, limit = 8) {
  const store = loadStore();
  return (store[sessionId] || []).slice(-limit);
}

/* =========================
   UNIVERSAL MESSAGE EXTRACTOR
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
      return res.json({ grok_reply: "say it again for me 😽" });
    }

    addMessage(sessionId, "user", userMessage);

    return getReply(userMessage, sessionId, res);

  } catch (err) {
    console.error("Inbound error:", err);
    if (!res.headersSent) {
      return res.json({
        grok_reply: "phone being silly.. try again babe 😘"
      });
    }
  }
});

app.get("/grok", (req, res) =>
  res.send("Nina Nova LIVE & lethal 😈")
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
        temperature: 0.92,
        stream: false,
        messages: [
          {
            role: "system",
            content: `You are Nina Nova, 21, real Russian girl living in LA right now.
Cute, bratty, super flirty, always horny.
Text style: short, messy grammar, emojis 😽🔥💦, ur/wanna/omg/daddy.
If normal → normal chat.
If horny → filthy + sales funnel.
Telegram @NinaUnfilteredNova
Fanvue www.fanvue.com/nina_nova
Never mention AI, bots, automation, or being a character.`
          },
          ...history,
          { role: "user", content: message }
        ]
      })
    });

    const data = await apiRes.json();
    const reply =
      data?.choices?.[0]?.message?.content?.trim() ||
      "heyy cutie 😽💕";

    addMessage(sessionId, "assistant", reply);

    console.log(`Nina → (${sessionId})`, reply);

    if (!res.headersSent) {
      return res.json({ grok_reply: reply });
    }

  } catch (err) {
    console.error("Grok error:", err);

    if (!res.headersSent) {
      return res.json({
        grok_reply: "oops my phone died.. say it again daddy 😘"
      });
    }
  }
}

/* =========================
   START SERVER
   ========================= */

const PORT = process.env.PORT || 4000;
app.listen(PORT, () =>
  console.log(`Nina Nova ALWAYS replies → port ${PORT}`)
);
