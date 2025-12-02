
import { getSecret } from "../utils/secrets";

// Sample deterministic prompt to instruct Azure OpenAI to return JSON
const buildPrompt = (transcript: string, question: any) => {
  const keyPhrases = (question.key_phrases || []).map((p:string)=>p.toLowerCase());
  return [
       "You are an automated deterministic grader evaluating a Microsoft Mission Critical Architect's response to a CTO. Output ONLY valid JSON with these fields:",
       "- score (0-100 integer): Technical content accuracy",
       "- matched_phrases (array): Matched key technical phrases",
       "- missing_phrases (array): Missing key phrases",
       "- feedback (string): Brief technical feedback",
       "- sentiment (object): { confidence: 0-100, empathy: 0-100, executive_presence: 0-100, professionalism: 0-100 }",
       "- sentiment_feedback (string): Brief assessment of communication style",
       "",
       "Reference Microsoft Learn (Azure) best practices for correctness. Grade alignment to Azure architecture guidance, reliability, support, and cost optimization patterns.",
       "",
       "Question: " + (question.question || ""),
       "Expected key phrases: " + keyPhrases.join(", "),
       "Architect's answer: " + transcript,
       "",
       "Technical Scoring: Match phrases case-insensitively. Give proportional score based on key phrases matched. Prefer Azure terminology (Azure Advisor, SLOs/error budgets, canary/blue-green, autoscale, Reservations/Savings Plans).",
       "",
       "Sentiment Scoring Guidelines:",
       "- confidence: 0-30 (hesitant, uncertain), 31-60 (moderately confident), 61-100 (assured, authoritative). Look for definitive language, lack of hedging, strong recommendations.",
       "- empathy: 0-30 (dismissive), 31-60 (acknowledges concerns), 61-100 (deeply understands pain points, shows partnership). Look for validation of CTO concerns, customer-first language.",
       "- executive_presence: 0-30 (too technical/rambling), 31-60 (clear but basic), 61-100 (strategic, concise, business-focused). Look for business impact framing, strategic thinking, executive communication style.",
       "- professionalism: 0-30 (casual/inappropriate), 31-60 (adequate), 61-100 (polished, respectful, consultative). Look for respectful tone, ownership, accountability.",
       "",
       "Output JSON now."
  ].join("\n\n");
};

export default async function evaluate(transcript: string, question: any) {
  // Try Azure OpenAI first (if configured). Otherwise fallback to deterministic local scoring.
  try {
     const endpoint = process.env.AZURE_OPENAI_ENDPOINT || await getSecret("AZURE_OPENAI_ENDPOINT");
     const apiKey = process.env.AZURE_OPENAI_API_KEY || await getSecret("AZURE_OPENAI_API_KEY");
     
     if (!endpoint || !apiKey) throw new Error("Azure OpenAI not configured");
     
     // Use Azure OpenAI chat completions API
     const response = await fetch(endpoint, {
        method: "POST",
        headers: {
           "Content-Type": "application/json",
           "api-key": apiKey
        },
        body: JSON.stringify({
           messages: [
              {
                 role: "user",
                 content: buildPrompt(transcript, question)
              }
           ],
           max_tokens: 400,
           temperature: 0.3
        })
     });
     
     if (!response.ok) {
        throw new Error(`Azure OpenAI API error: ${response.status} ${response.statusText}`);
     }
     
     const data = await response.json();
     const text = data.choices?.[0]?.message?.content || "";
     
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
     console.warn("Azure OpenAI evaluation failed, falling back:", err?.message || err);
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
  
  // Basic sentiment analysis
  const sentiment = analyzeSentiment(transcript);
  const sentimentFeedback = generateSentimentFeedback(sentiment);
  
  return { 
    score, 
    matched_phrases: matched, 
    missing_phrases: missing, 
    feedback,
    sentiment,
    sentiment_feedback: sentimentFeedback
  };
}

function analyzeSentiment(transcript: string): { confidence: number; empathy: number; executive_presence: number; professionalism: number } {
  const low = transcript.toLowerCase();
  const wordCount = transcript.split(/\s+/).length;
  
  // Confidence indicators
  const confidentPhrases = ['will', 'recommend', 'should', 'must', 'ensure', 'guarantee', 'commit', 'definitely', 'absolutely'];
  const hesitantPhrases = ['maybe', 'perhaps', 'might', 'possibly', 'i think', 'not sure', 'probably'];
  const confidentCount = confidentPhrases.filter(p => low.includes(p)).length;
  const hesitantCount = hesitantPhrases.filter(p => low.includes(p)).length;
  const confidence = Math.min(100, Math.max(30, 50 + (confidentCount * 10) - (hesitantCount * 15)));
  
  // Empathy indicators
  const empathyPhrases = ['understand', 'appreciate', 'acknowledge', 'concern', 'pain point', 'challenge', 'impact', 'critical', 'partner', 'together'];
  const empathyCount = empathyPhrases.filter(p => low.includes(p)).length;
  const empathy = Math.min(100, Math.max(30, 40 + (empathyCount * 8)));
  
  // Executive presence indicators
  const executivePhrases = ['strategy', 'roadmap', 'vision', 'business', 'revenue', 'customer', 'enterprise', 'mission critical', 'priority', 'investment'];
  const technicalJargon = ['api', 'endpoint', 'query', 'cache', 'latency', 'throughput'];
  const executiveCount = executivePhrases.filter(p => low.includes(p)).length;
  const jargonCount = technicalJargon.filter(p => low.includes(p)).length;
  const concise = wordCount < 150 ? 10 : (wordCount < 250 ? 0 : -10);
  const executive_presence = Math.min(100, Math.max(30, 45 + (executiveCount * 8) - (jargonCount * 3) + concise));
  
  // Professionalism indicators
  const professionalPhrases = ['thank you', 'appreciate', 'respectfully', 'collaborate', 'committed', 'accountable', 'transparent'];
  const informalPhrases = ['yeah', 'yep', 'gonna', 'wanna', 'kinda', 'sorta'];
  const professionalCount = professionalPhrases.filter(p => low.includes(p)).length;
  const informalCount = informalPhrases.filter(p => low.includes(p)).length;
  const professionalism = Math.min(100, Math.max(40, 60 + (professionalCount * 8) - (informalCount * 12)));
  
  return { confidence, empathy, executive_presence, professionalism };
}

function generateSentimentFeedback(sentiment: { confidence: number; empathy: number; executive_presence: number; professionalism: number }): string {
  const feedback: string[] = [];
  
  if (sentiment.confidence < 50) feedback.push("Show more confidence and conviction in your recommendations.");
  else if (sentiment.confidence >= 70) feedback.push("Strong confident delivery.");
  
  if (sentiment.empathy < 50) feedback.push("Acknowledge the CTO's concerns more directly.");
  else if (sentiment.empathy >= 70) feedback.push("Excellent empathy and customer understanding.");
  
  if (sentiment.executive_presence < 50) feedback.push("Frame responses with business impact and strategic value.");
  else if (sentiment.executive_presence >= 70) feedback.push("Strong executive presence and strategic communication.");
  
  if (sentiment.professionalism < 60) feedback.push("Maintain professional tone and language.");
  else if (sentiment.professionalism >= 80) feedback.push("Professional and consultative approach.");
  
  return feedback.length ? feedback.join(" ") : "Good overall communication style.";
}
