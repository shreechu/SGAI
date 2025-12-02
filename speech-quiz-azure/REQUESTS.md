# API Request Examples (curl)

Backend base URL: `http://localhost:7071`

Health check

```bash
curl -sS http://localhost:7071/health | jq
```

Get next question (index 0)

```bash
curl -sS "http://localhost:7071/api/nextquestion?idx=0" | jq
```

Evaluate an answer (example)

```bash
curl -sS -X POST http://localhost:7071/api/evaluate \
  -H "Content-Type: application/json" \
  -d '{"transcript":"The pyramids and hieroglyphics...","question":{"id":"q1","question":"Describe three key achievements of the ancient Egyptians.","key_phrases":["pyramids","hieroglyphics","irrigation"]}}' | jq
```

Notes:
- Install `jq` for pretty JSON output. On macOS: `brew install jq`.
