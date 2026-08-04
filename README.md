# KitchenQ

Session and club management for the DEPC pickleball club — courts, fair queue
rotation, scoring, rankings, and a payment ledger. Mobile-first web app (PWA).

Build plan and milestones: `docs/PLAN.md`.

## Design system

Light mode, yellow-green brand, rounded white cards. Tokens live in
`src/index.css` (`@theme`), mirrored in `src/theme.ts` for tests and SVG fills.

**The one rule that matters:** `brand` (`#7CB518`) is 2.48:1 against white and
must never carry white text. Anything with a white label uses `primary`
(`#4A7C15`, 5.0:1). `src/theme.test.ts` asserts every colour pair the UI uses,
and asserts the forbidden ones stay forbidden. Adding a new colour combination
means adding it to `TEXT_PAIRS` — that is deliberate.

## Setup

### 1. Supabase project

1. Create a project at https://supabase.com (free tier is enough).
2. **Authentication → Providers → Anonymous sign-ins: enable.** Players join with
   a code and a name, so the app signs them in anonymously. Nothing works without
   this.
3. **SQL Editor** → paste and run `supabase/migrations/0001_init.sql`.
4. **Project Settings → API** → copy the Project URL and the `anon` public key.

### 2. Local env

Copy `.env.example` to `.env` and fill in both values:

```
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
```

The `anon` key is safe in the client — row-level security in the migration is what
actually protects the data. Never put the `service_role` key here.

### 3. Run

```
npm install
npm run dev
```

## Deploy

**Live: https://kitchen-q.vercel.app**

Static build, no server. Vercel builds from `main` on every push, so deploying is
`git push`.

The two `VITE_*` variables are set in the Vercel project's environment settings.
Vite inlines them **at build time**, so changing one means redeploying — editing
it in the dashboard does nothing to the build already serving.

SPA fallback is configured (`vercel.json`, `public/_redirects`). It is what makes
a shared `/join?code=…` link work; without it that link 404s while the home page
looks perfectly fine.

## Notes

- `npm audit` reports a high-severity advisory in `react-router`. It applies only
  to RSC (React Server Components) mode. This app is a pure client SPA and does
  not use RSC, so it is not affected. Do not downgrade.
