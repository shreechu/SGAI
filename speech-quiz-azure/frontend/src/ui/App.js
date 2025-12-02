import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import axios from "axios";
// Configure axios to use backend endpoint
axios.defaults.baseURL = "http://localhost:7071";
export default function App() {
    const [question, setQuestion] = useState(null);
    const [idx, setIdx] = useState(0);
    const [transcript, setTranscript] = useState("");
    const [evaluation, setEvaluation] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    useEffect(() => {
        fetchQuestion(0);
    }, []);
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
    async function onSubmitAnswer() {
        if (!question || !transcript.trim()) {
            setError("Please enter a transcript");
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
        }
        catch (err) {
            setError(`Evaluation failed: ${err.message}`);
            console.error(err);
        }
        finally {
            setLoading(false);
        }
    }
    return (_jsxs("div", { style: { padding: 24, fontFamily: "Arial, sans-serif", maxWidth: 800, margin: "0 auto" }, children: [_jsx("h1", { children: "\uD83C\uDFA4 Speech-First AI Quiz" }), error && (_jsx("div", { style: {
                    padding: 12,
                    backgroundColor: "#fee",
                    border: "1px solid #f00",
                    borderRadius: 6,
                    marginBottom: 16,
                    color: "#c00"
                }, children: error })), _jsx("div", { style: { marginBottom: 16 }, children: _jsx("button", { onClick: () => fetchQuestion(idx), disabled: loading, style: { padding: "8px 16px", marginRight: 8, cursor: loading ? "not-allowed" : "pointer" }, children: loading ? "Loading..." : "Next Question" }) }), _jsxs("div", { style: {
                    border: "1px solid #ddd",
                    padding: 16,
                    borderRadius: 8,
                    backgroundColor: "#f9f9f9",
                    marginBottom: 16
                }, children: [_jsx("h3", { children: "\uD83D\uDCDD Question" }), _jsx("p", { style: { fontSize: 18, lineHeight: 1.6 }, children: question?.question || "Loading..." }), question?.key_phrases && (_jsxs("div", { children: [_jsx("strong", { children: "Key phrases to cover:" }), _jsx("div", { style: { display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }, children: question.key_phrases.map((phrase, i) => (_jsx("span", { style: {
                                        backgroundColor: "#e0e7ff",
                                        padding: "4px 8px",
                                        borderRadius: 4,
                                        fontSize: 14
                                    }, children: phrase }, i))) })] }))] }), _jsxs("div", { style: {
                    border: "1px solid #ddd",
                    padding: 16,
                    borderRadius: 8,
                    marginBottom: 16
                }, children: [_jsx("h3", { children: "\uD83C\uDF99\uFE0F Your Answer" }), _jsx("textarea", { value: transcript, onChange: (e) => setTranscript(e.target.value), placeholder: "Type your answer here (or paste speech-to-text transcript)...", style: {
                            width: "100%",
                            minHeight: 100,
                            padding: 8,
                            borderRadius: 4,
                            border: "1px solid #ccc",
                            fontFamily: "monospace",
                            fontSize: 14
                        } }), _jsx("button", { onClick: onSubmitAnswer, disabled: loading || !transcript.trim(), style: {
                            padding: "10px 20px",
                            marginTop: 12,
                            backgroundColor: "#4CAF50",
                            color: "white",
                            border: "none",
                            borderRadius: 4,
                            cursor: loading || !transcript.trim() ? "not-allowed" : "pointer",
                            fontSize: 16
                        }, children: loading ? "Evaluating..." : "Submit Answer" })] }), evaluation && (_jsxs("div", { style: {
                    border: "1px solid #4CAF50",
                    padding: 16,
                    borderRadius: 8,
                    backgroundColor: "#f1f8f4"
                }, children: [_jsx("h3", { children: "\u2705 Evaluation Result" }), _jsx("div", { style: { fontSize: 18, marginBottom: 12 }, children: _jsxs("strong", { children: ["Score: ", evaluation.score, "%"] }) }), _jsxs("div", { style: { marginBottom: 12 }, children: [_jsx("strong", { children: "\u2713 Matched:" }), _jsx("div", { children: evaluation.matched_phrases?.join(", ") || "None" })] }), _jsxs("div", { style: { marginBottom: 12 }, children: [_jsx("strong", { children: "\u2717 Missing:" }), _jsx("div", { children: evaluation.missing_phrases?.join(", ") || "None" })] }), _jsxs("div", { children: [_jsx("strong", { children: "Feedback:" }), _jsx("p", { children: evaluation.feedback })] })] }))] }));
}
