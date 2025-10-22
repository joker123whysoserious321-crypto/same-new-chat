import 'dotenv/config';
import fetch from "node-fetch";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function embed(text) {
  const r = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: process.env.EMBED_MODEL, input: text })
  }).then(res => res.json());
  return r.data[0].embedding;
}

async function retrieveContext(query, k=6) {
  const e = await embed(query);
  const { rows } = await pool.query("SELECT id, content FROM kb_chunk ORDER BY embedding <=> $1 LIMIT $2", [e, k]);
  const context = rows.map(r => `[${r.id}]\n${r.content}`).join("\n\n");
  const cites = rows.map(r => r.id);
  return { context, cites };
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
    const { question, conversation_id="demo-conv-1", user_id="demo-user-1", memory=[] } = req.body || {};
    const { context, cites } = await retrieveContext(question, 6);

    const SYSTEM = `You are a helpful assistant.
Use ONLY the CONTEXT and MEMORY to answer.
If info is missing, say you don't have that info.
Always cite chunks like [#chunk_id].`;
    const MEMORY = memory.length ? `\n\nMEMORY:\n- ${memory.join("\n- ")}` : "";

    const messages = [
      { role: "system", content: SYSTEM },
      { role: "user", content: `CONTEXT:\n${context}${MEMORY}\n\nUSER:\n${question}\n\nASSISTANT:` }
    ];

    const cc = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: process.env.OPENAI_MODEL, messages, temperature: 0.2 })
    }).then(r => r.json());

    const reply = cc.choices?.[0]?.message?.content || "I don't have enough info in our knowledge base.";
    res.setHeader("Access-Control-Allow-Origin","*");
    return res.status(200).json({ reply, citations: cites });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Server error" });
  }
}
