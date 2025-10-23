
export default async function handler(req, res) {
  // --- CORS ---
  const origin = req.headers.origin;
  const allowed = (process.env.ALLOWED_ORIGIN || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  const allowOrigin = allowed.includes(origin) ? origin : '';
  res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')  return res.status(405).json({ error: 'Use POST' });

  // …your existing POST logic stays below…
}






import 'dotenv/config';
import fetch from "node-fetch";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function saveMessage(conversation_id, user_id, role, content) {
  await pool.query(
    "INSERT INTO message (conversation_id, user_id, role, content) VALUES ($1,$2,$3,$4)",
    [conversation_id, user_id, role, content]
  );
}

async function getRecentMessages(conversation_id, limit=8) {
  const { rows } = await pool.query(
    "SELECT role, content FROM message WHERE conversation_id=$1 ORDER BY created_at DESC LIMIT $2",
    [conversation_id, limit]
  );
  return rows.reverse();
}

async function getUserMemory(user_id) {
  const { rows } = await pool.query("SELECT facts FROM user_memory WHERE user_id=$1", [user_id]);
  return rows[0]?.facts || [];
}

async function upsertUserMemory(user_id, newFact) {
  const { rows } = await pool.query("SELECT facts FROM user_memory WHERE user_id=$1", [user_id]);
  let facts = rows[0]?.facts || [];
  if (newFact && !facts.includes(newFact)) facts = [...facts.slice(-9), newFact];
  await pool.query(
    `INSERT INTO user_memory (user_id, facts) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET facts=EXCLUDED.facts, updated_at=now()`,
    [user_id, JSON.stringify(facts)]
  );
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin","*");
    res.setHeader("Access-Control-Allow-Methods","POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers","Content-Type");
    return res.status(204).end();
  }
  if (req.method !== "POST") return res.status(405).send("Use POST");

  try {
    const { message, conversation_id="demo-conv-1", user_id="demo-user-1" } = req.body || {};
    if (!message) return res.status(400).json({ error: "Missing message" });

    await saveMessage(conversation_id, user_id, 'user', message);

    const [recent, memory] = await Promise.all([
      getRecentMessages(conversation_id),
      getUserMemory(user_id)
    ]);

    // Ask our RAG endpoint for a grounded answer
    const rag = await fetch(`${process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : ''}/api/ragAnswer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: message, conversation_id, user_id, memory })
    }).then(r => r.json());

    const reply = rag?.reply || "I don't have enough info in our knowledge base.";
    await saveMessage(conversation_id, user_id, 'assistant', reply);

    // naive memory rule: capture "I prefer ..."
    const m = /i prefer ([^.!\n]+)/i.exec(message);
    if (m?.[1]) await upsertUserMemory(user_id, `Prefers ${m[1].trim()}`);

    res.setHeader("Access-Control-Allow-Origin","*");
    return res.status(200).json({ reply, citations: rag?.citations || [] });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Server error" });
  }
}
