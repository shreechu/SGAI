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

type UserProfile = {
  name: string;
  email: string;
  technicalConfidence: number;
  consultativeConfidence: number;
};

type SessionResult = {
  userName: string;
  userEmail: string;
  technicalConfidence: number;
  consultativeConfidence: number;
  overallScore: number;
  timestamp: string;
  results: FinalItem[];
};

export default function App() {
  // Page state
  const [currentPage, setCurrentPage] = useState<'landing' | 'quiz' | 'admin' | 'adminLogin'>('landing');
  const [userProfile, setUserProfile] = useState<UserProfile>({ name: '', email: '', technicalConfidence: 5, consultativeConfidence: 5 });
  const [adminSessions, setAdminSessions] = useState<SessionResult[]>([]);
  
  const [question, setQuestion] = useState<Question | null>(null);
  const [idx, setIdx] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [finalResults, setFinalResults] = useState<FinalResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [endOfQuiz, setEndOfQuiz] = useState(false);
  const [showEndConfirmation, setShowEndConfirmation] = useState(false);
  const [seenQuestions, setSeenQuestions] = useState<Array<{ id: string; idx: number; heading?: string; topic?: string }>>([]);
  
  const [listening, setListening] = useState(false);
  const [continuousListening, setContinuousListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [audioPaused, setAudioPaused] = useState(false);
  const [pausedListening, setPausedListening] = useState(false);
  const [azureReady, setAzureReady] = useState(false);
  const [browserFallbackReady, setBrowserFallbackReady] = useState(false);
  const [autoRead, setAutoRead] = useState(true);
  // Using Azure Neural TTS for most realistic voice
  const [currentAudio, setCurrentAudio] = useState<HTMLAudioElement | null>(null);
  const [browserVoices, setBrowserVoices] = useState<SpeechSynthesisVoice[]>([]);

  const recognizerRef = useRef<SpeechSDK.SpeechRecognizer | null>(null);
  const webVoiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const tokenRef = useRef<{ token: string; region: string } | null>(null);

  useEffect(() => {
    if (currentPage === 'quiz') {
      fetchToken();
      fetchQuestion(0);
    }
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
      const audioConfig = SpeechSDK.AudioConfig.fromDefaultMicrophoneInput();
      recognizerRef.current = new SpeechSDK.SpeechRecognizer(speechConfig, audioConfig);
    } catch {}
  }, [azureReady]);

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
      const audioConfig = SpeechSDK.AudioConfig.fromDefaultMicrophoneInput();
      recognizerRef.current = new SpeechSDK.SpeechRecognizer(speechConfig, audioConfig);
      setAzureReady(true);
    } catch (err) {
      console.error("Failed to initialize speech objects:", err);
      setAzureReady(false);
    }
  }

  // Speak helper using Azure Neural TTS for ultra-realistic voice
  async function speakText(text: string) {
    if (!text) return;
    
    // Stop any currently playing audio
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.currentTime = 0;
      setCurrentAudio(null);
    }
    
    setSpeaking(true);
    setAudioPaused(false);
    
    try {
      // Call Azure Neural TTS endpoint
      const response = await axios.post("/api/openai/tts", 
        { text },
        { responseType: "blob" }
      );
      
      // Create audio element from blob
      const audioBlob = new Blob([response.data], { type: "audio/mpeg" });
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      
      audio.onplay = () => {
        setSpeaking(true);
        setAudioPaused(false);
      };
      
      audio.onpause = () => {
        setAudioPaused(true);
      };
      
      audio.onended = () => {
        setSpeaking(false);
        setAudioPaused(false);
        setCurrentAudio(null);
        URL.revokeObjectURL(audioUrl);
      };
      
      audio.onerror = (err) => {
        console.error("Audio playback error:", err);
        setSpeaking(false);
        setAudioPaused(false);
        setCurrentAudio(null);
        URL.revokeObjectURL(audioUrl);
      };
      
      setCurrentAudio(audio);
      await audio.play();
    } catch (err) {
      console.error("Azure Neural TTS failed:", err);
      setSpeaking(false);
      setAudioPaused(false);
      setCurrentAudio(null);
      setError("Failed to generate speech. Please check Azure Speech configuration.");
    }
  }

  function pauseOrResumeSpeaking() {
    if (!currentAudio) return;
    
    try {
      if (currentAudio.paused) {
        currentAudio.play();
        setAudioPaused(false);
      } else {
        currentAudio.pause();
        setAudioPaused(true);
      }
    } catch (err) {
      console.error("Pause/resume failed:", err);
    }
  }

  function stopSpeaking() {
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.currentTime = 0;
      setCurrentAudio(null);
    }
    setSpeaking(false);
    setAudioPaused(false);
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
          return [...prev, { 
            id: resp.data.question.id, 
            idx: i, 
            heading: (resp.data.question as any).heading,
            topic: (resp.data.question as any).topic 
          }];
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
          const errorDetails = e?.errorDetails || "";
          const reason = e?.reason;
          
          // Only show error if it's not a normal user cancellation
          if (reason !== 3) { // 3 = EndOfStream (normal stop)
            console.error("Recognition canceled:", errorDetails, "Reason:", reason);
            if (errorDetails.includes("1006") || errorDetails.includes("websocket")) {
              setError("Unable to connect to Azure Speech service. Using browser fallback.");
            } else if (errorDetails) {
              setError(`Recognition canceled: ${errorDetails}`);
            }
          }
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
          console.error("Speech recognition error:", e);
          const errorType = e?.error || "unknown";
          
          // Handle common errors more gracefully
          if (errorType === "aborted") {
            // Aborted is normal when user stops manually - don't show error
            console.log("Recognition was stopped by user");
          } else if (errorType === "no-speech") {
            setError("No speech detected. Please try speaking again.");
          } else if (errorType === "audio-capture") {
            setError("Microphone not accessible. Please check permissions.");
          } else if (errorType === "not-allowed") {
            setError("Microphone permission denied. Please allow microphone access.");
          } else {
            setError(`Recognition error: ${errorType}`);
          }
          setListening(false);
          setContinuousListening(false);
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

  function handleEndEvaluation() {
    setShowEndConfirmation(true);
  }

  function confirmEndEvaluation() {
    setShowEndConfirmation(false);
    setEndOfQuiz(true);
    onSubmitAll();
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
      
      // Save session result to backend
      await saveSessionResult(resp.data);
    } catch (err: any) {
      setError(`Final evaluation failed: ${err.message}`);
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function saveSessionResult(results: FinalResults) {
    try {
      const sessionData: SessionResult = {
        userName: userProfile.name,
        userEmail: userProfile.email,
        technicalConfidence: userProfile.technicalConfidence,
        consultativeConfidence: userProfile.consultativeConfidence,
        overallScore: results.overallScore,
        timestamp: new Date().toISOString(),
        results: results.results
      };
      await axios.post("/api/sessions", sessionData);
    } catch (err) {
      console.error("Failed to save session:", err);
    }
  }

  async function loadAdminSessions() {
    try {
      const resp = await axios.get("/api/sessions");
      setAdminSessions(resp.data);
    } catch (err) {
      console.error("Failed to load sessions:", err);
    }
  }

  function handleAdminLogin(username: string, password: string) {
    if (username === 'sa' && password === 'test123') {
      setCurrentPage('admin');
      loadAdminSessions();
      return true;
    }
    return false;
  }

  function renderLandingPage() {
    const isFormValid = userProfile.name.trim() && userProfile.email.trim() && userProfile.email.includes('@');
    
    return (
      <div style={{ 
        minHeight: "100vh", 
        background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
        fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
        padding: "40px 20px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center"
      }}>
        <div style={{ maxWidth: 600, width: "100%" }}>
          <div style={{
            background: "white",
            borderRadius: 20,
            boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
            padding: 40
          }}>
            <h1 style={{ 
              fontSize: 32, 
              fontWeight: 700, 
              marginBottom: 8,
              color: "#1a237e",
              textAlign: "center"
            }}>
              Mission Critical Architect Assessment
            </h1>
            <p style={{ 
              fontSize: 16, 
              color: "#666",
              textAlign: "center",
              marginBottom: 32
            }}>
              Azure Reliability & Performance Readiness
            </p>

            <div style={{ marginBottom: 24 }}>
              <label style={{ display: "block", marginBottom: 8, fontWeight: 600, color: "#37474f" }}>
                Full Name *
              </label>
              <input
                type="text"
                value={userProfile.name}
                onChange={e => setUserProfile(prev => ({ ...prev, name: e.target.value }))}
                placeholder="Enter your full name"
                style={{
                  width: "100%",
                  padding: "12px 16px",
                  fontSize: 16,
                  border: "2px solid #e0e0e0",
                  borderRadius: 8,
                  outline: "none",
                  transition: "border-color 0.2s"
                }}
                onFocus={e => e.currentTarget.style.borderColor = "#667eea"}
                onBlur={e => e.currentTarget.style.borderColor = "#e0e0e0"}
              />
            </div>

            <div style={{ marginBottom: 32 }}>
              <label style={{ display: "block", marginBottom: 8, fontWeight: 600, color: "#37474f" }}>
                Email Address *
              </label>
              <input
                type="email"
                value={userProfile.email}
                onChange={e => setUserProfile(prev => ({ ...prev, email: e.target.value }))}
                placeholder="your.email@company.com"
                style={{
                  width: "100%",
                  padding: "12px 16px",
                  fontSize: 16,
                  border: "2px solid #e0e0e0",
                  borderRadius: 8,
                  outline: "none",
                  transition: "border-color 0.2s"
                }}
                onFocus={e => e.currentTarget.style.borderColor = "#667eea"}
                onBlur={e => e.currentTarget.style.borderColor = "#e0e0e0"}
              />
            </div>

            <div style={{ marginBottom: 24 }}>
              <label style={{ display: "block", marginBottom: 12, fontWeight: 600, color: "#37474f" }}>
                How confident are you to have technical conversations with customer executives?
              </label>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 14, color: "#999", minWidth: 30 }}>Low</span>
                <input
                  type="range"
                  min="1"
                  max="10"
                  value={userProfile.technicalConfidence}
                  onChange={e => setUserProfile(prev => ({ ...prev, technicalConfidence: parseInt(e.target.value) }))}
                  style={{ flex: 1 }}
                />
                <span style={{ fontSize: 14, color: "#999", minWidth: 30 }}>High</span>
              </div>
              <div style={{ textAlign: "center", marginTop: 8 }}>
                <span style={{ 
                  display: "inline-block",
                  backgroundColor: "#667eea",
                  color: "white",
                  padding: "6px 16px",
                  borderRadius: 20,
                  fontSize: 18,
                  fontWeight: 700
                }}>
                  {userProfile.technicalConfidence}
                </span>
              </div>
            </div>

            <div style={{ marginBottom: 32 }}>
              <label style={{ display: "block", marginBottom: 12, fontWeight: 600, color: "#37474f" }}>
                How confident are you with consultative skills?
              </label>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 14, color: "#999", minWidth: 30 }}>Low</span>
                <input
                  type="range"
                  min="1"
                  max="10"
                  value={userProfile.consultativeConfidence}
                  onChange={e => setUserProfile(prev => ({ ...prev, consultativeConfidence: parseInt(e.target.value) }))}
                  style={{ flex: 1 }}
                />
                <span style={{ fontSize: 14, color: "#999", minWidth: 30 }}>High</span>
              </div>
              <div style={{ textAlign: "center", marginTop: 8 }}>
                <span style={{ 
                  display: "inline-block",
                  backgroundColor: "#764ba2",
                  color: "white",
                  padding: "6px 16px",
                  borderRadius: 20,
                  fontSize: 18,
                  fontWeight: 700
                }}>
                  {userProfile.consultativeConfidence}
                </span>
              </div>
            </div>

            <button
              onClick={() => setCurrentPage('quiz')}
              disabled={!isFormValid}
              style={{
                width: "100%",
                padding: "16px",
                backgroundColor: isFormValid ? "#4CAF50" : "#ccc",
                color: "white",
                border: "none",
                borderRadius: 12,
                fontSize: 18,
                fontWeight: 700,
                cursor: isFormValid ? "pointer" : "not-allowed",
                transition: "all 0.3s",
                boxShadow: isFormValid ? "0 4px 12px rgba(76, 175, 80, 0.4)" : "none"
              }}
              onMouseEnter={e => {
                if (isFormValid) e.currentTarget.style.transform = "translateY(-2px)";
              }}
              onMouseLeave={e => {
                e.currentTarget.style.transform = "translateY(0)";
              }}
            >
              Begin Assessment →
            </button>

            <button
              onClick={() => setCurrentPage('adminLogin')}
              style={{
                width: "100%",
                marginTop: 16,
                padding: "12px",
                backgroundColor: "transparent",
                color: "#667eea",
                border: "2px solid #667eea",
                borderRadius: 12,
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
                transition: "all 0.3s"
              }}
              onMouseEnter={e => {
                e.currentTarget.style.backgroundColor = "#667eea";
                e.currentTarget.style.color = "white";
              }}
              onMouseLeave={e => {
                e.currentTarget.style.backgroundColor = "transparent";
                e.currentTarget.style.color = "#667eea";
              }}
            >
              🔐 Admin Login
            </button>
          </div>
        </div>
      </div>
    );
  }

  function renderAdminLogin() {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [loginError, setLoginError] = useState('');

    const handleLogin = () => {
      if (handleAdminLogin(username, password)) {
        setLoginError('');
      } else {
        setLoginError('Invalid credentials');
      }
    };

    return (
      <div style={{ 
        minHeight: "100vh", 
        background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
        fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
        padding: "40px 20px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center"
      }}>
        <div style={{ maxWidth: 400, width: "100%" }}>
          <div style={{
            background: "white",
            borderRadius: 20,
            boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
            padding: 40
          }}>
            <h2 style={{ 
              fontSize: 28, 
              fontWeight: 700, 
              marginBottom: 24,
              color: "#1a237e",
              textAlign: "center"
            }}>
              Admin Login
            </h2>

            {loginError && (
              <div style={{
                padding: 12,
                backgroundColor: "#ffebee",
                border: "1px solid #f44336",
                borderRadius: 8,
                marginBottom: 20,
                color: "#c62828",
                textAlign: "center"
              }}>
                {loginError}
              </div>
            )}

            <div style={{ marginBottom: 20 }}>
              <label style={{ display: "block", marginBottom: 8, fontWeight: 600, color: "#37474f" }}>
                Username
              </label>
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="Enter username"
                style={{
                  width: "100%",
                  padding: "12px 16px",
                  fontSize: 16,
                  border: "2px solid #e0e0e0",
                  borderRadius: 8,
                  outline: "none"
                }}
                onKeyPress={e => e.key === 'Enter' && handleLogin()}
              />
            </div>

            <div style={{ marginBottom: 24 }}>
              <label style={{ display: "block", marginBottom: 8, fontWeight: 600, color: "#37474f" }}>
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Enter password"
                style={{
                  width: "100%",
                  padding: "12px 16px",
                  fontSize: 16,
                  border: "2px solid #e0e0e0",
                  borderRadius: 8,
                  outline: "none"
                }}
                onKeyPress={e => e.key === 'Enter' && handleLogin()}
              />
            </div>

            <button
              onClick={handleLogin}
              style={{
                width: "100%",
                padding: "14px",
                backgroundColor: "#667eea",
                color: "white",
                border: "none",
                borderRadius: 12,
                fontSize: 16,
                fontWeight: 700,
                cursor: "pointer",
                marginBottom: 12
              }}
            >
              Login
            </button>

            <button
              onClick={() => setCurrentPage('landing')}
              style={{
                width: "100%",
                padding: "12px",
                backgroundColor: "transparent",
                color: "#666",
                border: "none",
                fontSize: 14,
                cursor: "pointer"
              }}
            >
              ← Back to Home
            </button>
          </div>
        </div>
      </div>
    );
  }

  function renderAdminDashboard() {
    return (
      <div style={{ 
        minHeight: "100vh", 
        background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
        fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
        padding: "20px"
      }}>
        <div style={{ maxWidth: 1400, margin: "0 auto" }}>
          <div style={{
            background: "white",
            borderRadius: 20,
            boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
            padding: 32
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
              <h1 style={{ 
                fontSize: 32, 
                fontWeight: 700,
                color: "#1a237e",
                margin: 0
              }}>
                Admin Dashboard
              </h1>
              <button
                onClick={() => setCurrentPage('landing')}
                style={{
                  padding: "10px 20px",
                  backgroundColor: "#f44336",
                  color: "white",
                  border: "none",
                  borderRadius: 8,
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer"
                }}
              >
                Logout
              </button>
            </div>

            <p style={{ color: "#666", marginBottom: 24 }}>
              Total Sessions: <strong>{adminSessions.length}</strong>
            </p>

            <div style={{ overflowX: "auto" }}>
              <table style={{ 
                width: "100%", 
                borderCollapse: "collapse",
                fontSize: 14
              }}>
                <thead>
                  <tr style={{ backgroundColor: "#f5f5f5" }}>
                    <th style={{ padding: 12, textAlign: "left", borderBottom: "2px solid #ddd" }}>Date</th>
                    <th style={{ padding: 12, textAlign: "left", borderBottom: "2px solid #ddd" }}>Name</th>
                    <th style={{ padding: 12, textAlign: "left", borderBottom: "2px solid #ddd" }}>Email</th>
                    <th style={{ padding: 12, textAlign: "center", borderBottom: "2px solid #ddd" }}>Technical Conf.</th>
                    <th style={{ padding: 12, textAlign: "center", borderBottom: "2px solid #ddd" }}>Consultative Conf.</th>
                    <th style={{ padding: 12, textAlign: "center", borderBottom: "2px solid #ddd" }}>Overall Score</th>
                  </tr>
                </thead>
                <tbody>
                  {adminSessions.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ padding: 24, textAlign: "center", color: "#999" }}>
                        No sessions recorded yet
                      </td>
                    </tr>
                  ) : (
                    adminSessions.map((session, idx) => (
                      <tr key={idx} style={{ borderBottom: "1px solid #eee" }}>
                        <td style={{ padding: 12 }}>
                          {new Date(session.timestamp).toLocaleDateString()} {new Date(session.timestamp).toLocaleTimeString()}
                        </td>
                        <td style={{ padding: 12, fontWeight: 600 }}>{session.userName}</td>
                        <td style={{ padding: 12 }}>{session.userEmail}</td>
                        <td style={{ padding: 12, textAlign: "center" }}>
                          <span style={{
                            backgroundColor: session.technicalConfidence >= 7 ? "#4CAF50" : session.technicalConfidence >= 4 ? "#FF9800" : "#f44336",
                            color: "white",
                            padding: "4px 12px",
                            borderRadius: 12,
                            fontSize: 13,
                            fontWeight: 600
                          }}>
                            {session.technicalConfidence}/10
                          </span>
                        </td>
                        <td style={{ padding: 12, textAlign: "center" }}>
                          <span style={{
                            backgroundColor: session.consultativeConfidence >= 7 ? "#4CAF50" : session.consultativeConfidence >= 4 ? "#FF9800" : "#f44336",
                            color: "white",
                            padding: "4px 12px",
                            borderRadius: 12,
                            fontSize: 13,
                            fontWeight: 600
                          }}>
                            {session.consultativeConfidence}/10
                          </span>
                        </td>
                        <td style={{ padding: 12, textAlign: "center" }}>
                          <span style={{
                            backgroundColor: session.overallScore >= 70 ? "#4CAF50" : session.overallScore >= 40 ? "#FF9800" : "#f44336",
                            color: "white",
                            padding: "4px 16px",
                            borderRadius: 12,
                            fontSize: 14,
                            fontWeight: 700
                          }}>
                            {session.overallScore}%
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (currentPage === 'landing') {
    return renderLandingPage();
  }

  if (currentPage === 'adminLogin') {
    return renderAdminLogin();
  }

  if (currentPage === 'admin') {
    return renderAdminDashboard();
  }

  return (
    <div style={{ 
      minHeight: "100vh", 
      background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
      fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
      padding: "20px 20px"
    }}>
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <div style={{ 
          textAlign: "center", 
          color: "white", 
          marginBottom: 20 
        }}>
          <h1 style={{ 
            fontSize: 32, 
            fontWeight: 700, 
            marginBottom: 4,
            textShadow: "0 2px 4px rgba(0,0,0,0.1)"
          }}>
            Mission Critical Architect Assessment
          </h1>
          <p style={{ fontSize: 16, opacity: 0.95 }}>
            Azure Reliability & Performance Readiness
          </p>
        </div>

        <div style={{
          background: "white",
          borderRadius: 16,
          boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
          padding: 20,
          marginBottom: 24
        }}>
          <div style={{
            padding: 16,
            background: "linear-gradient(135deg, #f093fb 0%, #f5576c 100%)",
            borderRadius: 12,
            color: "white",
            marginBottom: 16
          }}>
            <p style={{ marginBottom: 12, fontSize: 16, fontWeight: 600 }}>
              <strong>CTO of Zava speaks{userProfile.name ? ` to ${userProfile.name}` : ''}:</strong>
            </p>
            <p style={{ fontSize: 15, lineHeight: 1.6, opacity: 0.95 }}>
              Our mission-critical app has had too many outages, and our support experience hasn't met expectations. I need a practical plan that improves reliability quickly, shortens detection and recovery times, and brings spend under control without adding risk.
            </p>
            <p style={{ fontSize: 15, lineHeight: 1.6, opacity: 0.95, marginTop: 8 }}>
              Speak to me directly{userProfile.name ? `, ${userProfile.name.split(' ')[0]}` : ''}. Be clear, pragmatic, and back your recommendations with Azure best practices.
            </p>
          </div>

          {/* Auto-read toggle */}
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
            
            <div style={{ fontSize: 13, color: "#666", marginLeft: "auto" }}>
              {azureReady ? "🎙️ OpenAI GPT Audio Active" : "Loading..."}
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
                title={speaking ? (audioPaused ? "Resume" : "Pause") : "Play message"}
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
                {audioPaused ? "▶️" : speaking ? "⏸" : "▶️"}
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
              <button
                onClick={handleEndEvaluation}
                disabled={loading || listening || speaking || seenQuestions.length === 0}
                title="End Evaluation"
                style={{
                  padding: "12px 24px",
                  backgroundColor: "#9C27B0",
                  color: "white",
                  border: "none",
                  borderRadius: "24px",
                  cursor: loading || listening || speaking || seenQuestions.length === 0 ? "not-allowed" : "pointer",
                  fontSize: 14,
                  fontWeight: 600,
                  boxShadow: "0 4px 8px rgba(0,0,0,0.15)",
                  transition: "all 200ms",
                  opacity: loading || listening || speaking || seenQuestions.length === 0 ? 0.5 : 1
                }}
                onMouseEnter={e => {
                  if (!(loading || listening || speaking || seenQuestions.length === 0)) {
                    e.currentTarget.style.transform = "scale(1.05)";
                  }
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.transform = "scale(1)";
                }}
              >
                🏁 End Evaluation
              </button>
            </div>
          </div>
          )}

      {/* End Evaluation Confirmation Modal */}
      {showEndConfirmation && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: "rgba(0,0,0,0.6)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 1000
        }}>
          <div style={{
            background: "white",
            borderRadius: 16,
            padding: 32,
            maxWidth: 500,
            width: "90%",
            boxShadow: "0 20px 60px rgba(0,0,0,0.3)"
          }}>
            <h2 style={{ marginTop: 0, marginBottom: 16, color: "#1a237e" }}>End Evaluation?</h2>
            
            {(() => {
              const unansweredTopics = seenQuestions.filter(q => !answers[q.id]);
              const totalQuestions = 12;
              const answeredCount = Object.keys(answers).length;
              const unseenCount = totalQuestions - seenQuestions.length;
              
              return (
                <>
                  <p style={{ marginBottom: 16, color: "#37474f" }}>
                    You have answered <strong>{answeredCount}</strong> out of <strong>{seenQuestions.length}</strong> questions seen.
                  </p>
                  
                  {unseenCount > 0 && (
                    <div style={{ 
                      padding: 12, 
                      background: "#fff3e0", 
                      border: "2px solid #ff9800", 
                      borderRadius: 8,
                      marginBottom: 16 
                    }}>
                      <strong style={{ color: "#e65100" }}>⚠️ {unseenCount} questions not yet viewed</strong>
                    </div>
                  )}
                  
                  {unansweredTopics.length > 0 && (
                    <div style={{ 
                      padding: 12, 
                      background: "#ffebee", 
                      border: "1px solid #ef5350", 
                      borderRadius: 8,
                      marginBottom: 16 
                    }}>
                      <strong style={{ color: "#c62828" }}>Topics not covered ({unansweredTopics.length}):</strong>
                      <ul style={{ margin: "8px 0 0 20px", paddingLeft: 0 }}>
                        {unansweredTopics.map(q => (
                          <li key={q.id} style={{ marginBottom: 4, color: "#d32f2f" }}>
                            {q.topic || q.heading || q.id}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  
                  <p style={{ marginBottom: 24, color: "#37474f" }}>
                    Are you sure you want to end the evaluation and see your results?
                  </p>
                  
                  <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
                    <button
                      onClick={() => setShowEndConfirmation(false)}
                      style={{
                        padding: "12px 24px",
                        backgroundColor: "#9E9E9E",
                        color: "white",
                        border: "none",
                        borderRadius: 8,
                        cursor: "pointer",
                        fontSize: 14,
                        fontWeight: 600
                      }}
                    >
                      No, Continue
                    </button>
                    <button
                      onClick={confirmEndEvaluation}
                      style={{
                        padding: "12px 24px",
                        backgroundColor: "#4CAF50",
                        color: "white",
                        border: "none",
                        borderRadius: 8,
                        cursor: "pointer",
                        fontSize: 14,
                        fontWeight: 600
                      }}
                    >
                      Yes, End & Show Results
                    </button>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* End Evaluation Confirmation Modal */}
      {showEndConfirmation && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: "rgba(0,0,0,0.6)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 1000
        }}>
          <div style={{
            background: "white",
            borderRadius: 16,
            padding: 32,
            maxWidth: 500,
            width: "90%",
            boxShadow: "0 20px 60px rgba(0,0,0,0.3)"
          }}>
            <h2 style={{ marginTop: 0, marginBottom: 16, color: "#1a237e" }}>End Evaluation?</h2>
            
            {(() => {
              const unansweredTopics = seenQuestions.filter(q => !answers[q.id]);
              const totalQuestions = 12;
              const answeredCount = Object.keys(answers).length;
              const unseenCount = totalQuestions - seenQuestions.length;
              
              return (
                <>
                  <p style={{ marginBottom: 16, color: "#37474f" }}>
                    You have answered <strong>{answeredCount}</strong> out of <strong>{seenQuestions.length}</strong> questions seen.
                  </p>
                  
                  {unseenCount > 0 && (
                    <div style={{ 
                      padding: 12, 
                      background: "#fff3e0", 
                      border: "2px solid #ff9800", 
                      borderRadius: 8,
                      marginBottom: 16 
                    }}>
                      <strong style={{ color: "#e65100" }}>⚠️ {unseenCount} questions not yet viewed</strong>
                    </div>
                  )}
                  
                  {unansweredTopics.length > 0 && (
                    <div style={{ 
                      padding: 12, 
                      background: "#ffebee", 
                      border: "1px solid #ef5350", 
                      borderRadius: 8,
                      marginBottom: 16 
                    }}>
                      <strong style={{ color: "#c62828" }}>Topics not covered ({unansweredTopics.length}):</strong>
                      <ul style={{ margin: "8px 0 0 20px", paddingLeft: 0 }}>
                        {unansweredTopics.map(q => (
                          <li key={q.id} style={{ marginBottom: 4, color: "#d32f2f" }}>
                            {q.topic || q.heading || q.id}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  
                  <p style={{ marginBottom: 24, color: "#37474f" }}>
                    Are you sure you want to end the evaluation and see your results?
                  </p>
                  
                  <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
                    <button
                      onClick={() => setShowEndConfirmation(false)}
                      style={{
                        padding: "12px 24px",
                        backgroundColor: "#9E9E9E",
                        color: "white",
                        border: "none",
                        borderRadius: 8,
                        cursor: "pointer",
                        fontSize: 14,
                        fontWeight: 600
                      }}
                    >
                      No, Continue
                    </button>
                    <button
                      onClick={confirmEndEvaluation}
                      style={{
                        padding: "12px 24px",
                        backgroundColor: "#4CAF50",
                        color: "white",
                        border: "none",
                        borderRadius: 8,
                        cursor: "pointer",
                        fontSize: 14,
                        fontWeight: 600
                      }}
                    >
                      Yes, End & Show Results
                    </button>
                  </div>
                </>
              );
            })()}
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


