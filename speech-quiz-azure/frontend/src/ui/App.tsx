import { useEffect, useRef, useState } from "react";
import axios from "axios";

// Configure axios to use backend endpoint
axios.defaults.baseURL = "http://localhost:7071";

type Question = {
  id: string;
  question: string;
  key_phrases: string[];
  topic?: string;
  difficulty?: string;
};

export default function App() {
  const [question, setQuestion] = useState<Question | null>(null);
  const [idx, setIdx] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [evaluation, setEvaluation] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchQuestion(0);
  }, []);

  async function fetchQuestion(i: number) {
    try {
      setLoading(true);
      setError(null);
      const resp = await axios.get(`/api/nextquestion?idx=${i}`);
      setQuestion(resp.data.question);
      setIdx(resp.data.nextIndex);
      setTranscript("");
      setEvaluation(null);
    } catch (err: any) {
      setError(`Failed to load question: ${err.message}`);
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function onSubmitAnswer() {
    if (!question || !transcript.trim()) {
      setError("Please enter a transcript");
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const resp = await axios.post("/api/evaluate", {
        transcript,
        question,
        sessionId: "local-session"
      });
      setEvaluation(resp.data.evaluation);
    } catch (err: any) {
      setError(`Evaluation failed: ${err.message}`);
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ padding: 24, fontFamily: "Arial, sans-serif", maxWidth: 800, margin: "0 auto" }}>
      <h1>🎤 Speech-First AI Quiz</h1>
      
      {error && (
        <div style={{ 
          padding: 12, 
          backgroundColor: "#fee", 
          border: "1px solid #f00", 
          borderRadius: 6, 
          marginBottom: 16,
          color: "#c00"
        }}>
          {error}
        </div>
      )}

      <div style={{ marginBottom: 16 }}>
        <button 
          onClick={() => fetchQuestion(idx)}
          disabled={loading}
          style={{ padding: "8px 16px", marginRight: 8, cursor: loading ? "not-allowed" : "pointer" }}
        >
          {loading ? "Loading..." : "Next Question"}
        </button>
      </div>

      <div style={{ 
        border: "1px solid #ddd", 
        padding: 16, 
        borderRadius: 8,
        backgroundColor: "#f9f9f9",
        marginBottom: 16
      }}>
        <h3>📝 Question</h3>
        <p style={{ fontSize: 18, lineHeight: 1.6 }}>
          {question?.question || "Loading..."}
        </p>
        {question?.key_phrases && (
          <div>
            <strong>Key phrases to cover:</strong>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
              {question.key_phrases.map((phrase, i) => (
                <span 
                  key={i}
                  style={{
                    backgroundColor: "#e0e7ff",
                    padding: "4px 8px",
                    borderRadius: 4,
                    fontSize: 14
                  }}
                >
                  {phrase}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      <div style={{ 
        border: "1px solid #ddd", 
        padding: 16, 
        borderRadius: 8,
        marginBottom: 16
      }}>
        <h3>🎙️ Your Answer</h3>
        <textarea
          value={transcript}
          onChange={(e) => setTranscript(e.target.value)}
          placeholder="Type your answer here (or paste speech-to-text transcript)..."
          style={{
            width: "100%",
            minHeight: 100,
            padding: 8,
            borderRadius: 4,
            border: "1px solid #ccc",
            fontFamily: "monospace",
            fontSize: 14
          }}
        />
        <button
          onClick={onSubmitAnswer}
          disabled={loading || !transcript.trim()}
          style={{
            padding: "10px 20px",
            marginTop: 12,
            backgroundColor: "#4CAF50",
            color: "white",
            border: "none",
            borderRadius: 4,
            cursor: loading || !transcript.trim() ? "not-allowed" : "pointer",
            fontSize: 16
          }}
        >
          {loading ? "Evaluating..." : "Submit Answer"}
        </button>
      </div>

      {evaluation && (
        <div style={{ 
          border: "1px solid #4CAF50", 
          padding: 16, 
          borderRadius: 8,
          backgroundColor: "#f1f8f4"
        }}>
          <h3>✅ Evaluation Result</h3>
          <div style={{ fontSize: 18, marginBottom: 12 }}>
            <strong>Score: {evaluation.score}%</strong>
          </div>
          <div style={{ marginBottom: 12 }}>
            <strong>✓ Matched:</strong>
            <div>{evaluation.matched_phrases?.join(", ") || "None"}</div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <strong>✗ Missing:</strong>
            <div>{evaluation.missing_phrases?.join(", ") || "None"}</div>
          </div>
          <div>
            <strong>Feedback:</strong>
            <p>{evaluation.feedback}</p>
          </div>
        </div>
      )}
    </div>
  );
}

