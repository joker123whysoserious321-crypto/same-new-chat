import 'dotenv/config';
import fs from "fs/promises";
import fetch from "node-fetch";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function chunkText(t, size=1200, overlap=200){
  const out=[]; for(let i=0;i<t.length;i+=size-overlap) out.push(t.slice(i,i+size)); return out;
}

async function embed(text){
  const r = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: process.env.EMBED_MODEL, input: text })
  }).then(res=>res.json());
  return r.data[0].embedding;
}

const raw = await fs.readFile("./public/knowledge.txt","utf8");
const chunks = chunkText(raw);
const client = await pool.connect();
try {
  for (const c of chunks) {
    const e = await embed(c);
    await client.query("INSERT INTO kb_chunk (content, source, embedding) VALUES ($1,$2,$3)", [c, "knowledge.txt", e]);
  }
  console.log("Seeded", chunks.length, "chunks.");
} finally { client.release(); await pool.end(); }
