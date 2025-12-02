import { Router } from "express";
import OpenAI from "openai";
import { getSecret } from "../utils/secrets";

const router = Router();

// OpenAI text-to-speech endpoint
router.post("/openai/tts", async (req, res) => {
  try {
    const { text } = req.body;
    
    if (!text) {
      return res.status(400).json({ error: "Text is required" });
    }

    // Get OpenAI API key
    const apiKey = process.env.OPENAI_API_KEY || await getSecret("OPENAI_API_KEY");
    
    if (!apiKey) {
      return res.status(500).json({ error: "OpenAI API key not configured" });
    }

    const openai = new OpenAI({ apiKey });

    // Use GPT-4 Audio with the most natural voice
    const mp3 = await openai.audio.speech.create({
      model: "tts-1-hd", // High-quality model
      voice: "onyx", // Deep, warm male voice - most natural
      input: text,
      speed: 0.95, // Slightly slower for clarity
    });

    const buffer = Buffer.from(await mp3.arrayBuffer());
    
    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': buffer.length,
    });
    
    res.send(buffer);
  } catch (err: any) {
    console.error("OpenAI TTS error:", err);
    res.status(500).json({ error: err.message || "Failed to generate speech" });
  }
});

export default router;
