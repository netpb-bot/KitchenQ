import { useEffect, useState } from 'react'
import { supabase } from './supabase'

/* -------------------------------------------------------------------- types */

export const TIERS = ['beginner', 'intermediate', 'advanced'] as const
export type Tier = (typeof TIERS)[number]

/** The tier enum is lowercase; it must never reach a screen unlabelled. */
export const TIER_LABEL: Record<Tier, string> = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
}

/** For the badge that overlaps an avatar, where there is room for three characters. */
export const TIER_SHORT: Record<Tier, string> = {
  beginner: 'BEG',
  intermediate: 'INT',
  advanced: 'ADV',
}
export type Role = 'owner' | 'admin' | 'member'
export type SessionStatus = 'draft' | 'live' | 'ended'

export type Club = { id: string; name: string; slug: string; currency: string }

export type Member = {
  id: string
  club_id: string
  user_id: string | null
  display_name: string
  skill_tier: Tier
  role: Role
}

export type Session = {
  id: string
  club_id: string
  name: string
  join_code: string
  status: SessionStatus
  court_count: number
  target_score: number
  win_by: number
  fee_amount: number
  allow_player_scoring: boolean
  started_at: string | null
  ended_at: string | null
}

export type PlayerStatus = 'waiting' | 'playing' | 'resting' | 'left'

export type SessionPlayer = {
  id: string
  status: PlayerStatus
  games_played: number
  queued_at: string
  club_members: Pick<Member, 'id' | 'display_name' | 'skill_tier' | 'role' | 'user_id'>
}

export type Match = {
  id: string
  session_id: string
  court_number: number
  team_a_ids: string[]
  team_b_ids: string[]
  score_a: number | null
  score_b: number | null
  started_at: string
  ended_at: string | null
}

export type PaymentStatus = 'unpaid' | 'partial' | 'paid'

export type LedgerEntry = {
  id: string
  session_id: string
  club_member_id: string
  amount_due: number
  amount_paid: number
  status: PaymentStatus
}

/** Unwrap a PostgREST response, turning its error into a throw. */
function ok<T>(res: { data: unknown; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message)
  return res.data as T
}

/* --------------------------------------------------------------------- auth */

let session: Promise<string> | null = null

/**
 * One anonymous sign-in per browser, shared by every caller. The player gets a
 * real auth identity so RLS can scope them; they can claim an account later.
 */
export function ensureSession(): Promise<string> {
  session ??= (async () => {
    const { data } = await supabase.auth.getSession()
    if (data.session) return data.session.user.id
    const { data: signed, error } = await supabase.auth.signInAnonymously()
    if (error) throw new Error(error.message)
    return signed.user!.id
  })()
  return session
}

/* -------------------------------------------------------------------- clubs */

export async function listClubs(): Promise<Club[]> {
  await ensureSession()
  return ok(await supabase.from('clubs').select('id, name, slug, currency').order('name'))
}

export async function getClub(clubId: string): Promise<Club> {
  await ensureSession()
  return ok(
    await supabase.from('clubs').select('id, name, slug, currency').eq('id', clubId).single(),
  )
}

export async function createClub(name: string, ownerName: string): Promise<string> {
  await ensureSession()
  const slug =
    name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) ||
    'club'
  // Slugs are globally unique; a suffix keeps two clubs with the same name apart.
  const suffix = Math.random().toString(36).slice(2, 6)
  return ok(
    await supabase.rpc('create_club', {
      club_name: name.trim(),
      club_slug: `${slug}-${suffix}`,
      owner_name: ownerName.trim(),
    }),
  )
}

/** Club money, in the club's own currency. */
export function money(amount: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount)
}

/**
 * Wall-clock length of a session, as "1h 45m". Em dash if it never started.
 * Counts up to now while the session is still running, which is what both the
 * recap and Home's live bar want.
 */
export function duration(session: Session): string {
  if (!session.started_at) return '—'
  const end = session.ended_at ? new Date(session.ended_at) : new Date()
  const minutes = Math.max(
    0,
    Math.round((end.getTime() - new Date(session.started_at).getTime()) / 60000),
  )
  const hours = Math.floor(minutes / 60)
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`
}

/* ------------------------------------------------------------------ members */

const MEMBER_COLS = 'id, club_id, user_id, display_name, skill_tier, role'

export async function listMembers(clubId: string): Promise<Member[]> {
  await ensureSession()
  return ok(
    await supabase.from('club_members').select(MEMBER_COLS).eq('club_id', clubId).order('display_name'),
  )
}

/** Every club membership the caller has, newest first. */
export async function myMemberships(): Promise<Member[]> {
  const userId = await ensureSession()
  return ok(
    await supabase
      .from('club_members')
      .select(MEMBER_COLS)
      .eq('user_id', userId)
      .order('created_at', { ascending: false }),
  )
}

/** The caller's own membership in a club, or null if they haven't joined it. */
export async function myMember(clubId: string): Promise<Member | null> {
  const userId = await ensureSession()
  return ok(
    await supabase
      .from('club_members')
      .select(MEMBER_COLS)
      .eq('club_id', clubId)
      .eq('user_id', userId)
      .maybeSingle(),
  )
}

export function isAdmin(member: Member | null): boolean {
  return member?.role === 'owner' || member?.role === 'admin'
}

/**
 * A guest is a member the host typed in for someone without a phone. They queue,
 * play and owe fees like anyone else; they just can't act for themselves.
 */
export function isGuest(member: { user_id: string | null }): boolean {
  return member.user_id === null
}

export async function createGuest(
  clubId: string,
  name: string,
  tier: Tier = 'intermediate',
): Promise<Member> {
  await ensureSession()
  return ok(
    await supabase
      .from('club_members')
      .insert({ club_id: clubId, display_name: name.trim(), skill_tier: tier })
      .select(MEMBER_COLS)
      .single(),
  )
}

/** Guests nobody has taken over yet — the candidates on the join screen. */
export async function listUnclaimedGuests(clubId: string): Promise<Member[]> {
  await ensureSession()
  return ok(
    await supabase
      .from('club_members')
      .select(MEMBER_COLS)
      .eq('club_id', clubId)
      .eq('role', 'member')
      .is('user_id', null)
      .order('display_name'),
  )
}

/** Takes over a guest row, keeping its name and its whole match record. */
export async function claimMember(code: string, memberId: string): Promise<string> {
  await ensureSession()
  return ok(
    await supabase.rpc('claim_member', {
      code: code.trim(),
      target_member: memberId,
    }),
  )
}

export async function updateMember(
  memberId: string,
  patch: { role?: Role; skill_tier?: Tier; display_name?: string },
): Promise<void> {
  ok(await supabase.from('club_members').update(patch).eq('id', memberId))
}

/* ----------------------------------------------------------------- sessions */

const SESSION_COLS =
  'id, club_id, name, join_code, status, court_count, target_score, win_by, fee_amount, allow_player_scoring, started_at, ended_at'

// No I/O/0/1 — these get read aloud across a gym and typed on a phone.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function randomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('')
}

export async function listSessions(clubId: string): Promise<Session[]> {
  await ensureSession()
  return ok(
    await supabase
      .from('sessions')
      .select(SESSION_COLS)
      .eq('club_id', clubId)
      .order('created_at', { ascending: false }),
  )
}

/** Sessions still open across every club the caller belongs to. */
export async function listOpenSessions(clubIds: string[]): Promise<Session[]> {
  if (clubIds.length === 0) return []
  return ok(
    await supabase
      .from('sessions')
      .select(SESSION_COLS)
      .in('club_id', clubIds)
      .neq('status', 'ended')
      .order('created_at', { ascending: false }),
  )
}

/**
 * Resolve a join code before joining, so the join screen can offer the club's
 * unclaimed guests. Null when the code doesn't match anything yet.
 */
export async function findSessionByCode(code: string): Promise<Session | null> {
  await ensureSession()
  return ok(
    await supabase
      .from('sessions')
      .select(SESSION_COLS)
      .eq('join_code', code.trim().toUpperCase())
      .maybeSingle(),
  )
}

export async function getSession(sessionId: string): Promise<Session> {
  await ensureSession()
  return ok(await supabase.from('sessions').select(SESSION_COLS).eq('id', sessionId).single())
}

export async function createSession(input: {
  club_id: string
  name: string
  court_count: number
  fee_amount: number
}): Promise<Session> {
  await ensureSession()
  // 32^6 codes makes a collision vanishingly unlikely, but the column is unique
  // and a retry is cheaper than reasoning about the odds.
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await supabase
      .from('sessions')
      .insert({ ...input, join_code: randomCode() })
      .select(SESSION_COLS)
      .single()
    if (!res.error) return res.data as Session
    if (res.error.code !== '23505') throw new Error(res.error.message)
  }
  throw new Error('Could not generate a free join code. Try again.')
}

export async function setSessionStatus(
  sessionId: string,
  status: SessionStatus,
): Promise<void> {
  const stamp =
    status === 'live'
      ? { started_at: new Date().toISOString() }
      : status === 'ended'
        ? { ended_at: new Date().toISOString() }
        : {}
  ok(await supabase.from('sessions').update({ status, ...stamp }).eq('id', sessionId))
}

/**
 * Undo an accidental "End session". Deliberately not setSessionStatus('live'):
 * that stamps a fresh started_at, which would reset the recap's duration and
 * make a night that ran three hours read as one minute.
 */
export async function reopenSession(sessionId: string): Promise<void> {
  ok(await supabase.from('sessions').update({ status: 'live', ended_at: null }).eq('id', sessionId))
}

/**
 * The fee is a guess when the session is created and the truth once someone is
 * holding cash. A change re-prices every unpaid line through the trigger in
 * 0007; lines with money already recorded against them keep what was collected.
 */
export async function setSessionFee(sessionId: string, amount: number): Promise<void> {
  const fee = Math.max(0, Math.round(amount * 100) / 100)
  ok(await supabase.from('sessions').update({ fee_amount: fee }).eq('id', sessionId))
}

/** Session toggle: let the players on court record their own score. */
export async function setPlayerScoring(sessionId: string, allow: boolean): Promise<void> {
  ok(await supabase.from('sessions').update({ allow_player_scoring: allow }).eq('id', sessionId))
}

/**
 * Courts open or close mid-session all the time — a group leaves, the club
 * hands over a spare. Clamped to the same 1–12 the create form uses.
 *
 * Shrinking below a court with a live match on it is refused rather than
 * silently orphaning that match: the diagram is keyed on court number, so the
 * match would simply stop being rendered while still holding four players.
 */
export async function setCourtCount(sessionId: string, count: number): Promise<void> {
  const courts = Math.min(12, Math.max(1, Math.round(count)))
  const live = ok<{ court_number: number }[]>(
    await supabase
      .from('matches')
      .select('court_number')
      .eq('session_id', sessionId)
      .is('ended_at', null),
  )
  const highest = live.reduce((max, m) => Math.max(max, m.court_number), 0)
  if (courts < highest) {
    throw new Error(`Court ${highest} still has a match on it. End it first.`)
  }
  ok(await supabase.from('sessions').update({ court_count: courts }).eq('id', sessionId))
}

/** Returns the session id so the caller can navigate straight into it. */
export async function joinSession(code: string, playerName: string): Promise<string> {
  await ensureSession()
  return ok(
    await supabase.rpc('join_session', { code: code.trim(), player_name: playerName.trim() }),
  )
}

export async function listSessionPlayers(sessionId: string): Promise<SessionPlayer[]> {
  await ensureSession()
  return ok(
    await supabase
      .from('session_players')
      .select(
        'id, status, games_played, queued_at, club_members(id, display_name, skill_tier, role, user_id)',
      )
      .eq('session_id', sessionId)
      .order('queued_at'),
  )
}

export async function setPlayerStatus(
  sessionPlayerId: string,
  status: PlayerStatus,
): Promise<void> {
  ok(await supabase.from('session_players').update({ status }).eq('id', sessionPlayerId))
}

/** Host adds a club member who is present but hasn't joined on their phone. */
export async function addPlayer(sessionId: string, clubMemberId: string): Promise<void> {
  ok(
    await supabase
      .from('session_players')
      .upsert(
        { session_id: sessionId, club_member_id: clubMemberId, status: 'waiting' },
        { onConflict: 'session_id,club_member_id' },
      ),
  )
}

/* ------------------------------------------------------------------ matches */

const MATCH_COLS =
  'id, session_id, court_number, team_a_ids, team_b_ids, score_a, score_b, started_at, ended_at'

export async function listMatches(sessionId: string): Promise<Match[]> {
  await ensureSession()
  return ok(
    await supabase
      .from('matches')
      .select(MATCH_COLS)
      .eq('session_id', sessionId)
      .order('started_at', { ascending: false }),
  )
}

/**
 * Every finished match in the club, newest first — the basis for all-time
 * standings and a player's record. RLS already lets any club member read these
 * (`matches_read`); the `sessions` embed is only there so the club filter has
 * something to filter on, exactly as in `listClubLedger`.
 */
// ponytail: the whole history in one fetch. A club past ~5k matches wants a SQL
// aggregate view instead — but truncating here would silently understate
// someone's record, which is worse than a large response.
export async function listClubMatches(clubId: string): Promise<Match[]> {
  await ensureSession()
  return ok(
    await supabase
      .from('matches')
      .select(`${MATCH_COLS}, sessions!inner(club_id)`)
      .eq('sessions.club_id', clubId)
      .not('ended_at', 'is', null)
      .order('ended_at', { ascending: false }),
  )
}

export async function startMatch(
  sessionId: string,
  court: number,
  teamA: string[],
  teamB: string[],
): Promise<string> {
  return ok(
    await supabase.rpc('start_match', {
      target_session: sessionId,
      court,
      team_a: teamA,
      team_b: teamB,
    }),
  )
}

export async function endMatch(
  matchId: string,
  scoreA: number,
  scoreB: number,
): Promise<void> {
  ok(await supabase.rpc('end_match', { target_match: matchId, score_a: scoreA, score_b: scoreB }))
}

/** Host-only fix to a score already recorded. Doesn't touch games played. */
export async function correctMatch(
  matchId: string,
  scoreA: number,
  scoreB: number,
): Promise<void> {
  ok(
    await supabase.rpc('correct_match', {
      target_match: matchId,
      score_a: scoreA,
      score_b: scoreB,
    }),
  )
}

export async function cancelMatch(matchId: string): Promise<void> {
  ok(await supabase.rpc('cancel_match', { target_match: matchId }))
}

/* ------------------------------------------------------------------- ledger */

const LEDGER_COLS = 'id, session_id, club_member_id, amount_due, amount_paid, status'

/**
 * Entries are created and priced by database triggers (see 0007) — the client
 * only ever reads them and records what was collected.
 */
export async function listLedger(sessionId: string): Promise<LedgerEntry[]> {
  await ensureSession()
  return ok(
    await supabase.from('ledger_entries').select(LEDGER_COLS).eq('session_id', sessionId),
  )
}

/** What the host actually took. `status` is derived by the database. */
export async function recordPayment(entryId: string, amountPaid: number): Promise<void> {
  ok(await supabase.from('ledger_entries').update({ amount_paid: amountPaid }).eq('id', entryId))
}

/**
 * Several lines as one user action — settling the room at the end of the night,
 * or putting all of it back when the host undoes that.
 */
export async function recordPayments(
  updates: { id: string; amount: number }[],
): Promise<void> {
  // ponytail: one request per line, and a line is a player. Batch into an RPC
  // only if a thirty-player session measurably drags.
  await Promise.all(updates.map((u) => recordPayment(u.id, u.amount)))
}

/**
 * The lines a "settle everyone" sweep should touch: anyone still short, partial
 * payments included — a half-paid line is exactly the one the host is chasing.
 * Returns what to write, so the caller can capture the amounts it replaces.
 */
export function unsettled(rows: LedgerEntry[]): { id: string; amount: number }[] {
  return rows
    .filter((e) => e.amount_paid < e.amount_due)
    .map((e) => ({ id: e.id, amount: e.amount_due }))
}

/**
 * Every entry across the club's sessions. RLS does the scoping for us: a host
 * gets the whole club, a member gets only their own rows. The `sessions` embed
 * is there purely so the club filter has something to filter on.
 */
export async function listClubLedger(clubId: string): Promise<LedgerEntry[]> {
  await ensureSession()
  return ok(
    await supabase
      .from('ledger_entries')
      .select(`${LEDGER_COLS}, sessions!inner(club_id)`)
      .eq('sessions.club_id', clubId),
  )
}

/**
 * The caller's own ledger lines across every club they belong to. The
 * `club_member_id` filter is load-bearing, not decorative: a host also matches
 * `ledger_admin_all`, so without it this would return the whole club's rows and
 * report someone else's debt as theirs.
 */
export async function listMyLedger(memberIds: string[]): Promise<LedgerEntry[]> {
  if (memberIds.length === 0) return []
  await ensureSession()
  return ok(
    await supabase.from('ledger_entries').select(LEDGER_COLS).in('club_member_id', memberIds),
  )
}

/* ----------------------------------------------------------------- realtime */

/**
 * Trailing-edge debounce. One score save writes the match row, four
 * session_players rows and up to four ledger rows, so the four subscriptions
 * below see roughly nine events for a single tap — and each one would
 * otherwise cost a seven-request refetch on gym wifi.
 */
export function debounce(fn: () => void, ms: number): (() => void) & { cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined
  const run = () => {
    clearTimeout(timer)
    timer = setTimeout(fn, ms)
  }
  run.cancel = () => clearTimeout(timer)
  return run
}

export type Connection = 'connecting' | 'live' | 'dropped'

/**
 * Fires `onChange` on any roster or match change in this session — that covers
 * every screen the session tabs render, so one subscription is enough.
 *
 * `onConnection` is not decoration. A phone that screen-locks in a gym drops
 * the socket, and without this the session screen goes on rendering the last
 * roster it saw, looking perfectly healthy while two hosts diverge. Coming back
 * up also forces a refetch: whatever changed while the socket was down is
 * exactly what is now wrong on screen.
 */
export function watchSession(
  sessionId: string,
  onChange: () => void,
  onConnection?: (state: Connection) => void,
): () => void {
  const filter = `session_id=eq.${sessionId}`
  const changed = debounce(onChange, 250)
  let wasDropped = false

  const channel = supabase
    .channel(`session:${sessionId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'session_players', filter }, changed)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'matches', filter }, changed)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'ledger_entries', filter }, changed)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'sessions', filter: `id=eq.${sessionId}` }, changed)
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        onConnection?.('live')
        if (wasDropped) {
          wasDropped = false
          onChange()
        }
        return
      }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        wasDropped = true
        onConnection?.('dropped')
      }
    })

  return () => {
    changed.cancel()
    void supabase.removeChannel(channel)
  }
}

/* -------------------------------------------------------------------- hooks */

export type Async<T> = { loading: boolean; data?: T; error?: string }

/**
 * Load-on-mount with a manual reload. Supabase realtime already pushes updates,
 * so there is nothing here to cache or invalidate — hence no query library.
 */
export function useAsync<T>(
  load: () => Promise<T>,
  deps: unknown[],
): [Async<T>, () => void] {
  const [state, setState] = useState<Async<T>>({ loading: true })
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let live = true
    load().then(
      (data) => live && setState({ loading: false, data }),
      (e: unknown) =>
        live && setState({ loading: false, error: e instanceof Error ? e.message : String(e) }),
    )
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce])

  return [state, () => setNonce((n) => n + 1)]
}

/**
 * Runs one write, and makes its failure visible. Replaces the
 * `setBusy(true); await write(); reload(); setBusy(false)` shape that was
 * repeated across the session screens with no `try` — where a rejection meant
 * an unhandled promise, `setBusy(false)` never running, and a control that was
 * dead for the rest of the night with nothing on screen to say why.
 */
export function useAction(): [boolean, string, (work: () => Promise<unknown>) => void] {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const run = (work: () => Promise<unknown>) => {
    setBusy(true)
    setError('')
    work()
      .then(
        () => setError(''),
        (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
      )
      .finally(() => setBusy(false))
  }

  return [busy, error, run]
}

/** The player's own name, remembered so joining a second session is one tap. */
export const lastName = {
  get: () => localStorage.getItem('kq.name') ?? '',
  set: (name: string) => localStorage.setItem('kq.name', name.trim()),
}
