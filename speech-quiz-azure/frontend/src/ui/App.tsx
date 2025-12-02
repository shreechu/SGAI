import { useEffect, useRef, useState } from "react";
import axios from "axios";
import * as SpeechSDK from "microsoft-cognitiveservices-speech-sdk";

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
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [azureReady, setAzureReady] = useState(false);
  const [browserFallbackReady, setBrowserFallbackReady] = useState(false);

  const recognizerRef = useRef<SpeechSDK.SpeechRecognizer | null>(null);
  const synthesizerRef = useRef<SpeechSDK.SpeechSynthesizer | null>(null);
  const webVoiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const tokenRef = useRef<{ token: string; region: string } | null>(null);
  const DEFAULT_AZURE_VOICE = "en-US-AriaNeural";

  useEffect(() => {
    fetchToken();
    fetchQuestion(0);
    // Detect browser Web Speech API availability as a fallback
    try {
      const w = window as any;
      if (w && (w.SpeechRecognition || w.webkitSpeechRecognition)) {
        setBrowserFallbackReady(true);
      }
      if (typeof window !== "undefined" && window.speechSynthesis) {
        const assignVoice = () => {
          const voices = window.speechSynthesis.getVoices();
          if (voices && voices.length) {
            webVoiceRef.current =
              voices.find(v => v.lang?.toLowerCase().startsWith("en")) || voices[0] || null;
          }
        };
        window.speechSynthesis.onvoiceschanged = assignVoice;
        assignVoice();
      }
    } catch {}
  }, []);

  async function fetchToken() {
    try {
      const resp = await axios.get("/api/speech/token");
      tokenRef.current = resp.data;
      initializeSpeechObjects(resp.data);
    } catch (err: any) {
      console.warn("Speech token not available (Speech services may not be configured):", err?.message || err);
      setAzureReady(false);
    }
  }

  function initializeSpeechObjects(tokenInfo: { token: string; region: string }) {
    try {
      const speechConfig = SpeechSDK.SpeechConfig.fromAuthorizationToken(tokenInfo.token, tokenInfo.region);
      speechConfig.speechRecognitionLanguage = "en-US";
      // Set a pleasant neural voice for TTS
      try { speechConfig.speechSynthesisVoiceName = DEFAULT_AZURE_VOICE; } catch {}

      const audioConfig = SpeechSDK.AudioConfig.fromDefaultMicrophoneInput();
      recognizerRef.current = new SpeechSDK.SpeechRecognizer(speechConfig, audioConfig);
      synthesizerRef.current = new SpeechSDK.SpeechSynthesizer(speechConfig);
      setAzureReady(true);
    } catch (err) {
      console.error("Failed to initialize speech objects:", err);
      setAzureReady(false);
    }
  }

  // Speak helper that uses Azure when available, else browser speech
  function speakText(text: string) {
    if (!text) return;
    setSpeaking(true);
    // Azure path
    if (synthesizerRef.current) {
      try {
        synthesizerRef.current.speakTextAsync(
          text,
          () => setSpeaking(false),
          (err: any) => { console.error(err); setSpeaking(false); }
        );
        return;
      } catch (e) {
        console.warn("Azure TTS failed, using browser fallback", e);
      }
    }
    // Browser fallback
    if (typeof window !== "undefined" && window.speechSynthesis) {
      const u = new SpeechSynthesisUtterance(text);
      if (webVoiceRef.current) u.voice = webVoiceRef.current;
      u.onend = () => setSpeaking(false);
      u.onerror = () => setSpeaking(false);
      window.speechSynthesis.speak(u);
      return;
    }
    setSpeaking(false);
    setError("No TTS available. Configure Azure Speech or use a browser with speechSynthesis support.");
  }

  async function fetchQuestion(i: number) {
    try {
      setLoading(true);
      setError(null);
      const resp = await axios.get(`/api/nextquestion?idx=${i}`);
      setQuestion(resp.data.question);
      setIdx(resp.data.nextIndex);
      setTranscript("");
      setEvaluation(null);
      // Auto-speak the question content
      if (resp.data?.question?.question) {
        speakText(resp.data.question.question);
      }
    } catch (err: any) {
      setError(`Failed to load question: ${err.message}`);
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  function onPlayQuestion() {
    if (!question) return;
    try { speakText(question.question); } catch (err: any) { setError(`Failed to play question: ${err.message}`); }
  }

  function onStartListening() {
    try {
      setListening(true);
      setTranscript("");
      setError(null);

      if (azureReady && recognizerRef.current) {
        // Azure Speech recognition (single utterance)
        recognizerRef.current.recognizeOnceAsync((result) => {
          if (result.reason === SpeechSDK.ResultReason.RecognizedSpeech) {
            setTranscript(result.text);
          } else if (result.reason === SpeechSDK.ResultReason.NoMatch) {
            setError("No speech detected. Please try again.");
          } else if (result.reason === SpeechSDK.ResultReason.Canceled) {
            const cancellation = SpeechSDK.CancellationDetails.fromResult(result);
            setError(`Recognition error: ${cancellation.errorDetails}`);
          }
          setListening(false);
        });
        return;
      }

      // Browser Web Speech API fallback
      const w = window as any;
      const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
      if (SR) {
        const rec = new SR();
        rec.lang = "en-US";
        rec.continuous = false;
        rec.interimResults = false;
        rec.onresult = (e: any) => {
          try {
            const text = e.results?.[0]?.[0]?.transcript || "";
            setTranscript(text);
          } catch {}
        };
        rec.onerror = (e: any) => {
          console.error(e);
          setError(`Recognition error: ${e?.error || "unknown"}`);
        };
        rec.onend = () => setListening(false);
        rec.start();
        return;
      }

      setError("No speech recognition available. Configure Azure Speech or use Chrome/Edge (Web Speech API).");
      setListening(false);
    } catch (err: any) {
      setError(`Failed to start listening: ${err.message}`);
      setListening(false);
    }
  }

  async function onSubmitAnswer() {
    if (!question || !transcript.trim()) {
      setError("Please speak an answer or type one manually");
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

      // Speak the feedback
      const feedbackText = `Score ${resp.data.evaluation.score}. ${resp.data.evaluation.feedback}`;
      if (synthesizerRef.current) {
        setSpeaking(true);
        synthesizerRef.current.speakTextAsync(
          feedbackText,
          () => setSpeaking(false),
          (err: any) => {
            console.error("TTS feedback error:", err);
            setSpeaking(false);
          }
        );
      }
    } catch (err: any) {
      setError(`Evaluation failed: ${err.message}`);
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ padding: 24, fontFamily: "Arial, sans-serif", maxWidth: 900, margin: "0 auto" }}>
      <h1>MCS Consolidated assessment Architect readiness bot</h1>
      <div style={{
        marginTop: 8,
        marginBottom: 16,
        padding: 12,
        border: "1px solid #e0e0e0",
        borderRadius: 8,
        background: "#fafafa"
      }}>
        <p style={{ marginBottom: 6 }}>
          <strong>Bot (CTO of Zava):</strong> I’m concerned about frequent outages impacting our mission-critical application. I’m unhappy with the support quality we’ve received so far and I’m skeptical about the practicality and risks of the recommendations you’ve proposed.
        </p>
        <p>
          <strong>You (Microsoft Architect):</strong> Engage, clarify constraints, and address risk, support quality, and implementation concerns. Provide actionable, prioritized steps to improve reliability.
        </p>
      </div>

      {error && (
        <div
          style={{
            padding: 12,
            backgroundColor: "#fee",
            border: "1px solid #f00",
            borderRadius: 6,
            marginBottom: 16,
            color: "#c00"
          }}
        >
          ⚠️ {error}
        </div>
      )}

      <div style={{ marginBottom: 16, display: "flex", gap: 8 }}>
        <button
          onClick={() => fetchQuestion(idx)}
          disabled={loading || listening || speaking}
          style={{
            padding: "10px 16px",
            cursor: loading || listening || speaking ? "not-allowed" : "pointer",
            opacity: loading || listening || speaking ? 0.6 : 1
          }}
        >
          {loading ? "Loading..." : "Next Question"}
        </button>
      </div>

      <div
        style={{
          border: "1px solid #ddd",
          padding: 16,
          borderRadius: 8,
          backgroundColor: "#f9f9f9",
          marginBottom: 16
        }}
      >
        <h3 style={{ display: "flex", alignItems: "center", gap: 12 }}>📝 Question</h3>
        <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
          <img
            src="/bot.svg"
            alt="Quiz Bot"
            width={72}
            height={72}
            style={{
              borderRadius: "50%",
              boxShadow: speaking ? "0 0 0 4px rgba(76,175,80,0.25)" : "none",
              transition: "box-shadow 200ms ease-in-out"
            }}
          />
          <p style={{ fontSize: 18, lineHeight: 1.6, marginBottom: 12 }}>
            {question?.question || "Loading..."}
          </p>
        </div>
        <button
          onClick={onPlayQuestion}
          disabled={!question || listening || speaking}
          style={{
            padding: "8px 16px",
            backgroundColor: "#2196F3",
            color: "white",
            border: "none",
            borderRadius: 4,
            cursor: !question || listening || speaking ? "not-allowed" : "pointer"
          }}
        >
          {speaking ? "🔊 Playing..." : "🔊 Play Question"}
        </button>
        {question?.key_phrases && (
          <div style={{ marginTop: 12 }}>
            <strong>Key phrases to cover:</strong>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
              {question.key_phrases.map((phrase, i) => (
                <span
                  key={i}
                  style={{
                    backgroundColor: "#e0e7ff",
                    padding: "6px 12px",
                    borderRadius: 4,
                    fontSize: 14,
                    fontWeight: 500
                  }}
                >
                  {phrase}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      <div
        style={{
          border: "2px solid #4CAF50",
          padding: 16,
          borderRadius: 8,
          backgroundColor: "#f1f8f4",
          marginBottom: 16
        }}
      >
        <h3>🎙️ Record Your Answer</h3>
        <p style={{ color: "#666", marginBottom: 12 }}>
          Click "Start Listening" and speak your answer. The app will record and transcribe it.
        </p>
        <button
          onClick={onStartListening}
          disabled={loading || listening || (!azureReady && !browserFallbackReady)}
          style={{
            padding: "12px 24px",
            backgroundColor: listening ? "#FF9800" : "#4CAF50",
            color: "white",
            border: "none",
            borderRadius: 4,
            cursor: loading || listening || (!azureReady && !browserFallbackReady) ? "not-allowed" : "pointer",
            fontSize: 16,
            fontWeight: "bold"
          }}
        >
          {listening ? "🎤 Listening..." : "🎤 Start Listening"}
        </button>

        {/* Indicator of which speech path is active */}
        <div style={{ marginTop: 8, color: "#666", fontSize: 13 }}>
          {azureReady ? "Using Azure Speech SDK" : browserFallbackReady ? "Using browser speech fallback" : "Speech not available"}
        </div>

        {transcript && (
          <div
            style={{
              marginTop: 12,
              padding: 12,
              backgroundColor: "white",
              border: "1px solid #ddd",
              borderRadius: 4
            }}
          >
            <strong>Your answer:</strong>
            <p style={{ marginTop: 8, fontSize: 16, lineHeight: 1.5 }}>{transcript}</p>
          </div>
        )}

        <button
          onClick={onSubmitAnswer}
          disabled={loading || listening || !transcript.trim() || !question}
          style={{
            padding: "12px 24px",
            marginTop: 12,
            backgroundColor: "#4CAF50",
            color: "white",
            border: "none",
            borderRadius: 4,
            cursor: loading || listening || !transcript.trim() || !question ? "not-allowed" : "pointer",
            fontSize: 16,
            fontWeight: "bold"
          }}
        >
          {loading ? "Evaluating..." : "✅ Submit Answer"}
        </button>
      </div>

      {evaluation && (
        <div
          style={{
            border: "2px solid #4CAF50",
            padding: 16,
            borderRadius: 8,
            backgroundColor: "#f1f8f4"
          }}
        >
          <h3>✅ Evaluation Result</h3>
          <div style={{ fontSize: 24, marginBottom: 12, fontWeight: "bold" }}>
            Score: {evaluation.score}%
          </div>
          <div style={{ marginBottom: 12 }}>
            <strong>✓ Matched phrases:</strong>
            <p>{evaluation.matched_phrases?.join(", ") || "None"}</p>
          </div>
          <div style={{ marginBottom: 12 }}>
            <strong>✗ Missing phrases:</strong>
            <p>{evaluation.missing_phrases?.join(", ") || "None"}</p>
          </div>
          <div>
            <strong>📝 Feedback:</strong>
            <p style={{ marginTop: 8, fontStyle: "italic" }}>{evaluation.feedback}</p>
          </div>
          {speaking && <p style={{ marginTop: 12, color: "#FF9800" }}>🔊 Playing feedback...</p>}
        </div>
      )}
    </div>
  );
}


