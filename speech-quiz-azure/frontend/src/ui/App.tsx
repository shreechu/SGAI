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

  // Rebuild Azure synthesizer when voice or style changes
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
  }, [azureVoiceName, azureVoiceStyle, azureReady]);

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

  function pauseOrResumeSpeaking() {
    try {
      if (typeof window !== "undefined" && window.speechSynthesis) {
        if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
          window.speechSynthesis.pause();
        } else if (window.speechSynthesis.paused) {
          window.speechSynthesis.resume();
        }
      }
      // Note: Azure Speech SDK doesn't have built-in pause/resume for TTS
      // For Azure, we'd need to implement chunking or use stop/restart
    } catch (err) {
      console.error("Pause/resume failed:", err);
    }
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
    <div style={{ 
      minHeight: "100vh", 
      background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
      fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
      padding: "40px 20px"
    }}>
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <div style={{ 
          textAlign: "center", 
          color: "white", 
          marginBottom: 40 
        }}>
          <h1 style={{ 
            fontSize: 42, 
            fontWeight: 700, 
            marginBottom: 8,
            textShadow: "0 2px 4px rgba(0,0,0,0.1)"
          }}>
            Mission Critical Architect Assessment
          </h1>
          <p style={{ fontSize: 18, opacity: 0.95 }}>
            Azure Reliability & Performance Readiness
          </p>
        </div>

        <div style={{
          background: "white",
          borderRadius: 16,
          boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
          padding: 32,
          marginBottom: 24
        }}>
          <div style={{
            padding: 20,
            background: "linear-gradient(135deg, #f093fb 0%, #f5576c 100%)",
            borderRadius: 12,
            color: "white",
            marginBottom: 24
          }}>
            <p style={{ marginBottom: 12, fontSize: 16, fontWeight: 600 }}>
              <strong>CTO of Zava speaks:</strong>
            </p>
            <p style={{ fontSize: 15, lineHeight: 1.6, opacity: 0.95 }}>
              Our mission-critical app has had too many outages, and our support experience hasn't met expectations. I need a practical plan that improves reliability quickly, shortens detection and recovery times, and brings spend under control without adding risk.
            </p>
            <p style={{ fontSize: 15, lineHeight: 1.6, opacity: 0.95, marginTop: 8 }}>
              Speak to me directly. Be clear, pragmatic, and back your recommendations with Azure best practices.
            </p>
          </div>

          {/* Auto-read toggle and Voice selector */}
          <div style={{ 
            display: "flex", 
            gap: 16, 
            alignItems: "center", 
            flexWrap: "wrap", 
            padding: 16,
            background: "#f8f9fa",
            borderRadius: 8,
            marginBottom: 24
          }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input type="checkbox" checked={autoRead} onChange={e => setAutoRead(e.target.checked)} />
              <span style={{ fontSize: 14 }}>Auto-read questions</span>
            </label>

            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ color: "#555", fontSize: 14, fontWeight: 600 }}>Voice:</span>
              {azureReady ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <select 
                    value={azureVoiceName} 
                    onChange={e => setAzureVoiceName(e.target.value)}
                    style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: 14 }}
                  >
                    {["en-US-JennyNeural", "en-US-JaneNeural", "en-US-AvaNeural", "en-US-DavisNeural", "en-US-GuyNeural", "en-GB-LibbyNeural", "en-GB-RyanNeural", "en-AU-NatashaNeural", "en-IN-NeerjaNeural"].map(v => (
                      <option key={v} value={v}>{v}</option>
                    ))}
                  </select>
                  <span style={{ color: "#555", fontSize: 14, fontWeight: 600 }}>Style:</span>
                  <select 
                    value={azureVoiceStyle} 
                    onChange={e => setAzureVoiceStyle(e.target.value)}
                    style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: 14 }}
                  >
                    {["chat", "customerservice", "newscast-casual", "empathetic"].map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
              ) : browserFallbackReady ? (
                <select 
                  value={webVoiceRef.current?.name || ""} 
                  onChange={e => {
                    const v = browserVoices.find(bv => bv.name === e.target.value) || null;
                    webVoiceRef.current = v;
                  }}
                  style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: 14 }}
                >
                  {browserVoices.map(v => (
                    <option key={v.name} value={v.name}>{v.name} ({v.lang})</option>
                  ))}
                </select>
              ) : (
                <span style={{ color: "#999", fontSize: 14 }}>Loading voices…</span>
              )}
            </div>
          </div>

          {error && (
            <div
              style={{
                padding: 16,
                backgroundColor: "#fee",
                border: "2px solid #f44336",
                borderRadius: 12,
                marginBottom: 24,
                color: "#c62828",
                fontSize: 15,
                fontWeight: 500
              }}
            >
              ⚠️ {error}
            </div>
          )}

          {/* CTO Avatar and Question */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              padding: 32,
              background: "linear-gradient(135deg, #e0f7fa 0%, #e1bee7 100%)",
              borderRadius: 16,
              marginBottom: 24,
              boxShadow: "0 4px 12px rgba(0,0,0,0.1)"
            }}
          >
            <div style={{ 
              marginBottom: 24,
              position: "relative"
            }}>
              <img
                src="https://ui-avatars.com/api/?name=Mark+CTO&size=180&background=667eea&color=fff&bold=true&font-size=0.4"
                alt="Mark - CTO"
                onError={(e) => {
                  (e.target as HTMLImageElement).src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Ccircle cx='90' cy='90' r='90' fill='%23667eea'/%3E%3Ctext x='50%25' y='50%25' text-anchor='middle' dy='.3em' fill='white' font-size='60' font-family='Arial' font-weight='bold'%3EMC%3C/text%3E%3C/svg%3E";
                }}
                style={{
                  width: 180,
                  height: 180,
                  borderRadius: "50%",
                  border: speaking ? "6px solid #4CAF50" : "6px solid white",
                  boxShadow: speaking ? "0 0 0 8px rgba(76,175,80,0.3), 0 8px 24px rgba(0,0,0,0.2)" : "0 8px 24px rgba(0,0,0,0.15)",
                  transition: "all 300ms ease-in-out",
                  animation: speaking ? "pulse 1.5s ease-in-out infinite" : "none"
                }}
              />
              {speaking && (
                <div style={{
                  position: "absolute",
                  top: -10,
                  right: -10,
                  background: "#4CAF50",
                  color: "white",
                  padding: "8px 12px",
                  borderRadius: 20,
                  fontSize: 12,
                  fontWeight: 700,
                  boxShadow: "0 4px 8px rgba(0,0,0,0.2)"
                }}>
                  SPEAKING
                </div>
              )}
            </div>
            <h3 style={{ 
              fontSize: 24, 
              fontWeight: 700, 
              color: "#1a237e",
              marginBottom: 8
            }}>
              Mark, CTO at Zava
            </h3>
            <p style={{ 
              fontSize: 18, 
              lineHeight: 1.7, 
              color: "#37474f",
              textAlign: "center",
              maxWidth: 800,
              marginBottom: 20
            }}>
              {question?.question || "Loading question..."}
            </p>
            
            <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
              <button
                onClick={speaking ? pauseOrResumeSpeaking : onPlayQuestion}
                disabled={!question || listening}
                title={speaking ? "Pause/Resume speaking" : "Play message"}
                style={{
                  width: 48,
                  height: 48,
                  backgroundColor: speaking ? "#FF9800" : "#2196F3",
                  color: "white",
                  border: "none",
                  borderRadius: "50%",
                  cursor: !question || listening ? "not-allowed" : "pointer",
                  fontSize: 20,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: "0 4px 8px rgba(0,0,0,0.15)",
                  transition: "all 200ms",
                  opacity: !question || listening ? 0.5 : 1
                }}
                onMouseEnter={e => {
                  if (!(!question || listening)) {
                    e.currentTarget.style.transform = "scale(1.1)";
                  }
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.transform = "scale(1)";
                }}
              >
                {speaking && typeof window !== "undefined" && window.speechSynthesis?.paused ? "▶️" : speaking ? "⏸" : "▶️"}
              </button>
              {speaking && (
                <button
                  onClick={stopSpeaking}
                  title="Stop speaking"
                  style={{
                    width: 48,
                    height: 48,
                    backgroundColor: "#f44336",
                    color: "white",
                    border: "none",
                    borderRadius: "50%",
                    cursor: "pointer",
                    fontSize: 20,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    boxShadow: "0 4px 8px rgba(0,0,0,0.15)",
                    transition: "all 200ms"
                  }}
                  onMouseEnter={e => e.currentTarget.style.transform = "scale(1.1)"}
                  onMouseLeave={e => e.currentTarget.style.transform = "scale(1)"}
                >
                  ⏹
                </button>
              )}
            </div>
          </div>

          {!endOfQuiz && (
          <div
            style={{
              background: "white",
              padding: 24,
              borderRadius: 16,
              boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
              marginBottom: 24
            }}
          >
            <h3 style={{ 
              fontSize: 22, 
              fontWeight: 700, 
              color: "#1a237e",
              marginBottom: 16,
              display: "flex",
              alignItems: "center",
              gap: 8
            }}>
              🎙️ Your Response
            </h3>
            <p style={{ color: "#666", marginBottom: 20, fontSize: 15 }}>
              Click the microphone to start recording. Speak naturally and the app will transcribe your answer.
            </p>
            
            <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap", justifyContent: "center" }}>
              <button
                onClick={onStartListening}
                disabled={loading || listening || (!azureReady && !browserFallbackReady)}
                title="Start listening"
                style={{
                  width: 56,
                  height: 56,
                  backgroundColor: listening ? "#FF9800" : "#4CAF50",
                  color: "white",
                  border: "none",
                  borderRadius: "50%",
                  cursor: loading || listening || (!azureReady && !browserFallbackReady) ? "not-allowed" : "pointer",
                  fontSize: 24,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: listening ? "0 0 0 8px rgba(255,152,0,0.3), 0 4px 12px rgba(0,0,0,0.2)" : "0 4px 12px rgba(0,0,0,0.15)",
                  transition: "all 200ms",
                  opacity: loading || (!azureReady && !browserFallbackReady) ? 0.5 : 1
                }}
                onMouseEnter={e => {
                  if (!(loading || listening || (!azureReady && !browserFallbackReady))) {
                    e.currentTarget.style.transform = "scale(1.1)";
                  }
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.transform = "scale(1)";
                }}
              >
                🎤
              </button>
              
              {listening && (
                <>
                  <button
                    onClick={onStopListening}
                    title="Stop listening"
                    style={{
                      width: 56,
                      height: 56,
                      backgroundColor: "#f44336",
                      color: "white",
                      border: "none",
                      borderRadius: "50%",
                      cursor: "pointer",
                      fontSize: 24,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                      transition: "all 200ms"
                    }}
                    onMouseEnter={e => e.currentTarget.style.transform = "scale(1.1)"}
                    onMouseLeave={e => e.currentTarget.style.transform = "scale(1)"}
                  >
                    ⏹
                  </button>
                  <button
                    onClick={togglePauseListening}
                    title={pausedListening ? "Resume listening" : "Pause listening"}
                    style={{
                      width: 56,
                      height: 56,
                      backgroundColor: pausedListening ? "#3F51B5" : "#9E9E9E",
                      color: "white",
                      border: "none",
                      borderRadius: "50%",
                      cursor: "pointer",
                      fontSize: 24,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                      transition: "all 200ms"
                    }}
                    onMouseEnter={e => e.currentTarget.style.transform = "scale(1.1)"}
                    onMouseLeave={e => e.currentTarget.style.transform = "scale(1)"}
                  >
                    {pausedListening ? "▶️" : "⏸"}
                  </button>
                </>
              )}
            </div>

            <div style={{ textAlign: "center", color: "#999", fontSize: 13, marginBottom: 16 }}>
              {azureReady ? "✓ Azure Speech SDK" : browserFallbackReady ? "✓ Browser Speech" : "Speech not available"}
            </div>

            {transcript && (
              <div
                style={{
                  marginTop: 16,
                  padding: 16,
                  backgroundColor: "#f8f9fa",
                  border: "2px solid #e0e0e0",
                  borderRadius: 12
                }}
              >
                <strong style={{ color: "#1a237e", fontSize: 15 }}>Your answer:</strong>
                <p style={{ marginTop: 12, fontSize: 15, lineHeight: 1.6, color: "#37474f" }}>{transcript}</p>
              </div>
            )}

            <div style={{ display: "flex", gap: 12, marginTop: 20, flexWrap: "wrap", justifyContent: "center" }}>
              <button
                onClick={onSaveAnswer}
                disabled={loading || listening || !transcript.trim() || !question}
                title="Save answer"
                style={{
                  width: 48,
                  height: 48,
                  backgroundColor: "#4CAF50",
                  color: "white",
                  border: "none",
                  borderRadius: "50%",
                  cursor: loading || listening || !transcript.trim() || !question ? "not-allowed" : "pointer",
                  fontSize: 20,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: "0 4px 8px rgba(0,0,0,0.15)",
                  transition: "all 200ms",
                  opacity: loading || listening || !transcript.trim() || !question ? 0.5 : 1
                }}
                onMouseEnter={e => {
                  if (!(loading || listening || !transcript.trim() || !question)) {
                    e.currentTarget.style.transform = "scale(1.1)";
                  }
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.transform = "scale(1)";
                }}
              >
                💾
              </button>
              <button
                onClick={onRetryRecording}
                disabled={loading || listening}
                title="Retry recording"
                style={{
                  width: 48,
                  height: 48,
                  backgroundColor: "#FF9800",
                  color: "white",
                  border: "none",
                  borderRadius: "50%",
                  cursor: loading || listening ? "not-allowed" : "pointer",
                  fontSize: 20,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: "0 4px 8px rgba(0,0,0,0.15)",
                  transition: "all 200ms",
                  opacity: loading || listening ? 0.5 : 1
                }}
                onMouseEnter={e => {
                  if (!(loading || listening)) {
                    e.currentTarget.style.transform = "scale(1.1)";
                  }
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.transform = "scale(1)";
                }}
              >
                🔁
              </button>
              <button
                onClick={() => setAnswers(prev => ({ ...prev, [question!.id]: transcript.trim() }))}
                disabled={loading || listening || !transcript.trim() || !question}
                title="Submit response"
                style={{
                  width: 48,
                  height: 48,
                  backgroundColor: "#3F51B5",
                  color: "white",
                  border: "none",
                  borderRadius: "50%",
                  cursor: loading || listening || !transcript.trim() || !question ? "not-allowed" : "pointer",
                  fontSize: 20,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: "0 4px 8px rgba(0,0,0,0.15)",
                  transition: "all 200ms",
                  opacity: loading || listening || !transcript.trim() || !question ? 0.5 : 1
                }}
                onMouseEnter={e => {
                  if (!(loading || listening || !transcript.trim() || !question)) {
                    e.currentTarget.style.transform = "scale(1.1)";
                  }
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.transform = "scale(1)";
                }}
              >
                📤
              </button>
              <button
                onClick={() => fetchQuestion(idx)}
                disabled={loading || listening || speaking}
                title="Next question"
                style={{
                  width: 48,
                  height: 48,
                  backgroundColor: "#2196F3",
                  color: "white",
                  border: "none",
                  borderRadius: "50%",
                  cursor: loading || listening || speaking ? "not-allowed" : "pointer",
                  fontSize: 20,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: "0 4px 8px rgba(0,0,0,0.15)",
                  transition: "all 200ms",
                  opacity: loading || listening || speaking ? 0.5 : 1
                }}
                onMouseEnter={e => {
                  if (!(loading || listening || speaking)) {
                    e.currentTarget.style.transform = "scale(1.1)";
                  }
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.transform = "scale(1)";
                }}
              >
                ➡️
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
            <div style={{ 
              background: "white",
              padding: 32,
              borderRadius: 16,
              boxShadow: "0 4px 12px rgba(0,0,0,0.1)"
            }}>
              <h3 style={{ fontSize: 28, fontWeight: 700, color: "#1a237e", marginBottom: 8 }}>
                ✅ Final Evaluation
              </h3>
              <div style={{ 
                fontSize: 48, 
                marginBottom: 24, 
                fontWeight: 800,
                background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text"
              }}>
                Technical Score: {finalResults.overallScore}%
              </div>
              
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
                  <div style={{ 
                    background: 'linear-gradient(135deg, #e0f7fa 0%, #e1bee7 100%)', 
                    borderRadius: 16, 
                    padding: 24, 
                    marginBottom: 24,
                    boxShadow: "0 4px 12px rgba(0,0,0,0.08)"
                  }}>
                    <h4 style={{ marginTop: 0, marginBottom: 20, fontSize: 22, fontWeight: 700, color: "#1a237e" }}>
                      Communication & Presence Assessment
                    </h4>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 20 }}>
                      <div style={{ textAlign: "center" }}>
                        <div style={{ fontSize: 13, color: '#555', marginBottom: 8, fontWeight: 600 }}>Confidence</div>
                        <div style={{ fontSize: 36, fontWeight: 800, color: getColor(avgConfidence) }}>{avgConfidence}%</div>
                      </div>
                      <div style={{ textAlign: "center" }}>
                        <div style={{ fontSize: 13, color: '#555', marginBottom: 8, fontWeight: 600 }}>Empathy</div>
                        <div style={{ fontSize: 36, fontWeight: 800, color: getColor(avgEmpathy) }}>{avgEmpathy}%</div>
                      </div>
                      <div style={{ textAlign: "center" }}>
                        <div style={{ fontSize: 13, color: '#555', marginBottom: 8, fontWeight: 600 }}>Executive Presence</div>
                        <div style={{ fontSize: 36, fontWeight: 800, color: getColor(avgExecutive) }}>{avgExecutive}%</div>
                      </div>
                      <div style={{ textAlign: "center" }}>
                        <div style={{ fontSize: 13, color: '#555', marginBottom: 8, fontWeight: 600 }}>Professionalism</div>
                        <div style={{ fontSize: 36, fontWeight: 800, color: getColor(avgProfessionalism) }}>{avgProfessionalism}%</div>
                      </div>
                    </div>
                  </div>
                );
              })()}
              
              {finalResults.results.map((r, i) => (
                <div key={i} style={{ 
                  background: "#f8f9fa", 
                  border: "2px solid #e0e0e0", 
                  borderRadius: 16, 
                  padding: 20, 
                  marginBottom: 20 
                }}>
                  <div style={{ fontWeight: 700, marginBottom: 12, fontSize: 18, color: "#1a237e" }}>
                    {r.heading || r.questionId} {r.topic ? `(${r.topic})` : ""}
                  </div>
                  <div style={{ marginBottom: 12, fontSize: 16, fontWeight: 600, color: "#4CAF50" }}>
                    Technical Score: {r.evaluation?.score}%
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <strong style={{ color: "#555" }}>Technical Feedback:</strong>
                    <div style={{ marginTop: 6, fontStyle: "italic", fontSize: 14, color: "#37474f" }}>
                      {r.evaluation?.feedback}
                    </div>
                  </div>
                  
                  {/* Sentiment scores for this question */}
                  {r.evaluation?.sentiment && (
                    <div style={{ marginTop: 16, padding: 16, background: 'white', borderRadius: 12, border: "1px solid #e0e0e0" }}>
                      <strong style={{ color: "#555" }}>Communication Assessment:</strong>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginTop: 12, fontSize: 14 }}>
                        <div>
                          <span style={{ color: "#666" }}>Confidence:</span> 
                          <strong style={{ marginLeft: 6, color: "#1a237e" }}>{r.evaluation.sentiment.confidence}%</strong>
                        </div>
                        <div>
                          <span style={{ color: "#666" }}>Empathy:</span> 
                          <strong style={{ marginLeft: 6, color: "#1a237e" }}>{r.evaluation.sentiment.empathy}%</strong>
                        </div>
                        <div>
                          <span style={{ color: "#666" }}>Executive Presence:</span> 
                          <strong style={{ marginLeft: 6, color: "#1a237e" }}>{r.evaluation.sentiment.executive_presence}%</strong>
                        </div>
                        <div>
                          <span style={{ color: "#666" }}>Professionalism:</span> 
                          <strong style={{ marginLeft: 6, color: "#1a237e" }}>{r.evaluation.sentiment.professionalism}%</strong>
                        </div>
                      </div>
                      {r.evaluation?.sentiment_feedback && (
                        <div style={{ marginTop: 12, fontSize: 14, color: '#555', fontStyle: 'italic', padding: 12, background: "#f8f9fa", borderRadius: 8 }}>
                          💡 {r.evaluation.sentiment_feedback}
                        </div>
                      )}
                    </div>
                  )}
                  
                  {/* Do not expose key phrases or missing phrases in UI */}
                  {r.learnLinks?.length > 0 && (
                    <div style={{ marginTop: 16 }}>
                      <strong style={{ color: "#555" }}>📚 Microsoft Learn Resources:</strong>
                      <ul style={{ margin: "10px 0 0 20px", lineHeight: 1.8 }}>
                        {r.learnLinks.map((l, j) => (
                          <li key={j} style={{ fontSize: 14 }}>
                            <a 
                              href={l.url} 
                              target="_blank" 
                              rel="noreferrer"
                              style={{ 
                                color: "#2196F3", 
                                textDecoration: "none",
                                fontWeight: 500
                              }}
                              onMouseEnter={e => e.currentTarget.style.textDecoration = "underline"}
                              onMouseLeave={e => e.currentTarget.style.textDecoration = "none"}
                            >
                              {l.title}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <style>{`
        @keyframes pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.05); }
        }
      `}</style>
    </div>
  );
}


