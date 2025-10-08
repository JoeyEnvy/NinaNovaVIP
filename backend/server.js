// backend/server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import nodemailer from "nodemailer"; // optional for future SMTP use

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

// --- Example in-memory database (temporary) ---
const DB = { members: [] };

// --- Helpers ---
function findByToken(token) {
  for (const m of DB.members) {
    const t = m.tokens?.find((x) => x.token === token);
    if (t) return { member: m, token: t };
  }
  return null;
}

function makeToken(email, days) {
  const token = Math.random().toString(36).substring(2);
  const expires = Date.now() + days * 24 * 60 * 60 * 1000;
  return { token, expires };
}

// --- Google Apps Script Email Sender (free) ---
async function sendAccessEmail(email, token) {
  const link = `${process.env.SITE_BASE}/members.html?token=${token}`;
  const body = `Here is your private access link:\n${link}\n\nIf you didn’t request this, ignore this email.`;

  const res = await fetch(process.env.GSCRIPT_WEBAPP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      subject: "Your NinaNovaVIP Access Link",
      body,
    }),
  });

  if (!res.ok) throw new Error(await res.text());
  console.log(`Access email sent to ${email}`);
  return true;
}

function upsertMember(email) {
  let member = DB.members.find((m) => m.email === email);
  if (!member) {
    member = { email, status: "inactive", tokens: [], purchases: [] };
    DB.members.push(member);
  }
  return member;
}

function futureDays(days) {
  return Date.now() + days * 24 * 60 * 60 * 1000;
}

// --- Routes ---
app.get("/", (_, res) => res.json({ ok: true }));

app.get("/api/verify", (req, res) => {
  const token = String(req.query.token || "");
  const hit = findByToken(token);
  if (!hit) return res.json({ valid: false });

  const { member, token: t } = hit;
  const active =
    member.status === "active" && (member.expiry || 0) > Date.now();
  const valid = active && t.used === false && t.expires > Date.now();
  return res.json({ valid });
});

app.post("/api/resend", async (req, res) => {
  const email = String(req.body.email || "").trim();
  if (!email)
    return res.status(400).json({ ok: false, message: "Missing email" });

  const member = DB.members.find(
    (x) => x.email.toLowerCase() === email.toLowerCase()
  );
  if (
    !member ||
    member.status !== "active" ||
    (member.expiry || 0) < Date.now()
  ) {
    return res.json({ ok: false, message: "No active membership found" });
  }

  const { token } = makeToken(email, 7);
  try {
    await sendAccessEmail(email, token);
    return res.json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, message: "Email failed" });
  }
});

app.post("/api/postback", (req, res) => {
  const { email, product, action } = req.body || {};
  if (!email) return res.status(400).json({ ok: false });

  let m = upsertMember(email);

  if (product === "monthly") {
    if (action === "signup" || action === "rebill") {
      m.status = "active";
      m.plan = "monthly";
      m.expiry = futureDays(30);
    } else if (action === "cancel") {
      m.status = "inactive";
    }
  } else {
    if (!m.purchases.includes(product)) m.purchases.push(product);
  }

  if (action === "signup" || action === "rebill" || action === "purchase") {
    const { token } = makeToken(email, 7);
    sendAccessEmail(email, token).catch(console.error);
  }

  return res.json({ ok: true });
});

// --- Test Email Endpoint (uses Google Script) ---
app.get("/api/test-email", async (req, res) => {
  try {
    const from = process.env.FROM_EMAIL || "test@ninanovavip.com";
    const response = await fetch(process.env.GSCRIPT_WEBAPP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: from,
        subject: "NinaNovaVIP Email Test (Google Script)",
        body: "API test success! Your Google Script email integration is working.",
      }),
    });

    if (response.ok) {
      res.json({ ok: true, message: "Email sent successfully via Google Script." });
    } else {
      const text = await response.text();
      throw new Error(text);
    }
  } catch (err) {
    console.error("Google Script API error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// --- Start server ---
const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`NinaNovaVIP backend on ${port}`));
