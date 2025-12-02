
// Local-file fallback for session storage (avoids requiring Cosmos DB during local dev)
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import path from "path";

const DATA_DIR = path.resolve(__dirname, "../../data");
const SESSIONS_FILE = path.join(DATA_DIR, "sessions.json");

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

export async function saveSession(item: any) {
  const id = item.sessionId || `s-${Date.now()}`;
  const doc = { id, ...item };
  let sessions: any[] = [];
  try {
    if (existsSync(SESSIONS_FILE)) {
      sessions = JSON.parse(readFileSync(SESSIONS_FILE, "utf8") || "[]");
    }
  } catch {
    sessions = [];
  }
  sessions.push(doc);
  writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2), "utf8");
  return doc;
}

export async function saveAudioToBlob(_filename: string, _buffer: Buffer) {
  throw new Error("Blob storage not configured for local development");
}
