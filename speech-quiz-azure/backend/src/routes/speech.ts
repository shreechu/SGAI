import { Router } from "express";
import fetch from "node-fetch";
import { getSecret } from "../utils/secrets";

const router = Router();

// Issues short-lived Speech token for client to use directly with Speech SDK
router.get("/token", async (req, res) => {
  try {
     const region = process.env.SPEECH_REGION || await getSecret("SPEECH_REGION");
     const key = process.env.SPEECH_KEY || await getSecret("SPEECH_KEY");
     if (!region || !key) {
        return res.status(500).json({ error: "Speech credentials missing" });
     }
     // Issue token
     const issueUrl = `https://${region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`;
     const resp = await fetch(issueUrl, { method: "POST", headers: { "Ocp-Apim-Subscription-Key": key } });
     if (!resp.ok) throw new Error("Failed to get token");
     const token = await resp.text();
     res.json({ region, token, expires_in: 600 });
  } catch (err: any) {
     console.error(err);
     res.status(500).json({ error: err.message || String(err) });
  }
});

export default router;
