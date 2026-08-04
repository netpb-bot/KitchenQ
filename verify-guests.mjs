/**
 * End-to-end check of guest players against the live Supabase project.
 * Creates two throwaway clubs, exercises guest creation, play and claiming,
 * then deletes both. Run: node verify-guests.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)

const URL = env.VITE_SUPABASE_URL
const KEY = env.VITE_SUPABASE_ANON_KEY

let passed = 0
let failed = 0

function check(label, condition, detail = '') {
  if (condition) {
    passed++
    console.log(`  PASS  ${label}`)
  } else {
    failed++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

async function rejects(label, promise, expectedFragment) {
  const { error } = await promise
  if (!error) return check(label, false, 'the call succeeded')
  const matched = error.message.toLowerCase().includes(expectedFragment.toLowerCase())
  check(label, matched, `got "${error.message}"`)
}

async function anonClient() {
  const client = createClient(URL, KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error } = await client.auth.signInAnonymously()
  if (error) throw new Error(`anonymous sign-in failed: ${error.message}`)
  return client
}

/** A club with one live session, owned by `host`. */
async function makeClub(host, label, stamp) {
  const { data: clubId, error: clubErr } = await host.rpc('create_club', {
    club_name: `Guest verification ${label} ${stamp}`,
    club_slug: `guest-verify-${label}-${stamp}`,
    owner_name: 'Host',
  })
  if (clubErr) throw new Error(`create_club(${label}): ${clubErr.message}`)

  const code = `G${label}${String(stamp).slice(-4)}`.toUpperCase()
  const { data: session, error: sessErr } = await host
    .from('sessions')
    .insert({
      club_id: clubId,
      name: 'Verification session',
      join_code: code,
      status: 'live',
      court_count: 1,
      target_score: 11,
      win_by: 2,
    })
    .select('id, join_code')
    .single()
  if (sessErr) throw new Error(`create session(${label}): ${sessErr.message}`)

  return { clubId, sessionId: session.id, code: session.join_code }
}

const addGuest = (host, clubId, name) =>
  host
    .from('club_members')
    .insert({ club_id: clubId, display_name: name, skill_tier: 'intermediate' })
    .select('id, display_name, user_id, role')
    .single()

const run = async () => {
  console.log('\nGuest players — live verification\n')

  const stamp = Date.now()
  const host = await anonClient()
  const club = await makeClub(host, 'a', stamp)
  const other = await makeClub(host, 'b', stamp)

  // ------------------------------------------------------------- creation
  const { data: ana, error: anaErr } = await addGuest(host, club.clubId, 'Ana Guest')
  check('the host creates a guest', !anaErr, anaErr?.message)
  check('a guest has no auth user', ana?.user_id === null)

  const { error: dupErr } = await addGuest(host, club.clubId, 'Ben Guest')
  check('a second guest in the same club is allowed', !dupErr, dupErr?.message)

  const outsider = await anonClient()
  const { error: outsiderErr } = await addGuest(outsider, club.clubId, 'Intruder')
  check(
    'a non-admin cannot create a guest',
    Boolean(outsiderErr),
    outsiderErr ? '' : 'the insert succeeded',
  )

  // ------------------------------------------------------- guests can play
  const names = ['Cara Guest', 'Dan Guest']
  const extra = []
  for (const name of names) {
    const { data } = await addGuest(host, club.clubId, name)
    extra.push(data.id)
  }
  const { data: ben } = await host
    .from('club_members')
    .select('id')
    .eq('club_id', club.clubId)
    .eq('display_name', 'Ben Guest')
    .single()

  const four = [ana.id, ben.id, ...extra]
  await host
    .from('session_players')
    .insert(four.map((id) => ({ session_id: club.sessionId, club_member_id: id })))

  const { data: matchId, error: startErr } = await host.rpc('start_match', {
    target_session: club.sessionId,
    court: 1,
    team_a: four.slice(0, 2),
    team_b: four.slice(2, 4),
  })
  check('four guests can be put on court', !startErr, startErr?.message)

  const { error: scoreErr } = await host.rpc('end_match', {
    target_match: matchId,
    score_a: 11,
    score_b: 6,
  })
  check('a match of guests can be scored', !scoreErr, scoreErr?.message)

  const { data: afterPlay } = await host
    .from('session_players')
    .select('club_member_id, status, games_played')
    .eq('session_id', club.sessionId)
  check(
    'guests are credited and requeued like anyone else',
    afterPlay.every((p) => p.games_played === 1 && p.status === 'waiting'),
  )

  // -------------------------------------------------------------- claiming
  await rejects(
    'a guest cannot be claimed with another club’s code',
    outsider.rpc('claim_member', { code: other.code, target_member: ana.id }),
    'not in this club',
  )

  await rejects(
    'somebody already in the club cannot claim a guest',
    host.rpc('claim_member', { code: club.code, target_member: ana.id }),
    'already in this club',
  )

  const { data: adminGhost } = await addGuest(host, club.clubId, 'Orphaned Admin')
  await host.from('club_members').update({ role: 'admin' }).eq('id', adminGhost.id)
  const stranger = await anonClient()
  await rejects(
    'an unclaimed admin row cannot be claimed into its role',
    stranger.rpc('claim_member', { code: club.code, target_member: adminGhost.id }),
    'cannot be claimed',
  )

  const realAna = await anonClient()
  const { error: claimErr } = await realAna.rpc('claim_member', {
    code: club.code,
    target_member: ana.id,
  })
  check('the real player claims their guest row', !claimErr, claimErr?.message)

  const { data: claimed } = await host
    .from('club_members')
    .select('id, display_name, user_id')
    .eq('id', ana.id)
    .single()
  check('claiming attaches an auth user', claimed.user_id !== null)
  check('claiming keeps the name', claimed.display_name === 'Ana Guest')

  const { data: anaPlayer } = await host
    .from('session_players')
    .select('games_played')
    .eq('session_id', club.sessionId)
    .eq('club_member_id', ana.id)
    .single()
  check('claiming keeps the match record', anaPlayer.games_played === 1)

  await rejects(
    'the same guest cannot be claimed twice',
    stranger.rpc('claim_member', { code: club.code, target_member: ana.id }),
    'already been claimed',
  )

  // Joining after claiming must not create a second membership.
  const { error: rejoinErr } = await realAna.rpc('join_session', {
    code: club.code,
    player_name: 'Ana Guest',
  })
  check('the claimer can join the session', !rejoinErr, rejoinErr?.message)

  const { count: anaRows } = await host
    .from('club_members')
    .select('id', { count: 'exact', head: true })
    .eq('club_id', club.clubId)
    .eq('display_name', 'Ana Guest')
  check('joining after a claim creates no duplicate membership', anaRows === 1)

  const { data: unclaimed } = await host
    .from('club_members')
    .select('id')
    .eq('club_id', club.clubId)
    .is('user_id', null)
    .eq('role', 'member')
  check('the claimed guest drops off the unclaimed list', !unclaimed.some((m) => m.id === ana.id))

  // -------------------------------------------------------------- teardown
  const { error: d1 } = await host.from('clubs').delete().eq('id', club.clubId)
  const { error: d2 } = await host.from('clubs').delete().eq('id', other.clubId)
  check('both verification clubs are deleted', !d1 && !d2, d1?.message ?? d2?.message)

  console.log(`\n${passed} passed, ${failed} failed\n`)
  process.exit(failed === 0 ? 0 : 1)
}

run().catch((e) => {
  console.error(`\nABORTED: ${e.message}\n`)
  process.exit(1)
})
