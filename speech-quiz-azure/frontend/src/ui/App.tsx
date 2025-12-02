
type Question = {
  id: string;
  question: string;
  key_phrases: string[];
  topic?: string;
  difficulty?: string;
};

export default function App() {
  const [tokenInfo, setTokenInfo] = useState<{ token: string; region: string } | null>(null);
  const [question, setQuestion] = useState<Question | null>(null);
  const [idx, setIdx] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [evaluation, setEvaluation] = useState<any>(null);
  const recognizerRef = useRef<SpeechSDK.SpeechRecognizer| null>(null);
  const synthesizerRef = useRef<SpeechSDK.SpeechSynthesizer| null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => { fetchToken(); fetchQuestion(idx); }, []);

  async function fetchToken() {
     const resp = await axios.get("/api/speech/token");
     setTokenInfo(resp.data);
  }

  async function fetchQuestion(i: number) {
     const resp = await axios.get(`/api/nextquestion?idx=${i}`);
     setQuestion(resp.data.question);
     setIdx(resp.data.nextIndex);
     setTranscript(""); setEvaluation(null);
  }

  function createSpeechObjects() {
     if (!tokenInfo) return;
     const speechConfig = SpeechSDK.SpeechConfig.fromAuthorizationToken(tokenInfo.token, tokenInfo.region);
     speechConfig.speechRecognitionLanguage = "en-US";
     const audioConfig = SpeechSDK.AudioConfig.fromDefaultMicrophoneInput();
     recognizerRef.current = new SpeechSDK.SpeechRecognizer(speechConfig, audioConfig);
     synthesizerRef.current = new SpeechSDK.SpeechSynthesizer(speechConfig);
  }

  function onPlayQuestion() {
     if (!question) return;
     if (!synthesizerRef.current) createSpeechObjects();
     synthesizerRef.current!.speakTextAsync(question.question,
        result => {
          console.log("synth ok", result);
        },
        err => console.error(err)
     );
  }

  function onStartSpeaking() {
     if (!tokenInfo) { alert("No speech token"); return; }
     if (!recognizerRef.current) createSpeechObjects();
     setTranscript("");
     recognizerRef.current!.startContinuousRecognitionAsync();
     recognizerRef.current!.recognized = (s, e) => {
        if (e.result.reason === SpeechSDK.ResultReason.RecognizedSpeech) {
          setTranscript(prev => prev + " " + e.result.text);
        }
     };
     recognizerRef.current!.canceled = (s, e) => {
        console.warn("canceled", e);
     };
  }

  function onStop() {
     if (recognizerRef.current) {
        recognizerRef.current.stopContinuousRecognitionAsync();
     }
  }

  async function onSubmitAnswer() {
     if (!question) return;
     const resp = await axios.post("/api/evaluate", { transcript, question, sessionId: "local-session" });
     setEvaluation(resp.data.evaluation);
     // speak feedback
     const text = `Score ${resp.data.evaluation.score}. ${resp.data.evaluation.feedback}`;
     if (!synthesizerRef.current) createSpeechObjects();
     synthesizerRef.current!.speakTextAsync(text, () => {}, e => console.error(e));
  }

  return (
     <div style={{ padding: 16, fontFamily: "Arial, sans-serif" }}>
        <h2>Speech-First AI Quiz</h2>
        <div style={{ marginBottom: 12 }}>
          <button onClick={() => fetchQuestion(idx)}>Next Question</button>
          <button onClick={onPlayQuestion} style={{ marginLeft: 8 }}>Play Question</button>
          <button onClick={onStartSpeaking} style={{ marginLeft: 8 }}>Start Speaking</button>
          <button onClick={onStop} style={{ marginLeft: 8 }}>Stop</button>
          <button onClick={onSubmitAnswer} style={{ marginLeft: 8 }}>Submit Answer</button>
        </div>
        <div style={{ border: "1px solid #ddd", padding: 12, borderRadius: 6 }}>
          <strong>Question</strong>
          <p>{question?.question || "No question loaded"}</p>
          <strong>Transcript</strong>
          <p>{transcript}</p>
          <strong>Evaluation</strong>
          <pre>{evaluation ? JSON.stringify(evaluation, null, 2) : "-"}</pre>
        </div>
     </div>
  );
}
