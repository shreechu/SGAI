import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import axios from "axios";
import * as SpeechSDK from "microsoft-cognitiveservices-speech-sdk";
// Configure axios to use backend endpoint
axios.defaults.baseURL = "http://localhost:7071";
export default function App() {
    const [question, setQuestion] = useState(null);
    const [idx, setIdx] = useState(0);
    const [transcript, setTranscript] = useState("");
    const [evaluation, setEvaluation] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [listening, setListening] = useState(false);
    const [speaking, setSpeaking] = useState(false);
    const recognizerRef = useRef(null);
    const synthesizerRef = useRef(null);
    const tokenRef = useRef(null);
    useEffect(() => {
        fetchToken();
        fetchQuestion(0);
    }, []);
    async function fetchToken() {
        try {
            const resp = await axios.get("/api/speech/token");
            tokenRef.current = resp.data;
            initializeSpeechObjects(resp.data);
        }
        catch (err) {
            console.warn("Speech token not available (Speech services may not be configured):", err.message);
        }
    }
    function initializeSpeechObjects(tokenInfo) {
        try {
            const speechConfig = SpeechSDK.SpeechConfig.fromAuthorizationToken(tokenInfo.token, tokenInfo.region);
            speechConfig.speechRecognitionLanguage = "en-US";
            const audioConfig = SpeechSDK.AudioConfig.fromDefaultMicrophoneInput();
            recognizerRef.current = new SpeechSDK.SpeechRecognizer(speechConfig, audioConfig);
            synthesizerRef.current = new SpeechSDK.SpeechSynthesizer(speechConfig);
        }
        catch (err) {
            console.error("Failed to initialize speech objects:", err);
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
            setEvaluation(null);
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
        if (!question || !synthesizerRef.current) {
            setError("Question not loaded or speech not configured");
            return;
        }
        try {
            setSpeaking(true);
            synthesizerRef.current.speakTextAsync(question.question, () => setSpeaking(false), (err) => {
                setError(`TTS error: ${err}`);
                setSpeaking(false);
            });
        }
        catch (err) {
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
                }
                else if (result.reason === SpeechSDK.ResultReason.NoMatch) {
                    setError("No speech detected. Please try again.");
                }
                else if (result.reason === SpeechSDK.ResultReason.Canceled) {
                    const cancellation = SpeechSDK.CancellationDetails.fromResult(result);
                    setError(`Recognition error: ${cancellation.errorDetails}`);
                }
                setListening(false);
            });
        }
        catch (err) {
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
                synthesizerRef.current.speakTextAsync(feedbackText, () => setSpeaking(false), (err) => {
                    console.error("TTS feedback error:", err);
                    setSpeaking(false);
                });
            }
        }
        catch (err) {
            setError(`Evaluation failed: ${err.message}`);
            console.error(err);
        }
        finally {
            setLoading(false);
        }
    }
    return (_jsxs("div", { style: { padding: 24, fontFamily: "Arial, sans-serif", maxWidth: 900, margin: "0 auto" }, children: [_jsx("h1", { children: "\uD83C\uDFA4 Speech-to-Speech AI Quiz" }), error && (_jsxs("div", { style: {
                    padding: 12,
                    backgroundColor: "#fee",
                    border: "1px solid #f00",
                    borderRadius: 6,
                    marginBottom: 16,
                    color: "#c00"
                }, children: ["\u26A0\uFE0F ", error] })), _jsx("div", { style: { marginBottom: 16, display: "flex", gap: 8 }, children: _jsx("button", { onClick: () => fetchQuestion(idx), disabled: loading || listening || speaking, style: {
                        padding: "10px 16px",
                        cursor: loading || listening || speaking ? "not-allowed" : "pointer",
                        opacity: loading || listening || speaking ? 0.6 : 1
                    }, children: loading ? "Loading..." : "Next Question" }) }), _jsxs("div", { style: {
                    border: "1px solid #ddd",
                    padding: 16,
                    borderRadius: 8,
                    backgroundColor: "#f9f9f9",
                    marginBottom: 16
                }, children: [_jsx("h3", { children: "\uD83D\uDCDD Question" }), _jsx("p", { style: { fontSize: 18, lineHeight: 1.6, marginBottom: 12 }, children: question?.question || "Loading..." }), _jsx("button", { onClick: onPlayQuestion, disabled: !question || listening || speaking, style: {
                            padding: "8px 16px",
                            backgroundColor: "#2196F3",
                            color: "white",
                            border: "none",
                            borderRadius: 4,
                            cursor: !question || listening || speaking ? "not-allowed" : "pointer"
                        }, children: speaking ? "🔊 Playing..." : "🔊 Play Question" }), question?.key_phrases && (_jsxs("div", { style: { marginTop: 12 }, children: [_jsx("strong", { children: "Key phrases to cover:" }), _jsx("div", { style: { display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }, children: question.key_phrases.map((phrase, i) => (_jsx("span", { style: {
                                        backgroundColor: "#e0e7ff",
                                        padding: "6px 12px",
                                        borderRadius: 4,
                                        fontSize: 14,
                                        fontWeight: 500
                                    }, children: phrase }, i))) })] }))] }), _jsxs("div", { style: {
                    border: "2px solid #4CAF50",
                    padding: 16,
                    borderRadius: 8,
                    backgroundColor: "#f1f8f4",
                    marginBottom: 16
                }, children: [_jsx("h3", { children: "\uD83C\uDF99\uFE0F Record Your Answer" }), _jsx("p", { style: { color: "#666", marginBottom: 12 }, children: "Click \"Start Listening\" and speak your answer. The app will record and transcribe it." }), _jsx("button", { onClick: onStartListening, disabled: loading || listening || !recognizerRef.current, style: {
                            padding: "12px 24px",
                            backgroundColor: listening ? "#FF9800" : "#4CAF50",
                            color: "white",
                            border: "none",
                            borderRadius: 4,
                            cursor: loading || listening || !recognizerRef.current ? "not-allowed" : "pointer",
                            fontSize: 16,
                            fontWeight: "bold"
                        }, children: listening ? "🎤 Listening..." : "🎤 Start Listening" }), transcript && (_jsxs("div", { style: {
                            marginTop: 12,
                            padding: 12,
                            backgroundColor: "white",
                            border: "1px solid #ddd",
                            borderRadius: 4
                        }, children: [_jsx("strong", { children: "Your answer:" }), _jsx("p", { style: { marginTop: 8, fontSize: 16, lineHeight: 1.5 }, children: transcript })] })), _jsx("button", { onClick: onSubmitAnswer, disabled: loading || listening || !transcript.trim() || !question, style: {
                            padding: "12px 24px",
                            marginTop: 12,
                            backgroundColor: "#4CAF50",
                            color: "white",
                            border: "none",
                            borderRadius: 4,
                            cursor: loading || listening || !transcript.trim() || !question ? "not-allowed" : "pointer",
                            fontSize: 16,
                            fontWeight: "bold"
                        }, children: loading ? "Evaluating..." : "✅ Submit Answer" })] }), evaluation && (_jsxs("div", { style: {
                    border: "2px solid #4CAF50",
                    padding: 16,
                    borderRadius: 8,
                    backgroundColor: "#f1f8f4"
                }, children: [_jsx("h3", { children: "\u2705 Evaluation Result" }), _jsxs("div", { style: { fontSize: 24, marginBottom: 12, fontWeight: "bold" }, children: ["Score: ", evaluation.score, "%"] }), _jsxs("div", { style: { marginBottom: 12 }, children: [_jsx("strong", { children: "\u2713 Matched phrases:" }), _jsx("p", { children: evaluation.matched_phrases?.join(", ") || "None" })] }), _jsxs("div", { style: { marginBottom: 12 }, children: [_jsx("strong", { children: "\u2717 Missing phrases:" }), _jsx("p", { children: evaluation.missing_phrases?.join(", ") || "None" })] }), _jsxs("div", { children: [_jsx("strong", { children: "\uD83D\uDCDD Feedback:" }), _jsx("p", { style: { marginTop: 8, fontStyle: "italic" }, children: evaluation.feedback })] }), speaking && _jsx("p", { style: { marginTop: 12, color: "#FF9800" }, children: "\uD83D\uDD0A Playing feedback..." })] }))] }));
}
