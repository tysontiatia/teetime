/**
 * Preview branded alert email via Resend.
 * Usage: RESEND_API_KEY=... node scripts/test-email.mjs [to@email.com]
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  try {
    const raw = readFileSync(resolve(__dirname, '../.env'), 'utf8');
    const env = {};
    for (const line of raw.split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) env[m[1]] = m[2].trim();
    }
    return env;
  } catch {
    return {};
  }
}

const env = { ...loadEnv(), ...process.env };
const to = process.argv[2] || 'dev.teetimeio@gmail.com';
const key = env.RESEND_API_KEY;
if (!key) {
  console.error('Missing RESEND_API_KEY');
  process.exit(1);
}

const b = {
  paper: '#FBFBF8',
  card: '#FFFFFF',
  ink: '#141E19',
  muted: '#4C5A53',
  subtle: '#8A958F',
  pine: '#1E4D3B',
  pineDeep: '#143528',
  fairway: '#B7EA3C',
  greenSoft: '#F0FADB',
  line: '#E4E2DA',
  sand: '#EFECE3',
};

const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${b.paper};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${b.paper};padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px">
        <tr><td style="background:${b.pineDeep};border-radius:18px 18px 0 0;padding:22px 24px">
          <table role="presentation" width="100%"><tr>
            <td width="40"><img src="https://tee-time.io/logo-icon-light.svg" width="36" height="36" alt="" style="display:block;border-radius:9px"></td>
            <td style="padding-left:12px;font-size:18px;font-weight:700;color:#fff">Tee-Time<span style="color:${b.fairway}">.io</span></td>
          </tr></table>
        </td></tr>
        <tr><td style="background:${b.card};border:1px solid ${b.line};border-top:none;border-radius:0 0 18px 18px;padding:24px">
          <div style="font-size:12px;font-weight:700;text-transform:uppercase;color:${b.pine};margin-bottom:8px">Tee time alert</div>
          <h1 style="margin:0 0 6px;font-size:24px;color:${b.ink}">1:30 PM just reopened</h1>
          <h2 style="margin:0;font-size:17px;color:${b.ink}">Stonebridge</h2>
          <p style="margin:0 0 6px;color:${b.pine};font-size:13px;font-weight:600">Weekly alert · Saturdays</p>
          <p style="margin:0;color:${b.muted};font-size:14px">Saturday, July 11, 2026 · 2 players</p>
          <div style="background:${b.greenSoft};border:1px solid ${b.line};border-radius:14px;padding:18px 20px;margin:18px 0">
            <div style="font-size:12px;font-weight:700;text-transform:uppercase;color:${b.pine};margin-bottom:8px">Reopened</div>
            <div style="font-size:28px;font-weight:700;color:${b.ink}">1:30 PM</div>
            <div style="font-size:15px;color:${b.muted};margin-top:6px">$55 · 4 spots</div>
          </div>
          <p style="text-align:center;margin:22px 0 0"><a href="https://tee-time.io/app/" style="display:inline-block;background:${b.pine};color:#fff;padding:14px 28px;border-radius:12px;text-decoration:none;font-weight:700">Book now →</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

const res = await fetch('https://api.resend.com/emails', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    from: 'Tee-Time.io <alerts@tee-time.io>',
    to: [to],
    subject: '⛳ 1:30 PM reopened at Stonebridge',
    html,
  }),
});

const data = await res.json();
console.log(JSON.stringify({ status: res.status, ...data }, null, 2));
process.exit(res.ok ? 0 : 1);
