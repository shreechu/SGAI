import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from "react-router-dom";
import axios from "axios";
import * as SpeechSDK from "microsoft-cognitiveservices-speech-sdk";
// Configure axios to use backend endpoint
axios.defaults.baseURL = "http://localhost:7071";
export default function App() {
    return (_jsx(BrowserRouter, { children: _jsxs(Routes, { children: [_jsx(Route, { path: "/", element: _jsx(LandingPage, {}) }), _jsx(Route, { path: "/quiz", element: _jsx(QuizPage, {}) }), _jsx(Route, { path: "/admin/login", element: _jsx(AdminLoginPage, {}) }), _jsx(Route, { path: "/admin", element: _jsx(AdminDashboard, {}) }), _jsx(Route, { path: "*", element: _jsx(Navigate, { to: "/", replace: true }) })] }) }));
}
function LandingPage() {
    const navigate = useNavigate();
    const [userProfile, setUserProfile] = useState({ name: '', email: '', technicalConfidence: 5, consultativeConfidence: 5 });
    const handleBeginAssessment = () => {
        sessionStorage.setItem('userProfile', JSON.stringify(userProfile));
        navigate('/quiz');
    };
    const isFormValid = userProfile.name.trim() && userProfile.email.trim() && /\S+@\S+\.\S+/.test(userProfile.email);
    const [question, setQuestion] = useState(null);
    const [idx, setIdx] = useState(0);
    const [transcript, setTranscript] = useState("");
    const [answers, setAnswers] = useState({});
    const [finalResults, setFinalResults] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [endOfQuiz, setEndOfQuiz] = useState(false);
    const [showEndConfirmation, setShowEndConfirmation] = useState(false);
    const [seenQuestions, setSeenQuestions] = useState([]);
    const [listening, setListening] = useState(false);
    const [continuousListening, setContinuousListening] = useState(false);
    const [speaking, setSpeaking] = useState(false);
    const [audioPaused, setAudioPaused] = useState(false);
    const [pausedListening, setPausedListening] = useState(false);
    const [azureReady, setAzureReady] = useState(false);
    const [browserFallbackReady, setBrowserFallbackReady] = useState(false);
    const [autoRead, setAutoRead] = useState(true);
    // Using Azure Neural TTS for most realistic voice
    const [currentAudio, setCurrentAudio] = useState(null);
    const [browserVoices, setBrowserVoices] = useState([]);
    const recognizerRef = useRef(null);
    const webVoiceRef = useRef(null);
    const tokenRef = useRef(null);
    // Initialize browser speech API on mount
    useEffect(() => {
        try {
            const w = window;
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
        }
        catch { }
    }, []);
    // Load quiz when navigating to quiz page
    useEffect(() => {
        if (currentPage === 'quiz') {
            fetchToken();
            fetchQuestion(0);
        }
    }, [currentPage]);
    // Rebuild Azure synthesizer when voice or style changes
    useEffect(() => {
        if (!azureReady || !tokenRef.current)
            return;
        try {
            const speechConfig = SpeechSDK.SpeechConfig.fromAuthorizationToken(tokenRef.current.token, tokenRef.current.region);
            speechConfig.speechRecognitionLanguage = "en-US";
            const audioConfig = SpeechSDK.AudioConfig.fromDefaultMicrophoneInput();
            recognizerRef.current = new SpeechSDK.SpeechRecognizer(speechConfig, audioConfig);
        }
        catch { }
    }, [azureReady]);
    async function fetchToken() {
        try {
            const resp = await axios.get("/api/speech/token");
            tokenRef.current = resp.data;
            initializeSpeechObjects(resp.data);
        }
        catch (err) {
            console.warn("Speech token not available (Speech services may not be configured):", err?.message || err);
            setAzureReady(false);
        }
    }
    function initializeSpeechObjects(tokenInfo) {
        try {
            const speechConfig = SpeechSDK.SpeechConfig.fromAuthorizationToken(tokenInfo.token, tokenInfo.region);
            speechConfig.speechRecognitionLanguage = "en-US";
            const audioConfig = SpeechSDK.AudioConfig.fromDefaultMicrophoneInput();
            recognizerRef.current = new SpeechSDK.SpeechRecognizer(speechConfig, audioConfig);
            setAzureReady(true);
        }
        catch (err) {
            console.error("Failed to initialize speech objects:", err);
            setAzureReady(false);
        }
    }
    // Speak helper using Azure Neural TTS for ultra-realistic voice
    async function speakText(text) {
        if (!text)
            return;
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
            const response = await axios.post("/api/openai/tts", { text }, { responseType: "blob" });
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
        }
        catch (err) {
            console.error("Azure Neural TTS failed:", err);
            setSpeaking(false);
            setAudioPaused(false);
            setCurrentAudio(null);
            setError("Failed to generate speech. Please check Azure Speech configuration.");
        }
    }
    function pauseOrResumeSpeaking() {
        if (!currentAudio)
            return;
        try {
            if (currentAudio.paused) {
                currentAudio.play();
                setAudioPaused(false);
            }
            else {
                currentAudio.pause();
                setAudioPaused(true);
            }
        }
        catch (err) {
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
    async function fetchQuestion(i) {
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
                    if (exists)
                        return prev;
                    return [...prev, {
                            id: resp.data.question.id,
                            idx: i,
                            heading: resp.data.question.heading,
                            topic: resp.data.question.topic
                        }];
                });
            }
            // Auto-speak the question content
            if (autoRead && resp.data?.question?.question) {
                speakText(resp.data.question.question);
            }
        }
        catch (err) {
            setError(`Failed to load question: ${err.message}`);
            console.error(err);
        }
        finally {
            setLoading(false);
        }
    }
    async function onPlayQuestion() {
        if (!question)
            return;
        try {
            await speakText(question.question);
        }
        catch (err) {
            setError(`Failed to play question: ${err.message}`);
        }
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
                recognizerRef.current.recognized = (_s, e) => {
                    try {
                        const text = e?.result?.text || "";
                        if (text) {
                            collected = collected ? `${collected} ${text}` : text;
                            setTranscript(collected);
                        }
                    }
                    catch { }
                };
                recognizerRef.current.canceled = (_s, e) => {
                    const errorDetails = e?.errorDetails || "";
                    const reason = e?.reason;
                    // Only show error if it's not a normal user cancellation
                    if (reason !== 3) { // 3 = EndOfStream (normal stop)
                        console.error("Recognition canceled:", errorDetails, "Reason:", reason);
                        if (errorDetails.includes("1006") || errorDetails.includes("websocket")) {
                            setError("Unable to connect to Azure Speech service. Using browser fallback.");
                        }
                        else if (errorDetails) {
                            setError(`Recognition canceled: ${errorDetails}`);
                        }
                    }
                    setListening(false);
                    setContinuousListening(false);
                    try {
                        recognizerRef.current?.stopContinuousRecognitionAsync?.(() => { }, () => { });
                    }
                    catch { }
                };
                recognizerRef.current.sessionStopped = () => {
                    setListening(false);
                    setContinuousListening(false);
                };
                recognizerRef.current.startContinuousRecognitionAsync(() => { }, (err) => {
                    setError(`Failed to start recognition: ${err?.message || err}`);
                    setListening(false);
                    setContinuousListening(false);
                });
                return;
            }
            // Browser Web Speech API fallback
            const w = window;
            const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
            if (SR) {
                const rec = new SR();
                rec.lang = "en-US";
                rec.continuous = true; // allow extended speech
                rec.interimResults = true;
                let collected = "";
                rec.onresult = (e) => {
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
                    }
                    catch { }
                };
                rec.onerror = (e) => {
                    console.error("Speech recognition error:", e);
                    const errorType = e?.error || "unknown";
                    // Handle common errors more gracefully
                    if (errorType === "aborted") {
                        // Aborted is normal when user stops manually - don't show error
                        console.log("Recognition was stopped by user");
                    }
                    else if (errorType === "no-speech") {
                        setError("No speech detected. Please try speaking again.");
                    }
                    else if (errorType === "audio-capture") {
                        setError("Microphone not accessible. Please check permissions.");
                    }
                    else if (errorType === "not-allowed") {
                        setError("Microphone permission denied. Please allow microphone access.");
                    }
                    else {
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
        }
        catch (err) {
            setError(`Failed to start listening: ${err.message}`);
            setListening(false);
        }
    }
    function onStopListening() {
        try {
            setListening(false);
            setContinuousListening(false);
            // Azure
            try {
                recognizerRef.current?.stopContinuousRecognitionAsync?.(() => { }, () => { });
            }
            catch { }
            // Browser
            const w = window;
            const SR = w?.SpeechRecognition || w?.webkitSpeechRecognition;
            if (SR && w?.currentRecognizerInstance) {
                try {
                    w.currentRecognizerInstance.stop?.();
                }
                catch { }
            }
        }
        catch { }
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
        if (!listening)
            return;
        if (!pausedListening) {
            onStopListening();
            setPausedListening(true);
        }
        else {
            setPausedListening(false);
            onStartListening();
        }
    }
    function onSaveAnswer() {
        if (!question)
            return;
        const text = transcript.trim();
        if (!text) {
            setError("Please speak an answer or type one before saving");
            return;
        }
        setAnswers(prev => ({ ...prev, [question.id]: text }));
    }
    function goToQuestionById(qid) {
        const target = seenQuestions.find(sq => sq.id === qid);
        if (!target)
            return;
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
        }
        catch (err) {
            setError(`Final evaluation failed: ${err.message}`);
            console.error(err);
        }
        finally {
            setLoading(false);
        }
    }
    async function saveSessionResult(results) {
        try {
            const sessionData = {
                userName: userProfile.name,
                userEmail: userProfile.email,
                technicalConfidence: userProfile.technicalConfidence,
                consultativeConfidence: userProfile.consultativeConfidence,
                overallScore: results.overallScore,
                timestamp: new Date().toISOString(),
                results: results.results
            };
            await axios.post("/api/sessions", sessionData);
        }
        catch (err) {
            console.error("Failed to save session:", err);
        }
    }
    async function loadAdminSessions() {
        try {
            const resp = await axios.get("/api/sessions");
            setAdminSessions(resp.data);
        }
        catch (err) {
            console.error("Failed to load sessions:", err);
        }
    }
    function handleAdminLogin(username, password) {
        if (username === 'sa' && password === 'test123') {
            setCurrentPage('admin');
            loadAdminSessions();
            return true;
        }
        return false;
    }
    function renderLandingPage() {
        const isFormValid = userProfile.name.trim() && userProfile.email.trim() && userProfile.email.includes('@');
        return (_jsx("div", { style: {
                minHeight: "100vh",
                background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
                fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
                padding: "40px 20px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center"
            }, children: _jsx("div", { style: { maxWidth: 600, width: "100%" }, children: _jsxs("div", { style: {
                        background: "white",
                        borderRadius: 20,
                        boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
                        padding: 40
                    }, children: [_jsx("h1", { style: {
                                fontSize: 32,
                                fontWeight: 700,
                                marginBottom: 8,
                                color: "#1a237e",
                                textAlign: "center"
                            }, children: "Mission Critical Architect Assessment" }), _jsx("p", { style: {
                                fontSize: 16,
                                color: "#666",
                                textAlign: "center",
                                marginBottom: 32
                            }, children: "Azure Reliability & Performance Readiness" }), _jsxs("div", { style: { marginBottom: 24 }, children: [_jsx("label", { style: { display: "block", marginBottom: 8, fontWeight: 600, color: "#37474f" }, children: "Full Name *" }), _jsx("input", { type: "text", value: userProfile.name, onChange: e => setUserProfile(prev => ({ ...prev, name: e.target.value })), placeholder: "Enter your full name", style: {
                                        width: "100%",
                                        padding: "12px 16px",
                                        fontSize: 16,
                                        border: "2px solid #e0e0e0",
                                        borderRadius: 8,
                                        outline: "none",
                                        transition: "border-color 0.2s"
                                    }, onFocus: e => e.currentTarget.style.borderColor = "#667eea", onBlur: e => e.currentTarget.style.borderColor = "#e0e0e0" })] }), _jsxs("div", { style: { marginBottom: 32 }, children: [_jsx("label", { style: { display: "block", marginBottom: 8, fontWeight: 600, color: "#37474f" }, children: "Email Address *" }), _jsx("input", { type: "email", value: userProfile.email, onChange: e => setUserProfile(prev => ({ ...prev, email: e.target.value })), placeholder: "your.email@company.com", style: {
                                        width: "100%",
                                        padding: "12px 16px",
                                        fontSize: 16,
                                        border: "2px solid #e0e0e0",
                                        borderRadius: 8,
                                        outline: "none",
                                        transition: "border-color 0.2s"
                                    }, onFocus: e => e.currentTarget.style.borderColor = "#667eea", onBlur: e => e.currentTarget.style.borderColor = "#e0e0e0" })] }), _jsxs("div", { style: { marginBottom: 24 }, children: [_jsx("label", { style: { display: "block", marginBottom: 12, fontWeight: 600, color: "#37474f" }, children: "How confident are you to have technical conversations with customer executives?" }), _jsxs("div", { style: { display: "flex", alignItems: "center", gap: 12 }, children: [_jsx("span", { style: { fontSize: 14, color: "#999", minWidth: 30 }, children: "Low" }), _jsx("input", { type: "range", min: "1", max: "10", value: userProfile.technicalConfidence, onChange: e => setUserProfile(prev => ({ ...prev, technicalConfidence: parseInt(e.target.value) })), style: { flex: 1 } }), _jsx("span", { style: { fontSize: 14, color: "#999", minWidth: 30 }, children: "High" })] }), _jsx("div", { style: { textAlign: "center", marginTop: 8 }, children: _jsx("span", { style: {
                                            display: "inline-block",
                                            backgroundColor: "#667eea",
                                            color: "white",
                                            padding: "6px 16px",
                                            borderRadius: 20,
                                            fontSize: 18,
                                            fontWeight: 700
                                        }, children: userProfile.technicalConfidence }) })] }), _jsxs("div", { style: { marginBottom: 32 }, children: [_jsx("label", { style: { display: "block", marginBottom: 12, fontWeight: 600, color: "#37474f" }, children: "How confident are you with consultative skills?" }), _jsxs("div", { style: { display: "flex", alignItems: "center", gap: 12 }, children: [_jsx("span", { style: { fontSize: 14, color: "#999", minWidth: 30 }, children: "Low" }), _jsx("input", { type: "range", min: "1", max: "10", value: userProfile.consultativeConfidence, onChange: e => setUserProfile(prev => ({ ...prev, consultativeConfidence: parseInt(e.target.value) })), style: { flex: 1 } }), _jsx("span", { style: { fontSize: 14, color: "#999", minWidth: 30 }, children: "High" })] }), _jsx("div", { style: { textAlign: "center", marginTop: 8 }, children: _jsx("span", { style: {
                                            display: "inline-block",
                                            backgroundColor: "#764ba2",
                                            color: "white",
                                            padding: "6px 16px",
                                            borderRadius: 20,
                                            fontSize: 18,
                                            fontWeight: 700
                                        }, children: userProfile.consultativeConfidence }) })] }), _jsx("button", { onClick: () => setCurrentPage('quiz'), disabled: !isFormValid, style: {
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
                            }, onMouseEnter: e => {
                                if (isFormValid)
                                    e.currentTarget.style.transform = "translateY(-2px)";
                            }, onMouseLeave: e => {
                                e.currentTarget.style.transform = "translateY(0)";
                            }, children: "Begin Assessment \u2192" }), _jsx("button", { onClick: () => setCurrentPage('adminLogin'), style: {
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
                            }, onMouseEnter: e => {
                                e.currentTarget.style.backgroundColor = "#667eea";
                                e.currentTarget.style.color = "white";
                            }, onMouseLeave: e => {
                                e.currentTarget.style.backgroundColor = "transparent";
                                e.currentTarget.style.color = "#667eea";
                            }, children: "\uD83D\uDD10 Admin Login" })] }) }) }));
    }
    function renderAdminLogin() {
        const [username, setUsername] = useState('');
        const [password, setPassword] = useState('');
        const [loginError, setLoginError] = useState('');
        const handleLogin = () => {
            if (handleAdminLogin(username, password)) {
                setLoginError('');
            }
            else {
                setLoginError('Invalid credentials');
            }
        };
        return (_jsx("div", { style: {
                minHeight: "100vh",
                background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
                fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
                padding: "40px 20px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center"
            }, children: _jsx("div", { style: { maxWidth: 400, width: "100%" }, children: _jsxs("div", { style: {
                        background: "white",
                        borderRadius: 20,
                        boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
                        padding: 40
                    }, children: [_jsx("h2", { style: {
                                fontSize: 28,
                                fontWeight: 700,
                                marginBottom: 24,
                                color: "#1a237e",
                                textAlign: "center"
                            }, children: "Admin Login" }), loginError && (_jsx("div", { style: {
                                padding: 12,
                                backgroundColor: "#ffebee",
                                border: "1px solid #f44336",
                                borderRadius: 8,
                                marginBottom: 20,
                                color: "#c62828",
                                textAlign: "center"
                            }, children: loginError })), _jsxs("div", { style: { marginBottom: 20 }, children: [_jsx("label", { style: { display: "block", marginBottom: 8, fontWeight: 600, color: "#37474f" }, children: "Username" }), _jsx("input", { type: "text", value: username, onChange: e => setUsername(e.target.value), placeholder: "Enter username", style: {
                                        width: "100%",
                                        padding: "12px 16px",
                                        fontSize: 16,
                                        border: "2px solid #e0e0e0",
                                        borderRadius: 8,
                                        outline: "none"
                                    }, onKeyPress: e => e.key === 'Enter' && handleLogin() })] }), _jsxs("div", { style: { marginBottom: 24 }, children: [_jsx("label", { style: { display: "block", marginBottom: 8, fontWeight: 600, color: "#37474f" }, children: "Password" }), _jsx("input", { type: "password", value: password, onChange: e => setPassword(e.target.value), placeholder: "Enter password", style: {
                                        width: "100%",
                                        padding: "12px 16px",
                                        fontSize: 16,
                                        border: "2px solid #e0e0e0",
                                        borderRadius: 8,
                                        outline: "none"
                                    }, onKeyPress: e => e.key === 'Enter' && handleLogin() })] }), _jsx("button", { onClick: handleLogin, style: {
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
                            }, children: "Login" }), _jsx("button", { onClick: () => setCurrentPage('landing'), style: {
                                width: "100%",
                                padding: "12px",
                                backgroundColor: "transparent",
                                color: "#666",
                                border: "none",
                                fontSize: 14,
                                cursor: "pointer"
                            }, children: "\u2190 Back to Home" })] }) }) }));
    }
    function renderAdminDashboard() {
        return (_jsx("div", { style: {
                minHeight: "100vh",
                background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
                fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
                padding: "20px"
            }, children: _jsx("div", { style: { maxWidth: 1400, margin: "0 auto" }, children: _jsxs("div", { style: {
                        background: "white",
                        borderRadius: 20,
                        boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
                        padding: 32
                    }, children: [_jsxs("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }, children: [_jsx("h1", { style: {
                                        fontSize: 32,
                                        fontWeight: 700,
                                        color: "#1a237e",
                                        margin: 0
                                    }, children: "Admin Dashboard" }), _jsx("button", { onClick: () => setCurrentPage('landing'), style: {
                                        padding: "10px 20px",
                                        backgroundColor: "#f44336",
                                        color: "white",
                                        border: "none",
                                        borderRadius: 8,
                                        fontSize: 14,
                                        fontWeight: 600,
                                        cursor: "pointer"
                                    }, children: "Logout" })] }), _jsxs("p", { style: { color: "#666", marginBottom: 24 }, children: ["Total Sessions: ", _jsx("strong", { children: adminSessions.length })] }), _jsx("div", { style: { overflowX: "auto" }, children: _jsxs("table", { style: {
                                    width: "100%",
                                    borderCollapse: "collapse",
                                    fontSize: 14
                                }, children: [_jsx("thead", { children: _jsxs("tr", { style: { backgroundColor: "#f5f5f5" }, children: [_jsx("th", { style: { padding: 12, textAlign: "left", borderBottom: "2px solid #ddd" }, children: "Date" }), _jsx("th", { style: { padding: 12, textAlign: "left", borderBottom: "2px solid #ddd" }, children: "Name" }), _jsx("th", { style: { padding: 12, textAlign: "left", borderBottom: "2px solid #ddd" }, children: "Email" }), _jsx("th", { style: { padding: 12, textAlign: "center", borderBottom: "2px solid #ddd" }, children: "Technical Conf." }), _jsx("th", { style: { padding: 12, textAlign: "center", borderBottom: "2px solid #ddd" }, children: "Consultative Conf." }), _jsx("th", { style: { padding: 12, textAlign: "center", borderBottom: "2px solid #ddd" }, children: "Overall Score" })] }) }), _jsx("tbody", { children: adminSessions.length === 0 ? (_jsx("tr", { children: _jsx("td", { colSpan: 6, style: { padding: 24, textAlign: "center", color: "#999" }, children: "No sessions recorded yet" }) })) : (adminSessions.map((session, idx) => (_jsxs("tr", { style: { borderBottom: "1px solid #eee" }, children: [_jsxs("td", { style: { padding: 12 }, children: [new Date(session.timestamp).toLocaleDateString(), " ", new Date(session.timestamp).toLocaleTimeString()] }), _jsx("td", { style: { padding: 12, fontWeight: 600 }, children: session.userName }), _jsx("td", { style: { padding: 12 }, children: session.userEmail }), _jsx("td", { style: { padding: 12, textAlign: "center" }, children: _jsxs("span", { style: {
                                                            backgroundColor: session.technicalConfidence >= 7 ? "#4CAF50" : session.technicalConfidence >= 4 ? "#FF9800" : "#f44336",
                                                            color: "white",
                                                            padding: "4px 12px",
                                                            borderRadius: 12,
                                                            fontSize: 13,
                                                            fontWeight: 600
                                                        }, children: [session.technicalConfidence, "/10"] }) }), _jsx("td", { style: { padding: 12, textAlign: "center" }, children: _jsxs("span", { style: {
                                                            backgroundColor: session.consultativeConfidence >= 7 ? "#4CAF50" : session.consultativeConfidence >= 4 ? "#FF9800" : "#f44336",
                                                            color: "white",
                                                            padding: "4px 12px",
                                                            borderRadius: 12,
                                                            fontSize: 13,
                                                            fontWeight: 600
                                                        }, children: [session.consultativeConfidence, "/10"] }) }), _jsx("td", { style: { padding: 12, textAlign: "center" }, children: _jsxs("span", { style: {
                                                            backgroundColor: session.overallScore >= 70 ? "#4CAF50" : session.overallScore >= 40 ? "#FF9800" : "#f44336",
                                                            color: "white",
                                                            padding: "4px 16px",
                                                            borderRadius: 12,
                                                            fontSize: 14,
                                                            fontWeight: 700
                                                        }, children: [session.overallScore, "%"] }) })] }, idx)))) })] }) })] }) }) }));
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
    return (_jsxs("div", { style: {
            minHeight: "100vh",
            background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
            fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
            padding: "20px 20px"
        }, children: [_jsxs("div", { style: { maxWidth: 1200, margin: "0 auto" }, children: [_jsxs("div", { style: {
                            textAlign: "center",
                            color: "white",
                            marginBottom: 20
                        }, children: [_jsx("h1", { style: {
                                    fontSize: 32,
                                    fontWeight: 700,
                                    marginBottom: 4,
                                    textShadow: "0 2px 4px rgba(0,0,0,0.1)"
                                }, children: "Mission Critical Architect Assessment" }), _jsx("p", { style: { fontSize: 16, opacity: 0.95 }, children: "Azure Reliability & Performance Readiness" })] }), _jsxs("div", { style: {
                            background: "white",
                            borderRadius: 16,
                            boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
                            padding: 20,
                            marginBottom: 24
                        }, children: [_jsxs("div", { style: {
                                    padding: 16,
                                    background: "linear-gradient(135deg, #f093fb 0%, #f5576c 100%)",
                                    borderRadius: 12,
                                    color: "white",
                                    marginBottom: 16
                                }, children: [_jsx("p", { style: { marginBottom: 12, fontSize: 16, fontWeight: 600 }, children: _jsxs("strong", { children: ["CTO of Zava speaks", userProfile.name ? ` to ${userProfile.name}` : '', ":"] }) }), _jsx("p", { style: { fontSize: 15, lineHeight: 1.6, opacity: 0.95 }, children: "Our mission-critical app has had too many outages, and our support experience hasn't met expectations. I need a practical plan that improves reliability quickly, shortens detection and recovery times, and brings spend under control without adding risk." }), _jsxs("p", { style: { fontSize: 15, lineHeight: 1.6, opacity: 0.95, marginTop: 8 }, children: ["Speak to me directly", userProfile.name ? `, ${userProfile.name.split(' ')[0]}` : '', ". Be clear, pragmatic, and back your recommendations with Azure best practices."] })] }), _jsxs("div", { style: {
                                    display: "flex",
                                    gap: 16,
                                    alignItems: "center",
                                    flexWrap: "wrap",
                                    padding: 16,
                                    background: "#f8f9fa",
                                    borderRadius: 8,
                                    marginBottom: 24
                                }, children: [_jsxs("label", { style: { display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }, children: [_jsx("input", { type: "checkbox", checked: autoRead, onChange: e => setAutoRead(e.target.checked) }), _jsx("span", { style: { fontSize: 14 }, children: "Auto-read questions" })] }), _jsx("div", { style: { fontSize: 13, color: "#666", marginLeft: "auto" }, children: azureReady ? "🎙️ OpenAI GPT Audio Active" : "Loading..." })] }), error && (_jsxs("div", { style: {
                                    padding: 16,
                                    backgroundColor: "#fee",
                                    border: "2px solid #f44336",
                                    borderRadius: 12,
                                    marginBottom: 24,
                                    color: "#c62828",
                                    fontSize: 15,
                                    fontWeight: 500
                                }, children: ["\u26A0\uFE0F ", error] })), _jsxs("div", { style: {
                                    display: "flex",
                                    flexDirection: "column",
                                    alignItems: "center",
                                    padding: 32,
                                    background: "linear-gradient(135deg, #e0f7fa 0%, #e1bee7 100%)",
                                    borderRadius: 16,
                                    marginBottom: 24,
                                    boxShadow: "0 4px 12px rgba(0,0,0,0.1)"
                                }, children: [_jsxs("div", { style: {
                                            marginBottom: 24,
                                            position: "relative"
                                        }, children: [_jsx("img", { src: "https://ui-avatars.com/api/?name=Mark+CTO&size=180&background=667eea&color=fff&bold=true&font-size=0.4", alt: "Mark - CTO", onError: (e) => {
                                                    e.target.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Ccircle cx='90' cy='90' r='90' fill='%23667eea'/%3E%3Ctext x='50%25' y='50%25' text-anchor='middle' dy='.3em' fill='white' font-size='60' font-family='Arial' font-weight='bold'%3EMC%3C/text%3E%3C/svg%3E";
                                                }, style: {
                                                    width: 180,
                                                    height: 180,
                                                    borderRadius: "50%",
                                                    border: speaking ? "6px solid #4CAF50" : "6px solid white",
                                                    boxShadow: speaking ? "0 0 0 8px rgba(76,175,80,0.3), 0 8px 24px rgba(0,0,0,0.2)" : "0 8px 24px rgba(0,0,0,0.15)",
                                                    transition: "all 300ms ease-in-out",
                                                    animation: speaking ? "pulse 1.5s ease-in-out infinite" : "none"
                                                } }), speaking && (_jsx("div", { style: {
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
                                                }, children: "SPEAKING" }))] }), _jsx("h3", { style: {
                                            fontSize: 24,
                                            fontWeight: 700,
                                            color: "#1a237e",
                                            marginBottom: 8
                                        }, children: "Mark, CTO at Zava" }), _jsx("p", { style: {
                                            fontSize: 18,
                                            lineHeight: 1.7,
                                            color: "#37474f",
                                            textAlign: "center",
                                            maxWidth: 800,
                                            marginBottom: 20
                                        }, children: question?.question || "Loading question..." }), _jsxs("div", { style: { display: "flex", gap: 12, marginTop: 8 }, children: [_jsx("button", { onClick: speaking ? pauseOrResumeSpeaking : onPlayQuestion, disabled: !question || listening, title: speaking ? (audioPaused ? "Resume" : "Pause") : "Play message", style: {
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
                                                }, onMouseEnter: e => {
                                                    if (!(!question || listening)) {
                                                        e.currentTarget.style.transform = "scale(1.1)";
                                                    }
                                                }, onMouseLeave: e => {
                                                    e.currentTarget.style.transform = "scale(1)";
                                                }, children: audioPaused ? "▶️" : speaking ? "⏸" : "▶️" }), speaking && (_jsx("button", { onClick: stopSpeaking, title: "Stop speaking", style: {
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
                                                }, onMouseEnter: e => e.currentTarget.style.transform = "scale(1.1)", onMouseLeave: e => e.currentTarget.style.transform = "scale(1)", children: "\u23F9" }))] })] }), !endOfQuiz && (_jsxs("div", { style: {
                                    background: "white",
                                    padding: 24,
                                    borderRadius: 16,
                                    boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
                                    marginBottom: 24
                                }, children: [_jsx("h3", { style: {
                                            fontSize: 22,
                                            fontWeight: 700,
                                            color: "#1a237e",
                                            marginBottom: 16,
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 8
                                        }, children: "\uD83C\uDF99\uFE0F Your Response" }), _jsx("p", { style: { color: "#666", marginBottom: 20, fontSize: 15 }, children: "Click the microphone to start recording. Speak naturally and the app will transcribe your answer." }), _jsxs("div", { style: { display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap", justifyContent: "center" }, children: [_jsx("button", { onClick: onStartListening, disabled: loading || listening || (!azureReady && !browserFallbackReady), title: "Start listening", style: {
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
                                                }, onMouseEnter: e => {
                                                    if (!(loading || listening || (!azureReady && !browserFallbackReady))) {
                                                        e.currentTarget.style.transform = "scale(1.1)";
                                                    }
                                                }, onMouseLeave: e => {
                                                    e.currentTarget.style.transform = "scale(1)";
                                                }, children: "\uD83C\uDFA4" }), listening && (_jsxs(_Fragment, { children: [_jsx("button", { onClick: onStopListening, title: "Stop listening", style: {
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
                                                        }, onMouseEnter: e => e.currentTarget.style.transform = "scale(1.1)", onMouseLeave: e => e.currentTarget.style.transform = "scale(1)", children: "\u23F9" }), _jsx("button", { onClick: togglePauseListening, title: pausedListening ? "Resume listening" : "Pause listening", style: {
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
                                                        }, onMouseEnter: e => e.currentTarget.style.transform = "scale(1.1)", onMouseLeave: e => e.currentTarget.style.transform = "scale(1)", children: pausedListening ? "▶️" : "⏸" })] }))] }), _jsx("div", { style: { textAlign: "center", color: "#999", fontSize: 13, marginBottom: 16 }, children: azureReady ? "✓ Azure Speech SDK" : browserFallbackReady ? "✓ Browser Speech" : "Speech not available" }), transcript && (_jsxs("div", { style: {
                                            marginTop: 16,
                                            padding: 16,
                                            backgroundColor: "#f8f9fa",
                                            border: "2px solid #e0e0e0",
                                            borderRadius: 12
                                        }, children: [_jsx("strong", { style: { color: "#1a237e", fontSize: 15 }, children: "Your answer:" }), _jsx("p", { style: { marginTop: 12, fontSize: 15, lineHeight: 1.6, color: "#37474f" }, children: transcript })] })), _jsxs("div", { style: { display: "flex", gap: 12, marginTop: 20, flexWrap: "wrap", justifyContent: "center" }, children: [_jsx("button", { onClick: onSaveAnswer, disabled: loading || listening || !transcript.trim() || !question, title: "Save answer", style: {
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
                                                }, onMouseEnter: e => {
                                                    if (!(loading || listening || !transcript.trim() || !question)) {
                                                        e.currentTarget.style.transform = "scale(1.1)";
                                                    }
                                                }, onMouseLeave: e => {
                                                    e.currentTarget.style.transform = "scale(1)";
                                                }, children: "\uD83D\uDCBE" }), _jsx("button", { onClick: onRetryRecording, disabled: loading || listening, title: "Retry recording", style: {
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
                                                }, onMouseEnter: e => {
                                                    if (!(loading || listening)) {
                                                        e.currentTarget.style.transform = "scale(1.1)";
                                                    }
                                                }, onMouseLeave: e => {
                                                    e.currentTarget.style.transform = "scale(1)";
                                                }, children: "\uD83D\uDD01" }), _jsx("button", { onClick: () => setAnswers(prev => ({ ...prev, [question.id]: transcript.trim() })), disabled: loading || listening || !transcript.trim() || !question, title: "Submit response", style: {
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
                                                }, onMouseEnter: e => {
                                                    if (!(loading || listening || !transcript.trim() || !question)) {
                                                        e.currentTarget.style.transform = "scale(1.1)";
                                                    }
                                                }, onMouseLeave: e => {
                                                    e.currentTarget.style.transform = "scale(1)";
                                                }, children: "\uD83D\uDCE4" }), _jsx("button", { onClick: () => fetchQuestion(idx), disabled: loading || listening || speaking, title: "Next question", style: {
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
                                                }, onMouseEnter: e => {
                                                    if (!(loading || listening || speaking)) {
                                                        e.currentTarget.style.transform = "scale(1.1)";
                                                    }
                                                }, onMouseLeave: e => {
                                                    e.currentTarget.style.transform = "scale(1)";
                                                }, children: "\u27A1\uFE0F" }), _jsx("button", { onClick: handleEndEvaluation, disabled: loading || listening || speaking || seenQuestions.length === 0, title: "End Evaluation", style: {
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
                                                }, onMouseEnter: e => {
                                                    if (!(loading || listening || speaking || seenQuestions.length === 0)) {
                                                        e.currentTarget.style.transform = "scale(1.05)";
                                                    }
                                                }, onMouseLeave: e => {
                                                    e.currentTarget.style.transform = "scale(1)";
                                                }, children: "\uD83C\uDFC1 End Evaluation" })] })] })), showEndConfirmation && (_jsx("div", { style: {
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
                                }, children: _jsxs("div", { style: {
                                        background: "white",
                                        borderRadius: 16,
                                        padding: 32,
                                        maxWidth: 500,
                                        width: "90%",
                                        boxShadow: "0 20px 60px rgba(0,0,0,0.3)"
                                    }, children: [_jsx("h2", { style: { marginTop: 0, marginBottom: 16, color: "#1a237e" }, children: "End Evaluation?" }), (() => {
                                            const unansweredTopics = seenQuestions.filter(q => !answers[q.id]);
                                            const totalQuestions = 12;
                                            const answeredCount = Object.keys(answers).length;
                                            const unseenCount = totalQuestions - seenQuestions.length;
                                            return (_jsxs(_Fragment, { children: [_jsxs("p", { style: { marginBottom: 16, color: "#37474f" }, children: ["You have answered ", _jsx("strong", { children: answeredCount }), " out of ", _jsx("strong", { children: seenQuestions.length }), " questions seen."] }), unseenCount > 0 && (_jsx("div", { style: {
                                                            padding: 12,
                                                            background: "#fff3e0",
                                                            border: "2px solid #ff9800",
                                                            borderRadius: 8,
                                                            marginBottom: 16
                                                        }, children: _jsxs("strong", { style: { color: "#e65100" }, children: ["\u26A0\uFE0F ", unseenCount, " questions not yet viewed"] }) })), unansweredTopics.length > 0 && (_jsxs("div", { style: {
                                                            padding: 12,
                                                            background: "#ffebee",
                                                            border: "1px solid #ef5350",
                                                            borderRadius: 8,
                                                            marginBottom: 16
                                                        }, children: [_jsxs("strong", { style: { color: "#c62828" }, children: ["Topics not covered (", unansweredTopics.length, "):"] }), _jsx("ul", { style: { margin: "8px 0 0 20px", paddingLeft: 0 }, children: unansweredTopics.map(q => (_jsx("li", { style: { marginBottom: 4, color: "#d32f2f" }, children: q.topic || q.heading || q.id }, q.id))) })] })), _jsx("p", { style: { marginBottom: 24, color: "#37474f" }, children: "Are you sure you want to end the evaluation and see your results?" }), _jsxs("div", { style: { display: "flex", gap: 12, justifyContent: "flex-end" }, children: [_jsx("button", { onClick: () => setShowEndConfirmation(false), style: {
                                                                    padding: "12px 24px",
                                                                    backgroundColor: "#9E9E9E",
                                                                    color: "white",
                                                                    border: "none",
                                                                    borderRadius: 8,
                                                                    cursor: "pointer",
                                                                    fontSize: 14,
                                                                    fontWeight: 600
                                                                }, children: "No, Continue" }), _jsx("button", { onClick: confirmEndEvaluation, style: {
                                                                    padding: "12px 24px",
                                                                    backgroundColor: "#4CAF50",
                                                                    color: "white",
                                                                    border: "none",
                                                                    borderRadius: 8,
                                                                    cursor: "pointer",
                                                                    fontSize: 14,
                                                                    fontWeight: 600
                                                                }, children: "Yes, End & Show Results" })] })] }));
                                        })()] }) })), showEndConfirmation && (_jsx("div", { style: {
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
                                }, children: _jsxs("div", { style: {
                                        background: "white",
                                        borderRadius: 16,
                                        padding: 32,
                                        maxWidth: 500,
                                        width: "90%",
                                        boxShadow: "0 20px 60px rgba(0,0,0,0.3)"
                                    }, children: [_jsx("h2", { style: { marginTop: 0, marginBottom: 16, color: "#1a237e" }, children: "End Evaluation?" }), (() => {
                                            const unansweredTopics = seenQuestions.filter(q => !answers[q.id]);
                                            const totalQuestions = 12;
                                            const answeredCount = Object.keys(answers).length;
                                            const unseenCount = totalQuestions - seenQuestions.length;
                                            return (_jsxs(_Fragment, { children: [_jsxs("p", { style: { marginBottom: 16, color: "#37474f" }, children: ["You have answered ", _jsx("strong", { children: answeredCount }), " out of ", _jsx("strong", { children: seenQuestions.length }), " questions seen."] }), unseenCount > 0 && (_jsx("div", { style: {
                                                            padding: 12,
                                                            background: "#fff3e0",
                                                            border: "2px solid #ff9800",
                                                            borderRadius: 8,
                                                            marginBottom: 16
                                                        }, children: _jsxs("strong", { style: { color: "#e65100" }, children: ["\u26A0\uFE0F ", unseenCount, " questions not yet viewed"] }) })), unansweredTopics.length > 0 && (_jsxs("div", { style: {
                                                            padding: 12,
                                                            background: "#ffebee",
                                                            border: "1px solid #ef5350",
                                                            borderRadius: 8,
                                                            marginBottom: 16
                                                        }, children: [_jsxs("strong", { style: { color: "#c62828" }, children: ["Topics not covered (", unansweredTopics.length, "):"] }), _jsx("ul", { style: { margin: "8px 0 0 20px", paddingLeft: 0 }, children: unansweredTopics.map(q => (_jsx("li", { style: { marginBottom: 4, color: "#d32f2f" }, children: q.topic || q.heading || q.id }, q.id))) })] })), _jsx("p", { style: { marginBottom: 24, color: "#37474f" }, children: "Are you sure you want to end the evaluation and see your results?" }), _jsxs("div", { style: { display: "flex", gap: 12, justifyContent: "flex-end" }, children: [_jsx("button", { onClick: () => setShowEndConfirmation(false), style: {
                                                                    padding: "12px 24px",
                                                                    backgroundColor: "#9E9E9E",
                                                                    color: "white",
                                                                    border: "none",
                                                                    borderRadius: 8,
                                                                    cursor: "pointer",
                                                                    fontSize: 14,
                                                                    fontWeight: 600
                                                                }, children: "No, Continue" }), _jsx("button", { onClick: confirmEndEvaluation, style: {
                                                                    padding: "12px 24px",
                                                                    backgroundColor: "#4CAF50",
                                                                    color: "white",
                                                                    border: "none",
                                                                    borderRadius: 8,
                                                                    cursor: "pointer",
                                                                    fontSize: 14,
                                                                    fontWeight: 600
                                                                }, children: "Yes, End & Show Results" })] })] }));
                                        })()] }) })), endOfQuiz && !finalResults && (_jsxs("div", { style: { border: "1px solid #ddd", padding: 16, borderRadius: 8, background: "#fff" }, children: [_jsx("h3", { children: "Review your answers" }), _jsx("p", { children: "You\u2019ve reached the end. Save anything missing, then submit all to see your results with Microsoft Learn links." }), (() => {
                                        const unanswered = seenQuestions.filter(q => !answers[q.id]);
                                        if (unanswered.length === 0)
                                            return null;
                                        return (_jsxs("div", { style: { marginTop: 12, padding: 12, background: '#fff8e1', border: '1px solid #ffe082', borderRadius: 6 }, children: [_jsxs("strong", { children: ["Unanswered questions (", unanswered.length, "):"] }), _jsx("ul", { style: { margin: '8px 0 0 18px' }, children: unanswered.map(u => (_jsxs("li", { style: { marginBottom: 6 }, children: [(u.heading || u.id), _jsx("button", { onClick: () => goToQuestionById(u.id), style: { marginLeft: 8, padding: '4px 10px', borderRadius: 4, border: '1px solid #ccc', cursor: 'pointer' }, children: "Go answer" })] }, u.id))) })] }));
                                    })(), _jsxs("div", { style: { marginTop: 12 }, children: [Object.keys(answers).length === 0 && _jsx("p", { children: "No answers saved yet." }), Object.entries(answers).map(([qid, text]) => (_jsxs("div", { style: { marginBottom: 8 }, children: [_jsx("strong", { children: qid }), _jsx("div", { style: { marginTop: 4, padding: 8, background: "#f9f9f9", borderRadius: 4 }, children: text })] }, qid)))] }), _jsx("button", { onClick: onSubmitAll, disabled: loading || Object.keys(answers).length === 0, style: {
                                            padding: "12px 24px",
                                            marginTop: 12,
                                            backgroundColor: "#4CAF50",
                                            color: "white",
                                            border: "none",
                                            borderRadius: 4,
                                            cursor: loading || Object.keys(answers).length === 0 ? "not-allowed" : "pointer",
                                            fontSize: 16,
                                            fontWeight: "bold"
                                        }, children: loading ? "Evaluating..." : "🚀 Submit All" })] })), finalResults && (_jsxs("div", { style: {
                                    background: "white",
                                    padding: 32,
                                    borderRadius: 16,
                                    boxShadow: "0 4px 12px rgba(0,0,0,0.1)"
                                }, children: [_jsx("h3", { style: { fontSize: 28, fontWeight: 700, color: "#1a237e", marginBottom: 8 }, children: "\u2705 Final Evaluation" }), _jsxs("div", { style: {
                                            fontSize: 48,
                                            marginBottom: 24,
                                            fontWeight: 800,
                                            background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
                                            WebkitBackgroundClip: "text",
                                            WebkitTextFillColor: "transparent",
                                            backgroundClip: "text"
                                        }, children: ["Technical Score: ", finalResults.overallScore, "%"] }), (() => {
                                        const sentiments = finalResults.results
                                            .map(r => r.evaluation?.sentiment)
                                            .filter(s => s && typeof s === 'object');
                                        if (sentiments.length === 0)
                                            return null;
                                        const avgConfidence = Math.round(sentiments.reduce((sum, s) => sum + (s.confidence || 0), 0) / sentiments.length);
                                        const avgEmpathy = Math.round(sentiments.reduce((sum, s) => sum + (s.empathy || 0), 0) / sentiments.length);
                                        const avgExecutive = Math.round(sentiments.reduce((sum, s) => sum + (s.executive_presence || 0), 0) / sentiments.length);
                                        const avgProfessionalism = Math.round(sentiments.reduce((sum, s) => sum + (s.professionalism || 0), 0) / sentiments.length);
                                        const getColor = (score) => score >= 70 ? '#4CAF50' : score >= 50 ? '#FF9800' : '#f44336';
                                        return (_jsxs("div", { style: {
                                                background: 'linear-gradient(135deg, #e0f7fa 0%, #e1bee7 100%)',
                                                borderRadius: 16,
                                                padding: 24,
                                                marginBottom: 24,
                                                boxShadow: "0 4px 12px rgba(0,0,0,0.08)"
                                            }, children: [_jsx("h4", { style: { marginTop: 0, marginBottom: 20, fontSize: 22, fontWeight: 700, color: "#1a237e" }, children: "Communication & Presence Assessment" }), _jsxs("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 20 }, children: [_jsxs("div", { style: { textAlign: "center" }, children: [_jsx("div", { style: { fontSize: 13, color: '#555', marginBottom: 8, fontWeight: 600 }, children: "Confidence" }), _jsxs("div", { style: { fontSize: 36, fontWeight: 800, color: getColor(avgConfidence) }, children: [avgConfidence, "%"] })] }), _jsxs("div", { style: { textAlign: "center" }, children: [_jsx("div", { style: { fontSize: 13, color: '#555', marginBottom: 8, fontWeight: 600 }, children: "Empathy" }), _jsxs("div", { style: { fontSize: 36, fontWeight: 800, color: getColor(avgEmpathy) }, children: [avgEmpathy, "%"] })] }), _jsxs("div", { style: { textAlign: "center" }, children: [_jsx("div", { style: { fontSize: 13, color: '#555', marginBottom: 8, fontWeight: 600 }, children: "Executive Presence" }), _jsxs("div", { style: { fontSize: 36, fontWeight: 800, color: getColor(avgExecutive) }, children: [avgExecutive, "%"] })] }), _jsxs("div", { style: { textAlign: "center" }, children: [_jsx("div", { style: { fontSize: 13, color: '#555', marginBottom: 8, fontWeight: 600 }, children: "Professionalism" }), _jsxs("div", { style: { fontSize: 36, fontWeight: 800, color: getColor(avgProfessionalism) }, children: [avgProfessionalism, "%"] })] })] })] }));
                                    })(), finalResults.results.map((r, i) => (_jsxs("div", { style: {
                                            background: "#f8f9fa",
                                            border: "2px solid #e0e0e0",
                                            borderRadius: 16,
                                            padding: 20,
                                            marginBottom: 20
                                        }, children: [_jsxs("div", { style: { fontWeight: 700, marginBottom: 12, fontSize: 18, color: "#1a237e" }, children: [r.heading || r.questionId, " ", r.topic ? `(${r.topic})` : ""] }), _jsxs("div", { style: { marginBottom: 12, fontSize: 16, fontWeight: 600, color: "#4CAF50" }, children: ["Technical Score: ", r.evaluation?.score, "%"] }), _jsxs("div", { style: { marginBottom: 12 }, children: [_jsx("strong", { style: { color: "#555" }, children: "Technical Feedback:" }), _jsx("div", { style: { marginTop: 6, fontStyle: "italic", fontSize: 14, color: "#37474f" }, children: r.evaluation?.feedback })] }), r.evaluation?.sentiment && (_jsxs("div", { style: { marginTop: 16, padding: 16, background: 'white', borderRadius: 12, border: "1px solid #e0e0e0" }, children: [_jsx("strong", { style: { color: "#555" }, children: "Communication Assessment:" }), _jsxs("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginTop: 12, fontSize: 14 }, children: [_jsxs("div", { children: [_jsx("span", { style: { color: "#666" }, children: "Confidence:" }), _jsxs("strong", { style: { marginLeft: 6, color: "#1a237e" }, children: [r.evaluation.sentiment.confidence, "%"] })] }), _jsxs("div", { children: [_jsx("span", { style: { color: "#666" }, children: "Empathy:" }), _jsxs("strong", { style: { marginLeft: 6, color: "#1a237e" }, children: [r.evaluation.sentiment.empathy, "%"] })] }), _jsxs("div", { children: [_jsx("span", { style: { color: "#666" }, children: "Executive Presence:" }), _jsxs("strong", { style: { marginLeft: 6, color: "#1a237e" }, children: [r.evaluation.sentiment.executive_presence, "%"] })] }), _jsxs("div", { children: [_jsx("span", { style: { color: "#666" }, children: "Professionalism:" }), _jsxs("strong", { style: { marginLeft: 6, color: "#1a237e" }, children: [r.evaluation.sentiment.professionalism, "%"] })] })] }), r.evaluation?.sentiment_feedback && (_jsxs("div", { style: { marginTop: 12, fontSize: 14, color: '#555', fontStyle: 'italic', padding: 12, background: "#f8f9fa", borderRadius: 8 }, children: ["\uD83D\uDCA1 ", r.evaluation.sentiment_feedback] }))] })), r.learnLinks?.length > 0 && (_jsxs("div", { style: { marginTop: 16 }, children: [_jsx("strong", { style: { color: "#555" }, children: "\uD83D\uDCDA Microsoft Learn Resources:" }), _jsx("ul", { style: { margin: "10px 0 0 20px", lineHeight: 1.8 }, children: r.learnLinks.map((l, j) => (_jsx("li", { style: { fontSize: 14 }, children: _jsx("a", { href: l.url, target: "_blank", rel: "noreferrer", style: {
                                                                    color: "#2196F3",
                                                                    textDecoration: "none",
                                                                    fontWeight: 500
                                                                }, onMouseEnter: e => e.currentTarget.style.textDecoration = "underline", onMouseLeave: e => e.currentTarget.style.textDecoration = "none", children: l.title }) }, j))) })] }))] }, i)))] }))] })] }), _jsx("style", { children: `
        @keyframes pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.05); }
        }
      ` })] }));
}
