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


## Secrets & Configuration

This project reads configuration from environment variables. For local development, copy the example and populate values:

- Create local `.env` (do not commit):

  - Copy the example: `cp .env.example .env`
  - Fill in the appropriate values below.

- Example variables included in `.env.example`:
  - `PORT` : Backend port (defaults to `7071`).
  - `NODE_ENV` : `development` or `production`.
  - `USE_KEY_VAULT` : `false` (local) or `true` (to fetch secrets from Azure Key Vault).
  - `KEY_VAULT_NAME` : Name of the Key Vault (when using Key Vault).
  - `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_CLIENT_SECRET` : Service principal credentials (when not using managed identity).
  - `COSMOS_CONNECTION_STRING` : Cosmos DB connection string for production storage (optional for local dev).
  - `AZURE_STORAGE_CONNECTION_STRING` : Blob storage connection string (optional for local dev).
  - `OPENAI_API_KEY` : OpenAI API key (if using OpenAI cloud). If not present, the backend uses a local deterministic scorer fallback.
  - `OPENAI_ORG` : Optional OpenAI organization id.
  - `SESSION_STORE` : `file` (local default) or `cosmos`/`blob` for cloud store modes.
  - `SESSION_FILE_PATH` : Path to local sessions file (default: `data/sessions.json`).

- GitHub Actions / CI:
  - Add repository secrets via GitHub settings → Secrets & variables → Actions.
  - Recommended secret names:
    - `OPENAI_API_KEY`
    - `AZURE_CREDENTIALS` (for `azure/login` action - JSON for the service principal) or the individual `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_CLIENT_SECRET`.
    - `COSMOS_CONNECTION_STRING`
    - `AZURE_STORAGE_CONNECTION_STRING`
  - The integration workflow will expect `OPENAI_API_KEY` (if you want the cloud grader) and optionally `AZURE_CREDENTIALS` to run infra-sensitive tests.

Security notes:
- Never commit a real `.env` file or credential material. `.env` is listed in `.gitignore`.
- For production, prefer Azure Key Vault + managed identity or GitHub Actions secrets and avoid raw plaintext in repo.

If you want, I can also add a small script to validate required env vars at server start and fail early with clear messages.

