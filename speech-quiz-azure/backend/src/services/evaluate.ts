
import OpenAI from "openai";
import { getSecret } from "../utils/secrets";

// Sample deterministic prompt to instruct Azure OpenAI to return JSON
const buildPrompt = (transcript: string, question: any) => {
  const keyPhrases = (question.key_phrases || []).map((p:string)=>p.toLowerCase());
  return [
     "You are an automated deterministic grader. Output ONLY valid JSON with these fields: score (0-100 integer), matched_phrases (array), missing_phrases (array), feedback (string).",
     "Question: " + (question.question || ""),
     "Expected key phrases: " + keyPhrases.join(", "),
     "Student answer (transcript): " + transcript,
     "Scoring rules: match phrase case-insensitively. Give proportional score based on number of key phrases matched. Provide concise feedback and hints for missing phrases.",
     "Output JSON now."
  ].join("\n\n");
};

export default async function evaluate(transcript: string, question: any) {
  // Try Azure OpenAI first (if configured). Otherwise fallback to deterministic local scoring.
  try {
     const endpoint = process.env.AZURE_OPENAI_ENDPOINT || await getSecret("AZURE_OPENAI_ENDPOINT");
     const apiKey = process.env.AZURE_OPENAI_API_KEY || await getSecret("AZURE_OPENAI_API_KEY");
     const deployment = process.env.AZURE_OPENAI_DEPLOYMENT || await getSecret("AZURE_OPENAI_DEPLOYMENT");
     if (!endpoint || !apiKey || !deployment) throw new Error("OpenAI not configured");
     const client = new OpenAI({ apiKey, baseURL: endpoint });
     const prompt = buildPrompt(transcript, question);
     const resp = await client.responses.create({
        model: deployment,
        input: prompt,
        max_tokens: 400
     });
     const text = String((resp.output?.[0]?.content?.[0]?.text) || "");
     // Attempt to extract JSON from text
     const firstBrace = text.indexOf("{");
     const lastBrace = text.lastIndexOf("}");
     if (firstBrace >= 0 && lastBrace >= 0) {
        const jsonStr = text.slice(firstBrace, lastBrace + 1);
        const parsed = JSON.parse(jsonStr);
        return parsed;
     }
     // fallback to local scoring
     return localScore(transcript, question);
  } catch (err) {
     console.warn("OpenAI evaluation failed, falling back:", err?.message || err);
     return localScore(transcript, question);
  }
}

function localScore(transcript: string, question: any) {
  const keyPhrases = (question.key_phrases || []).map((s:string)=>s.toLowerCase());
  const matched: string[] = [];
  const low = transcript.toLowerCase();
  for (const kp of keyPhrases) {
     if (kp.split(" ").every(tok => low.includes(tok))) matched.push(kp);
  }
  const score = Math.round((matched.length / Math.max(1, keyPhrases.length)) * 100);
  const missing = keyPhrases.filter(k => !matched.includes(k));
  const feedback = matched.length === keyPhrases.length ? "Excellent — covered all key points." : `You mentioned ${matched.length} key items. Missing: ${missing.join(", ")}`;
  return { score, matched_phrases: matched, missing_phrases: missing, feedback };
}
