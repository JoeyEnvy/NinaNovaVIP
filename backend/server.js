// backend/server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch"; // <-- add this
import nodemailer from "nodemailer";

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

// --- Example in-memory database (temporary) ---
const DB = { members: [] };

// --- Helpers ---
function findByToken(token) {
  for (const m of DB.members) {
    const t = m.tokens?.find(x => x.token === token);
    if (t) return { member: m, token: t };
  }
  return null;
}

function makeToken(email, days) {
  const token = Math.random().toString(36).substring(2);
  const expires = Date.now() + days * 24 * 60 * 60 * 1000;
  return { token, expires };
}

async function sendAccessEmail(email, token) {
  const link = `${process.env.SITE_BASE}/members.html?token=${token}`;

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.sendgrid.net",
    port: Number(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: {
      user: process.env.SMTP_USER || "apikey",
      pass: process.env.SMTP_PASS
    },
    connectionTimeout: 10000,
    greetingTimeout: 5000
  });

  await transporter.sendMail({
    from: process.env.FROM_EMAIL,
    to: email,
    subject: "Your NinaNovaVIP Access Link",
    text: `Here is your private access link:\n${link}\n\nIf you didn’t request this, ignore this email.`,
  });

  console.log(`Access email sent to ${email}`);
  return true;
}

function upsertMember(email) {
  let member = DB.members.find(m => m.email === email);
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
    x => x.email.toLowerCase() === email.toLowerCase()
  );
  if (!member || member.status !== "active" || (member.expiry || 0) < Date.now()) {
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

// --- Test SendGrid email via HTTPS API ---
app.get("/api/test-email", async (req, res) => {
  try {
    const apiKey = process.env.SMTP_PASS; // your SendGrid API key
    const from = process.env.FROM_EMAIL;

    const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: from }] }],
        from: { email: from },
        subject: "NinaNovaVIP Email Test (API)",
        content: [{ type: "text/plain", value: "API test success!" }]
      })
    });

    if (response.ok) {
      res.json({ ok: true, message: "Email sent successfully via API." });
    } else {
      const text = await response.text();
      throw new Error(text);
    }
  } catch (err) {
    console.error("SendGrid API error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// --- Start server ---
const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`NinaNovaVIP backend on ${port}`));
