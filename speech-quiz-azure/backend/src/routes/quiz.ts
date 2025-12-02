
import { Router } from "express";
import { readFileSync } from "fs";
import path from "path";
import evaluateController from "../services/evaluate";
import { saveSession } from "../services/store";

const router = Router();
const QUESTIONS_PATH = path.resolve(__dirname, "../../scripts/questions.json");
let questions: any[] = [];
try {
  questions = JSON.parse(readFileSync(QUESTIONS_PATH, "utf8"));
} catch {
  questions = [];
}

// Next question endpoint
router.get("/nextquestion", (req, res) => {
  const idx = parseInt(String(req.query.idx || "0"), 10) || 0;
  const q = questions[idx] || null;
  res.json({ question: q, nextIndex: idx + 1 });
});

// Evaluate endpoint: receives { transcript, question }
router.post("/evaluate", async (req, res) => {
  try {
     const { transcript, question, audioBase64, sessionId } = req.body;
     if (!transcript || !question) return res.status(400).json({ error: "Missing fields" });

     const evaluation = await evaluateController(transcript, question);
     // Persist using local store (or Cosmos when configured)
     await saveSession({ sessionId, questionId: question.id, transcript, evaluation, timestamp: new Date().toISOString() });
     res.json({ evaluation });
  } catch (err: any) {
     console.error(err);
     res.status(500).json({ error: err.message || String(err) });
  }
});

export default router;
