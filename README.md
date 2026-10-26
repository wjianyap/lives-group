# Lives Group – MDM & Regional Insights Portal

Prototype for the SMU DSA Data Case Competition 2026. All sales data is **synthetic**.

- `client/` – Vue 3 + Vite (HTML, CSS, Vue)
- `server/` – Express 5 + Mongoose (MongoDB)
- `_archive-heartware/` – the previous HeartWare project, moved aside untouched

## Run locally (Node 22+)

1. `server/config.env` needs `DB=<mongodb connection string>` and `SECRET=<long random text>`
   (optional: `DB_NAME` (default `lives_mdm`), `PORT` (default 8100), `FIELD_KEY`, `TEAMS_WEBHOOK_URL`).
2. Server:
   ```
   cd server && npm install
   npm run seed     # resets the lives_mdm database with demo data
   npm run dev      # http://localhost:8100
   ```
3. Client (new terminal):
   ```
   cd client && npm install
   npm run dev      # http://localhost:5180 (proxies /api to 8100)
   ```
4. Sign in with any demo persona (password `Demo123!`), e.g. Amy (requestor), Wei Jie (Finance),
   Dr. Nok (QRA), Priya (MDM), Portal Admin.

`npm test` in `server/` runs unit tests for duplicate matching, forecasting, the email classifier and field encryption.
For one-origin hosting, `npm run build` in `client/` and the Express server serves `client/dist`.

## What it covers (brief section 5)

| Brief question | Where |
|---|---|
| Standard intake, no incomplete submissions | Dynamic forms per request type, required/conditional fields validated in browser **and** server |
| Prevent duplicates | Live fuzzy duplicate check (names, abbreviations, accents, reg. no., email domain); likely duplicates blocked unless a reason is given; MDM duplicate scan + merge |
| Orders vs enquiries vs MDM setup | Email intake classifier (explainable signals) + customer match; unknown customer → pre-filled setup request |
| Faster approvals, live status | Parallel approval stages, SLA timers, reminders at 50%, escalation at 100%, in-app (and optional Teams) notifications, tracker showing who it waits on |
| Audit + sensitive fields | SHA-256 hash-chained audit log with verify; bank/credit fields AES-256-GCM encrypted, masked, reveal only for Finance/MDM and logged |
| No IT to change domains/steps | Admin → Request types: fields, conditions, approval chain, SLA are data |
| Connection to SAP B1 | Service Layer payload generated from field mapping; MDM posts once all approvals are in |
| Forecasting with DS/AI | Holt-Winters vs 6/12-month averages, chosen by 6-month hold-out back-test per country × product |
| Regional business view | Country × product units, value, YoY growth & 6-month momentum (Nov 2025–Oct 2026), drop-off risk, cross-sell, recommended actions |

Assumption: the five countries are SG, MY, ID, TH, VN (see `server/config/constants.js`).
