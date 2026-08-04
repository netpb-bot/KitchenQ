/**
 * End-to-end check of the M2 match lifecycle against the live Supabase project.
 * Creates a throwaway club, joins six anonymous players, then exercises every
 * rule the RPCs are supposed to enforce. Deletes the club on the way out.
 *
 * Run: node verify-m2.mjs
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

/** Asserts an RPC is rejected, and that the message is the one we wrote. */
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

const run = async () => {
  console.log('\nM2 match lifecycle — live verification\n')

  const host = await anonClient()
  const stamp = Date.now()

  // ---------------------------------------------------------------- setup
  const { data: clubId, error: clubErr } = await host.rpc('create_club', {
    club_name: `M2 verification ${stamp}`,
    club_slug: `m2-verify-${stamp}`,
    owner_name: 'Host',
  })
  if (clubErr) throw new Error(`create_club: ${clubErr.message}`)

  const { data: session, error: sessErr } = await host
    .from('sessions')
    .insert({
      club_id: clubId,
      name: 'Verification session',
      join_code: `V${String(stamp).slice(-5)}`,
      court_count: 2,
      target_score: 11,
      win_by: 2,
    })
    .select('id, join_code')
    .single()
  if (sessErr) throw new Error(`create session: ${sessErr.message}`)

  const code = session.join_code

  // The host joins their own session, then five more players arrive.
  await host.rpc('join_session', { code, player_name: 'Host' })
  const guests = []
  for (const name of ['Ana', 'Ben', 'Cara', 'Dan', 'Eve']) {
    const client = await anonClient()
    const { error } = await client.rpc('join_session', { code, player_name: name })
    if (error) throw new Error(`join_session (${name}): ${error.message}`)
    guests.push({ name, client })
  }

  const roster = async () =>
    (
      await host
        .from('session_players')
        .select('club_member_id, status, games_played')
        .eq('session_id', session.id)
    ).data

  check('six players joined by code', (await roster()).length === 6)

  // ------------------------------------------------- starting requires live
  const waiting = (await roster()).map((p) => p.club_member_id)
  await rejects(
    'a match cannot start before the session is live',
    host.rpc('start_match', {
      target_session: session.id,
      court: 1,
      team_a: waiting.slice(0, 2),
      team_b: waiting.slice(2, 4),
    }),
    'not live',
  )

  await host.from('sessions').update({ status: 'live' }).eq('id', session.id)

  // ----------------------------------------------------- permission checks
  await rejects(
    'a player cannot start a match',
    guests[0].client.rpc('start_match', {
      target_session: session.id,
      court: 1,
      team_a: waiting.slice(0, 2),
      team_b: waiting.slice(2, 4),
    }),
    'only the host',
  )

  await rejects(
    'a court outside the session is refused',
    host.rpc('start_match', {
      target_session: session.id,
      court: 9,
      team_a: waiting.slice(0, 2),
      team_b: waiting.slice(2, 4),
    }),
    'not in this session',
  )

  await rejects(
    'the same player cannot fill two slots',
    host.rpc('start_match', {
      target_session: session.id,
      court: 1,
      team_a: [waiting[0], waiting[1]],
      team_b: [waiting[0], waiting[2]],
    }),
    'twice',
  )

  // ------------------------------------------------------- starting a match
  const { data: matchId, error: startErr } = await host.rpc('start_match', {
    target_session: session.id,
    court: 1,
    team_a: waiting.slice(0, 2),
    team_b: waiting.slice(2, 4),
  })
  check('the host starts a match', !startErr, startErr?.message)

  const playing = (await roster()).filter((p) => p.status === 'playing')
  check('all four players flip to playing', playing.length === 4)

  await rejects(
    'a player already on court cannot be put on another',
    host.rpc('start_match', {
      target_session: session.id,
      court: 2,
      team_a: [waiting[0], waiting[4]],
      team_b: [waiting[5], waiting[1]],
    }),
    'no longer all in the queue',
  )

  // --------------------------------------------------------- score validation
  await rejects(
    'a score below the target is refused',
    host.rpc('end_match', { target_match: matchId, score_a: 9, score_b: 5 }),
    'must reach 11',
  )
  await rejects(
    'a one-point win is refused',
    host.rpc('end_match', { target_match: matchId, score_a: 11, score_b: 10 }),
    'win by 2',
  )
  await rejects(
    'an impossible margin past the target is refused',
    host.rpc('end_match', { target_match: matchId, score_a: 15, score_b: 5 }),
    'lead reaches',
  )
  await rejects(
    'a player cannot record the score while self-scoring is off',
    guests[0].client.rpc('end_match', {
      target_match: matchId,
      score_a: 11,
      score_b: 9,
    }),
    'only the host',
  )

  // ---------------------------------------------------------- ending a match
  const { error: endErr } = await host.rpc('end_match', {
    target_match: matchId,
    score_a: 11,
    score_b: 9,
  })
  check('the host records a valid score', !endErr, endErr?.message)

  const after = await roster()
  const played = after.filter((p) => p.games_played === 1)
  check('full rotation: all four requeue', after.every((p) => p.status === 'waiting'))
  check('all four are credited with one game', played.length === 4)

  await rejects(
    'a finished match cannot be scored twice',
    host.rpc('end_match', { target_match: matchId, score_a: 11, score_b: 3 }),
    'already finished',
  )

  // -------------------------------------------------------------- cancelling
  const fresh = after.filter((p) => p.games_played === 0).map((p) => p.club_member_id)
  const rest = after.filter((p) => p.games_played === 1).map((p) => p.club_member_id)
  const { data: secondMatch } = await host.rpc('start_match', {
    target_session: session.id,
    court: 2,
    team_a: [fresh[0], fresh[1]],
    team_b: [rest[0], rest[1]],
  })
  const { error: cancelErr } = await host.rpc('cancel_match', { target_match: secondMatch })
  check('the host cancels a mis-started match', !cancelErr, cancelErr?.message)

  const afterCancel = await roster()
  check(
    'cancelling returns everyone to the queue',
    afterCancel.every((p) => p.status === 'waiting'),
  )
  check(
    'a cancelled match costs nobody a game',
    afterCancel.filter((p) => p.games_played === 1).length === 4,
  )
  const { count: matchCount } = await host
    .from('matches')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', session.id)
  check('a cancelled match leaves no record', matchCount === 1)

  // ------------------------------------------------------------ owner guard
  const { data: hostMember } = await host
    .from('club_members')
    .select('id')
    .eq('club_id', clubId)
    .eq('role', 'owner')
    .single()
  const { error: demoteErr } = await host
    .from('club_members')
    .update({ role: 'member' })
    .eq('id', hostMember.id)
  check(
    'the club owner cannot be demoted',
    Boolean(demoteErr),
    demoteErr ? '' : 'the update succeeded',
  )

  // ---------------------------------------------------------------- teardown
  const { error: delErr } = await host.from('clubs').delete().eq('id', clubId)
  check('the owner can delete the club', !delErr, delErr?.message)

  console.log(`\n${passed} passed, ${failed} failed\n`)
  process.exit(failed === 0 ? 0 : 1)
}

run().catch((e) => {
  console.error(`\nABORTED: ${e.message}\n`)
  process.exit(1)
})
