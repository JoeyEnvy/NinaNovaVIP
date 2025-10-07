// backend/server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

// --- Example in-memory database (temporary) ---
const DB = {
  members: []
};

// --- Helpers ---
function findByToken(token) {
  for (const m of DB.members) {
    const t = m.tokens?.find(x => x.token === token);
    if (t) return { member: m, token: t };
  }
  return null;
}

// makeToken: temporary stub until real implementation
function makeToken(email, days) {
  const token = Math.random().toString(36).substring(2);
  const expires = Date.now() + days * 24 * 60 * 60 * 1000;
  return { token, expires };
}

// sendAccessEmail: temporary stub to prevent runtime error
async function sendAccessEmail(email, token) {
  console.log(`(stub) Would send email to ${email} with token ${token}`);
  return true;
}

// upsertMember: temporary in-memory implementation
function upsertMember(email) {
  let member = DB.members.find(m => m.email === email);
  if (!member) {
    member = { email, status: "inactive", tokens: [], purchases: [] };
    DB.members.push(member);
  }
  return member;
}

// futureDays helper
function futureDays(days) {
  return Date.now() + days * 24 * 60 * 60 * 1000;
}

// --- Routes ---

// Health check
app.get("/", (_, res) => res.json({ ok: true }));

// Verify token
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

// Resend link
app.post("/api/resend", async (req, res) => {
  const email = String(req.body.email || "").trim();
  if (!email)
    return res
      .status(400)
      .json({ ok: false, message: "Missing email" });

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
    return res
      .status(500)
      .json({ ok: false, message: "Email failed" });
  }
});

// Payment postback (simulate Epoch/CCBill)
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

// --- Start server ---
const port = process.env.PORT || 4000;
app.listen(port, () =>
  console.log(`NinaNovaVIP backend on ${port}`)
);
