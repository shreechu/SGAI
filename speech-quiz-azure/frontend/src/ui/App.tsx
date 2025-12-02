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

type LearnLink = { title: string; url: string };
type FinalItem = { questionId: string; heading?: string; topic?: string; evaluation: any; learnLinks: LearnLink[] };
type FinalResults = { overallScore: number; results: FinalItem[] };

export default function App() {
  const [question, setQuestion] = useState<Question | null>(null);
  const [idx, setIdx] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [finalResults, setFinalResults] = useState<FinalResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [endOfQuiz, setEndOfQuiz] = useState(false);
  const [seenQuestions, setSeenQuestions] = useState<Array<{ id: string; idx: number; heading?: string }>>([]);
  
  const [listening, setListening] = useState(false);
  const [continuousListening, setContinuousListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [pausedListening, setPausedListening] = useState(false);
  const [azureReady, setAzureReady] = useState(false);
  const [browserFallbackReady, setBrowserFallbackReady] = useState(false);
  const [autoRead, setAutoRead] = useState(true);
  const [azureVoiceName, setAzureVoiceName] = useState("en-US-JennyNeural");
  const [browserVoices, setBrowserVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [azureVoiceStyle, setAzureVoiceStyle] = useState("chat");

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
            setBrowserVoices(voices);
            webVoiceRef.current = voices.find(v => v.lang?.toLowerCase().startsWith("en")) || voices[0] || null;
          }
        };
        window.speechSynthesis.onvoiceschanged = assignVoice;
        assignVoice();
      }
    } catch {}
  }, []);

  // Rebuild Azure synthesizer when voice changes
  useEffect(() => {
    if (!azureReady || !tokenRef.current) return;
    try {
      const speechConfig = SpeechSDK.SpeechConfig.fromAuthorizationToken(
        tokenRef.current.token,
        tokenRef.current.region
      );
      speechConfig.speechRecognitionLanguage = "en-US";
      try { speechConfig.speechSynthesisVoiceName = azureVoiceName || DEFAULT_AZURE_VOICE; } catch {}
      try { synthesizerRef.current?.close?.(); } catch {}
      synthesizerRef.current = new SpeechSDK.SpeechSynthesizer(speechConfig);
    } catch {}
  }, [azureVoiceName, azureReady]);

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
      try { speechConfig.speechSynthesisVoiceName = azureVoiceName || DEFAULT_AZURE_VOICE; } catch {}

      const audioConfig = SpeechSDK.AudioConfig.fromDefaultMicrophoneInput();
      recognizerRef.current = new SpeechSDK.SpeechRecognizer(speechConfig, audioConfig);
      synthesizerRef.current = new SpeechSDK.SpeechSynthesizer(speechConfig);
      setAzureReady(true);
    } catch (err) {
      console.error("Failed to initialize speech objects:", err);
      setAzureReady(false);
    }
  }

  function buildAzureSsml(text: string, voiceName: string) {
    const safe = (text || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return `<?xml version="1.0" encoding="UTF-8"?>
<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="en-US">
  <voice name="${voiceName}">
    <mstts:express-as style="${azureVoiceStyle}" styledegree="1.5">
      <prosody rate="+5%" pitch="+0%">${safe}</prosody>
    </mstts:express-as>
  </voice>
</speak>`;
  }

  // Speak helper that uses Azure when available, else browser speech
  function speakText(text: string) {
    if (!text) return;
    setSpeaking(true);
    // Azure path
    if (synthesizerRef.current) {
      try {
        const ssml = buildAzureSsml(text, azureVoiceName || DEFAULT_AZURE_VOICE);
        (synthesizerRef.current as any).speakSsmlAsync(
          ssml,
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
      u.rate = 1.05; // slightly more natural pacing
      u.pitch = 1.0;
      u.onend = () => setSpeaking(false);
      u.onerror = () => setSpeaking(false);
      window.speechSynthesis.speak(u);
      return;
    }
    setSpeaking(false);
    setError("No TTS available. Configure Azure Speech or use a browser with speechSynthesis support.");
  }

  function stopSpeaking() {
    try {
      // Browser speech: cancel queue
      if (typeof window !== "undefined" && window.speechSynthesis) {
        try { window.speechSynthesis.cancel(); } catch {}
      }
      // Azure speech: try stopSpeakingAsync if available, else recreate synthesizer
      const synth: any = synthesizerRef.current as any;
      if (synth && typeof synth.stopSpeakingAsync === "function") {
        try { synth.stopSpeakingAsync(() => {}, () => {}); } catch {}
      } else if (synth && typeof synth.close === "function") {
        try { synth.close(); } catch {}
        // Recreate synthesizer so future TTS still works
        try {
          if (tokenRef.current) {
            const cfg = SpeechSDK.SpeechConfig.fromAuthorizationToken(tokenRef.current.token, tokenRef.current.region);
            try { cfg.speechSynthesisVoiceName = azureVoiceName || DEFAULT_AZURE_VOICE; } catch {}
            synthesizerRef.current = new SpeechSDK.SpeechSynthesizer(cfg);
          }
        } catch {}
      }
    } finally {
      setSpeaking(false);
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
      if (!resp.data.question) {
        setEndOfQuiz(true);
      }
      if (resp.data.question) {
        setSeenQuestions(prev => {
          const exists = prev.some(p => p.id === resp.data.question.id);
          if (exists) return prev;
          return [...prev, { id: resp.data.question.id, idx: i, heading: (resp.data.question as any).heading }];
        });
      }
      // Auto-speak the question content
      if (autoRead && resp.data?.question?.question) {
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
        // Azure Speech continuous recognition for extended speaking time
        setContinuousListening(true);
        let collected = "";
        recognizerRef.current.recognized = (_s: any, e: any) => {
          try {
            const text: string = e?.result?.text || "";
            if (text) {
              collected = collected ? `${collected} ${text}` : text;
              setTranscript(collected);
            }
          } catch {}
        };
        recognizerRef.current.canceled = (_s: any, e: any) => {
          setError(`Recognition canceled: ${e?.errorDetails || "unknown"}`);
          setListening(false);
          setContinuousListening(false);
          try { recognizerRef.current?.stopContinuousRecognitionAsync?.(() => {}, () => {}); } catch {}
        };
        recognizerRef.current.sessionStopped = () => {
          setListening(false);
          setContinuousListening(false);
        };
        recognizerRef.current.startContinuousRecognitionAsync(
          () => {},
          (err: any) => {
            setError(`Failed to start recognition: ${err?.message || err}`);
            setListening(false);
            setContinuousListening(false);
          }
        );
        return;
      }

      // Browser Web Speech API fallback
      const w = window as any;
      const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
      if (SR) {
        const rec = new SR();
        rec.lang = "en-US";
        rec.continuous = true; // allow extended speech
        rec.interimResults = true;
        let collected = "";
        rec.onresult = (e: any) => {
          try {
            for (let i = e.resultIndex; i < e.results.length; i++) {
              const res = e.results[i];
              if (res.isFinal) {
                const text = res[0].transcript || "";
                if (text) {
                  collected = collected ? `${collected} ${text}` : text;
                  setTranscript(collected);
                }
              }
            }
          } catch {}
        };
        rec.onerror = (e: any) => {
          console.error(e);
          setError(`Recognition error: ${e?.error || "unknown"}`);
        };
        rec.onend = () => { setListening(false); setContinuousListening(false); };
        rec.start();
        setContinuousListening(true);
        return;
      }

      setError("No speech recognition available. Configure Azure Speech or use Chrome/Edge (Web Speech API).");
      setListening(false);
    } catch (err: any) {
      setError(`Failed to start listening: ${err.message}`);
      setListening(false);
    }
  }

  function onStopListening() {
    try {
      setListening(false);
      setContinuousListening(false);
      // Azure
      try { recognizerRef.current?.stopContinuousRecognitionAsync?.(() => {}, () => {}); } catch {}
      // Browser
      const w = window as any;
      const SR = w?.SpeechRecognition || w?.webkitSpeechRecognition;
      if (SR && w?.currentRecognizerInstance) {
        try { w.currentRecognizerInstance.stop?.(); } catch {}
      }
    } catch {}
  }

  function onRetryRecording() {
    setTranscript("");
    onStartListening();
  }

  function togglePauseListening() {
    // Simulate pause by stopping continuous recognition; resume restarts it and keeps collected transcript
    if (!listening) return;
    if (!pausedListening) {
      onStopListening();
      setPausedListening(true);
    } else {
      setPausedListening(false);
      onStartListening();
    }
  }

  function onSaveAnswer() {
    if (!question) return;
    const text = transcript.trim();
    if (!text) {
      setError("Please speak an answer or type one before saving");
      return;
    }
    setAnswers(prev => ({ ...prev, [question.id]: text }));
  }

  function goToQuestionById(qid: string) {
    const target = seenQuestions.find(sq => sq.id === qid);
    if (!target) return;
    setEndOfQuiz(false);
    fetchQuestion(target.idx);
  }

  async function onSubmitAll() {
    try {
      setLoading(true);
      setError(null);
      const answersArray = Object.entries(answers).map(([questionId, transcript]) => ({ questionId, transcript }));
      const resp = await axios.post("/api/evaluate-all", { sessionId: "local-session", answers: answersArray });
      setFinalResults(resp.data);
    } catch (err: any) {
      setError(`Final evaluation failed: ${err.message}`);
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
          <strong>CTO of Zava (speaking to you):</strong> Our mission-critical app has had too many outages, and our support experience hasn’t met expectations. I need a practical plan that improves reliability quickly, shortens detection and recovery times, and brings spend under control without adding risk.
        </p>
        <p>
          Speak to me directly. Be clear, pragmatic, and back your recommendations with Azure best practices.
        </p>
      </div>

      {/* Auto-read toggle and Voice selector */}
      <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input type="checkbox" checked={autoRead} onChange={e => setAutoRead(e.target.checked)} />
          Auto-read questions
        </label>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: "#333" }}>Voice:</span>
          {azureReady ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <select value={azureVoiceName} onChange={e => setAzureVoiceName(e.target.value)}>
                {["en-US-JennyNeural", "en-US-JaneNeural", "en-US-AvaNeural", "en-US-DavisNeural", "en-US-GuyNeural", "en-GB-LibbyNeural", "en-GB-RyanNeural", "en-AU-NatashaNeural", "en-IN-NeerjaNeural"].map(v => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
              <span style={{ color: "#333" }}>Style:</span>
              <select value={azureVoiceStyle} onChange={e => setAzureVoiceStyle(e.target.value)}>
                {["chat", "customerservice", "newscast-casual", "empathetic"].map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          ) : browserFallbackReady ? (
            <select value={webVoiceRef.current?.name || ""} onChange={e => {
              const v = browserVoices.find(bv => bv.name === e.target.value) || null;
              webVoiceRef.current = v;
            }}>
              {browserVoices.map(v => (
                <option key={v.name} value={v.name}>{v.name} ({v.lang})</option>
              ))}
            </select>
          ) : (
            <span style={{ color: "#666" }}>Loading voices…</span>
          )}
        </div>
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

      {!endOfQuiz && (
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
      )}

      <div
        style={{
          border: "1px solid #ddd",
          padding: 16,
          borderRadius: 8,
          backgroundColor: "#f9f9f9",
          marginBottom: 16
        }}
      >
        <h3 style={{ display: "flex", alignItems: "center", gap: 12 }}>🗣️ CTO</h3>
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
          {speaking ? "🔊 Playing..." : "🔊 Play Message"}
        </button>
        {speaking && (
          <button
            onClick={stopSpeaking}
            style={{
              marginLeft: 8,
              padding: "8px 16px",
              backgroundColor: "#f44336",
              color: "white",
              border: "none",
              borderRadius: 4,
              cursor: "pointer"
            }}
          >
            ⏹ Stop
          </button>
        )}
        {/* Pause/Resume applies to user recording, not bot speech */}
        {/* key_phrases are intentionally hidden in the UI; used only for evaluation */}
      </div>

      {!endOfQuiz && (
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
        {listening && (
          <button
            onClick={onStopListening}
            style={{
              marginLeft: 8,
              padding: "12px 24px",
              backgroundColor: "#f44336",
              color: "white",
              border: "none",
              borderRadius: 4,
              cursor: "pointer",
              fontSize: 16,
              fontWeight: "bold"
            }}
          >
            ⏹ Stop Listening
          </button>
        )}
        {listening && (
          <button
            onClick={togglePauseListening}
            style={{
              marginLeft: 8,
              padding: "12px 24px",
              backgroundColor: pausedListening ? "#3F51B5" : "#9E9E9E",
              color: "white",
              border: "none",
              borderRadius: 4,
              cursor: "pointer",
              fontSize: 16,
              fontWeight: "bold"
            }}
          >
            {pausedListening ? "▶️ Resume Listening" : "⏸️ Pause Listening"}
          </button>
        )}

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

        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          <button
            onClick={onSaveAnswer}
            disabled={loading || listening || !transcript.trim() || !question}
            style={{
              padding: "12px 24px",
              backgroundColor: "#4CAF50",
              color: "white",
              border: "none",
              borderRadius: 4,
              cursor: loading || listening || !transcript.trim() || !question ? "not-allowed" : "pointer",
              fontSize: 16,
              fontWeight: "bold"
            }}
          >
            💾 Save Answer
          </button>
          <button
            onClick={onRetryRecording}
            disabled={loading || listening}
            style={{
              padding: "12px 24px",
              backgroundColor: "#FF9800",
              color: "white",
              border: "none",
              borderRadius: 4,
              cursor: loading || listening ? "not-allowed" : "pointer",
              fontSize: 16,
              fontWeight: "bold"
            }}
          >
            🔁 Retry Recording
          </button>
          <button
            onClick={() => setAnswers(prev => ({ ...prev, [question!.id]: transcript.trim() }))}
            disabled={loading || listening || !transcript.trim() || !question}
            style={{
              padding: "12px 24px",
              backgroundColor: "#3F51B5",
              color: "white",
              border: "none",
              borderRadius: 4,
              cursor: loading || listening || !transcript.trim() || !question ? "not-allowed" : "pointer",
              fontSize: 16,
              fontWeight: "bold"
            }}
          >
            📤 Submit Response
          </button>
          <button
            onClick={() => fetchQuestion(idx)}
            disabled={loading || listening || speaking}
            style={{
              padding: "12px 24px",
              backgroundColor: "#2196F3",
              color: "white",
              border: "none",
              borderRadius: 4,
              cursor: loading || listening || speaking ? "not-allowed" : "pointer",
              fontSize: 16,
              fontWeight: "bold"
            }}
          >
            ➡️ Next
          </button>
        </div>
      </div>
      )}

      {/* Review & final submission */}
      {endOfQuiz && !finalResults && (
        <div style={{ border: "1px solid #ddd", padding: 16, borderRadius: 8, background: "#fff" }}>
          <h3>Review your answers</h3>
          <p>You’ve reached the end. Save anything missing, then submit all to see your results with Microsoft Learn links.</p>
          {/* Unanswered questions list */}
          {(() => {
            const unanswered = seenQuestions.filter(q => !answers[q.id]);
            if (unanswered.length === 0) return null;
            return (
              <div style={{ marginTop: 12, padding: 12, background: '#fff8e1', border: '1px solid #ffe082', borderRadius: 6 }}>
                <strong>Unanswered questions ({unanswered.length}):</strong>
                <ul style={{ margin: '8px 0 0 18px' }}>
                  {unanswered.map(u => (
                    <li key={u.id} style={{ marginBottom: 6 }}>
                      {(u.heading || u.id)}
                      <button
                        onClick={() => goToQuestionById(u.id)}
                        style={{ marginLeft: 8, padding: '4px 10px', borderRadius: 4, border: '1px solid #ccc', cursor: 'pointer' }}
                      >
                        Go answer
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })()}
          <div style={{ marginTop: 12 }}>
            {Object.keys(answers).length === 0 && <p>No answers saved yet.</p>}
            {Object.entries(answers).map(([qid, text]) => (
              <div key={qid} style={{ marginBottom: 8 }}>
                <strong>{qid}</strong>
                <div style={{ marginTop: 4, padding: 8, background: "#f9f9f9", borderRadius: 4 }}>{text}</div>
              </div>
            ))}
          </div>
          <button
            onClick={onSubmitAll}
            disabled={loading || Object.keys(answers).length === 0}
            style={{
              padding: "12px 24px",
              marginTop: 12,
              backgroundColor: "#4CAF50",
              color: "white",
              border: "none",
              borderRadius: 4,
              cursor: loading || Object.keys(answers).length === 0 ? "not-allowed" : "pointer",
              fontSize: 16,
              fontWeight: "bold"
            }}
          >
            {loading ? "Evaluating..." : "🚀 Submit All"}
          </button>
        </div>
      )}

      {/* Final results */}
      {finalResults && (
        <div style={{ border: "2px solid #4CAF50", padding: 16, borderRadius: 8, background: "#f1f8f4" }}>
          <h3>✅ Final Evaluation</h3>
          <div style={{ fontSize: 22, marginBottom: 12, fontWeight: "bold" }}>Overall Technical Score: {finalResults.overallScore}%</div>
          
          {/* Overall sentiment summary */}
          {(() => {
            const sentiments = finalResults.results
              .map(r => r.evaluation?.sentiment)
              .filter(s => s && typeof s === 'object');
            if (sentiments.length === 0) return null;
            
            const avgConfidence = Math.round(sentiments.reduce((sum, s) => sum + (s.confidence || 0), 0) / sentiments.length);
            const avgEmpathy = Math.round(sentiments.reduce((sum, s) => sum + (s.empathy || 0), 0) / sentiments.length);
            const avgExecutive = Math.round(sentiments.reduce((sum, s) => sum + (s.executive_presence || 0), 0) / sentiments.length);
            const avgProfessionalism = Math.round(sentiments.reduce((sum, s) => sum + (s.professionalism || 0), 0) / sentiments.length);
            
            const getColor = (score: number) => score >= 70 ? '#4CAF50' : score >= 50 ? '#FF9800' : '#f44336';
            
            return (
              <div style={{ background: '#fff', border: '1px solid #ddd', borderRadius: 8, padding: 16, marginBottom: 16 }}>
                <h4 style={{ marginTop: 0, marginBottom: 12 }}>Communication & Presence Assessment</h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 13, color: '#666', marginBottom: 4 }}>Confidence</div>
                    <div style={{ fontSize: 24, fontWeight: 'bold', color: getColor(avgConfidence) }}>{avgConfidence}%</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 13, color: '#666', marginBottom: 4 }}>Empathy</div>
                    <div style={{ fontSize: 24, fontWeight: 'bold', color: getColor(avgEmpathy) }}>{avgEmpathy}%</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 13, color: '#666', marginBottom: 4 }}>Executive Presence</div>
                    <div style={{ fontSize: 24, fontWeight: 'bold', color: getColor(avgExecutive) }}>{avgExecutive}%</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 13, color: '#666', marginBottom: 4 }}>Professionalism</div>
                    <div style={{ fontSize: 24, fontWeight: 'bold', color: getColor(avgProfessionalism) }}>{avgProfessionalism}%</div>
                  </div>
                </div>
              </div>
            );
          })()}
          
          {finalResults.results.map((r, i) => (
            <div key={i} style={{ background: "#fff", border: "1px solid #ddd", borderRadius: 8, padding: 12, marginBottom: 12 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>{r.heading || r.questionId} {r.topic ? `(${r.topic})` : ""}</div>
              <div style={{ marginBottom: 8 }}>Technical Score: {r.evaluation?.score}%</div>
              <div style={{ marginBottom: 8 }}>
                <strong>Technical Feedback:</strong>
                <div style={{ marginTop: 4, fontStyle: "italic" }}>{r.evaluation?.feedback}</div>
              </div>
              
              {/* Sentiment scores for this question */}
              {r.evaluation?.sentiment && (
                <div style={{ marginTop: 12, padding: 10, background: '#f9f9f9', borderRadius: 6 }}>
                  <strong>Communication Assessment:</strong>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, marginTop: 6, fontSize: 13 }}>
                    <div>Confidence: <strong>{r.evaluation.sentiment.confidence}%</strong></div>
                    <div>Empathy: <strong>{r.evaluation.sentiment.empathy}%</strong></div>
                    <div>Executive Presence: <strong>{r.evaluation.sentiment.executive_presence}%</strong></div>
                    <div>Professionalism: <strong>{r.evaluation.sentiment.professionalism}%</strong></div>
                  </div>
                  {r.evaluation?.sentiment_feedback && (
                    <div style={{ marginTop: 8, fontSize: 13, color: '#555', fontStyle: 'italic' }}>
                      {r.evaluation.sentiment_feedback}
                    </div>
                  )}
                </div>
              )}
              
              {/* Do not expose key phrases or missing phrases in UI */}
              {r.learnLinks?.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <strong>Microsoft Learn resources:</strong>
                  <ul style={{ margin: "6px 0 0 18px" }}>
                    {r.learnLinks.map((l, j) => (
                      <li key={j}><a href={l.url} target="_blank" rel="noreferrer">{l.title}</a></li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


