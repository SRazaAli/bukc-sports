#!/usr/bin/env node
/**
 * Try Coach from the terminal before the chat bubble exists (Feature 13, Step 2).
 *
 * Usage (server must be running on :4000):
 *   node scripts/try-coach.mjs <enrollmentNo> <password> "your question"
 *
 * Logs in as that STUDENT, sends the question, and prints Coach's reply as it streams.
 * Optional: API_URL=http://localhost:4000 (default).
 */
const [enrollmentNo, password, ...rest] = process.argv.slice(2);
const question = rest.join(' ');
const API = process.env.API_URL ?? 'http://localhost:4000';

if (!enrollmentNo || !password || !question) {
  console.error('Usage: node scripts/try-coach.mjs <enrollmentNo> <password> "your question"');
  process.exit(1);
}

const login = await fetch(`${API}/api/auth/login/student`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ enrollmentNo, password }),
});
const auth = await login.json();
if (!login.ok) {
  console.error(`Login failed (${login.status}): ${auth.error ?? JSON.stringify(auth)}`);
  process.exit(1);
}

const started = Date.now();
const res = await fetch(`${API}/api/assistant/chat`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.accessToken}` },
  body: JSON.stringify({ messages: [{ role: 'user', text: question }] }),
});
if (!res.ok) {
  const body = await res.json().catch(() => ({}));
  console.error(`Coach refused (${res.status}): ${body.error ?? ''}`);
  process.exit(1);
}

process.stdout.write('\nCoach: ');
const decoder = new TextDecoder();
let buffer = '';
for await (const part of res.body) {
  buffer += decoder.decode(part, { stream: true });
  let idx;
  while ((idx = buffer.indexOf('\n\n')) !== -1) {
    const block = buffer.slice(0, idx);
    buffer = buffer.slice(idx + 2);
    const event = /^event: (.*)$/m.exec(block)?.[1];
    const data = JSON.parse(/^data: (.*)$/m.exec(block)?.[1] ?? 'null');
    if (event === 'delta') process.stdout.write(data.text);
    if (event === 'error') process.stdout.write(`\n[${data.code}] ${data.message}`);
  }
}
console.log(`\n\n(${((Date.now() - started) / 1000).toFixed(1)} s)`);
