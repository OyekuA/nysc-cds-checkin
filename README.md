# NYSC Surulere CDS Check-In (v2)

A 100% free, zero-credit-card digital attendance system for NYSC Surulere CDS, rebuilt on **Cloudflare Pages + Cloudflare D1 (SQLite)** with **Vite + React + TypeScript**.

Courtesy of NYSC 2026/2027 ICT Excos · Designed by Alozor Kingsley · Sponsored by Seamflux Technologies.

---

## What Is New in v2

- **Reliable Google Sign-In on every phone**: Uses a normal full-page Google OAuth redirect with first-party `HttpOnly` cookies (no popups, no cross-domain cookie blocks on iPhone Safari or Android Chrome). Stays signed in for 30 days.
- **In-app browser warning**: Automatically detects when someone opens the link inside WhatsApp, Instagram, or a QR scanner app and guides them to open it in Chrome or Safari.
- **Real-time live GPS lock**: Rejects old cached locations from earlier in the day, waits for live GPS accuracy to settle, and guides users to turn on **Precise Location** if their phone is sharing Approximate Location.
- **Fixed QR or Rotating Venue QR**: Excos can either print a fixed venue QR poster or turn on **Require QR** to display a live QR code on `/qr` that rotates every 45 seconds (stopping screenshots and Fake GPS check-ins from home).
- **Works reliably on Glo, MTN, and Airtel**: Removed the heavy Firebase SDK and persistent Firestore streams. Pages are tiny (~80 kB gzipped), served from Cloudflare's Lagos edge, and check-ins use a plain HTTPS request with automatic retry.
- **Instant pass recovery**: If a corps member closes their browser after checking in, reopening the page immediately shows their arrival number and digital pass without needing GPS again.
- **Complete Exco Admin Dashboard (`/admin`)**:
  - Live attendance list with search, filters, on-time/late status, and daily CSV export.
  - Built-in CSV / paste roster importer (no more uploading temporary `import.html` files).
  - One-tap **Use my location** button to bind the geofence to the exact CDS venue pin and adjust radius or session hours anytime.
  - One-click **Unbind** if a corps member accidentally linked the wrong Google account.
  - **Manual check-in** fallback (with Exco audit trail) for members whose phone died.
  - Co-admin Exco management.
  - **Monthly NYSC Clearance Report** with attendance percentages and CSV export.

---

## v1 vs v2

| Area | v1 (Static HTML + Firebase + GitHub Pages) | v2 (Cloudflare Pages + D1 SQLite) |
| :--- | :--- | :--- |
| **Hosting & Cost** | GitHub Pages + Firebase Spark (upgrading to Cloud Functions required a Blaze billing card) | Cloudflare Pages + D1 SQLite (100% free, no credit card, never pauses) |
| **Google Sign-In** | Cross-domain popup (`github.io` -> `firebaseapp.com`), failed on iOS Safari and WebViews | Same-origin OAuth redirect + `HttpOnly` cookie, `select_account`, WebView banner |
| **GPS Accuracy** | Single `getCurrentPosition()` often returned a previous cached location | Live `watchPosition` (`maximumAge: 0`) filters stale fixes (> 15s) and waits for accuracy lock |
| **Glo Network** | External CDN scripts + Firestore WebChannel streams frequently stalled on Glo | Local bundled app on Cloudflare Lagos edge + simple HTTPS JSON with retry |
| **Anti-Cheat Integrity** | Client-side GPS check, phone clock, brittle 9.5 GB incognito check | Server-side geofence & `Africa/Lagos` clock, SQLite `UNIQUE` 1:1 claims & arrival numbers, optional rotating HMAC QR |
| **Rush-Hour Stability** | 50+ simultaneous phones clashed on one Firestore `counters/{day}` doc | Atomic SQLite arrival numbering with automatic retry |
| **Admin Operations** | Hardcoded single admin, manual `import-*.html` commits, daily CSV only | Multi-admin dashboard, in-app CSV roster import, venue GPS picker, account unbind, manual check-in, monthly clearance CSV |

---

## All v1 Bugs Fixed

1. **Google sign-in failing or trapping users on the wrong account**: Fixed by moving OAuth to a first-party server redirect on your own domain, adding `prompt=select_account` so switching accounts works cleanly, and catching in-app WebViews upfront.
2. **Location detecting a previous place (home/bus stop) instead of real-time venue location**: Fixed by switching from single-shot `getCurrentPosition` to a `watchPosition` convergence loop with `maximumAge: 0`, rejecting any reading older than 15 seconds or predating the session, and detecting Android/iOS Approximate Location.
3. **Glo mobile network hanging or failing**: Fixed by removing external CDN script fetches (`gstatic.com`, `fonts.googleapis.com`) and Firestore streaming connections; check-ins now send one small HTTPS POST request with automatic retry.
4. **Normal Android phones falsely blocked as "Incognito"**: Removed v1's brittle `< 9.5 GB` storage-quota incognito check that locked out legitimate low-storage Android phones.
5. **Rush-hour "Something went wrong" errors**: Replaced contended client-side Firestore transactions with atomic server-side SQLite inserts.
6. **Phone clock manipulation and client-side GPS spoofing**: Date (`Africa/Lagos`), open/close hours, late cutoff, geofence distance, and optional rotating QR verification all run on the server.
7. **One Google account claiming multiple state codes**: Enforced bi-directional 1:1 claims in SQLite (`code_id PRIMARY KEY` and `google_sub UNIQUE`) so one account cannot check in two different codes, and one code cannot be checked in by two different accounts.
8. **Having to re-pass GPS just to view today's arrival number**: Reopening `/` after checking in loads your digital pass immediately from the server.

---

## How the System Works

### For Corps Members (`/`)
1. Open the check-in link (or scan the venue QR code) in Chrome or Safari.
2. Sign in with Google (use the same Gmail every CDS day).
3. Enter your NYSC state code (e.g. `LA/26A/0123`; auto-filled on future visits).
4. Confirm live GPS lock at the venue (and scan the rotating QR if Excos turned **Require QR** on).
5. Tap **Check In** to receive your server-assigned arrival number and digital pass.

### For ICT Excos (`/admin` and `/qr`)
- **`/admin`**: Open/close attendance, toggle **Require QR**, watch attendance live, record manual fallback check-ins, import/edit the roster, unbind mistaken Google links, capture the venue GPS pin, manage co-admins, and export daily or monthly clearance CSVs.
- **`/qr`** *(admin-only)*:
  - **Fixed (printable)** mode: Displays a permanent QR for `/` with a **Print poster** button (use when **Require QR** is OFF).
  - **Rotating (live)** mode: Displays a live QR that rotates every 45 seconds with a countdown bar and live check-in count (use when **Require QR** is ON).

---

## Project Structure

```text
.
├── index.html                  # App entry point (routes: /, /admin, /qr)
├── schema.sql                  # SQLite schema reference (auto-initializes on first request)
├── .dev.vars.example           # Local dev environment template
├── src/
│   ├── App.tsx                 # Route loader with lazy chunks for /admin and /qr
│   ├── lib/                    # api.ts, auth.ts, geolocation.ts, device.ts, format.ts, types.ts
│   ├── components/             # LocationStatus, CheckInPass, SignInBox, QrScannerModal, WebViewBanner, Footer
│   └── pages/
│       ├── CheckInPage.tsx     # Corps member check-in & digital pass
│       ├── AdminPage.tsx       # Exco dashboard shell
│       ├── admin/              # AttendanceTab, RosterTab, SettingsTab, ReportsTab
│       └── QrDisplayPage.tsx   # Live rotating & printable fixed QR display
├── functions/                  # Cloudflare Pages Functions (auto-routed at /api/*)
│   ├── _lib/                   # db.ts (D1 auto-schema & secrets), crypto.ts, auth.ts, geo.ts, types.ts
│   └── api/
│       ├── auth/               # google.ts, callback.ts, me.ts, logout.ts, dev-login.ts
│       ├── checkin/            # status.ts, submit.ts
│       └── admin/              # bootstrap, checkins, roster, unbind, settings, admins, qr-token, monthly-report
└── tests/e2e.test.mjs          # Automated end-to-end tests running on real SQLite
```

---

## Porting Your Data from Firebase (v1)

**Nothing in Firebase is deleted or modified.** Your existing v1 database stays intact at [Firebase Console (`nysc-cds-checkin` Firestore)](https://console.firebase.google.com/project/nysc-cds-checkin/firestore).

To move cleanly into v2:
1. **Corps member roster (`codes` + `names`)**:
   - Open `https://<your-project>.pages.dev/admin`, go to **Roster**, and upload or paste your existing CSV spreadsheet (`LA/26A/0123, Full Name`, one per line).
   - If you no longer have the original CSV, you can view/export your `codes` and `names` collections from [Firebase Firestore](https://console.firebase.google.com/project/nysc-cds-checkin/firestore) as `Code, Name` lines and paste them into **Roster > Import roster**.
2. **Historical daily attendance (`checkins`)**:
   - Download any previous CDS dates as CSV from your old v1 admin page to keep as archive records, then record all new CDS sessions in v2.
3. **Google account links (`claims`)**:
   - No manual port is needed. Each corps member's Google account links automatically the first time they check in on v2.
4. **Venue coordinates**:
   - Your existing Surulere CDS coordinates (`6.5132891, 3.3559699`, `100 m` radius) are already pre-seeded as defaults in v2, and can be updated anytime under `/admin > Settings > Use my location`.

---

## Step-by-Step Deployment Walkthrough (100% Free, No Credit Card)

Everything runs free on **Cloudflare Pages + Cloudflare D1**. Database tables, default Surulere CDS venue settings, the primary admin (`kingsleyalozor@gmail.com`), and all signing secrets initialize automatically on the first request.

### Step 1: Reuse Your Existing Google OAuth Setup from Firebase (30 Seconds)
Because you already enabled Google Sign-In on your `nysc-cds-checkin` Firebase project, Google already set up your OAuth consent screen and Web Client ID for you:

1. Open [Google Cloud Credentials for `nysc-cds-checkin`](https://console.cloud.google.com/apis/credentials?project=nysc-cds-checkin).
2. Under **OAuth 2.0 Client IDs**, click **Web client (auto created by Google Service)**.
3. Under **Authorized redirect URIs**, click **Add URI** and enter your Cloudflare Pages callback URL (you can come back and confirm the exact domain right after Step 3):
   ```text
   https://<your-project>.pages.dev/api/auth/callback
   ```
4. Click **Save**, then copy the **Client ID** and **Client Secret**.

### Step 2: Create Your Free Cloudflare D1 Database
1. Sign up or sign in at [Cloudflare Dashboard](https://dash.cloudflare.com) (Free plan, no billing card required).
2. In the left sidebar, go to **Storage & Databases > D1 SQLite Database**.
3. Click **Create**, name it **`nysc-cds-checkin`**, and click **Create**.

### Step 3: Deploy on Cloudflare Pages (Connected to GitHub)
1. In Cloudflare Dashboard, go to **Workers & Pages > Create > Pages > Connect to Git**.
2. Select your GitHub repository (`nysc-surulere/nysc-cds-checkin`) and branch.
3. Set build settings:
   - **Framework preset**: `None` (or `Vite`)
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`
4. Click **Save and Deploy** (this creates your live URL like `https://nysc-cds-checkin.pages.dev`).
5. Now open your new Pages project and connect the database and Google keys:
   - Go to **Settings > Bindings > Add > D1 database**:
     - **Variable name**: `DB`
     - **D1 database**: `nysc-cds-checkin`
     - Save.
   - Go to **Settings > Variables and Secrets > Add**:
     - `GOOGLE_CLIENT_ID` = your Client ID from Step 1
     - `GOOGLE_CLIENT_SECRET` = your Client Secret from Step 1
     - Save.
6. Go to **Deployments** and click **Retry deployment** (or push a commit) so the new bindings and variables take effect.
7. Double-check Step 1's **Authorized redirect URI** in Google Cloud matches your exact live URL:
   `https://<your-exact-subdomain>.pages.dev/api/auth/callback`.

*(From now on, every push to your GitHub branch automatically rebuilds and deploys both the frontend and backend together.)*

### Step 4: Quick First-Time Setup Inside `/admin`
1. Open `https://<your-project>.pages.dev/admin` and sign in with `kingsleyalozor@gmail.com`.
2. Go to **Roster** and upload/paste your corps members' CSV.
3. When physically at the CDS venue, go to **Settings > Venue & GPS**, tap **Use my location**, adjust the radius if needed, and click **Save settings**.
4. Add any other ICT Excos under **Settings > Exco admins**.
5. Open `/qr` to either print your **Fixed QR poster** or project the **Rotating (live) QR**.

---

## Local Development & Testing

```bash
# 1. Install dependencies
npm install

# 2. Copy local dev env template (includes DEV_AUTH=true for quick localhost sign-in)
cp .dev.vars.example .dev.vars

# 3. Build and run full stack locally (frontend + API + local SQLite DB)
npm run preview
```

Open **http://localhost:8788/**:
- Check-In: `http://localhost:8788/`
- Exco Admin: `http://localhost:8788/admin` (sign in locally as `kingsleyalozor@gmail.com`)
- Venue QR: `http://localhost:8788/qr`

Run type checks and automated SQLite end-to-end tests anytime:

```bash
npm run typecheck
npm test
```
