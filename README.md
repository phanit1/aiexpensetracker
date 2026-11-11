# ExpenseAI

A full stack personal expense tracker built with React, Express, and PostgreSQL. It uses one server side `DATABASE_URL` for persistent user accounts and financial data. The API handles password hashing with bcrypt and sessions with JWT; no Supabase Auth client or API keys are used.

## Get started

Requirements: Node.js 20 or newer and npm.

1. Copy `.env.example` to `.env` or add `DATABASE_URL` and a long random `JWT_SECRET` to your existing `.env`.
2. Run `npm install`, then `npm run dev`.
3. Open the Vite URL shown in the terminal (normally `http://localhost:5173`).

The Express API starts on port 4000 and creates the required PostgreSQL tables on startup. Visit `http://localhost:4000/` for API status and endpoint information. The app uses in-memory demo storage if `DATABASE_URL` is unset; data in that mode resets when the server restarts.

## PostgreSQL

Set `DATABASE_URL` to a PostgreSQL connection string. A hosted PostgreSQL provider can be used by supplying its direct or pooler connection string; no provider specific URL or anon key is needed. You can apply [`database/schema.sql`](database/schema.sql) manually, though the API creates these tables when it starts:

- `app_users` stores email, display name, currency, and bcrypt password hash.
- `categories`, `transactions`, and `budgets` store user owned financial data.
- `insights` stores AI insight payloads as JSONB.

On startup, the API also adjusts the financial tables for server-managed JWT authentication. Existing accounts from a previous managed-auth setup must create a new app account; the local preview account is available for exploring the UI.

There are no preset production login credentials. For a local preview with `DATABASE_URL` configured, use **demo@expenseai.app** / **ExpenseAI123!**. On first startup outside production, the API seeds this account with 20 transactions and three budgets. You can also choose **Create your account** for a separate persistent account. The preview account is disabled when `NODE_ENV=production`.

## AI insights

Without `GEMINI_API_KEY`, the API generates rule based monthly summaries and savings ideas from the user's transaction history. To enable Gemini, set `GEMINI_API_KEY` and optionally `GEMINI_MODEL` in `.env`. Keep these values on the API server, never in `VITE_*` variables.

## Included

- JWT and bcrypt authentication.
- Seventeen default income and expense categories, plus custom categories with icon and color choices.
- Create, edit, delete, search, and filter transactions.
- Import bank and credit card statements from CSV, TSV, OFX, QFX, or text-based PDF; review and correct inferred transactions and categories before saving, with duplicate detection. Scanned image-only PDFs require OCR and are not supported.
- Weekly and monthly category budgets with current spending progress.
- Dashboard summary cards, income and expense trends, spending breakdown, recent transactions, and budgets.
- 30 day, 3 month, monthly, and yearly transaction charts.
- Monthly AI reflection, savings tips, and a filter aware transaction analyzer.
- Responsive desktop and mobile layouts.

## Production

Set `NODE_ENV=production`, configure `.env`, run `npm run build`, then `npm start`. The Express server serves the built React app and API from the same origin.
