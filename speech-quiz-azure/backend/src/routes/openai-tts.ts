import { Router } from "express";
import * as sdk from "microsoft-cognitiveservices-speech-sdk";
import { getSecret } from "../utils/secrets";

const router = Router();

// Azure Neural TTS endpoint using Speech SDK
router.post("/tts", async (req, res) => {
  try {
    const { text } = req.body;
    
    if (!text) {
      return res.status(400).json({ error: "Text is required" });
    }

    // Get Azure Speech credentials
    const speechKey = process.env.SPEECH_KEY || await getSecret("SPEECH_KEY");
    const speechRegion = process.env.SPEECH_REGION || "eastus";
    
    if (!speechKey || speechKey === "YOUR_SPEECH_KEY_HERE") {
      return res.status(500).json({ error: "Azure Speech key not configured" });
    }

    // Configure Speech SDK for audio generation
    const speechConfig = sdk.SpeechConfig.fromSubscription(speechKey, speechRegion);
    speechConfig.speechSynthesisVoiceName = "en-US-AndrewMultilingualNeural";
    speechConfig.speechSynthesisOutputFormat = sdk.SpeechSynthesisOutputFormat.Audio24Khz96KBitRateMonoMp3;

    // Create SSML for enhanced prosody
    const ssml = `<?xml version="1.0" encoding="UTF-8"?>
<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="en-US">
  <voice name="en-US-AndrewMultilingualNeural">
    <mstts:express-as style="friendly" styledegree="2">
      <prosody rate="0.95" pitch="+0%" volume="+5%">
        ${text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}
      </prosody>
    </mstts:express-as>
  </voice>
</speak>`;

    // Synthesize to memory
    const synthesizer = new sdk.SpeechSynthesizer(speechConfig, undefined as any);
    
    const result = await new Promise<sdk.SpeechSynthesisResult>((resolve, reject) => {
      synthesizer.speakSsmlAsync(
        ssml,
        result => {
          synthesizer.close();
          resolve(result);
        },
        error => {
          synthesizer.close();
          reject(error);
        }
      );
    });

    if (result.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
      const audioData = result.audioData;
      
      res.set({
        'Content-Type': 'audio/mpeg',
        'Content-Length': audioData.byteLength,
      });
      
      res.send(Buffer.from(audioData));
    } else {
      throw new Error(`Speech synthesis failed: ${result.errorDetails}`);
    }
    
  } catch (err: any) {
    console.error("Azure Neural TTS error:", err);
    res.status(500).json({ error: err.message || "Failed to generate speech" });
  }
});

export default router;
