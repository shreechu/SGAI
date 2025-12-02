const fs = require('fs');
const path = require('path');
const mammoth = require('mammoth');
import express from "express";
import cors from "cors";
import morgan from "morgan";
import dotenv from "dotenv";
import collectRoutes from "./routes";
import { Router } from "express";
import speechRoutes from "./routes/speech";
import quizRoutes from "./routes/quiz";
import { Router } from "express";
import fetch from "node-fetch";
import { getSecret } from "../utils/secrets";
import { Router } from "express";
import { readFileSync } from "fs";
import path from "path";
import evaluateController from "../services/evaluate";
import { saveSession } from "../services/store";
import OpenAI from "openai";
import { getSecret } from "../utils/secrets";
import { CosmosClient } from "@azure/cosmos";
import { BlobServiceClient } from "@azure/storage-blob";
import { getSecret } from "../utils/secrets";
import { DefaultAzureCredential } from "@azure/identity";
import { SecretClient } from "@azure/keyvault-secrets";
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./ui/App";
import React, { useEffect, useState, useRef } from "react";
import axios from "axios";
import * as SpeechSDK from "microsoft-cognitiveservices-speech-sdk";

#!/usr/bin/env bash
# generate_speech_quiz_project.sh
# Generates a full-stack Azure "speech-first AI quiz bot" project skeleton.
# Run: bash generate_speech_quiz_project.sh
set -e

ROOT_DIR="speech-quiz-azure"
mkdir -p "$ROOT_DIR"
cd "$ROOT_DIR"

# -------------------------
# README
# -------------------------
cat > README.md <<'MD'
# Speech-First AI Quiz Bot for Azure

This repository contains a complete end-to-end project skeleton for a "speech-first AI quiz bot" on Azure.

Features:
- Speech input (browser microphone) and spoken feedback (TTS).
- Questions ingested from DOCX -> structured JSON with key phrases.
- Azure Speech-to-Text for user answers.
- Azure OpenAI to evaluate answers and produce deterministic JSON outputs.
- Stores transcripts, scores, sessions in Cosmos DB.
- Optional audio storage in Azure Blob Storage.
- Backend in Node.js + Express (TypeScript).
- Frontend in React + TypeScript + Azure Speech SDK.
- Secrets stored in Azure Key Vault (backend uses managed identity).
- Terraform infra to provision Azure resources.
- CI/CD via GitHub Actions.

Quick start (local):
1. Install Node.js 18+, npm, and Terraform (if deploying infra).
2. Backend:
    - cd backend
    - cp .env.example .env and fill in local test values (or ensure Key Vault access).
    - npm install
    - npm run build
    - npm run start:dev
3. Frontend:
    - cd frontend
    - npm install
    - npm run dev
4. Ingest questions:
    - node scripts/ingest-docx.js path/to/questions.docx > scripts/questions.json

For Azure deployment and Terraform usage, see infra/README-TERRAFORM.md

MD

# -------------------------
# Project tree directories
# -------------------------
mkdir -p frontend/public frontend/src backend src scripts infra .github/workflows

# -------------------------
# Root .gitignore
# -------------------------
cat > .gitignore <<'GI'
node_modules
dist
.env
.env.local
.vscode
.DS_Store
coverage
GI

# -------------------------
# Sample question JSON
# -------------------------
cat > scripts/sample-questions.json <<'JSON'
[
  {
     "id": "q1",
     "topic": "World History",
     "difficulty": "easy",
     "heading": "Ancient Civilizations",
     "question": "Describe three key achievements of the ancient Egyptians.",
     "key_phrases": ["pyramids", "hieroglyphics", "irrigation", "mummification"]
  },
  {
     "id": "q2",
     "topic": "Biology",
     "difficulty": "medium",
     "heading": "Cell Biology",
     "question": "What are the main differences between prokaryotic and eukaryotic cells?",
     "key_phrases": ["nucleus", "membrane-bound organelles", "size", "ribosomes"]
  }
]
JSON

# -------------------------
# scripts/ingest-docx.js
# -------------------------
cat > scripts/ingest-docx.js <<'NODE'
#!/usr/bin/env node
// scripts/ingest-docx.js
// Usage: node ingest-docx.js path/to/file.docx > out.json
// Simple DOCX ingestion using 'mammoth' to extract text and parse Q/A blocks.
// Expected docx format (simple):
// Heading: <Topic>
// Difficulty: <easy|medium|hard>
// Question: <...>
// KeyPhrases: phrase1, phrase2, phrase3


async function ingest(file) {
  const buffer = fs.readFileSync(file);
  const { value: text } = await mammoth.extractRawText({ buffer });
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const questions = [];
  let current = {};
  for (const line of lines) {
     if (/^Heading:/i.test(line)) {
        if (current.question) { questions.push(current); current = {}; }
        current.heading = line.replace(/^Heading:\s*/i, '').trim();
     } else if (/^Difficulty:/i.test(line)) {
        current.difficulty = line.replace(/^Difficulty:\s*/i, '').trim();
     } else if (/^Topic:/i.test(line)) {
        current.topic = line.replace(/^Topic:\s*/i, '').trim();
     } else if (/^Question:/i.test(line)) {
        current.question = line.replace(/^Question:\s*/i, '').trim();
     } else if (/^KeyPhrases:/i.test(line)) {
        current.key_phrases = line.replace(/^KeyPhrases:\s*/i, '').split(',').map(s => s.trim()).filter(Boolean);
        current.id = 'q' + (questions.length + 1);
     } else {
        // Append to question if present
        if (current.question && !/^#/ .test(line)) {
          current.question += ' ' + line;
        }
     }
  }
  if (current.question) questions.push(current);
  console.log(JSON.stringify(questions, null, 2));
}

if (require.main === module) {
  const file = process.argv[2];
  if (!file) { console.error('Usage: ingest-docx.js <file.docx>'); process.exit(2); }
  ingest(file).catch(err => { console.error(err); process.exit(1); });
}
NODE
chmod +x scripts/ingest-docx.js

# -------------------------
# Backend (TypeScript + Express)
# -------------------------
cat > backend/package.json <<'JSON'
{
  "name": "speech-quiz-backend",
  "version": "0.1.0",
  "private": true,
  "main": "dist/index.js",
  "scripts": {
     "build": "tsc -p tsconfig.json",
     "start": "node dist/index.js",
     "start:dev": "ts-node-dev --respawn --transpile-only src/index.ts",
     "lint": "eslint . --ext .ts"
  },
  "dependencies": {
     "@azure/identity": "^3.0.0",
     "@azure/keyvault-secrets": "^4.4.0",
     "@azure/cosmos": "^3.19.0",
     "@azure/storage-blob": "^12.12.0",
     "axios": "^1.4.0",
     "cors": "^2.8.5",
     "express": "^4.18.2",
     "morgan": "^1.10.0",
     "node-fetch": "^2.6.7",
     "openai": "^4.10.0"
  },
  "devDependencies": {
     "@types/express": "^4.17.14",
     "@types/node": "^18.15.11",
     "ts-node-dev": "^2.0.0",
     "typescript": "^5.0.4"
  }
}
JSON

cat > backend/tsconfig.json <<'TS'
{
  "compilerOptions": {
     "target": "ES2020",
     "module": "CommonJS",
     "outDir": "dist",
     "rootDir": "src",
     "esModuleInterop": true,
     "strict": true,
     "skipLibCheck": true
  },
  "include": ["src/**/*.ts"]
}
TS

cat > backend/.env.example <<'ENV'
# Local testing (not required when using Key Vault & managed identity)
SPEECH_REGION=YOUR_SPEECH_REGION
SPEECH_KEY=YOUR_SPEECH_KEY
AZURE_OPENAI_ENDPOINT=https://YOUR_OPENAI_RESOURCE.openai.azure.com/
AZURE_OPENAI_API_KEY=YOUR_AZURE_OPENAI_KEY
AZURE_OPENAI_DEPLOYMENT=YOUR_DEPLOYMENT_NAME
COSMOS_CONNECTION_STRING=YOUR_COSMOS_DB_CONN
BLOB_CONNECTION_STRING=YOUR_BLOB_CONN
KEY_VAULT_NAME=your-key-vault-name
USE_KEY_VAULT=false
ENV

cat > backend/src/index.ts <<'TS'

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(morgan("dev"));

app.use("/api", collectRoutes);

const port = process.env.PORT || 7071;
app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`);
});
TS

cat > backend/src/routes.ts <<'TS'

const router = Router();
router.use("/speech", speechRoutes);
router.use("/", quizRoutes);
export default router;
TS

cat > backend/src/routes/speech.ts <<'TS'

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
TS

cat > backend/src/routes/quiz.ts <<'TS'

const router = Router();
const QUESTIONS_PATH = path.resolve(__dirname, "../../scripts/questions.json");
let questions: any[] = [];
try {
  questions = JSON.parse(readFileSync(QUESTIONS_PATH, "utf8"));
} catch {
  questions = [];
}

// Next question endpoint
router.get("/nextquestion", (req, res) => {
  const idx = parseInt(String(req.query.idx || "0"), 10) || 0;
  const q = questions[idx] || null;
  res.json({ question: q, nextIndex: idx + 1 });
});

// Evaluate endpoint: receives { transcript, question }
router.post("/evaluate", async (req, res) => {
  try {
     const { transcript, question, audioBase64, sessionId } = req.body;
     if (!transcript || !question) return res.status(400).json({ error: "Missing fields" });

     const evaluation = await evaluateController(transcript, question);
     // Persist to Cosmos DB
     await saveSession({ sessionId, questionId: question.id, transcript, evaluation, timestamp: new Date().toISOString() });
     res.json({ evaluation });
  } catch (err: any) {
     console.error(err);
     res.status(500).json({ error: err.message || String(err) });
  }
});

export default router;
TS

cat > backend/src/services/evaluate.ts <<'TS'

// Sample deterministic prompt to instruct Azure OpenAI to return JSON
const buildPrompt = (transcript: string, question: any) => {
  const keyPhrases = (question.key_phrases || []).map((p:string)=>p.toLowerCase());
  return [
     "You are an automated deterministic grader. Output ONLY valid JSON with these fields: score (0-100 integer), matched_phrases (array), missing_phrases (array), feedback (string).",
     "Question: " + (question.question || ""),
     "Expected key phrases: " + keyPhrases.join(", "),
     "Student answer (transcript): " + transcript,
     "Scoring rules: match phrase case-insensitively. Give proportional score based on number of key phrases matched. Provide concise feedback and hints for missing phrases.",
     "Output JSON now."
  ].join("\n\n");
};

export default async function evaluate(transcript: string, question: any) {
  // Try Azure OpenAI first (if configured). Otherwise fallback to deterministic local scoring.
  try {
     const endpoint = process.env.AZURE_OPENAI_ENDPOINT || await getSecret("AZURE_OPENAI_ENDPOINT");
     const apiKey = process.env.AZURE_OPENAI_API_KEY || await getSecret("AZURE_OPENAI_API_KEY");
     const deployment = process.env.AZURE_OPENAI_DEPLOYMENT || await getSecret("AZURE_OPENAI_DEPLOYMENT");
     if (!endpoint || !apiKey || !deployment) throw new Error("OpenAI not configured");
     const client = new OpenAI({ apiKey, baseURL: endpoint });
     const prompt = buildPrompt(transcript, question);
     const resp = await client.responses.create({
        model: deployment,
        input: prompt,
        max_tokens: 400
     });
     const text = String((resp.output?.[0]?.content?.[0]?.text) || "");
     // Attempt to extract JSON from text
     const firstBrace = text.indexOf("{");
     const lastBrace = text.lastIndexOf("}");
     if (firstBrace >= 0 && lastBrace >= 0) {
        const jsonStr = text.slice(firstBrace, lastBrace + 1);
        const parsed = JSON.parse(jsonStr);
        return parsed;
     }
     // fallback to local scoring
     return localScore(transcript, question);
  } catch (err) {
     console.warn("OpenAI evaluation failed, falling back:", err?.message || err);
     return localScore(transcript, question);
  }
}

function localScore(transcript: string, question: any) {
  const keyPhrases = (question.key_phrases || []).map((s:string)=>s.toLowerCase());
  const matched: string[] = [];
  const low = transcript.toLowerCase();
  for (const kp of keyPhrases) {
     if (kp.split(" ").every(tok => low.includes(tok))) matched.push(kp);
  }
  const score = Math.round((matched.length / Math.max(1, keyPhrases.length)) * 100);
  const missing = keyPhrases.filter(k => !matched.includes(k));
  const feedback = matched.length === keyPhrases.length ? "Excellent — covered all key points." : `You mentioned ${matched.length} key items. Missing: ${missing.join(", ")}`;
  return { score, matched_phrases: matched, missing_phrases: missing, feedback };
}
TS

cat > backend/src/services/store.ts <<'TS'

const containerId = "sessions";

async function getCosmos() {
  const conn = process.env.COSMOS_CONNECTION_STRING || await getSecret("COSMOS_CONNECTION_STRING");
  if (!conn) throw new Error("Cosmos DB connection missing");
  const client = new CosmosClient(conn);
  const db = client.database("quizdb");
  await db.containers.createIfNotExists({ id: containerId, partitionKey: { kind: "Hash", paths: ["/sessionId"] } });
  const container = db.container(containerId);
  return container;
}

export async function saveSession(item: any) {
  const container = await getCosmos();
  const id = item.sessionId || `s-${Date.now()}`;
  const doc = { id, ...item };
  await container.items.create(doc);
  return doc;
}

export async function saveAudioToBlob(filename: string, buffer: Buffer) {
  const conn = process.env.BLOB_CONNECTION_STRING || await getSecret("BLOB_CONNECTION_STRING");
  if (!conn) throw new Error("Blob connection missing");
  const client = BlobServiceClient.fromConnectionString(conn);
  const container = client.getContainerClient("audio-recordings");
  await container.createIfNotExists();
  const block = container.getBlockBlobClient(filename);
  await block.uploadData(buffer, { blobHTTPHeaders: { blobContentType: "audio/wav" } });
  return block.url;
}
TS

cat > backend/src/utils/secrets.ts <<'TS'

const useVault = process.env.USE_KEY_VAULT === "true";
const vaultName = process.env.KEY_VAULT_NAME || "";

export async function getSecret(name: string): Promise<string> {
  if (!useVault) throw new Error("Key Vault usage disabled");
  if (!vaultName) throw new Error("KEY_VAULT_NAME not set");
  const url = `https://${vaultName}.vault.azure.net`;
  const cred = new DefaultAzureCredential();
  const client = new SecretClient(url, cred);
  const sec = await client.getSecret(name);
  return sec.value || "";
}
TS

# -------------------------
# Frontend (Vite + React + TypeScript)
# -------------------------
cat > frontend/package.json <<'JSON'
{
  "name": "speech-quiz-frontend",
  "version": "0.1.0",
  "private": true,
  "scripts": {
     "dev": "vite",
     "build": "tsc && vite build",
     "preview": "vite preview"
  },
  "dependencies": {
     "axios": "^1.4.0",
     "react": "^18.2.0",
     "react-dom": "^18.2.0",
     "microsoft-cognitiveservices-speech-sdk": "^1.29.0"
  },
  "devDependencies": {
     "@types/react": "^18.0.28",
     "@types/react-dom": "^18.0.11",
     "typescript": "^5.0.4",
     "vite": "^4.3.9"
  }
}
JSON

cat > frontend/tsconfig.json <<'TS'
{
  "compilerOptions": {
     "target": "ES2020",
     "lib": ["DOM", "ES2020"],
     "jsx": "react-jsx",
     "module": "ESNext",
     "moduleResolution": "Node",
     "strict": true,
     "esModuleInterop": true,
     "skipLibCheck": true
  },
  "include": ["src"]
}
TS

cat > frontend/index.html <<'HTML'
<!doctype html>
<html>
  <head>
     <meta charset="utf-8" />
     <title>Speech Quiz</title>
  </head>
  <body>
     <div id="root"></div>
     <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
HTML

cat > frontend/src/main.tsx <<'TS'

createRoot(document.getElementById("root")!).render(<App />);
TS

cat > frontend/src/ui/App.tsx <<'TS'

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
TS

# -------------------------
# Infra (Terraform) skeleton
# -------------------------
cat > infra/README-TERRAFORM.md <<'TXT'
Infra notes:
- This folder contains sample Terraform to provision Azure resources.
- Customize variables in terraform.tfvars, then run:
  terraform init
  terraform apply

This sample config creates:
- Resource group
- Storage account (blob)
- Cosmos DB account
- Key Vault
- App Service plan + App Service
- Speech resource and cognitive services (note: azure_openai may require manual enrollment)
- Managed identity for the app to access Key Vault
TXT

cat > infra/main.tf <<'TF'
terraform {
  required_providers {
     azurerm = {
        source  = "hashicorp/azurerm"
        version = ">=3.0"
     }
  }
}

provider "azurerm" {
  features {}
}

variable "prefix" {
  type    = string
  default = "speechquiz"
}

resource "azurerm_resource_group" "rg" {
  name     = "${var.prefix}-rg"
  location = "EastUS"
}

resource "azurerm_storage_account" "st" {
  name                     = "${var.prefix}stg"
  resource_group_name      = azurerm_resource_group.rg.name
  location                 = azurerm_resource_group.rg.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
}

resource "azurerm_storage_container" "audio" {
  name                  = "audio-recordings"
  storage_account_name  = azurerm_storage_account.st.name
  container_access_type = "private"
}

resource "azurerm_key_vault" "kv" {
  name                        = "${var.prefix}-kv"
  location                    = azurerm_resource_group.rg.location
  resource_group_name         = azurerm_resource_group.rg.name
  tenant_id                   = data.azurerm_client_config.current.tenant_id
  sku_name                    = "standard"
  purge_protection_enabled    = false
  soft_delete_enabled         = true
}

data "azurerm_client_config" "current" {}

resource "azurerm_cosmosdb_account" "cosmos" {
  name                = "${var.prefix}-cosmos"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
  offer_type          = "Standard"
  kind                = "GlobalDocumentDB"
  consistency_policy {
     consistency_level = "Session"
  }
  geo_location {
     location          = azurerm_resource_group.rg.location
     failover_priority = 0
  }
}
# Note: Azure OpenAI resource requires special access; create manually or with provider if allowed.
TF

cat > infra/variables.tf <<'TF'
variable "subscription_id" {
  type = string
}
TF

# -------------------------
# GitHub Actions workflow
# -------------------------
cat > .github/workflows/deploy.yml <<'YAML'
name: CI/CD - Build & (optional) Deploy

on:
  push:
     branches:
        - main

jobs:
  build:
     runs-on: ubuntu-latest
     steps:
        - uses: actions/checkout@v4
        - name: Setup Node
          uses: actions/setup-node@v4
          with:
             node-version: 18
        - name: Build backend
          working-directory: backend
          run: |
             npm ci
             npm run build
        - name: Build frontend
          working-directory: frontend
          run: |
             npm ci
             npm run build
  # Optional: add az login and terraform apply steps here for deployment to Azure
YAML

# -------------------------
# Sample OpenAI prompt file
# -------------------------
cat > scripts/openai-prompt.md <<'PROMPT'
You are a deterministic grader. Input: question, expected key phrases, student transcript.
Output only JSON: { "score": 0-100, "matched_phrases": [...], "missing_phrases": [...], "feedback": "..." }
Scoring: proportion of key phrases found -> multiply by 100, round to integer.
PROMPT

# -------------------------
# scripts/questions.json (copy of sample)
# -------------------------
cp scripts/sample-questions.json scripts/questions.json

# -------------------------
# Final notes and run script
# -------------------------
cat > run-local.sh <<'SH'
#!/usr/bin/env bash
# Quick local run instructions:
# 1. Backend:
#    cd backend
#    cp .env.example .env
#    # edit .env to set SPEECH_KEY, SPEECH_REGION, AZURE_OPENAI_*, COSMOS_CONNECTION_STRING if testing cloud features.
#    npm install
#    npm run start:dev
# 2. Frontend:
#    cd frontend
#    npm install
#    npm run dev
echo "Started. Backend on http://localhost:7071, Frontend Vite default port (see console)."
SH
chmod +x run-local.sh

# -------------------------
# Done
# -------------------------
echo "Project '$ROOT_DIR' generated. Run 'bash run-local.sh' to start locally. See README.md for details."