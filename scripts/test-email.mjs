const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f6f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<div style="max-width:520px;margin:0 auto;padding:24px">
  <div style="background:#1A2E1A;border-radius:12px 12px 0 0;padding:20px 24px">
    <h1 style="margin:0;color:#fff;font-size:18px;font-weight:600">⛳ Tee Times Available!</h1>
  </div>
  <div style="background:#fff;padding:24px;border-radius:0 0 12px 12px;box-shadow:0 2px 8px rgba(0,0,0,0.06)">
    <h2 style="margin:0 0 4px;font-size:17px;color:#111">Stonebridge Golf Club</h2>
    <p style="margin:0 0 16px;color:#666;font-size:14px">Saturday, April 25, 2026 · 4 players</p>
    <table style="width:100%;border-collapse:collapse">
      <thead><tr style="background:#f8faf8">
        <th style="padding:8px 16px;text-align:left;font-size:12px;color:#888;font-weight:600;text-transform:uppercase">Time</th>
        <th style="padding:8px 16px;text-align:left;font-size:12px;color:#888;font-weight:600;text-transform:uppercase">Price</th>
        <th style="padding:8px 16px;text-align:left;font-size:12px;color:#888;font-weight:600;text-transform:uppercase">Spots</th>
      </tr></thead>
      <tbody>
        <tr><td style="padding:8px 16px;border-bottom:1px solid #f0f0f0;font-size:15px">6:30 AM</td><td style="padding:8px 16px;border-bottom:1px solid #f0f0f0;font-size:15px;color:#666">$35</td><td style="padding:8px 16px;border-bottom:1px solid #f0f0f0;font-size:15px;color:#666">4 spots</td></tr>
        <tr><td style="padding:8px 16px;border-bottom:1px solid #f0f0f0;font-size:15px">6:39 AM</td><td style="padding:8px 16px;border-bottom:1px solid #f0f0f0;font-size:15px;color:#666">$35</td><td style="padding:8px 16px;border-bottom:1px solid #f0f0f0;font-size:15px;color:#666">4 spots</td></tr>
        <tr><td style="padding:8px 16px;border-bottom:1px solid #f0f0f0;font-size:15px">7:06 AM</td><td style="padding:8px 16px;border-bottom:1px solid #f0f0f0;font-size:15px;color:#666">$35</td><td style="padding:8px 16px;border-bottom:1px solid #f0f0f0;font-size:15px;color:#666">4 spots</td></tr>
        <tr><td style="padding:8px 16px;border-bottom:1px solid #f0f0f0;font-size:15px">7:24 AM</td><td style="padding:8px 16px;border-bottom:1px solid #f0f0f0;font-size:15px;color:#666">$35</td><td style="padding:8px 16px;border-bottom:1px solid #f0f0f0;font-size:15px;color:#666">3 spots</td></tr>
        <tr><td style="padding:8px 16px;border-bottom:1px solid #f0f0f0;font-size:15px">7:42 AM</td><td style="padding:8px 16px;border-bottom:1px solid #f0f0f0;font-size:15px;color:#666">$35</td><td style="padding:8px 16px;border-bottom:1px solid #f0f0f0;font-size:15px;color:#666">4 spots</td></tr>
      </tbody>
    </table>
    <a href="https://foreupsoftware.com/index.php/booking/19457/1971#/teetimes" style="display:block;text-align:center;background:#2D7A3A;color:#fff;padding:14px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;margin-top:20px">Book Now →</a>
    <p style="color:#aaa;font-size:12px;text-align:center;margin-top:16px">You received this because you set a tee time alert on <a href="https://tee-time.io" style="color:#2D7A3A">tee-time.io</a>.</p>
  </div>
</div>
</body>
</html>`;

const res = await fetch('https://api.resend.com/emails', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer re_RgXzwT2Y_C4K7BwZJsDGmeJ2kMkgQASvC',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    from: 'Tee-Time.io <onboarding@resend.dev>',
    to: ['dev.teetimeio@gmail.com'],
    subject: '⛳ 5 tee times at Stonebridge Golf Club',
    html,
  }),
});
const data = await res.json();
console.log(JSON.stringify(data, null, 2));
