import { useEffect, useRef, useState } from "react";
import { BrowserRouter, useNavigate, useLocation } from "react-router-dom";
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
  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  );
}

function AppContent() {
  const navigate = useNavigate();
  const location = useLocation();
  
  // Determine current page from URL path
  const getPageFromPath = (path: string): 'landing' | 'quiz' | 'admin' | 'adminLogin' | 'confirmSubmission' => {
    if (path === '/') return 'landing';
    if (path === '/quiz') return 'quiz';
    if (path === '/confirm-submission') return 'confirmSubmission';
    if (path === '/admin/login') return 'adminLogin';
    if (path === '/admin') return 'admin';
    return 'landing';
  };

  const currentPage = getPageFromPath(location.pathname);
  
  const navigateToPage = (page: 'landing' | 'quiz' | 'admin' | 'adminLogin' | 'confirmSubmission') => {
    const paths = {
      'landing': '/',
      'quiz': '/quiz',
      'confirmSubmission': '/confirm-submission',
      'adminLogin': '/admin/login',
      'admin': '/admin'
    };
    navigate(paths[page]);
  };

  // Page state
  const [userProfile, setUserProfile] = useState<UserProfile>(() => {
    const saved = sessionStorage.getItem('userProfile');
    return saved ? JSON.parse(saved) : { name: '', email: '', technicalConfidence: 5, consultativeConfidence: 5 };
  });
  const [adminSessions, setAdminSessions] = useState<SessionResult[]>([]);
  
  // Admin login state
  const [adminUsername, setAdminUsername] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [selectedSession, setSelectedSession] = useState<SessionResult | null>(null);
  
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
  const browserRecognizerRef = useRef<any>(null);
  const webVoiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const tokenRef = useRef<{ token: string; region: string } | null>(null);

  // Initialize browser speech API on mount
  useEffect(() => {
    try {
      const w = window as any;
      if (w && (w.SpeechRecognition || w.webkitSpeechRecognition)) {
        console.log("Browser speech recognition available");
        setBrowserFallbackReady(true);
      } else {
        console.log("Browser speech recognition NOT available");
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

  // Load quiz when page becomes 'quiz'
  useEffect(() => {
    if (currentPage === 'quiz') {
      fetchToken();
      fetchQuestion(0);
    }
  }, [currentPage]);

  // Load admin sessions when page becomes 'admin'
  useEffect(() => {
    if (currentPage === 'admin') {
      loadAdminSessions();
    }
  }, [currentPage]);

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
      // Auto-save current answer if there's a transcript and question
      if (question && transcript.trim()) {
        console.log("Auto-saving answer before moving to next question");
        setAnswers(prev => {
          const updated = { ...prev, [question.id]: transcript.trim() };
          console.log(`Auto-saved answer for ${question.id}. Total answers: ${Object.keys(updated).length}`);
          return updated;
        });
      }
      
      setLoading(true);
      setError(null);
      
      // Only clean up if we're actually in a listening/speaking state
      // (avoid cleaning up on first question load)
      if (listening) {
        onStopListening();
        // Clean up browser recognizer if active
        try {
          if (browserRecognizerRef.current) {
            browserRecognizerRef.current.stop();
            browserRecognizerRef.current = null;
          }
        } catch {}
      }
      if (speaking || currentAudio) {
        stopSpeaking();
      }
      
      // Reset all listening/speaking states
      setListening(false);
      setContinuousListening(false);
      setPausedListening(false);
      setSpeaking(false);
      setAudioPaused(false);
      
      const resp = await axios.get(`/api/nextquestion?idx=${i}`);
      setQuestion(resp.data.question);
      setIdx(resp.data.nextIndex);
      setTranscript("");
      if (!resp.data.question) {
        setEndOfQuiz(true);
      } else {
        setEndOfQuiz(false); // Reset end of quiz flag when loading a valid question
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
    console.log("onStartListening called - azureReady:", azureReady, "browserFallbackReady:", browserFallbackReady);
    try {
      setListening(true);
      setTranscript("");
      setError(null);

      if (azureReady && recognizerRef.current) {
        console.log("Using Azure Speech Recognition");
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
      console.log("Checking browser fallback - SR available:", !!SR);
      if (SR) {
        console.log("Using Browser Web Speech API");
        // Clean up any existing recognizer first
        if (browserRecognizerRef.current) {
          try {
            browserRecognizerRef.current.stop();
          } catch {}
          browserRecognizerRef.current = null;
        }
        
        const rec = new SR();
        browserRecognizerRef.current = rec;
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
          browserRecognizerRef.current = null;
        };
        rec.onend = () => { 
          setListening(false); 
          setContinuousListening(false); 
          browserRecognizerRef.current = null;
        };
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
      if (browserRecognizerRef.current) {
        try { 
          browserRecognizerRef.current.stop(); 
          browserRecognizerRef.current = null;
        } catch {}
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
    if (!question) {
      console.log("Cannot save: no question loaded");
      return;
    }
    const text = transcript.trim();
    if (!text) {
      setError("Please speak an answer or type one before saving");
      console.log("Cannot save: transcript is empty");
      return;
    }
    console.log("=== SAVING ANSWER ===");
    console.log("Question ID:", question.id);
    console.log("Answer text length:", text.length);
    console.log("Answer preview:", text.substring(0, 100));
    setAnswers(prev => {
      const updated = { ...prev, [question.id]: text };
      console.log("Previous answers count:", Object.keys(prev).length);
      console.log("Updated answers count:", Object.keys(updated).length);
      console.log("All saved question IDs:", Object.keys(updated));
      return updated;
    });
    // Clear any errors after successful save
    setError(null);
  }

  function goToQuestionById(qid: string) {
    const target = seenQuestions.find(sq => sq.id === qid);
    if (!target) return;
    setEndOfQuiz(false);
    fetchQuestion(target.idx);
  }

  async function onSubmitAll() {
    console.log("onSubmitAll called - answers count:", Object.keys(answers).length);
    console.log("Answers:", answers);
    try {
      setLoading(true);
      setError(null);
      const answersArray = Object.entries(answers).map(([questionId, transcript]) => ({ questionId, transcript }));
      console.log("Sending to backend:", answersArray);
      const resp = await axios.post("/api/evaluate-all", { sessionId: "local-session", answers: answersArray });
      console.log("Got response:", resp.data);
      setFinalResults(resp.data);
      
      // Save session result to backend
      await saveSessionResult(resp.data);
      
      // Navigate to quiz page to show results
      navigateToPage('quiz');
    } catch (err: any) {
      console.error("Submit error:", err);
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
      setLoginError('');
      navigateToPage('admin');
      loadAdminSessions();
      return true;
    }
    setLoginError('Invalid credentials');
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
              onClick={() => {
                sessionStorage.setItem('userProfile', JSON.stringify(userProfile));
                navigateToPage('quiz');
              }}
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
              onClick={() => navigateToPage('adminLogin')}
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
    const handleLogin = () => {
      handleAdminLogin(adminUsername, adminPassword);
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
            padding: 40,
            position: "relative"
          }}>
            <button
              onClick={() => navigateToPage('landing')}
              style={{
                position: "absolute",
                top: 20,
                right: 20,
                padding: "8px 16px",
                backgroundColor: "#667eea",
                color: "white",
                border: "none",
                borderRadius: 8,
                cursor: "pointer",
                fontSize: 14,
                fontWeight: 600
              }}
            >
              🏠 Home
            </button>
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
                value={adminUsername}
                onChange={e => setAdminUsername(e.target.value)}
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
                value={adminPassword}
                onChange={e => setAdminPassword(e.target.value)}
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
              onClick={() => navigateToPage('landing')}
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
    // If a session is selected, show detailed view
    if (selectedSession) {
      return (
        <div style={{ 
          minHeight: "100vh", 
          background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
          fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
          padding: "20px"
        }}>
          <div style={{ maxWidth: 1200, margin: "0 auto" }}>
            <div style={{
              background: "white",
              borderRadius: 20,
              boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
              padding: 32
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
                <h1 style={{ 
                  fontSize: 28, 
                  fontWeight: 700,
                  color: "#1a237e",
                  margin: 0
                }}>
                  Evaluation Details
                </h1>
                <button
                  onClick={() => setSelectedSession(null)}
                  style={{
                    padding: "10px 20px",
                    backgroundColor: "#667eea",
                    color: "white",
                    border: "none",
                    borderRadius: 8,
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: "pointer"
                  }}
                >
                  ← Back to Dashboard
                </button>
              </div>

              {/* Architect Info */}
              <div style={{ 
                backgroundColor: "#f5f5f5", 
                padding: "20px", 
                borderRadius: 12,
                marginBottom: 24
              }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 16 }}>
                  <div>
                    <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>Architect Name</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: "#1a237e" }}>{selectedSession.userName}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>Email</div>
                    <div style={{ fontSize: 16, fontWeight: 600, color: "#555" }}>{selectedSession.userEmail}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>Overall Score</div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: selectedSession.overallScore >= 70 ? "#4CAF50" : selectedSession.overallScore >= 50 ? "#FF9800" : "#f44336" }}>
                      {selectedSession.overallScore}%
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>Evaluation Date</div>
                    <div style={{ fontSize: 16, fontWeight: 600, color: "#555" }}>
                      {new Date(selectedSession.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      {' at '}
                      {new Date(selectedSession.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </div>
              </div>

              {/* Question-by-Question Results */}
              <h2 style={{ fontSize: 20, fontWeight: 700, color: "#1a237e", marginBottom: 16 }}>Question-by-Question Analysis</h2>
              {selectedSession.results && selectedSession.results.length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  {selectedSession.results.map((result, idx) => (
                    <div key={idx} style={{
                      border: "2px solid #e0e0e0",
                      borderRadius: 12,
                      padding: 20,
                      backgroundColor: "#fafafa"
                    }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: 12 }}>
                        <div>
                          <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>
                            {result.topic || 'Question ' + (idx + 1)}
                          </div>
                          <h3 style={{ fontSize: 16, fontWeight: 700, color: "#1a237e", margin: 0 }}>
                            {result.heading || result.questionId}
                          </h3>
                        </div>
                        <span style={{
                          backgroundColor: (result.evaluation?.score || 0) >= 70 
                            ? "#4CAF50" 
                            : (result.evaluation?.score || 0) >= 50 
                            ? "#FF9800" 
                            : "#f44336",
                          color: "white",
                          padding: "6px 16px",
                          borderRadius: 16,
                          fontSize: 14,
                          fontWeight: 700
                        }}>
                          {result.evaluation?.score || 0}%
                        </span>
                      </div>

                      {/* Technical Feedback */}
                      {result.evaluation?.feedback && (
                        <div style={{ marginBottom: 12 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "#1a237e", marginBottom: 6 }}>
                            📋 Technical Feedback
                          </div>
                          <div style={{ fontSize: 14, color: "#555", lineHeight: 1.6 }}>
                            {result.evaluation.feedback}
                          </div>
                        </div>
                      )}

                      {/* Sentiment Analysis */}
                      {result.evaluation?.sentiment && (
                        <div style={{ marginBottom: 12 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "#1a237e", marginBottom: 8 }}>
                            💬 Communication Assessment
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
                            <div>
                              <div style={{ fontSize: 11, color: "#666", marginBottom: 4 }}>Confidence</div>
                              <div style={{ 
                                fontSize: 16, 
                                fontWeight: 700,
                                color: result.evaluation.sentiment.confidence >= 70 ? "#4CAF50" : result.evaluation.sentiment.confidence >= 50 ? "#FF9800" : "#f44336"
                              }}>
                                {result.evaluation.sentiment.confidence}/100
                              </div>
                            </div>
                            <div>
                              <div style={{ fontSize: 11, color: "#666", marginBottom: 4 }}>Empathy</div>
                              <div style={{ 
                                fontSize: 16, 
                                fontWeight: 700,
                                color: result.evaluation.sentiment.empathy >= 70 ? "#4CAF50" : result.evaluation.sentiment.empathy >= 50 ? "#FF9800" : "#f44336"
                              }}>
                                {result.evaluation.sentiment.empathy}/100
                              </div>
                            </div>
                            <div>
                              <div style={{ fontSize: 11, color: "#666", marginBottom: 4 }}>Executive Presence</div>
                              <div style={{ 
                                fontSize: 16, 
                                fontWeight: 700,
                                color: result.evaluation.sentiment.executive_presence >= 70 ? "#4CAF50" : result.evaluation.sentiment.executive_presence >= 50 ? "#FF9800" : "#f44336"
                              }}>
                                {result.evaluation.sentiment.executive_presence}/100
                              </div>
                            </div>
                            <div>
                              <div style={{ fontSize: 11, color: "#666", marginBottom: 4 }}>Professionalism</div>
                              <div style={{ 
                                fontSize: 16, 
                                fontWeight: 700,
                                color: result.evaluation.sentiment.professionalism >= 70 ? "#4CAF50" : result.evaluation.sentiment.professionalism >= 50 ? "#FF9800" : "#f44336"
                              }}>
                                {result.evaluation.sentiment.professionalism}/100
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Sentiment Feedback */}
                      {result.evaluation?.sentiment_feedback && (
                        <div style={{ 
                          backgroundColor: "#fff3e0", 
                          padding: 12, 
                          borderRadius: 8,
                          fontSize: 13,
                          color: "#e65100",
                          lineHeight: 1.5
                        }}>
                          💡 {result.evaluation.sentiment_feedback}
                        </div>
                      )}

                      {/* Key Phrases */}
                      <div style={{ marginTop: 12, display: "flex", gap: 16, flexWrap: "wrap" }}>
                        {result.evaluation?.matched_phrases && result.evaluation.matched_phrases.length > 0 && (
                          <div>
                            <div style={{ fontSize: 11, color: "#4CAF50", fontWeight: 600, marginBottom: 6 }}>
                              ✓ Matched Phrases ({result.evaluation.matched_phrases.length})
                            </div>
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                              {result.evaluation.matched_phrases.map((phrase: string, i: number) => (
                                <span key={i} style={{
                                  backgroundColor: "#e8f5e9",
                                  color: "#2e7d32",
                                  padding: "4px 10px",
                                  borderRadius: 12,
                                  fontSize: 12,
                                  fontWeight: 500
                                }}>
                                  {phrase}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                        {result.evaluation?.missing_phrases && result.evaluation.missing_phrases.length > 0 && (
                          <div>
                            <div style={{ fontSize: 11, color: "#f44336", fontWeight: 600, marginBottom: 6 }}>
                              ✗ Missing Phrases ({result.evaluation.missing_phrases.length})
                            </div>
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                              {result.evaluation.missing_phrases.map((phrase: string, i: number) => (
                                <span key={i} style={{
                                  backgroundColor: "#ffebee",
                                  color: "#c62828",
                                  padding: "4px 10px",
                                  borderRadius: 12,
                                  fontSize: 12,
                                  fontWeight: 500
                                }}>
                                  {phrase}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ padding: 40, textAlign: "center", color: "#999" }}>
                  No detailed results available
                </div>
              )}
            </div>
          </div>
        </div>
      );
    }

    // Main dashboard view
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
              <div style={{ display: "flex", gap: 12 }}>
                <button
                  onClick={() => navigateToPage('landing')}
                  style={{
                    padding: "10px 20px",
                    backgroundColor: "#667eea",
                    color: "white",
                    border: "none",
                    borderRadius: 8,
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: "pointer"
                  }}
                >
                  🏠 Home
                </button>
                <button
                  onClick={() => {
                    setAdminUsername('');
                    setAdminPassword('');
                    setLoginError('');
                    navigateToPage('landing');
                  }}
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
            </div>

            <div style={{ 
              backgroundColor: "#f5f5f5", 
              padding: "16px 20px", 
              borderRadius: 12,
              marginBottom: 24,
              display: "flex",
              alignItems: "center",
              gap: 12
            }}>
              <span style={{ fontSize: 24 }}>📊</span>
              <span style={{ color: "#666", fontSize: 16 }}>
                Total Evaluations: <strong style={{ color: "#1a237e", fontSize: 18 }}>{adminSessions.length}</strong>
              </span>
            </div>

            <div style={{ overflowX: "auto" }}>
              <table style={{ 
                width: "100%", 
                borderCollapse: "collapse",
                fontSize: 14
              }}>
                <thead>
                  <tr style={{ backgroundColor: "#1a237e" }}>
                    <th style={{ padding: "14px 12px", textAlign: "left", color: "white", fontWeight: 600, borderBottom: "3px solid #667eea" }}>Architect Name</th>
                    <th style={{ padding: "14px 12px", textAlign: "left", color: "white", fontWeight: 600, borderBottom: "3px solid #667eea" }}>Email ID</th>
                    <th style={{ padding: "14px 12px", textAlign: "center", color: "white", fontWeight: 600, borderBottom: "3px solid #667eea" }}>Evaluation Score</th>
                    <th style={{ padding: "14px 12px", textAlign: "center", color: "white", fontWeight: 600, borderBottom: "3px solid #667eea" }}>Date & Time</th>
                  </tr>
                </thead>
                <tbody>
                  {adminSessions.length === 0 ? (
                    <tr>
                      <td colSpan={4} style={{ padding: 32, textAlign: "center", color: "#999", fontSize: 16 }}>
                        📭 No evaluations recorded yet
                      </td>
                    </tr>
                  ) : (
                    adminSessions.map((session, idx) => (
                      <tr 
                        key={idx} 
                        onClick={() => setSelectedSession(session)}
                        style={{ 
                          borderBottom: "1px solid #e0e0e0",
                          backgroundColor: idx % 2 === 0 ? "#fafafa" : "white",
                          cursor: "pointer",
                          transition: "background-color 0.2s"
                        }}
                        onMouseEnter={e => {
                          e.currentTarget.style.backgroundColor = "#e3f2fd";
                        }}
                        onMouseLeave={e => {
                          e.currentTarget.style.backgroundColor = idx % 2 === 0 ? "#fafafa" : "white";
                        }}
                      >
                        <td style={{ padding: "14px 12px", fontWeight: 600, color: "#1a237e" }}>
                          {session.userName}
                        </td>
                        <td style={{ padding: "14px 12px", color: "#555" }}>
                          {session.userEmail}
                        </td>
                        <td style={{ padding: "14px 12px", textAlign: "center" }}>
                          <span style={{
                            backgroundColor: session.overallScore >= 70 
                              ? "#4CAF50" 
                              : session.overallScore >= 50 
                              ? "#FF9800" 
                              : "#f44336",
                            color: "white",
                            padding: "6px 20px",
                            borderRadius: 20,
                            fontSize: 16,
                            fontWeight: 700,
                            display: "inline-block",
                            minWidth: 60
                          }}>
                            {session.overallScore}%
                          </span>
                        </td>
                        <td style={{ padding: "14px 12px", textAlign: "center", color: "#666" }}>
                          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                            <span style={{ fontWeight: 600, color: "#1a237e" }}>
                              {new Date(session.timestamp).toLocaleDateString('en-US', { 
                                month: 'short', 
                                day: 'numeric', 
                                year: 'numeric' 
                              })}
                            </span>
                            <span style={{ fontSize: 12, color: "#999" }}>
                              {new Date(session.timestamp).toLocaleTimeString('en-US', { 
                                hour: '2-digit', 
                                minute: '2-digit'
                              })}
                            </span>
                          </div>
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

  function renderConfirmSubmissionPage() {
    const unansweredCount = seenQuestions.filter(q => !answers[q.id]).length;
    const answeredCount = Object.keys(answers).length;
    
    return (
      <div style={{
        minHeight: "100vh",
        background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
        fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
        padding: "40px 20px"
      }}>
        <div style={{ maxWidth: 1000, margin: "0 auto" }}>
          <div style={{
            background: "white",
            borderRadius: 20,
            padding: 40,
            boxShadow: "0 20px 60px rgba(0,0,0,0.3)"
          }}>
            <h1 style={{
              fontSize: 32,
              fontWeight: 700,
              color: "#1a237e",
              marginBottom: 8,
              textAlign: "center"
            }}>
              📋 Confirm Evaluation Submission
            </h1>
            <p style={{
              textAlign: "center",
              color: "#666",
              marginBottom: 32,
              fontSize: 16
            }}>
              Review your responses before final submission
            </p>

            {/* Summary Stats */}
            <div style={{
              display: "flex",
              gap: 20,
              marginBottom: 32,
              justifyContent: "center",
              flexWrap: "wrap"
            }}>
              <div style={{
                padding: "16px 24px",
                background: "linear-gradient(135deg, #4CAF50 0%, #45a049 100%)",
                borderRadius: 12,
                color: "white",
                textAlign: "center",
                minWidth: 140
              }}>
                <div style={{ fontSize: 32, fontWeight: 700 }}>{answeredCount}</div>
                <div style={{ fontSize: 14, opacity: 0.9 }}>Answered</div>
              </div>
              <div style={{
                padding: "16px 24px",
                background: unansweredCount > 0 
                  ? "linear-gradient(135deg, #FF9800 0%, #F57C00 100%)" 
                  : "linear-gradient(135deg, #9E9E9E 0%, #757575 100%)",
                borderRadius: 12,
                color: "white",
                textAlign: "center",
                minWidth: 140
              }}>
                <div style={{ fontSize: 32, fontWeight: 700 }}>{unansweredCount}</div>
                <div style={{ fontSize: 14, opacity: 0.9 }}>Unanswered</div>
              </div>
              <div style={{
                padding: "16px 24px",
                background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
                borderRadius: 12,
                color: "white",
                textAlign: "center",
                minWidth: 140
              }}>
                <div style={{ fontSize: 32, fontWeight: 700 }}>{seenQuestions.length}</div>
                <div style={{ fontSize: 14, opacity: 0.9 }}>Total Questions</div>
              </div>
            </div>

            {/* Questions Table */}
            <div style={{
              border: "1px solid #e0e0e0",
              borderRadius: 12,
              overflow: "hidden",
              marginBottom: 24
            }}>
              <table style={{
                width: "100%",
                borderCollapse: "collapse"
              }}>
                <thead>
                  <tr style={{ background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)", color: "white" }}>
                    <th style={{ padding: "16px 12px", textAlign: "left", fontSize: 14, fontWeight: 600 }}>#</th>
                    <th style={{ padding: "16px 12px", textAlign: "left", fontSize: 14, fontWeight: 600 }}>Topic</th>
                    <th style={{ padding: "16px 12px", textAlign: "center", fontSize: 14, fontWeight: 600 }}>Status</th>
                    <th style={{ padding: "16px 12px", textAlign: "center", fontSize: 14, fontWeight: 600 }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {seenQuestions.map((q, index) => {
                    const hasAnswer = !!answers[q.id];
                    return (
                      <tr key={q.id} style={{
                        background: index % 2 === 0 ? "#fafafa" : "white",
                        borderBottom: "1px solid #e0e0e0"
                      }}>
                        <td style={{ padding: "16px 12px", fontSize: 14, fontWeight: 600, color: "#666" }}>
                          {index + 1}
                        </td>
                        <td style={{ padding: "16px 12px", fontSize: 14 }}>
                          <div style={{ fontWeight: 600, color: "#1a237e", marginBottom: 4 }}>
                            {q.heading || q.id}
                          </div>
                          {q.topic && (
                            <div style={{ fontSize: 12, color: "#999" }}>{q.topic}</div>
                          )}
                        </td>
                        <td style={{ padding: "16px 12px", textAlign: "center" }}>
                          {hasAnswer ? (
                            <span style={{
                              display: "inline-block",
                              padding: "6px 16px",
                              background: "#e8f5e9",
                              color: "#2e7d32",
                              borderRadius: 20,
                              fontSize: 13,
                              fontWeight: 600
                            }}>
                              ✓ Answered
                            </span>
                          ) : (
                            <span style={{
                              display: "inline-block",
                              padding: "6px 16px",
                              background: "#fff3e0",
                              color: "#e65100",
                              borderRadius: 20,
                              fontSize: 13,
                              fontWeight: 600
                            }}>
                              ⚠ Skipped
                            </span>
                          )}
                        </td>
                        <td style={{ padding: "16px 12px", textAlign: "center" }}>
                          <button
                            onClick={() => {
                              navigateToPage('quiz');
                              setEndOfQuiz(false);
                              fetchQuestion(q.idx);
                            }}
                            style={{
                              padding: "8px 16px",
                              background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
                              color: "white",
                              border: "none",
                              borderRadius: 8,
                              cursor: "pointer",
                              fontSize: 13,
                              fontWeight: 600,
                              transition: "all 0.2s"
                            }}
                            onMouseEnter={e => {
                              e.currentTarget.style.transform = "translateY(-2px)";
                              e.currentTarget.style.boxShadow = "0 4px 12px rgba(102,126,234,0.4)";
                            }}
                            onMouseLeave={e => {
                              e.currentTarget.style.transform = "translateY(0)";
                              e.currentTarget.style.boxShadow = "none";
                            }}
                          >
                            👁️ Review
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Warning for unanswered questions */}
            {unansweredCount > 0 && (
              <div style={{
                padding: 16,
                background: "#fff3e0",
                border: "2px solid #ff9800",
                borderRadius: 12,
                marginBottom: 24,
                display: "flex",
                alignItems: "center",
                gap: 12
              }}>
                <span style={{ fontSize: 24 }}>⚠️</span>
                <div>
                  <div style={{ fontWeight: 700, color: "#e65100", marginBottom: 4 }}>
                    You have {unansweredCount} unanswered question(s)
                  </div>
                  <div style={{ fontSize: 14, color: "#666" }}>
                    You can still submit, but unanswered questions won't be evaluated.
                  </div>
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div style={{ display: "flex", gap: 16, justifyContent: "center", flexWrap: "wrap" }}>
              <button
                onClick={() => navigateToPage('quiz')}
                style={{
                  padding: "14px 32px",
                  background: "#f5f5f5",
                  color: "#333",
                  border: "2px solid #e0e0e0",
                  borderRadius: 12,
                  cursor: "pointer",
                  fontSize: 16,
                  fontWeight: 600,
                  transition: "all 0.3s"
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = "#e0e0e0";
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = "#f5f5f5";
                }}
              >
                ← Go Back to Quiz
              </button>
              <button
                onClick={() => {
                  console.log("Confirm submit clicked!");
                  onSubmitAll();
                }}
                disabled={loading}
                style={{
                  padding: "14px 32px",
                  background: loading 
                    ? "#ccc" 
                    : "linear-gradient(135deg, #4CAF50 0%, #45a049 100%)",
                  color: "white",
                  border: "none",
                  borderRadius: 12,
                  cursor: loading ? "not-allowed" : "pointer",
                  fontSize: 16,
                  fontWeight: 700,
                  boxShadow: !loading ? "0 4px 12px rgba(76,175,80,0.4)" : "none",
                  transition: "all 0.3s"
                }}
                onMouseEnter={e => {
                  if (!loading) {
                    e.currentTarget.style.transform = "translateY(-2px)";
                    e.currentTarget.style.boxShadow = "0 8px 20px rgba(76,175,80,0.5)";
                  }
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.transform = "translateY(0)";
                  e.currentTarget.style.boxShadow = !loading ? "0 4px 12px rgba(76,175,80,0.4)" : "none";
                }}
              >
                ✅ Confirm & Submit Evaluation
              </button>
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

  if (currentPage === 'confirmSubmission') {
    return renderConfirmSubmissionPage();
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
          marginBottom: 20,
          position: "relative"
        }}>
          <button
            onClick={() => navigateToPage('landing')}
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              padding: "10px 20px",
              backgroundColor: "rgba(255,255,255,0.2)",
              color: "white",
              border: "2px solid white",
              borderRadius: 8,
              cursor: "pointer",
              fontSize: 14,
              fontWeight: 600,
              transition: "all 0.3s"
            }}
            onMouseEnter={e => e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.3)"}
            onMouseLeave={e => e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.2)"}
          >
            🏠 Home
          </button>
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
              Click below to start responding. Speak naturally and your response will be transcribed.
            </p>
            
            <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap", justifyContent: "center" }}>
              <button
                onClick={onStartListening}
                disabled={loading || listening}
                title="Start responding"
                style={{
                  padding: "14px 32px",
                  background: listening ? "linear-gradient(135deg, #FF9800 0%, #F57C00 100%)" : "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
                  color: "white",
                  border: "none",
                  borderRadius: 12,
                  cursor: loading || listening ? "not-allowed" : "pointer",
                  fontSize: 16,
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  boxShadow: listening ? "0 0 0 4px rgba(255,152,0,0.2), 0 8px 16px rgba(0,0,0,0.2)" : "0 8px 16px rgba(102,126,234,0.3)",
                  transition: "all 300ms ease",
                  opacity: loading ? 0.5 : 1
                }}
                onMouseEnter={e => {
                  if (!(loading || listening)) {
                    e.currentTarget.style.transform = "translateY(-2px)";
                    e.currentTarget.style.boxShadow = "0 12px 24px rgba(102,126,234,0.4)";
                  }
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.transform = "translateY(0)";
                  e.currentTarget.style.boxShadow = "0 8px 16px rgba(102,126,234,0.3)";
                }}
              >
                <span style={{ fontSize: 20 }}>🎤</span>
                <span>{listening ? "Recording..." : "Start Responding"}</span>
              </button>
              
              {listening && (
                <>
                  <button
                    onClick={onStopListening}
                    title="Stop recording"
                    style={{
                      padding: "14px 28px",
                      background: "linear-gradient(135deg, #f44336 0%, #c62828 100%)",
                      color: "white",
                      border: "none",
                      borderRadius: 12,
                      cursor: "pointer",
                      fontSize: 16,
                      fontWeight: 600,
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      boxShadow: "0 8px 16px rgba(244,67,54,0.3)",
                      transition: "all 300ms ease"
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.transform = "translateY(-2px)";
                      e.currentTarget.style.boxShadow = "0 12px 24px rgba(244,67,54,0.4)";
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.transform = "translateY(0)";
                      e.currentTarget.style.boxShadow = "0 8px 16px rgba(244,67,54,0.3)";
                    }}
                  >
                    <span style={{ fontSize: 18 }}>⏹</span>
                    <span>Stop</span>
                  </button>
                  <button
                    onClick={togglePauseListening}
                    title={pausedListening ? "Resume recording" : "Pause recording"}
                    style={{
                      padding: "14px 28px",
                      background: pausedListening ? "linear-gradient(135deg, #3F51B5 0%, #283593 100%)" : "linear-gradient(135deg, #9E9E9E 0%, #616161 100%)",
                      color: "white",
                      border: "none",
                      borderRadius: 12,
                      cursor: "pointer",
                      fontSize: 16,
                      fontWeight: 600,
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      boxShadow: "0 8px 16px rgba(0,0,0,0.2)",
                      transition: "all 300ms ease"
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.transform = "translateY(-2px)";
                      e.currentTarget.style.boxShadow = "0 12px 24px rgba(0,0,0,0.3)";
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.transform = "translateY(0)";
                      e.currentTarget.style.boxShadow = "0 8px 16px rgba(0,0,0,0.2)";
                    }}
                  >
                    <span style={{ fontSize: 18 }}>{pausedListening ? "▶️" : "⏸"}</span>
                    <span>{pausedListening ? "Resume" : "Pause"}</span>
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
                onClick={() => fetchQuestion(idx)}
                disabled={loading || listening || speaking}
                title="Save and next question"
                style={{
                  padding: "12px 24px",
                  backgroundColor: "#2196F3",
                  color: "white",
                  border: "none",
                  borderRadius: "24px",
                  cursor: loading || listening || speaking ? "not-allowed" : "pointer",
                  fontSize: 14,
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  boxShadow: "0 4px 8px rgba(0,0,0,0.15)",
                  transition: "all 200ms",
                  opacity: loading || listening || speaking ? 0.5 : 1
                }}
                onMouseEnter={e => {
                  if (!(loading || listening || speaking)) {
                    e.currentTarget.style.transform = "scale(1.05)";
                  }
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.transform = "scale(1)";
                }}
              >
                💾 Save and Next ➡️
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

      {/* Review & final submission */}
      {endOfQuiz && !finalResults && (
        <div style={{ border: "1px solid #ddd", padding: 16, borderRadius: 8, background: "#fff" }}>
          <h3>Review your answers</h3>
          <p>You’ve reached the end. Save anything missing, then submit all to see your results with Microsoft Learn links.</p>
          {/* Unanswered questions list */}
          {(() => {
            console.log("Seen questions:", seenQuestions.map(q => q.id));
            console.log("Saved answer keys:", Object.keys(answers));
            const unanswered = seenQuestions.filter(q => {
              const hasAnswer = !!answers[q.id];
              console.log(`Question ${q.id}: hasAnswer=${hasAnswer}, answer=${answers[q.id]}`);
              return !hasAnswer;
            });
            console.log("Unanswered:", unanswered.map(q => q.id));
            if (unanswered.length === 0) return null;
            return (
              <div style={{ marginTop: 12, padding: 12, background: '#fff8e1', border: '1px solid #ffe082', borderRadius: 6 }}>
                <strong>Unanswered questions ({unanswered.length}):</strong>
                <ul style={{ margin: '8px 0 0 18px' }}>
                  {unanswered.map(u => (
                    <li key={u.id} style={{ marginBottom: 6 }}>
                      {(u.heading || u.id)}
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
            onClick={() => {
              console.log("=== SUBMIT EVALUATION CLICKED ===");
              console.log("Total answers saved:", Object.keys(answers).length);
              console.log("Saved question IDs:", Object.keys(answers));
              console.log("Seen questions:", seenQuestions.map(q => q.id));
              console.log("Answers object:", answers);
              // If no answers, submit directly; otherwise go to confirmation page
              if (Object.keys(answers).length === 0) {
                onSubmitAll();
              } else {
                navigateToPage('confirmSubmission');
              }
            }}
            disabled={loading}
            style={{
              padding: "14px 32px",
              marginTop: 12,
              background: loading ? "#ccc" : "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
              color: "white",
              border: "none",
              borderRadius: 12,
              cursor: loading ? "not-allowed" : "pointer",
              fontSize: 16,
              fontWeight: 700,
              boxShadow: !loading ? "0 4px 12px rgba(102,126,234,0.4)" : "none",
              transition: "all 0.3s"
            }}
            onMouseEnter={e => {
              if (!loading) {
                e.currentTarget.style.transform = "translateY(-2px)";
                e.currentTarget.style.boxShadow = "0 8px 20px rgba(102,126,234,0.5)";
              }
            }}
            onMouseLeave={e => {
              e.currentTarget.style.transform = "translateY(0)";
              e.currentTarget.style.boxShadow = !loading ? "0 4px 12px rgba(102,126,234,0.4)" : "none";
            }}
          >
            {loading ? "Evaluating..." : "📊 Submit Evaluation"}
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
                  
                  {/* User's Answer */}
                  {answers[r.questionId] && (
                    <div style={{ marginBottom: 16, padding: 16, background: 'white', borderRadius: 12, border: "2px solid #667eea" }}>
                      <strong style={{ color: "#1a237e", fontSize: 15 }}>Your Response:</strong>
                      <div style={{ marginTop: 8, fontSize: 14, color: '#37474f', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                        {answers[r.questionId]}
                      </div>
                    </div>
                  )}
                  
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


