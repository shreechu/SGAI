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
