# Pickleball Club App — Build Plan

## Context

You run a pickleball club and currently organize open play the manual way — a clipboard, "sino next?", repeated pairings, untracked scores, and fee math in someone's head. PaQueueKa (https://paqueueka.info/) solves this for badminton; you want the same thing for pickleball, for your own club.

The outcome: a phone-first app where the host creates a session, players join with a short code, the queue rotates fairly across courts, scores are recorded, rankings and a session recap are generated automatically, and the club can see who has paid.

**Revision, this session.** M0 shipped with a dark "Industrial" visual direction — pitch black, monospace, no rounded corners. It was the wrong read of the brief and you rejected it. You supplied PaQueueKa screenshots showing what you actually want: **light mode, rounded white cards on a near-white ground, yellow-green brand, friendly geometric sans, colored avatar circles, two-level navigation.** The backend, data model, and milestone structure from the original plan are unaffected and stay. The design system is replaced wholesale, and three scope items change (two-level nav, court diagram, podium recap).

---

## Status

| Milestone | State |
|---|---|
| M0 — Foundations | **Done.** Schema, RLS, `create_club` RPC verified live against the Supabase project. Anonymous auth confirmed working. |
| M0.5 — Design system reset | **Done.** Light Organic system, contrast test enforcing the brand/primary split. Visually signed off. |
| M1 — Club, identity, joining | **Done.** `0002_join_session.sql` applied; join-by-code verified live. |
| M2 — Live session & courts | **Built, awaiting a real session.** `0003_matches.sql` applied; 22/22 live RPC checks and the queue-engine tests pass. |
| M2.5 — Guest players | **Built, awaiting a real session.** `0004_guests.sql` applied; 19/19 live checks pass. Host types in players without phones; they queue, play and are scored normally, and can claim their record later with the join code. |
| M3 — Scoring, rankings, recap | **Built, awaiting a real session.** `0006_scoring.sql` — apply it, then `node verify-m3.mjs` (24 live checks). Tap steppers replace the number pad, standings rank on adjusted win rate, the recap podium appears when the session ends, and player self-scoring is a host toggle with host-only correction. |
| M4 — Payments ledger | **Built, awaiting a real session.** `0007_ledger.sql` — apply it, then `node verify-m4.mjs` (25 live checks). The ledger is kept by database triggers, not the client: an entry appears however a player arrives, follows a change of fee, and survives their removal once money has been taken. Collection sheet with partial payments, plus club-wide dues. |
| M5 — Home & profiles | **Built, awaiting a real session.** No migration needed — `matches_read` already lets a club member read the club's whole history, so all-time stats are client aggregation over `standings()`. Run `node verify-m5.mjs` (21 live checks) and `npm test`. Home greets you and carries your record and what you owe; Profile has your all-time table and match history; the club screen has the all-time leaderboard. |
| M6 — Polish & PWA | **Built, awaiting a real session.** No new dependency. Installs to a home screen and opens offline; eight writes that used to fail silently now report; a dropped realtime channel is visible and catches up on reconnect; one score save costs 7 requests instead of ~63. Run `npm test` (70) and `npm run icons`. |
| M7 — Pair requests | **Built, awaiting a real session.** `0012_pair_requests.sql` applied; 22/22 live checks pass. A waiting player asks another to partner up; the other accepts and the two are put on the same team for one game, entering the queue from whichever of them was further back. In-app notification only: the ask appears on every session screen via the realtime channel that was already open. |
| M8 — Host-editable next-up | **Built, awaiting a real session.** `0013_court_pins.sql` applied; 25/25 live checks pass (`node verify-pins.mjs`). The next-up lineup on a court that is still playing is now the host's to change: re-pair the teams, swap someone in from the queue, or pull a player off another court's next-up. Edits are `court_pins` rows rather than local state, so they reach every phone and the court opens holding exactly what the host chose. This is what finally meets M2's "a host override before start is reflected on all devices" — the old override lived in one `useState` and died on refresh. |

App name: **KitchenQ** — the kitchen (non-volley zone) plus the queue. Used in the document title, PWA manifest, and app header.

Your club is **DEPC**. It is created through the in-app flow rather than hardcoded, so the app stays multi-club-ready — but DEPC is the club used for every real-session verification step below, and any screenshot or manual test uses DEPC's actual members rather than invented names.

---

## Decisions locked in

| Area | Decision |
|---|---|
| Platform | Mobile-first web app (PWA) now, Capacitor wrap later |
| Backend | Supabase (Postgres + Realtime + Auth + RLS) — **built** |
| Joining | Join code + name; anonymous auth, upgradeable to a real account later |
| Multi-club | Multi-club data model, single-club UX |
| Play format | Full rotation — winners and losers both requeue |
| Matchmaking | Fair queue + skill tiers + avoid recent repeats, host drag/override |
| Scoring | Single game to 11, win by 2, full score entered |
| Rankings | Adjusted win rate (shrunk toward 50%) + point differential |
| Roles | Host → can promote co-hosts. Player self-scoring is a session toggle, off by default |
| Payments | **Flat fee per player per session.** Ledger only, no payment gateway |
| Connectivity | Assume online; realtime with a reconnecting state |
| **Visual direction** | **Light mode, yellow-green brand, rounded cards — PaQueueKa design language, our own identity** |
| **Navigation** | **Two levels: app tabs, then a session-scoped tab bar** |
| **Gamification** | **Session-wrapped podium recap only.** No XP, no levels, no badges, no medal icons in rankings |
| **Court view** | **Full SVG court diagram with players positioned on it** |
| **Avatars** | **Uploaded photo, one per person across every club**; colored initial circles, deterministic from name, wherever there isn't one |

---

## Stack

- **Vite + React + TypeScript** — static build, no server, Capacitor-friendly. *(in place)*
- **Tailwind CSS v4** *(in place)*
- **React Router** *(in place)*
- **`@supabase/supabase-js`** *(in place)*
- **Vitest** — queue engine and rating math only *(installed)*
- **Hosting:** Vercel or Netlify free tier

**Dependency changes for M0.5:**
- **Remove** `@fontsource/ibm-plex-mono` → **add** `@fontsource/poppins` (400/500/600/700).
- **Add `lucide-react`** for icons. The reference design is icon-dense (players, courts, queue, trophy, clock, wallet, streak). Hand-rolling 30+ SVG paths is worse than one well-maintained tree-shakeable dependency.

Still deliberately **not** included: no state library, no TanStack Query (Supabase realtime already pushes updates), no component library, no custom backend.

---

## Design system (replaces the Industrial direction)

**Anchor: Organic**, adapted to light. Warm, rounded, generous — a club app people use socially, not a control desk. Soft shadows, 16–24px radii, friendly geometric sans, colored avatars, plenty of white space.

### Palette

```
PAGE BG       #F7F9F2   near-white, faint green cast
SURFACE       #FFFFFF   cards
SURFACE DARK  #2E4A0C   dark hero cards (session header, player card)

BRAND         #7CB518   bright yellow-green — accents, fills WITH DARK TEXT,
                        progress fills, active tab, LIVE dot
PRIMARY       #4A7C15   deeper green — any fill carrying WHITE text (5.0:1 AA)
ACCENT        #C6E82F   bright lime — highlights on dark surfaces only
TINT          #EDF7D4   pale lime — badges, pills, selected rows

TEXT          #1A2416   near-black green
MUTED         #6B7A63   grey-green
BORDER        #E3EAD8   hairline on light surfaces

WARN          #E8A33D   amber — "in queue", pending
DANGER        #D9534F   red — unpaid, destructive
```

**Contrast rule, non-negotiable:** `BRAND #7CB518` is **2.48:1 against white** — it may never carry white text. Buttons with white labels use `PRIMARY #4A7C15`. `BRAND` is for dark-text fills, accents, and indicators. Verify every text/background pair at build time; this is the single easiest thing to get wrong here.

### Type

**Poppins** — 400/500/600/700. Large bold headings (`Ready for your next match?`), medium-weight labels, regular body. Numerals use `tabular-nums` in scores, standings, and the fee list so columns align.

### Structure

- Cards: white, `rounded-2xl` (20px), soft shadow `0 2px 12px rgba(26,36,22,0.06)`, generous padding.
- Dark hero cards: `SURFACE DARK`, same radius, white text, lime accents — used for the session header and the player card.
- Pills/badges: `TINT` background, `PRIMARY` text, fully rounded.
- Section headings: bold sentence case (`Courts`, `Queue · 6 waiting`), not uppercase tracking.
- Bottom tab bars: white, top hairline, active tab in `BRAND` with icon + label.

**The `* { border-radius: 0 !important }` rule currently in `src/index.css` must be deleted** — it will silently defeat every rounded corner in the new system.

### Differentiator

**The court diagram.** An SVG court with net and service boxes, the four players' avatar circles positioned on their actual sides, and a live match timer. It reads from across a gym and it's the one screen element that makes this feel like a pickleball app rather than a generic roster tool.

### Content discipline

Every string names real information. No invented players, no fabricated stats, no filler labels. Empty states say what's actually true and what to do next. Standard UI copy for standard actions.

---

## Navigation architecture

Two levels, matching the reference:

```
App level        (bottom tabs)   Home · Clubs · Profile
  └─ Session     (pushed route, own bottom tabs)
                                 Live · Ranks · History · Fees
```

- **Home** — greeting, Host session / Join with code actions, your player card, current live session if any.
- **Clubs** — your clubs, member directory, recurring schedule, dues overview.
- **Profile** — your stats, match history, tier.
- **Session** — entered from Home or a join code. Owns the whole screen while you're playing; back button returns to app level.

Requires restructuring `src/App.tsx` routing and splitting `src/components/TabBar.tsx` into an app-level and a session-level bar sharing one presentational component.

---

## Data model (Supabase / Postgres) — built and verified

```
clubs            id, name, slug, currency, created_by
club_members     id, club_id, user_id, display_name, skill_tier,
                 role (owner|admin|member), created_at
sessions         id, club_id, name, join_code, status (draft|live|ended),
                 court_count, target_score, win_by, fee_amount,
                 allow_player_scoring, attendance_cap, scheduled_at,
                 started_at, ended_at
session_players  id, session_id, club_member_id, status, queued_at, games_played
matches          id, session_id, court_number, team_a_ids[], team_b_ids[],
                 score_a, score_b, started_at, ended_at
ledger_entries   id, session_id, club_member_id, amount_due, amount_paid,
                 status, note, updated_by
rsvps            id, session_id, club_member_id, status
```

Two simplifications made during M0 and verified: the `courts` table was dropped (court number lives on `matches`, with a partial unique index enforcing one live match per court), and `guest_name` was dropped (anonymous sign-in gives every guest a real identity, so everyone is a `club_member` — one identity path everywhere downstream).

Permissions are enforced by **RLS policies**, not app code. `create_club` is an RPC because a club and its owner membership must be created in one transaction.

---

## Milestones

---

### M0 — Foundations ✅ Done

Schema, RLS, `create_club` RPC, deploy config, app shell. Verified: RLS scopes correctly (owner sees their club, a different anonymous user sees nothing, unauthenticated sees nothing); anonymous sign-in works.

---

### M0.5 — Design system reset ← next

Replace the Industrial direction before any more UI is built on it. Nothing else should be built on tokens we're about to throw away.

**Build:**
- Swap fonts: remove `@fontsource/ibm-plex-mono`, add `@fontsource/poppins`; add `lucide-react`.
- Rewrite `src/index.css` — new tokens above, light `color-scheme`, **delete the border-radius reset**, restore shadows, keep the 44px touch-target rule.
- Rebuild `src/components/ui.tsx` into the component set the reference needs: `Card`, `DarkCard`, `Button` (primary/secondary/ghost/danger), `Pill`, `Avatar`, `StatTile`, `SectionHeading`, `EmptyState`, `Screen`.
- `Avatar` derives its background color from a hash of the display name, so a player's color is stable everywhere without storing it.
- Restructure `src/App.tsx` for two-level routing; split `TabBar` into app-level and session-level bars over one shared presentational component.
- Restyle the four existing route screens onto the new system.
- Update `index.html` — light `theme-color`, drop the black status-bar meta.

**Verify:**
- Side-by-side against your screenshots on a phone — it should read as the same family of app.
- **Automated contrast check** over every token pair used for text, asserting ≥4.5:1. This is the one place the chosen palette is genuinely easy to get wrong, so it gets a test rather than an eyeball.
- Home still shows the live Supabase connection probe — the redesign must not break M0's verified behaviour.

---

### M1 — Club, identity, and joining

**Build:** Anonymous auth on first load · create club via the `create_club` RPC · member directory with skill tiers and avatars · promote/demote co-hosts · create a session with a 6-character join code · join screen (code → name → in) styled like the reference's "Joining as…" screen · share-code affordance on the session header.

**Verify:**
- Two phones join the same session with only the code.
- Both appear on both devices without a refresh (realtime).
- A non-admin phone cannot see or reach host controls.

---

### M2 — Live session & court management *(the core)*

**Build:**
- Queue engine as a **pure TypeScript function** — `pickNextMatch(waitingPlayers, recentMatches, opts)` — ranking by wait time, balancing skill tiers across teams, penalizing recent partners and opponents.
- **Court diagram component** (SVG): net, service boxes, four positioned avatars, live timer.
- Court cards with `End match · enter score` and `Cancel match · undo start`.
- Queue list with position numbers, avatars, tier pills, and "You're in the queue" self-indicator.
- Host actions: start next match, end match, swap players in the suggested lineup before starting, add player, remove player.
- Full rotation on match end — all four requeue.
- Player states: waiting, playing, resting, left; late arrivals join mid-session.
- Session header strip: LIVE badge, join code, and the players/courts/in-queue/matches stat row.
- Realtime propagation to every connected device.

**Verify:**
- Unit tests: no player waits two full rounds while another plays twice; teams are tier-balanced; immediate rematches avoided.
- **Run a real session** — 2 courts, 10+ players, a full night, no clipboard.
- A host override before start is reflected on all devices.

---

### M3 — Scoring, rankings, and recap

**Build:** Tap-based score entry (to 11, win by 2, validated) · session standings ranked by adjusted win rate with point differential as tiebreak · **"Session wrapped!" recap** with a 1-2-3 podium, session totals (duration, matches, players, courts), and a shareable link · `allow_player_scoring` toggle with host correction.

Adjusted win rate is Bayesian shrinkage — `(wins + k·0.5) / (games + k)`, `k ≈ 5` — so a 1–0 player doesn't outrank a 12–3 player. One line of math, one unit test.

No medal icons in the live rankings list, no XP, no levels, no badges — per your scope decision, the podium is the only celebration surface.

**Verify:**
- Hand-calculate standings for one real session; the app must match exactly.
- An invalid score (11–10) is rejected.
- The recap link opens for a player who wasn't the host.

---

### M4 — Payments ledger

**Build:** Flat session fee set at creation · a ledger entry generated per attending player · host collection sheet with paid/unpaid toggle and partial payments · per-member balance across sessions · club-wide dues overview with total outstanding · paid/unpaid/players summary tiles.

**Verify:**
- Reconcile one real session's collections against cash on hand — totals must match.
- A player sees their own balance and cannot edit it.

---

### M5 — Home view & player profiles

**Build:** Home dashboard — greeting, Host session / Join with code, your player card on a dark hero surface, live session card, unpaid balance · player profile with all-time adjusted win rate, games played, wins, losses, tier, and activity totals · match history · club leaderboard.

The club leaderboard lives on the club screen, not on Profile — club-scoped data on the club screen, with Profile linking across. Profile's stats are scoped to one club (a rating only means something against the people you actually play); a club selector appears only for someone in more than one.

**Verify:**
- `node verify-m5.mjs` — cross-session reads stay inside one club, a non-member reads nothing, and the record matches a hand calculation.
- Three club members on their own phones each answer "am I next?" and "what's my record?" in under 5 seconds, unprompted.

---

### M6 — Polish & PWA

**Build:** PWA manifest and icons, offline shell, install prompt · loading/empty/error states everywhere · reconnecting indicator · accessibility pass (contrast, focus, touch targets, reduced motion) · performance check on a mid-range Android.

An audit before starting found this was not a cosmetic pass. What it actually fixed:

- **Home blanked the whole app on any load error** — it rendered an `ErrorNote` and then dereferenced the data that failed to arrive, with no error boundary to catch it.
- **Eight writes failed silently** (start/end session, scoring toggle, cancel match, sit out, I'm back, remove player, add player). All followed `setBusy(true); await write(); reload(); setBusy(false)` with no `try`, so a rejection left the control permanently dead and said nothing. Replaced by one `useAction` hook rather than eight `try`/`catch` blocks.
- **No connection state existed.** `.subscribe()` took no status callback, so a dropped socket looked exactly like a quiet night. It is now visible, and coming back up forces a refetch — the correctness half, since whatever changed while the socket was down is what is now wrong on screen.
- **One score save fired ~63 requests** (nine realtime events × a seven-request refetch). Debouncing the callback in `watchSession` collapses it to 7.
- **The favicon was still the purple Vite logo**, and 366KB of Devanagari Poppins subsets were being shipped to a Philippine club.

**Decisions:** offline is shell-only with an honest "can't reach the club" state, matching the locked *assume online* connectivity decision — no offline writes and no stale data presented as truth. Everything is hand-rolled; no PWA plugin, no image library, no test-environment change.

`navigator.onLine` is deliberately **not** the only signal: it reports true for any network interface, so gym wifi that connects but stops routing looks perfectly online while every request fails. A failed request is what the UI actually keys off (`isUnreachable`).

**Verify:**
- `npm test` — 70 checks, including the debounce and the unreachable-error classifier.
- `npm run icons` — regenerates the icons from `KQ Logo.png` and asserts each file it writes.
- Installs to home screen on iOS and Android, launches without browser chrome.
- Deploy, open the installed app, deploy again, relaunch — the new build must appear. This is the one service-worker failure that matters.
- Full session run-through on a mid-range phone without jank.

---

### Deferred

- **Recurring session schedules** — **decided out.** Sessions are created ad hoc; the `scheduled_at` column stays for later.
- **RSVP / attendance cap** — parked with the above. The `rsvps` table and `attendance_cap` column exist and are unused.
- **Avatar moderation** — photo upload shipped (public `avatars` bucket, writes scoped to your own `auth.uid()/` folder, 2MB, WebP). There is no reporting or takedown path: the only way a photo comes down is the person who uploaded it removing it. A club that needs more than that needs a host-side takedown and somewhere for reports to land.
- **Guest photos** — a guest has no auth identity, so they cannot upload and nobody can upload for them. They keep initials until they claim their account.
- **Native wrap** via Capacitor once the web app is proven in real use.
- Tournament brackets, push notifications, XP/badges. Not in scope.

---

## Risks

1. **The queue engine is the whole product.** If rotation feels unfair, the club stops using the app regardless of how it looks. Tests plus a real-session trial before anything is built on top.
2. **The bright yellow-green is a contrast trap.** `#7CB518` fails AA against white. The token split (`BRAND` vs `PRIMARY`) exists solely to prevent this, and M0.5 ships a test that enforces it.
3. **Skill tiers are subjective.** Host-editable and visible, so they can be corrected in the moment.
4. **Anonymous auth ties a player to a device.** Clearing browser data loses their identity until they claim an account. Prompt long-term members to claim a profile once they have stats worth keeping.
5. **Ledger accuracy depends on host discipline.** The app can't know cash changed hands; the collection sheet is designed to be filled in during the session.

---

## Verification philosophy

Every milestone is verified by **running a real club session**, not only by tests. Unit tests cover the three places where correctness is genuinely non-obvious: the matchmaking engine, the rating math, and the palette contrast pairs. Everything else is verified by using it on a court.
