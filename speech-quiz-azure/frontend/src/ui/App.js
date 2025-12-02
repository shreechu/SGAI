import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import { BrowserRouter, useNavigate, useLocation } from "react-router-dom";
import axios from "axios";
import * as SpeechSDK from "microsoft-cognitiveservices-speech-sdk";
// Configure axios to use backend endpoint
axios.defaults.baseURL = "http://localhost:7071";
export default function App() {
    return (_jsx(BrowserRouter, { children: _jsx(AppContent, {}) }));
}
function AppContent() {
    const navigate = useNavigate();
    const location = useLocation();
    // Determine current page from URL path
    const getPageFromPath = (path) => {
        if (path === '/')
            return 'landing';
        if (path === '/quiz')
            return 'quiz';
        if (path === '/confirm-submission')
            return 'confirmSubmission';
        if (path === '/admin/login')
            return 'adminLogin';
        if (path === '/admin')
            return 'admin';
        return 'landing';
    };
    const currentPage = getPageFromPath(location.pathname);
    const navigateToPage = (page) => {
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
    const [userProfile, setUserProfile] = useState(() => {
        const saved = sessionStorage.getItem('userProfile');
        return saved ? JSON.parse(saved) : { name: '', email: '', technicalConfidence: 5, consultativeConfidence: 5 };
    });
    const [adminSessions, setAdminSessions] = useState([]);
    // Admin login state
    const [adminUsername, setAdminUsername] = useState('');
    const [adminPassword, setAdminPassword] = useState('');
    const [loginError, setLoginError] = useState('');
    const [selectedSession, setSelectedSession] = useState(null);
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
    const browserRecognizerRef = useRef(null);
    const webVoiceRef = useRef(null);
    const tokenRef = useRef(null);
    // Initialize browser speech API on mount
    useEffect(() => {
        try {
            const w = window;
            if (w && (w.SpeechRecognition || w.webkitSpeechRecognition)) {
                console.log("Browser speech recognition available");
                setBrowserFallbackReady(true);
            }
            else {
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
        }
        catch { }
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
                }
                catch { }
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
            }
            else {
                setEndOfQuiz(false); // Reset end of quiz flag when loading a valid question
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
    function onPlayQuestion() {
        if (!question)
            return;
        try {
            speakText(question.question);
        }
        catch (err) {
            setError(`Failed to play question: ${err.message}`);
        }
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
            console.log("Checking browser fallback - SR available:", !!SR);
            if (SR) {
                console.log("Using Browser Web Speech API");
                // Clean up any existing recognizer first
                if (browserRecognizerRef.current) {
                    try {
                        browserRecognizerRef.current.stop();
                    }
                    catch { }
                    browserRecognizerRef.current = null;
                }
                const rec = new SR();
                browserRecognizerRef.current = rec;
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
            if (browserRecognizerRef.current) {
                try {
                    browserRecognizerRef.current.stop();
                    browserRecognizerRef.current = null;
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
    function goToQuestionById(qid) {
        const target = seenQuestions.find(sq => sq.id === qid);
        if (!target)
            return;
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
        }
        catch (err) {
            console.error("Submit error:", err);
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
                                        }, children: userProfile.consultativeConfidence }) })] }), _jsx("button", { onClick: () => {
                                sessionStorage.setItem('userProfile', JSON.stringify(userProfile));
                                navigateToPage('quiz');
                            }, disabled: !isFormValid, style: {
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
                            }, children: "Begin Assessment \u2192" }), _jsx("button", { onClick: () => navigateToPage('adminLogin'), style: {
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
        const handleLogin = () => {
            handleAdminLogin(adminUsername, adminPassword);
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
                        padding: 40,
                        position: "relative"
                    }, children: [_jsx("button", { onClick: () => navigateToPage('landing'), style: {
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
                            }, children: "\uD83C\uDFE0 Home" }), _jsx("h2", { style: {
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
                            }, children: loginError })), _jsxs("div", { style: { marginBottom: 20 }, children: [_jsx("label", { style: { display: "block", marginBottom: 8, fontWeight: 600, color: "#37474f" }, children: "Username" }), _jsx("input", { type: "text", value: adminUsername, onChange: e => setAdminUsername(e.target.value), placeholder: "Enter username", style: {
                                        width: "100%",
                                        padding: "12px 16px",
                                        fontSize: 16,
                                        border: "2px solid #e0e0e0",
                                        borderRadius: 8,
                                        outline: "none"
                                    }, onKeyPress: e => e.key === 'Enter' && handleLogin() })] }), _jsxs("div", { style: { marginBottom: 24 }, children: [_jsx("label", { style: { display: "block", marginBottom: 8, fontWeight: 600, color: "#37474f" }, children: "Password" }), _jsx("input", { type: "password", value: adminPassword, onChange: e => setAdminPassword(e.target.value), placeholder: "Enter password", style: {
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
                            }, children: "Login" }), _jsx("button", { onClick: () => navigateToPage('landing'), style: {
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
        // If a session is selected, show detailed view
        if (selectedSession) {
            return (_jsx("div", { style: {
                    minHeight: "100vh",
                    background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
                    fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
                    padding: "20px"
                }, children: _jsx("div", { style: { maxWidth: 1200, margin: "0 auto" }, children: _jsxs("div", { style: {
                            background: "white",
                            borderRadius: 20,
                            boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
                            padding: 32
                        }, children: [_jsxs("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }, children: [_jsx("h1", { style: {
                                            fontSize: 28,
                                            fontWeight: 700,
                                            color: "#1a237e",
                                            margin: 0
                                        }, children: "Evaluation Details" }), _jsx("button", { onClick: () => setSelectedSession(null), style: {
                                            padding: "10px 20px",
                                            backgroundColor: "#667eea",
                                            color: "white",
                                            border: "none",
                                            borderRadius: 8,
                                            fontSize: 14,
                                            fontWeight: 600,
                                            cursor: "pointer"
                                        }, children: "\u2190 Back to Dashboard" })] }), _jsx("div", { style: {
                                    backgroundColor: "#f5f5f5",
                                    padding: "20px",
                                    borderRadius: 12,
                                    marginBottom: 24
                                }, children: _jsxs("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 16 }, children: [_jsxs("div", { children: [_jsx("div", { style: { fontSize: 12, color: "#666", marginBottom: 4 }, children: "Architect Name" }), _jsx("div", { style: { fontSize: 18, fontWeight: 700, color: "#1a237e" }, children: selectedSession.userName })] }), _jsxs("div", { children: [_jsx("div", { style: { fontSize: 12, color: "#666", marginBottom: 4 }, children: "Email" }), _jsx("div", { style: { fontSize: 16, fontWeight: 600, color: "#555" }, children: selectedSession.userEmail })] }), _jsxs("div", { children: [_jsx("div", { style: { fontSize: 12, color: "#666", marginBottom: 4 }, children: "Overall Score" }), _jsxs("div", { style: { fontSize: 24, fontWeight: 700, color: selectedSession.overallScore >= 70 ? "#4CAF50" : selectedSession.overallScore >= 50 ? "#FF9800" : "#f44336" }, children: [selectedSession.overallScore, "%"] })] }), _jsxs("div", { children: [_jsx("div", { style: { fontSize: 12, color: "#666", marginBottom: 4 }, children: "Evaluation Date" }), _jsxs("div", { style: { fontSize: 16, fontWeight: 600, color: "#555" }, children: [new Date(selectedSession.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }), ' at ', new Date(selectedSession.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })] })] })] }) }), _jsx("h2", { style: { fontSize: 20, fontWeight: 700, color: "#1a237e", marginBottom: 16 }, children: "Question-by-Question Analysis" }), selectedSession.results && selectedSession.results.length > 0 ? (_jsx("div", { style: { display: "flex", flexDirection: "column", gap: 16 }, children: selectedSession.results.map((result, idx) => (_jsxs("div", { style: {
                                        border: "2px solid #e0e0e0",
                                        borderRadius: 12,
                                        padding: 20,
                                        backgroundColor: "#fafafa"
                                    }, children: [_jsxs("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: 12 }, children: [_jsxs("div", { children: [_jsx("div", { style: { fontSize: 12, color: "#666", marginBottom: 4 }, children: result.topic || 'Question ' + (idx + 1) }), _jsx("h3", { style: { fontSize: 16, fontWeight: 700, color: "#1a237e", margin: 0 }, children: result.heading || result.questionId })] }), _jsxs("span", { style: {
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
                                                    }, children: [result.evaluation?.score || 0, "%"] })] }), result.evaluation?.feedback && (_jsxs("div", { style: { marginBottom: 12 }, children: [_jsx("div", { style: { fontSize: 13, fontWeight: 600, color: "#1a237e", marginBottom: 6 }, children: "\uD83D\uDCCB Technical Feedback" }), _jsx("div", { style: { fontSize: 14, color: "#555", lineHeight: 1.6 }, children: result.evaluation.feedback })] })), result.evaluation?.sentiment && (_jsxs("div", { style: { marginBottom: 12 }, children: [_jsx("div", { style: { fontSize: 13, fontWeight: 600, color: "#1a237e", marginBottom: 8 }, children: "\uD83D\uDCAC Communication Assessment" }), _jsxs("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }, children: [_jsxs("div", { children: [_jsx("div", { style: { fontSize: 11, color: "#666", marginBottom: 4 }, children: "Confidence" }), _jsxs("div", { style: {
                                                                        fontSize: 16,
                                                                        fontWeight: 700,
                                                                        color: result.evaluation.sentiment.confidence >= 70 ? "#4CAF50" : result.evaluation.sentiment.confidence >= 50 ? "#FF9800" : "#f44336"
                                                                    }, children: [result.evaluation.sentiment.confidence, "/100"] })] }), _jsxs("div", { children: [_jsx("div", { style: { fontSize: 11, color: "#666", marginBottom: 4 }, children: "Empathy" }), _jsxs("div", { style: {
                                                                        fontSize: 16,
                                                                        fontWeight: 700,
                                                                        color: result.evaluation.sentiment.empathy >= 70 ? "#4CAF50" : result.evaluation.sentiment.empathy >= 50 ? "#FF9800" : "#f44336"
                                                                    }, children: [result.evaluation.sentiment.empathy, "/100"] })] }), _jsxs("div", { children: [_jsx("div", { style: { fontSize: 11, color: "#666", marginBottom: 4 }, children: "Executive Presence" }), _jsxs("div", { style: {
                                                                        fontSize: 16,
                                                                        fontWeight: 700,
                                                                        color: result.evaluation.sentiment.executive_presence >= 70 ? "#4CAF50" : result.evaluation.sentiment.executive_presence >= 50 ? "#FF9800" : "#f44336"
                                                                    }, children: [result.evaluation.sentiment.executive_presence, "/100"] })] }), _jsxs("div", { children: [_jsx("div", { style: { fontSize: 11, color: "#666", marginBottom: 4 }, children: "Professionalism" }), _jsxs("div", { style: {
                                                                        fontSize: 16,
                                                                        fontWeight: 700,
                                                                        color: result.evaluation.sentiment.professionalism >= 70 ? "#4CAF50" : result.evaluation.sentiment.professionalism >= 50 ? "#FF9800" : "#f44336"
                                                                    }, children: [result.evaluation.sentiment.professionalism, "/100"] })] })] })] })), result.evaluation?.sentiment_feedback && (_jsxs("div", { style: {
                                                backgroundColor: "#fff3e0",
                                                padding: 12,
                                                borderRadius: 8,
                                                fontSize: 13,
                                                color: "#e65100",
                                                lineHeight: 1.5
                                            }, children: ["\uD83D\uDCA1 ", result.evaluation.sentiment_feedback] })), _jsxs("div", { style: { marginTop: 12, display: "flex", gap: 16, flexWrap: "wrap" }, children: [result.evaluation?.matched_phrases && result.evaluation.matched_phrases.length > 0 && (_jsxs("div", { children: [_jsxs("div", { style: { fontSize: 11, color: "#4CAF50", fontWeight: 600, marginBottom: 6 }, children: ["\u2713 Matched Phrases (", result.evaluation.matched_phrases.length, ")"] }), _jsx("div", { style: { display: "flex", gap: 6, flexWrap: "wrap" }, children: result.evaluation.matched_phrases.map((phrase, i) => (_jsx("span", { style: {
                                                                    backgroundColor: "#e8f5e9",
                                                                    color: "#2e7d32",
                                                                    padding: "4px 10px",
                                                                    borderRadius: 12,
                                                                    fontSize: 12,
                                                                    fontWeight: 500
                                                                }, children: phrase }, i))) })] })), result.evaluation?.missing_phrases && result.evaluation.missing_phrases.length > 0 && (_jsxs("div", { children: [_jsxs("div", { style: { fontSize: 11, color: "#f44336", fontWeight: 600, marginBottom: 6 }, children: ["\u2717 Missing Phrases (", result.evaluation.missing_phrases.length, ")"] }), _jsx("div", { style: { display: "flex", gap: 6, flexWrap: "wrap" }, children: result.evaluation.missing_phrases.map((phrase, i) => (_jsx("span", { style: {
                                                                    backgroundColor: "#ffebee",
                                                                    color: "#c62828",
                                                                    padding: "4px 10px",
                                                                    borderRadius: 12,
                                                                    fontSize: 12,
                                                                    fontWeight: 500
                                                                }, children: phrase }, i))) })] }))] })] }, idx))) })) : (_jsx("div", { style: { padding: 40, textAlign: "center", color: "#999" }, children: "No detailed results available" }))] }) }) }));
        }
        // Main dashboard view
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
                                    }, children: "Admin Dashboard" }), _jsxs("div", { style: { display: "flex", gap: 12 }, children: [_jsx("button", { onClick: () => navigateToPage('landing'), style: {
                                                padding: "10px 20px",
                                                backgroundColor: "#667eea",
                                                color: "white",
                                                border: "none",
                                                borderRadius: 8,
                                                fontSize: 14,
                                                fontWeight: 600,
                                                cursor: "pointer"
                                            }, children: "\uD83C\uDFE0 Home" }), _jsx("button", { onClick: () => {
                                                setAdminUsername('');
                                                setAdminPassword('');
                                                setLoginError('');
                                                navigateToPage('landing');
                                            }, style: {
                                                padding: "10px 20px",
                                                backgroundColor: "#f44336",
                                                color: "white",
                                                border: "none",
                                                borderRadius: 8,
                                                fontSize: 14,
                                                fontWeight: 600,
                                                cursor: "pointer"
                                            }, children: "Logout" })] })] }), _jsxs("div", { style: {
                                backgroundColor: "#f5f5f5",
                                padding: "16px 20px",
                                borderRadius: 12,
                                marginBottom: 24,
                                display: "flex",
                                alignItems: "center",
                                gap: 12
                            }, children: [_jsx("span", { style: { fontSize: 24 }, children: "\uD83D\uDCCA" }), _jsxs("span", { style: { color: "#666", fontSize: 16 }, children: ["Total Evaluations: ", _jsx("strong", { style: { color: "#1a237e", fontSize: 18 }, children: adminSessions.length })] })] }), _jsx("div", { style: { overflowX: "auto" }, children: _jsxs("table", { style: {
                                    width: "100%",
                                    borderCollapse: "collapse",
                                    fontSize: 14
                                }, children: [_jsx("thead", { children: _jsxs("tr", { style: { backgroundColor: "#1a237e" }, children: [_jsx("th", { style: { padding: "14px 12px", textAlign: "left", color: "white", fontWeight: 600, borderBottom: "3px solid #667eea" }, children: "Architect Name" }), _jsx("th", { style: { padding: "14px 12px", textAlign: "left", color: "white", fontWeight: 600, borderBottom: "3px solid #667eea" }, children: "Email ID" }), _jsx("th", { style: { padding: "14px 12px", textAlign: "center", color: "white", fontWeight: 600, borderBottom: "3px solid #667eea" }, children: "Evaluation Score" }), _jsx("th", { style: { padding: "14px 12px", textAlign: "center", color: "white", fontWeight: 600, borderBottom: "3px solid #667eea" }, children: "Date & Time" })] }) }), _jsx("tbody", { children: adminSessions.length === 0 ? (_jsx("tr", { children: _jsx("td", { colSpan: 4, style: { padding: 32, textAlign: "center", color: "#999", fontSize: 16 }, children: "\uD83D\uDCED No evaluations recorded yet" }) })) : (adminSessions.map((session, idx) => (_jsxs("tr", { onClick: () => setSelectedSession(session), style: {
                                                borderBottom: "1px solid #e0e0e0",
                                                backgroundColor: idx % 2 === 0 ? "#fafafa" : "white",
                                                cursor: "pointer",
                                                transition: "background-color 0.2s"
                                            }, onMouseEnter: e => {
                                                e.currentTarget.style.backgroundColor = "#e3f2fd";
                                            }, onMouseLeave: e => {
                                                e.currentTarget.style.backgroundColor = idx % 2 === 0 ? "#fafafa" : "white";
                                            }, children: [_jsx("td", { style: { padding: "14px 12px", fontWeight: 600, color: "#1a237e" }, children: session.userName }), _jsx("td", { style: { padding: "14px 12px", color: "#555" }, children: session.userEmail }), _jsx("td", { style: { padding: "14px 12px", textAlign: "center" }, children: _jsxs("span", { style: {
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
                                                        }, children: [session.overallScore, "%"] }) }), _jsx("td", { style: { padding: "14px 12px", textAlign: "center", color: "#666" }, children: _jsxs("div", { style: { display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }, children: [_jsx("span", { style: { fontWeight: 600, color: "#1a237e" }, children: new Date(session.timestamp).toLocaleDateString('en-US', {
                                                                    month: 'short',
                                                                    day: 'numeric',
                                                                    year: 'numeric'
                                                                }) }), _jsx("span", { style: { fontSize: 12, color: "#999" }, children: new Date(session.timestamp).toLocaleTimeString('en-US', {
                                                                    hour: '2-digit',
                                                                    minute: '2-digit'
                                                                }) })] }) })] }, idx)))) })] }) })] }) }) }));
    }
    function renderConfirmSubmissionPage() {
        const unansweredCount = seenQuestions.filter(q => !answers[q.id]).length;
        const answeredCount = Object.keys(answers).length;
        return (_jsx("div", { style: {
                minHeight: "100vh",
                background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
                fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
                padding: "40px 20px"
            }, children: _jsx("div", { style: { maxWidth: 1000, margin: "0 auto" }, children: _jsxs("div", { style: {
                        background: "white",
                        borderRadius: 20,
                        padding: 40,
                        boxShadow: "0 20px 60px rgba(0,0,0,0.3)"
                    }, children: [_jsx("h1", { style: {
                                fontSize: 32,
                                fontWeight: 700,
                                color: "#1a237e",
                                marginBottom: 8,
                                textAlign: "center"
                            }, children: "\uD83D\uDCCB Confirm Evaluation Submission" }), _jsx("p", { style: {
                                textAlign: "center",
                                color: "#666",
                                marginBottom: 32,
                                fontSize: 16
                            }, children: "Review your responses before final submission" }), _jsxs("div", { style: {
                                display: "flex",
                                gap: 20,
                                marginBottom: 32,
                                justifyContent: "center",
                                flexWrap: "wrap"
                            }, children: [_jsxs("div", { style: {
                                        padding: "16px 24px",
                                        background: "linear-gradient(135deg, #4CAF50 0%, #45a049 100%)",
                                        borderRadius: 12,
                                        color: "white",
                                        textAlign: "center",
                                        minWidth: 140
                                    }, children: [_jsx("div", { style: { fontSize: 32, fontWeight: 700 }, children: answeredCount }), _jsx("div", { style: { fontSize: 14, opacity: 0.9 }, children: "Answered" })] }), _jsxs("div", { style: {
                                        padding: "16px 24px",
                                        background: unansweredCount > 0
                                            ? "linear-gradient(135deg, #FF9800 0%, #F57C00 100%)"
                                            : "linear-gradient(135deg, #9E9E9E 0%, #757575 100%)",
                                        borderRadius: 12,
                                        color: "white",
                                        textAlign: "center",
                                        minWidth: 140
                                    }, children: [_jsx("div", { style: { fontSize: 32, fontWeight: 700 }, children: unansweredCount }), _jsx("div", { style: { fontSize: 14, opacity: 0.9 }, children: "Unanswered" })] }), _jsxs("div", { style: {
                                        padding: "16px 24px",
                                        background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
                                        borderRadius: 12,
                                        color: "white",
                                        textAlign: "center",
                                        minWidth: 140
                                    }, children: [_jsx("div", { style: { fontSize: 32, fontWeight: 700 }, children: seenQuestions.length }), _jsx("div", { style: { fontSize: 14, opacity: 0.9 }, children: "Total Questions" })] })] }), _jsx("div", { style: {
                                border: "1px solid #e0e0e0",
                                borderRadius: 12,
                                overflow: "hidden",
                                marginBottom: 24
                            }, children: _jsxs("table", { style: {
                                    width: "100%",
                                    borderCollapse: "collapse"
                                }, children: [_jsx("thead", { children: _jsxs("tr", { style: { background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)", color: "white" }, children: [_jsx("th", { style: { padding: "16px 12px", textAlign: "left", fontSize: 14, fontWeight: 600 }, children: "#" }), _jsx("th", { style: { padding: "16px 12px", textAlign: "left", fontSize: 14, fontWeight: 600 }, children: "Topic" }), _jsx("th", { style: { padding: "16px 12px", textAlign: "center", fontSize: 14, fontWeight: 600 }, children: "Status" }), _jsx("th", { style: { padding: "16px 12px", textAlign: "center", fontSize: 14, fontWeight: 600 }, children: "Action" })] }) }), _jsx("tbody", { children: seenQuestions.map((q, index) => {
                                            const hasAnswer = !!answers[q.id];
                                            return (_jsxs("tr", { style: {
                                                    background: index % 2 === 0 ? "#fafafa" : "white",
                                                    borderBottom: "1px solid #e0e0e0"
                                                }, children: [_jsx("td", { style: { padding: "16px 12px", fontSize: 14, fontWeight: 600, color: "#666" }, children: index + 1 }), _jsxs("td", { style: { padding: "16px 12px", fontSize: 14 }, children: [_jsx("div", { style: { fontWeight: 600, color: "#1a237e", marginBottom: 4 }, children: q.heading || q.id }), q.topic && (_jsx("div", { style: { fontSize: 12, color: "#999" }, children: q.topic }))] }), _jsx("td", { style: { padding: "16px 12px", textAlign: "center" }, children: hasAnswer ? (_jsx("span", { style: {
                                                                display: "inline-block",
                                                                padding: "6px 16px",
                                                                background: "#e8f5e9",
                                                                color: "#2e7d32",
                                                                borderRadius: 20,
                                                                fontSize: 13,
                                                                fontWeight: 600
                                                            }, children: "\u2713 Answered" })) : (_jsx("span", { style: {
                                                                display: "inline-block",
                                                                padding: "6px 16px",
                                                                background: "#fff3e0",
                                                                color: "#e65100",
                                                                borderRadius: 20,
                                                                fontSize: 13,
                                                                fontWeight: 600
                                                            }, children: "\u26A0 Skipped" })) }), _jsx("td", { style: { padding: "16px 12px", textAlign: "center" }, children: _jsx("button", { onClick: () => {
                                                                navigateToPage('quiz');
                                                                setEndOfQuiz(false);
                                                                fetchQuestion(q.idx);
                                                            }, style: {
                                                                padding: "8px 16px",
                                                                background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
                                                                color: "white",
                                                                border: "none",
                                                                borderRadius: 8,
                                                                cursor: "pointer",
                                                                fontSize: 13,
                                                                fontWeight: 600,
                                                                transition: "all 0.2s"
                                                            }, onMouseEnter: e => {
                                                                e.currentTarget.style.transform = "translateY(-2px)";
                                                                e.currentTarget.style.boxShadow = "0 4px 12px rgba(102,126,234,0.4)";
                                                            }, onMouseLeave: e => {
                                                                e.currentTarget.style.transform = "translateY(0)";
                                                                e.currentTarget.style.boxShadow = "none";
                                                            }, children: "\uD83D\uDC41\uFE0F Review" }) })] }, q.id));
                                        }) })] }) }), unansweredCount > 0 && (_jsxs("div", { style: {
                                padding: 16,
                                background: "#fff3e0",
                                border: "2px solid #ff9800",
                                borderRadius: 12,
                                marginBottom: 24,
                                display: "flex",
                                alignItems: "center",
                                gap: 12
                            }, children: [_jsx("span", { style: { fontSize: 24 }, children: "\u26A0\uFE0F" }), _jsxs("div", { children: [_jsxs("div", { style: { fontWeight: 700, color: "#e65100", marginBottom: 4 }, children: ["You have ", unansweredCount, " unanswered question(s)"] }), _jsx("div", { style: { fontSize: 14, color: "#666" }, children: "You can still submit, but unanswered questions won't be evaluated." })] })] })), _jsxs("div", { style: { display: "flex", gap: 16, justifyContent: "center", flexWrap: "wrap" }, children: [_jsx("button", { onClick: () => navigateToPage('quiz'), style: {
                                        padding: "14px 32px",
                                        background: "#f5f5f5",
                                        color: "#333",
                                        border: "2px solid #e0e0e0",
                                        borderRadius: 12,
                                        cursor: "pointer",
                                        fontSize: 16,
                                        fontWeight: 600,
                                        transition: "all 0.3s"
                                    }, onMouseEnter: e => {
                                        e.currentTarget.style.background = "#e0e0e0";
                                    }, onMouseLeave: e => {
                                        e.currentTarget.style.background = "#f5f5f5";
                                    }, children: "\u2190 Go Back to Quiz" }), _jsx("button", { onClick: () => {
                                        console.log("Confirm submit clicked!");
                                        onSubmitAll();
                                    }, disabled: loading, style: {
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
                                    }, onMouseEnter: e => {
                                        if (!loading) {
                                            e.currentTarget.style.transform = "translateY(-2px)";
                                            e.currentTarget.style.boxShadow = "0 8px 20px rgba(76,175,80,0.5)";
                                        }
                                    }, onMouseLeave: e => {
                                        e.currentTarget.style.transform = "translateY(0)";
                                        e.currentTarget.style.boxShadow = !loading ? "0 4px 12px rgba(76,175,80,0.4)" : "none";
                                    }, children: "\u2705 Confirm & Submit Evaluation" })] })] }) }) }));
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
    return (_jsxs("div", { style: {
            minHeight: "100vh",
            background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
            fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
            padding: "20px 20px"
        }, children: [_jsxs("div", { style: { maxWidth: 1200, margin: "0 auto" }, children: [_jsxs("div", { style: {
                            textAlign: "center",
                            color: "white",
                            marginBottom: 20,
                            position: "relative"
                        }, children: [_jsx("button", { onClick: () => navigateToPage('landing'), style: {
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
                                }, onMouseEnter: e => e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.3)", onMouseLeave: e => e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.2)", children: "\uD83C\uDFE0 Home" }), _jsx("h1", { style: {
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
                                        }, children: "\uD83C\uDF99\uFE0F Your Response" }), _jsx("p", { style: { color: "#666", marginBottom: 20, fontSize: 15 }, children: "Click below to start responding. Speak naturally and your response will be transcribed." }), _jsxs("div", { style: { display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap", justifyContent: "center" }, children: [_jsxs("button", { onClick: onStartListening, disabled: loading || listening, title: "Start responding", style: {
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
                                                }, onMouseEnter: e => {
                                                    if (!(loading || listening)) {
                                                        e.currentTarget.style.transform = "translateY(-2px)";
                                                        e.currentTarget.style.boxShadow = "0 12px 24px rgba(102,126,234,0.4)";
                                                    }
                                                }, onMouseLeave: e => {
                                                    e.currentTarget.style.transform = "translateY(0)";
                                                    e.currentTarget.style.boxShadow = "0 8px 16px rgba(102,126,234,0.3)";
                                                }, children: [_jsx("span", { style: { fontSize: 20 }, children: "\uD83C\uDFA4" }), _jsx("span", { children: listening ? "Recording..." : "Start Responding" })] }), listening && (_jsxs(_Fragment, { children: [_jsxs("button", { onClick: onStopListening, title: "Stop recording", style: {
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
                                                        }, onMouseEnter: e => {
                                                            e.currentTarget.style.transform = "translateY(-2px)";
                                                            e.currentTarget.style.boxShadow = "0 12px 24px rgba(244,67,54,0.4)";
                                                        }, onMouseLeave: e => {
                                                            e.currentTarget.style.transform = "translateY(0)";
                                                            e.currentTarget.style.boxShadow = "0 8px 16px rgba(244,67,54,0.3)";
                                                        }, children: [_jsx("span", { style: { fontSize: 18 }, children: "\u23F9" }), _jsx("span", { children: "Stop" })] }), _jsxs("button", { onClick: togglePauseListening, title: pausedListening ? "Resume recording" : "Pause recording", style: {
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
                                                        }, onMouseEnter: e => {
                                                            e.currentTarget.style.transform = "translateY(-2px)";
                                                            e.currentTarget.style.boxShadow = "0 12px 24px rgba(0,0,0,0.3)";
                                                        }, onMouseLeave: e => {
                                                            e.currentTarget.style.transform = "translateY(0)";
                                                            e.currentTarget.style.boxShadow = "0 8px 16px rgba(0,0,0,0.2)";
                                                        }, children: [_jsx("span", { style: { fontSize: 18 }, children: pausedListening ? "▶️" : "⏸" }), _jsx("span", { children: pausedListening ? "Resume" : "Pause" })] })] }))] }), _jsx("div", { style: { textAlign: "center", color: "#999", fontSize: 13, marginBottom: 16 }, children: azureReady ? "✓ Azure Speech SDK" : browserFallbackReady ? "✓ Browser Speech" : "Speech not available" }), transcript && (_jsxs("div", { style: {
                                            marginTop: 16,
                                            padding: 16,
                                            backgroundColor: "#f8f9fa",
                                            border: "2px solid #e0e0e0",
                                            borderRadius: 12
                                        }, children: [_jsx("strong", { style: { color: "#1a237e", fontSize: 15 }, children: "Your answer:" }), _jsx("p", { style: { marginTop: 12, fontSize: 15, lineHeight: 1.6, color: "#37474f" }, children: transcript })] })), _jsxs("div", { style: { display: "flex", gap: 12, marginTop: 20, flexWrap: "wrap", justifyContent: "center" }, children: [_jsx("button", { onClick: onRetryRecording, disabled: loading || listening, title: "Retry recording", style: {
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
                                                }, children: "\uD83D\uDD01" }), _jsx("button", { onClick: () => fetchQuestion(idx), disabled: loading || listening || speaking, title: "Save and next question", style: {
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
                                                }, onMouseEnter: e => {
                                                    if (!(loading || listening || speaking)) {
                                                        e.currentTarget.style.transform = "scale(1.05)";
                                                    }
                                                }, onMouseLeave: e => {
                                                    e.currentTarget.style.transform = "scale(1)";
                                                }, children: "\uD83D\uDCBE Save and Next \u27A1\uFE0F" }), _jsx("button", { onClick: handleEndEvaluation, disabled: loading || listening || speaking || seenQuestions.length === 0, title: "End Evaluation", style: {
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
                                        })()] }) })), endOfQuiz && !finalResults && (_jsxs("div", { style: { border: "1px solid #ddd", padding: 16, borderRadius: 8, background: "#fff" }, children: [_jsx("h3", { children: "Review your answers" }), _jsx("p", { children: "You\u2019ve reached the end. Save anything missing, then submit all to see your results with Microsoft Learn links." }), (() => {
                                        console.log("Seen questions:", seenQuestions.map(q => q.id));
                                        console.log("Saved answer keys:", Object.keys(answers));
                                        const unanswered = seenQuestions.filter(q => {
                                            const hasAnswer = !!answers[q.id];
                                            console.log(`Question ${q.id}: hasAnswer=${hasAnswer}, answer=${answers[q.id]}`);
                                            return !hasAnswer;
                                        });
                                        console.log("Unanswered:", unanswered.map(q => q.id));
                                        if (unanswered.length === 0)
                                            return null;
                                        return (_jsxs("div", { style: { marginTop: 12, padding: 12, background: '#fff8e1', border: '1px solid #ffe082', borderRadius: 6 }, children: [_jsxs("strong", { children: ["Unanswered questions (", unanswered.length, "):"] }), _jsx("ul", { style: { margin: '8px 0 0 18px' }, children: unanswered.map(u => (_jsx("li", { style: { marginBottom: 6 }, children: (u.heading || u.id) }, u.id))) })] }));
                                    })(), _jsxs("div", { style: { marginTop: 12 }, children: [Object.keys(answers).length === 0 && _jsx("p", { children: "No answers saved yet." }), Object.entries(answers).map(([qid, text]) => (_jsxs("div", { style: { marginBottom: 8 }, children: [_jsx("strong", { children: qid }), _jsx("div", { style: { marginTop: 4, padding: 8, background: "#f9f9f9", borderRadius: 4 }, children: text })] }, qid)))] }), _jsx("button", { onClick: () => {
                                            console.log("=== SUBMIT EVALUATION CLICKED ===");
                                            console.log("Total answers saved:", Object.keys(answers).length);
                                            console.log("Saved question IDs:", Object.keys(answers));
                                            console.log("Seen questions:", seenQuestions.map(q => q.id));
                                            console.log("Answers object:", answers);
                                            // If no answers, submit directly; otherwise go to confirmation page
                                            if (Object.keys(answers).length === 0) {
                                                onSubmitAll();
                                            }
                                            else {
                                                navigateToPage('confirmSubmission');
                                            }
                                        }, disabled: loading, style: {
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
                                        }, onMouseEnter: e => {
                                            if (!loading) {
                                                e.currentTarget.style.transform = "translateY(-2px)";
                                                e.currentTarget.style.boxShadow = "0 8px 20px rgba(102,126,234,0.5)";
                                            }
                                        }, onMouseLeave: e => {
                                            e.currentTarget.style.transform = "translateY(0)";
                                            e.currentTarget.style.boxShadow = !loading ? "0 4px 12px rgba(102,126,234,0.4)" : "none";
                                        }, children: loading ? "Evaluating..." : "📊 Submit Evaluation" })] })), finalResults && (_jsxs("div", { style: {
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
                                        }, children: [_jsxs("div", { style: { fontWeight: 700, marginBottom: 12, fontSize: 18, color: "#1a237e" }, children: [r.heading || r.questionId, " ", r.topic ? `(${r.topic})` : ""] }), _jsxs("div", { style: { marginBottom: 12, fontSize: 16, fontWeight: 600, color: "#4CAF50" }, children: ["Technical Score: ", r.evaluation?.score, "%"] }), answers[r.questionId] && (_jsxs("div", { style: { marginBottom: 16, padding: 16, background: 'white', borderRadius: 12, border: "2px solid #667eea" }, children: [_jsx("strong", { style: { color: "#1a237e", fontSize: 15 }, children: "Your Response:" }), _jsx("div", { style: { marginTop: 8, fontSize: 14, color: '#37474f', lineHeight: 1.6, whiteSpace: 'pre-wrap' }, children: answers[r.questionId] })] })), _jsxs("div", { style: { marginBottom: 12 }, children: [_jsx("strong", { style: { color: "#555" }, children: "Technical Feedback:" }), _jsx("div", { style: { marginTop: 6, fontStyle: "italic", fontSize: 14, color: "#37474f" }, children: r.evaluation?.feedback })] }), r.evaluation?.sentiment && (_jsxs("div", { style: { marginTop: 16, padding: 16, background: 'white', borderRadius: 12, border: "1px solid #e0e0e0" }, children: [_jsx("strong", { style: { color: "#555" }, children: "Communication Assessment:" }), _jsxs("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginTop: 12, fontSize: 14 }, children: [_jsxs("div", { children: [_jsx("span", { style: { color: "#666" }, children: "Confidence:" }), _jsxs("strong", { style: { marginLeft: 6, color: "#1a237e" }, children: [r.evaluation.sentiment.confidence, "%"] })] }), _jsxs("div", { children: [_jsx("span", { style: { color: "#666" }, children: "Empathy:" }), _jsxs("strong", { style: { marginLeft: 6, color: "#1a237e" }, children: [r.evaluation.sentiment.empathy, "%"] })] }), _jsxs("div", { children: [_jsx("span", { style: { color: "#666" }, children: "Executive Presence:" }), _jsxs("strong", { style: { marginLeft: 6, color: "#1a237e" }, children: [r.evaluation.sentiment.executive_presence, "%"] })] }), _jsxs("div", { children: [_jsx("span", { style: { color: "#666" }, children: "Professionalism:" }), _jsxs("strong", { style: { marginLeft: 6, color: "#1a237e" }, children: [r.evaluation.sentiment.professionalism, "%"] })] })] }), r.evaluation?.sentiment_feedback && (_jsxs("div", { style: { marginTop: 12, fontSize: 14, color: '#555', fontStyle: 'italic', padding: 12, background: "#f8f9fa", borderRadius: 8 }, children: ["\uD83D\uDCA1 ", r.evaluation.sentiment_feedback] }))] })), r.learnLinks?.length > 0 && (_jsxs("div", { style: { marginTop: 16 }, children: [_jsx("strong", { style: { color: "#555" }, children: "\uD83D\uDCDA Microsoft Learn Resources:" }), _jsx("ul", { style: { margin: "10px 0 0 20px", lineHeight: 1.8 }, children: r.learnLinks.map((l, j) => (_jsx("li", { style: { fontSize: 14 }, children: _jsx("a", { href: l.url, target: "_blank", rel: "noreferrer", style: {
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
