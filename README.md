# Utah Tee Times

A tee time aggregator for 43 Utah golf courses (29 on ForeUp, 14 on Chronogolf).
Pick a date, number of players, and time window — see all available tee times in one place.
Click any tee time to open the course's booking page. Nothing is booked automatically.

---

## Deploy

### 1. Install Wrangler CLI

```bash
npm install -g wrangler
```

### 2. Login to Cloudflare

```bash
wrangler login
```

### 3. Deploy the Worker

```bash
cd worker && wrangler deploy
```

Copy the Worker URL from the output — it looks like:

```
https://utah-tee-times.yourname.workers.dev
```

### 4. Update the Frontend

Open `public/index.html` and replace `YOUR_SUBDOMAIN` in the `WORKER_URL` constant at the top of the `<script>` block:

```js
const WORKER_URL = 'https://utah-tee-times.yourname.workers.dev';
```

### 5. Deploy the Frontend to Cloudflare Pages

Option A — Wrangler CLI:

```bash
wrangler pages deploy public/
```

Option B — Cloudflare Dashboard:

- Go to [pages.cloudflare.com](https://pages.cloudflare.com)
- Create a new project → **Upload assets** → upload the contents of the `public/` folder
- Done — Cloudflare will give you a `.pages.dev` URL

### 6. Open the App

Visit your Pages URL. Search by date, players, and time window. All 43 courses load in parallel.

---

## Login-Gated Courses

Three courses require a ForeUp account to view tee times:

- **Stonebridge** (West Valley City)
- **The Ridge** (West Valley)
- **Timpanogos** (Provo)

For each of these, the app shows a token input. To get your session token:

1. Log into the course's booking page in your browser (e.g. `foreupsoftware.com/index.php/booking/22130`)
2. Open DevTools (`F12` or `Cmd+Option+I`)
3. Go to **Application** → **Cookies** → select the foreupsoftware.com domain
4. Find the cookie named `remember_82539b771b3a70569040bf4eb434cdf1` and copy its value
5. Paste the value into the token field in the app and click **Save & retry**

The token is stored in your browser's `localStorage` — you won't need to re-enter it unless you log out of ForeUp or clear your browser data.

---

## File Structure

```
utah-tee-times/
├── worker/
│   ├── index.js          ← Cloudflare Worker (CORS proxy)
│   └── wrangler.toml     ← Worker config
├── public/
│   └── index.html        ← Entire frontend (single file, no build step)
└── courses.json          ← Master list of 43 courses
```

The worker acts as a CORS proxy — it forwards requests from the browser to ForeUp and Chronogolf APIs and returns the results with proper CORS headers. Session tokens for login-gated courses are passed through in-memory only and never logged or stored by the worker.
