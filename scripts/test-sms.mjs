/**
 * Smoke-test Twilio alert SMS (Messages API) using .env credentials.
 * Usage: node scripts/test-sms.mjs +18015551234
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '../.env');

function loadEnv() {
  const raw = readFileSync(envPath, 'utf8');
  const env = {};
  for (const line of raw.split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

const to = process.argv[2];
if (!to || !/^\+1\d{10}$/.test(to)) {
  console.error('Usage: node scripts/test-sms.mjs +18015551234');
  process.exit(1);
}

const env = loadEnv();
const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER } = env;
if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER) {
  console.error('Missing TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, or TWILIO_FROM_NUMBER in .env');
  process.exit(1);
}

const body =
  '⛳ Tee-Time.io test — if you got this, alert SMS is wired up.\nBook: https://tee-time.io/app/';

const form = new URLSearchParams();
form.set('To', to);
form.set('From', TWILIO_FROM_NUMBER);
form.set('Body', body);

const creds = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
const res = await fetch(
  `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
  {
    method: 'POST',
    headers: {
      Authorization: `Basic ${creds}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  },
);

const text = await res.text();
let data;
try {
  data = JSON.parse(text);
} catch {
  data = { raw: text };
}

console.log(JSON.stringify({ status: res.status, ...data }, null, 2));
process.exit(res.ok ? 0 : 1);
