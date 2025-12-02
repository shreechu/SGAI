
import { Router } from "express";
import { readFileSync } from "fs";
import path from "path";
import evaluateController from "../services/evaluate";
import { saveSession } from "../services/store";

const router = Router();
const QUESTIONS_PATH = path.resolve(process.cwd(), "../scripts/questions.json");
let questions: any[] = [];
try {
  questions = JSON.parse(readFileSync(QUESTIONS_PATH, "utf8"));
} catch {
  questions = [];
}
console.log("Loaded questions from", QUESTIONS_PATH, "count=", questions.length);

// Simple Microsoft Learn links by topic to include with results
const learnLinksByTopic: Record<string, Array<{ title: string; url: string }>> = {
  Reliability: [
    { title: "Azure Well-Architected Framework: Reliability", url: "https://learn.microsoft.com/azure/architecture/framework/resiliency/overview" },
    { title: "Design for resiliency in Azure", url: "https://learn.microsoft.com/azure/architecture/resiliency/" }
  ],
  Observability: [
    { title: "Azure Monitor overview", url: "https://learn.microsoft.com/azure/azure-monitor/overview" },
    { title: "Distributed tracing with OpenTelemetry (Azure)", url: "https://learn.microsoft.com/azure/azure-monitor/app/opentelemetry-overview" },
    { title: "SLOs, error budgets and alerting", url: "https://learn.microsoft.com/azure/architecture/framework/observability/monitoring-slos" }
  ],
  "Change Management": [
    { title: "Safe deployment practices (blue/green, canary)", url: "https://learn.microsoft.com/azure/architecture/framework/reliability/deploy" },
    { title: "Feature flags with Azure App Configuration", url: "https://learn.microsoft.com/azure/azure-app-configuration/concept-feature-management" }
  ],
  "Support & Process": [
    { title: "Azure Support plans", url: "https://learn.microsoft.com/training/support-plans/" },
    { title: "Azure Service Health", url: "https://learn.microsoft.com/azure/service-health/overview" }
  ],
  "Cost Optimization": [
    { title: "Azure Advisor cost recommendations", url: "https://learn.microsoft.com/azure/advisor/advisor-cost-recommendations" },
    { title: "Azure Reservations and Savings Plans", url: "https://learn.microsoft.com/azure/cost-management-billing/savings-plan/" },
    { title: "Cost Management + Billing", url: "https://learn.microsoft.com/azure/cost-management-billing/" }
  ]
};

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

// Evaluate all answers at the end of the quiz
// Expects: { sessionId: string, answers: Array<{ questionId: string, transcript: string }> }
router.post("/evaluate-all", async (req, res) => {
  try {
    const { sessionId, answers } = req.body || {};
    if (!Array.isArray(answers) || !answers.length) {
      return res.status(400).json({ error: "answers array required" });
    }

    const byId = new Map(questions.map(q => [q.id, q] as const));
    const results: any[] = [];
    for (const a of answers) {
      const q = byId.get(a.questionId);
      if (!q) continue;
      const evaluation = await evaluateController(a.transcript || "", q);
      const links = learnLinksByTopic[q.topic as string] || [];
      results.push({ questionId: q.id, heading: q.heading, topic: q.topic, evaluation, learnLinks: links });
      try {
        await saveSession({ sessionId, questionId: q.id, transcript: a.transcript, evaluation, timestamp: new Date().toISOString() });
      } catch {}
    }

    const scores = results.map(r => Number(r.evaluation?.score || 0));
    const overallScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
    res.json({ overallScore, results });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

export default router;
