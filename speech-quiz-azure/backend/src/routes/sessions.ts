import { Router } from "express";
import * as fs from "fs";
import * as path from "path";

const router = Router();

const SESSIONS_FILE = path.join(__dirname, "../../data/sessions.json");

// Ensure data directory exists
function ensureDataDir() {
  const dir = path.dirname(SESSIONS_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(SESSIONS_FILE)) {
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify([], null, 2));
  }
}

// Get all sessions
router.get("/sessions", (req, res) => {
  try {
    ensureDataDir();
    const data = fs.readFileSync(SESSIONS_FILE, "utf-8");
    const sessions = JSON.parse(data);
    // Sort by timestamp descending (newest first)
    sessions.sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    res.json(sessions);
  } catch (err: any) {
    console.error("Error reading sessions:", err);
    res.status(500).json({ error: "Failed to load sessions" });
  }
});

// Save a new session
router.post("/sessions", (req, res) => {
  try {
    ensureDataDir();
    const sessionData = req.body;
    
    // Read existing sessions
    const data = fs.readFileSync(SESSIONS_FILE, "utf-8");
    const sessions = JSON.parse(data);
    
    // Add new session
    sessions.push(sessionData);
    
    // Write back to file
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
    
    res.json({ success: true, message: "Session saved successfully" });
  } catch (err: any) {
    console.error("Error saving session:", err);
    res.status(500).json({ error: "Failed to save session" });
  }
});

export default router;
