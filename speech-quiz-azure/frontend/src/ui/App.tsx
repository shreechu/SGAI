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

  const recognizerRef = useRef<SpeechSDK.SpeechRecognizer | null>(null);
  const synthesizerRef = useRef<SpeechSDK.SpeechSynthesizer | null>(null);
  const tokenRef = useRef<{ token: string; region: string } | null>(null);

  useEffect(() => {
    fetchToken();
    fetchQuestion(0);
  }, []);

  async function fetchToken() {
    try {
      const resp = await axios.get("/api/speech/token");
      tokenRef.current = resp.data;
      initializeSpeechObjects(resp.data);
    } catch (err: any) {
      console.warn("Speech token not available (Speech services may not be configured):", err.message);
    }
  }

  function initializeSpeechObjects(tokenInfo: { token: string; region: string }) {
    try {
      const speechConfig = SpeechSDK.SpeechConfig.fromAuthorizationToken(tokenInfo.token, tokenInfo.region);
      speechConfig.speechRecognitionLanguage = "en-US";

      const audioConfig = SpeechSDK.AudioConfig.fromDefaultMicrophoneInput();
      recognizerRef.current = new SpeechSDK.SpeechRecognizer(speechConfig, audioConfig);
      synthesizerRef.current = new SpeechSDK.SpeechSynthesizer(speechConfig);
    } catch (err) {
      console.error("Failed to initialize speech objects:", err);
    }
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
    } catch (err: any) {
      setError(`Failed to load question: ${err.message}`);
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  function onPlayQuestion() {
    if (!question || !synthesizerRef.current) {
      setError("Question not loaded or speech not configured");
      return;
    }
    try {
      setSpeaking(true);
      synthesizerRef.current.speakTextAsync(
        question.question,
        () => setSpeaking(false),
        (err: any) => {
          setError(`TTS error: ${err}`);
          setSpeaking(false);
        }
      );
    } catch (err: any) {
      setError(`Failed to play question: ${err.message}`);
      setSpeaking(false);
    }
  }

  function onStartListening() {
    if (!recognizerRef.current) {
      setError("Speech recognizer not initialized. Please configure Azure Speech services.");
      return;
    }

    try {
      setListening(true);
      setTranscript("");
      setError(null);

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
      <h1>🎤 Speech-to-Speech AI Quiz</h1>

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
        <h3>📝 Question</h3>
        <p style={{ fontSize: 18, lineHeight: 1.6, marginBottom: 12 }}>
          {question?.question || "Loading..."}
        </p>
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
          disabled={loading || listening || !recognizerRef.current}
          style={{
            padding: "12px 24px",
            backgroundColor: listening ? "#FF9800" : "#4CAF50",
            color: "white",
            border: "none",
            borderRadius: 4,
            cursor: loading || listening || !recognizerRef.current ? "not-allowed" : "pointer",
            fontSize: 16,
            fontWeight: "bold"
          }}
        >
          {listening ? "🎤 Listening..." : "🎤 Start Listening"}
        </button>

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


