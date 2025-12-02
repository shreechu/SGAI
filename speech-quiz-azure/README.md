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

