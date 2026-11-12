# ExpenseAI

A full-stack personal expense tracker built with React, Express, and Supabase. Supabase Auth manages accounts and the Supabase Data API stores financial data. The app uses a publishable key with authenticated user sessions; it does not need a Postgres connection string or a server secret key.

## Setup

Requirements: Node.js 20 or newer and npm.

1. In Supabase, open **Project Settings → API** and copy the Project URL and publishable key.
2. Add `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` to `.env` locally and to the Vercel project's environment variables. Never put a secret/service-role key in the browser.
3. In Supabase **SQL Editor**, run [`database/schema.sql`](database/schema.sql) once. It creates the ExpenseAI tables, including `expenseai_users` for account profiles, and grants access to authenticated users. A trigger creates or updates each profile from Supabase Auth; the API filters records by the signed-in user's ID.
4. Run `npm install`, then `npm run dev` and open the Vite URL (normally `http://localhost:5173`).

Supabase Auth email confirmation is controlled in the Supabase Auth settings. If confirmation is enabled, signup displays a prompt to verify the email before signing in. For a quick local setup, you can disable email confirmation in the Supabase Auth provider settings.

## Vercel deployment

Set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` for the Production environment. Add `GEMINI_API_KEY` only if you want Gemini generated insights. Run the SQL setup before testing signup, then deploy or redeploy. `/api/health` confirms the Supabase Auth API is reachable; authenticated data requests additionally require the SQL schema.

**Security note:** RLS is intentionally disabled per project preference. The app's Express API filters records by user ID, but anyone with a valid Supabase user session can call the Supabase Data API directly and access rows across accounts. Do not use this configuration with real financial data; enable RLS and per-user policies before production.

## Included

- Supabase Auth signup, login, and access-token refresh.
- Seventeen default income and expense categories, plus custom categories with icon and color choices.
- Create, edit, delete, search, and filter transactions.
- Import bank and credit card statements from CSV, TSV, OFX, QFX, XLS, XLSX, PDF, and common image formats. Scanned PDFs and images use browser-based OCR; review and correct extracted transactions and categories before importing, with duplicate detection. OCR accuracy depends on scan quality and statement layout.
- Weekly and monthly category budgets with current spending progress.
- Dashboard summary cards, income and expense trends, spending breakdown, recent transactions, and budgets.
- 30 day, 3 month, monthly, and yearly transaction charts.
- Monthly AI reflection, savings tips, and a filter aware transaction analyzer. Without `GEMINI_API_KEY`, the API generates local rule-based summaries and tips.
- Responsive desktop and mobile layouts.
