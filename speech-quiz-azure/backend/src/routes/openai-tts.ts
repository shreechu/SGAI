import { Router } from "express";
import axios from "axios";
import { getSecret } from "../utils/secrets";

const router = Router();

// Azure Neural TTS endpoint using REST API
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

    // Create SSML for enhanced prosody
    const ssml = `<speak version='1.0' xml:lang='en-US' xmlns='http://www.w3.org/2001/10/synthesis' xmlns:mstts='https://www.w3.org/2001/mstts'>
  <voice name='en-US-AndrewMultilingualNeural'>
    <mstts:express-as style='friendly' styledegree='2'>
      <prosody rate='0.95' pitch='+0%' volume='+5%'>
        ${text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&apos;").replace(/"/g, "&quot;")}
      </prosody>
    </mstts:express-as>
  </voice>
</speak>`;

    // Call Azure Speech REST API
    const response = await axios.post(
      `https://${speechRegion}.tts.speech.microsoft.com/cognitiveservices/v1`,
      ssml,
      {
        headers: {
          'Ocp-Apim-Subscription-Key': speechKey,
          'Content-Type': 'application/ssml+xml',
          'X-Microsoft-OutputFormat': 'audio-24khz-96kbitrate-mono-mp3',
          'User-Agent': 'MissionCriticalQuiz'
        },
        responseType: 'arraybuffer'
      }
    );

    const buffer = Buffer.from(response.data);
    
    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': buffer.length,
    });
    
    res.send(buffer);
    
  } catch (err: any) {
    console.error("Azure Neural TTS error:", err.response?.data || err.message);
    res.status(500).json({ 
      error: err.response?.data?.message || err.message || "Failed to generate speech" 
    });
  }
});

export default router;
