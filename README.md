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

## PWA

Installs to a phone home screen and launches without browser chrome:
`public/manifest.webmanifest`, `public/sw.js`, and the icons in `public/`.

**The service worker fetches navigations from the network first**, falling back
to the cached shell only when that fails. This is deliberate. Cache-first would
pin a host to a stale build during a live session, which is a worse failure than
having no offline support at all. Built assets carry a content hash in their
filename, so those are cache-first and safe. Supabase is another origin and is
never cached — the app assumes online and says plainly when it isn't.

Bump `CACHE` in `public/sw.js` to retire every previous cache at once.

### Icons

```
npm run icons
```

Regenerates every icon in `public/` from `KQ Logo.png`. The source has white
baked into the corners of its rounded square, which reads as a rendering fault
under a launcher mask, so `scripts/make-icons.mjs` floods that white out, extends
the plate to a full-bleed square, downscales, and re-encodes — using only
`node:zlib`, no image library. It re-decodes each file it writes and fails loudly
rather than emitting a broken PNG.

Run it after changing the logo; the outputs are committed.

## Notes

- `npm audit` reports a high-severity advisory in `react-router`. It applies only
  to RSC (React Server Components) mode. This app is a pure client SPA and does
  not use RSC, so it is not affected. Do not downgrade.
