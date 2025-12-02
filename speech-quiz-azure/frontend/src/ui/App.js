import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import axios from "axios";
import * as SpeechSDK from "microsoft-cognitiveservices-speech-sdk";
// Configure axios to use backend endpoint
axios.defaults.baseURL = "http://localhost:7071";
export default function App() {
    const [question, setQuestion] = useState(null);
    const [idx, setIdx] = useState(0);
    const [transcript, setTranscript] = useState("");
    const [answers, setAnswers] = useState({});
    const [finalResults, setFinalResults] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [endOfQuiz, setEndOfQuiz] = useState(false);
    const [seenQuestions, setSeenQuestions] = useState([]);
    const [listening, setListening] = useState(false);
    const [continuousListening, setContinuousListening] = useState(false);
    const [speaking, setSpeaking] = useState(false);
    const [pausedListening, setPausedListening] = useState(false);
    const [azureReady, setAzureReady] = useState(false);
    const [browserFallbackReady, setBrowserFallbackReady] = useState(false);
    const [autoRead, setAutoRead] = useState(true);
    const [azureVoiceName, setAzureVoiceName] = useState("en-US-JennyNeural");
    const [browserVoices, setBrowserVoices] = useState([]);
    const [azureVoiceStyle, setAzureVoiceStyle] = useState("chat");
    const recognizerRef = useRef(null);
    const synthesizerRef = useRef(null);
    const webVoiceRef = useRef(null);
    const tokenRef = useRef(null);
    const DEFAULT_AZURE_VOICE = "en-US-AriaNeural";
    useEffect(() => {
        fetchToken();
        fetchQuestion(0);
        // Detect browser Web Speech API availability as a fallback
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
    // Rebuild Azure synthesizer when voice or style changes
    useEffect(() => {
        if (!azureReady || !tokenRef.current)
            return;
        // If currently speaking, stop it first
        const wasPlaying = speaking;
        if (wasPlaying) {
            stopSpeaking();
        }
        try {
            const speechConfig = SpeechSDK.SpeechConfig.fromAuthorizationToken(tokenRef.current.token, tokenRef.current.region);
            speechConfig.speechRecognitionLanguage = "en-US";
            try {
                speechConfig.speechSynthesisVoiceName = azureVoiceName || DEFAULT_AZURE_VOICE;
            }
            catch { }
            try {
                synthesizerRef.current?.close?.();
            }
            catch { }
            synthesizerRef.current = new SpeechSDK.SpeechSynthesizer(speechConfig);
        }
        catch { }
        // If was playing, restart with new voice
        if (wasPlaying && question?.question) {
            setTimeout(() => speakText(question.question), 300);
        }
    }, [azureVoiceName, azureVoiceStyle, azureReady]);
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
            // Set a pleasant neural voice for TTS
            try {
                speechConfig.speechSynthesisVoiceName = azureVoiceName || DEFAULT_AZURE_VOICE;
            }
            catch { }
            const audioConfig = SpeechSDK.AudioConfig.fromDefaultMicrophoneInput();
            recognizerRef.current = new SpeechSDK.SpeechRecognizer(speechConfig, audioConfig);
            synthesizerRef.current = new SpeechSDK.SpeechSynthesizer(speechConfig);
            setAzureReady(true);
        }
        catch (err) {
            console.error("Failed to initialize speech objects:", err);
            setAzureReady(false);
        }
    }
    function buildAzureSsml(text, voiceName) {
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
    function speakText(text) {
        if (!text)
            return;
        setSpeaking(true);
        // Azure path
        if (synthesizerRef.current) {
            try {
                const ssml = buildAzureSsml(text, azureVoiceName || DEFAULT_AZURE_VOICE);
                synthesizerRef.current.speakSsmlAsync(ssml, () => setSpeaking(false), (err) => { console.error(err); setSpeaking(false); });
                return;
            }
            catch (e) {
                console.warn("Azure TTS failed, using browser fallback", e);
            }
        }
        // Browser fallback
        if (typeof window !== "undefined" && window.speechSynthesis) {
            const u = new SpeechSynthesisUtterance(text);
            if (webVoiceRef.current)
                u.voice = webVoiceRef.current;
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
                }
                else if (window.speechSynthesis.paused) {
                    window.speechSynthesis.resume();
                }
            }
            // Note: Azure Speech SDK doesn't have built-in pause/resume for TTS
            // For Azure, we'd need to implement chunking or use stop/restart
        }
        catch (err) {
            console.error("Pause/resume failed:", err);
        }
    }
    function stopSpeaking() {
        try {
            // Browser speech: cancel queue
            if (typeof window !== "undefined" && window.speechSynthesis) {
                try {
                    window.speechSynthesis.cancel();
                }
                catch { }
            }
            // Azure speech: try stopSpeakingAsync if available, else recreate synthesizer
            const synth = synthesizerRef.current;
            if (synth && typeof synth.stopSpeakingAsync === "function") {
                try {
                    synth.stopSpeakingAsync(() => { }, () => { });
                }
                catch { }
            }
            else if (synth && typeof synth.close === "function") {
                try {
                    synth.close();
                }
                catch { }
                // Recreate synthesizer so future TTS still works
                try {
                    if (tokenRef.current) {
                        const cfg = SpeechSDK.SpeechConfig.fromAuthorizationToken(tokenRef.current.token, tokenRef.current.region);
                        try {
                            cfg.speechSynthesisVoiceName = azureVoiceName || DEFAULT_AZURE_VOICE;
                        }
                        catch { }
                        synthesizerRef.current = new SpeechSDK.SpeechSynthesizer(cfg);
                    }
                }
                catch { }
            }
        }
        finally {
            setSpeaking(false);
        }
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
                    return [...prev, { id: resp.data.question.id, idx: i, heading: resp.data.question.heading }];
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
                    setError(`Recognition canceled: ${e?.errorDetails || "unknown"}`);
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
        }
        catch (err) {
            setError(`Final evaluation failed: ${err.message}`);
            console.error(err);
        }
        finally {
            setLoading(false);
        }
    }
    return (_jsxs("div", { style: {
            minHeight: "100vh",
            background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
            fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
            padding: "40px 20px"
        }, children: [_jsxs("div", { style: { maxWidth: 1200, margin: "0 auto" }, children: [_jsxs("div", { style: {
                            textAlign: "center",
                            color: "white",
                            marginBottom: 40
                        }, children: [_jsx("h1", { style: {
                                    fontSize: 42,
                                    fontWeight: 700,
                                    marginBottom: 8,
                                    textShadow: "0 2px 4px rgba(0,0,0,0.1)"
                                }, children: "Mission Critical Architect Assessment" }), _jsx("p", { style: { fontSize: 18, opacity: 0.95 }, children: "Azure Reliability & Performance Readiness" })] }), _jsxs("div", { style: {
                            background: "white",
                            borderRadius: 16,
                            boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
                            padding: 32,
                            marginBottom: 24
                        }, children: [_jsxs("div", { style: {
                                    padding: 20,
                                    background: "linear-gradient(135deg, #f093fb 0%, #f5576c 100%)",
                                    borderRadius: 12,
                                    color: "white",
                                    marginBottom: 24
                                }, children: [_jsx("p", { style: { marginBottom: 12, fontSize: 16, fontWeight: 600 }, children: _jsx("strong", { children: "CTO of Zava speaks:" }) }), _jsx("p", { style: { fontSize: 15, lineHeight: 1.6, opacity: 0.95 }, children: "Our mission-critical app has had too many outages, and our support experience hasn't met expectations. I need a practical plan that improves reliability quickly, shortens detection and recovery times, and brings spend under control without adding risk." }), _jsx("p", { style: { fontSize: 15, lineHeight: 1.6, opacity: 0.95, marginTop: 8 }, children: "Speak to me directly. Be clear, pragmatic, and back your recommendations with Azure best practices." })] }), _jsxs("div", { style: {
                                    display: "flex",
                                    gap: 16,
                                    alignItems: "center",
                                    flexWrap: "wrap",
                                    padding: 16,
                                    background: "#f8f9fa",
                                    borderRadius: 8,
                                    marginBottom: 24
                                }, children: [_jsxs("label", { style: { display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }, children: [_jsx("input", { type: "checkbox", checked: autoRead, onChange: e => setAutoRead(e.target.checked) }), _jsx("span", { style: { fontSize: 14 }, children: "Auto-read questions" })] }), _jsxs("div", { style: { display: "flex", alignItems: "center", gap: 8 }, children: [_jsx("span", { style: { color: "#555", fontSize: 14, fontWeight: 600 }, children: "Voice:" }), azureReady ? (_jsxs("div", { style: { display: "flex", alignItems: "center", gap: 8 }, children: [_jsx("select", { value: azureVoiceName, onChange: e => setAzureVoiceName(e.target.value), style: { padding: "6px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: 14 }, children: ["en-US-JennyNeural", "en-US-JaneNeural", "en-US-AvaNeural", "en-US-DavisNeural", "en-US-GuyNeural", "en-GB-LibbyNeural", "en-GB-RyanNeural", "en-AU-NatashaNeural", "en-IN-NeerjaNeural"].map(v => (_jsx("option", { value: v, children: v }, v))) }), _jsx("span", { style: { color: "#555", fontSize: 14, fontWeight: 600 }, children: "Style:" }), _jsx("select", { value: azureVoiceStyle, onChange: e => setAzureVoiceStyle(e.target.value), style: { padding: "6px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: 14 }, children: ["chat", "customerservice", "newscast-casual", "empathetic"].map(s => (_jsx("option", { value: s, children: s }, s))) })] })) : browserFallbackReady ? (_jsx("select", { value: webVoiceRef.current?.name || "", onChange: e => {
                                                    const v = browserVoices.find(bv => bv.name === e.target.value) || null;
                                                    webVoiceRef.current = v;
                                                    // If currently speaking with browser speech, restart with new voice
                                                    if (speaking && typeof window !== "undefined" && window.speechSynthesis && question?.question) {
                                                        window.speechSynthesis.cancel();
                                                        setTimeout(() => speakText(question.question), 100);
                                                    }
                                                }, style: { padding: "6px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: 14 }, children: browserVoices.map(v => (_jsxs("option", { value: v.name, children: [v.name, " (", v.lang, ")"] }, v.name))) })) : (_jsx("span", { style: { color: "#999", fontSize: 14 }, children: "Loading voices\u2026" }))] })] }), error && (_jsxs("div", { style: {
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
                                        }, children: question?.question || "Loading question..." }), _jsxs("div", { style: { display: "flex", gap: 12, marginTop: 8 }, children: [_jsx("button", { onClick: speaking ? pauseOrResumeSpeaking : onPlayQuestion, disabled: !question || listening, title: speaking ? "Pause/Resume speaking" : "Play message", style: {
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
                                                }, children: speaking && typeof window !== "undefined" && window.speechSynthesis?.paused ? "▶️" : speaking ? "⏸" : "▶️" }), speaking && (_jsx("button", { onClick: stopSpeaking, title: "Stop speaking", style: {
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
                                                }, children: "\u27A1\uFE0F" })] })] })), endOfQuiz && !finalResults && (_jsxs("div", { style: { border: "1px solid #ddd", padding: 16, borderRadius: 8, background: "#fff" }, children: [_jsx("h3", { children: "Review your answers" }), _jsx("p", { children: "You\u2019ve reached the end. Save anything missing, then submit all to see your results with Microsoft Learn links." }), (() => {
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
