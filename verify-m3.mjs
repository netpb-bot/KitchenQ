/**
 * End-to-end check of M3 scoring against the live Supabase project: the
 * `allow_player_scoring` toggle and the `correct_match` RPC. Creates a
 * throwaway club, plays real matches, and deletes the club on the way out.
 *
 * The ranking math is NOT checked here — it is pure and lives in
 * src/lib/standings.test.ts. What this proves is the boundary: who may record
 * a score, who may change one afterwards, and that a correction survives a
 * round trip so the standings computed from it are computed from the truth.
 *
 * Run: node verify-m3.mjs
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

// Mirrors SESSION_COLS in src/lib/db.ts. Every session screen selects exactly
// this list, so a column renamed in the schema breaks all of them at once.
const SESSION_COLS =
  'id, club_id, name, join_code, status, court_count, target_score, win_by, fee_amount, allow_player_scoring, started_at, ended_at'

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
  console.log('\nM3 scoring — live verification\n')

  const host = await anonClient()
  const stamp = Date.now()

  // ------------------------------------------------------------------ setup
  const { data: clubId, error: clubErr } = await host.rpc('create_club', {
    club_name: `M3 verification ${stamp}`,
    club_slug: `m3-verify-${stamp}`,
    owner_name: 'Host',
  })
  if (clubErr) throw new Error(`create_club: ${clubErr.message}`)

  const { data: session, error: sessErr } = await host
    .from('sessions')
    .insert({
      club_id: clubId,
      name: 'Scoring verification',
      join_code: `S${String(stamp).slice(-5)}`,
      court_count: 2,
      target_score: 11,
      win_by: 2,
    })
    .select(SESSION_COLS)
    .single()
  if (sessErr) throw new Error(`create session: ${sessErr.message}`)
  check('every column the session screens read exists', Boolean(session.id))
  check('a new session starts with player scoring off', session.allow_player_scoring === false)

  const code = session.join_code
  await host.rpc('join_session', { code, player_name: 'Host' })
  const players = []
  for (const name of ['Ana', 'Ben', 'Cara', 'Dan', 'Eve']) {
    const client = await anonClient()
    const { error } = await client.rpc('join_session', { code, player_name: name })
    if (error) throw new Error(`join_session (${name}): ${error.message}`)
    players.push({ name, client })
  }
  // Mirrors setSessionStatus: going live stamps started_at, which the recap's
  // duration is measured from.
  await host
    .from('sessions')
    .update({ status: 'live', started_at: new Date().toISOString() })
    .eq('id', session.id)

  const roster = async () =>
    (
      await host
        .from('session_players')
        .select('club_member_id, status, games_played')
        .eq('session_id', session.id)
    ).data

  const readMatch = async (id) =>
    (await host.from('matches').select('score_a, score_b, ended_at').eq('id', id).single()).data

  const start = async (court, ids) => {
    const { data, error } = await host.rpc('start_match', {
      target_session: session.id,
      court,
      team_a: ids.slice(0, 2),
      team_b: ids.slice(2, 4),
    })
    if (error) throw new Error(`start_match: ${error.message}`)
    return data
  }

  const ids = (await roster()).map((p) => p.club_member_id)

  // ------------------------------------------------ correcting a live match
  const live = await start(1, ids.slice(0, 4))
  await rejects(
    'a match still being played cannot be corrected',
    host.rpc('correct_match', { target_match: live, score_a: 11, score_b: 4 }),
    'has not finished yet',
  )

  const { error: endErr } = await host.rpc('end_match', {
    target_match: live,
    score_a: 11,
    score_b: 4,
  })
  check('the host records a score', !endErr, endErr?.message)

  // ---------------------------------------------------------- correct_match
  await rejects(
    'a player cannot correct a recorded score',
    players[0].client.rpc('correct_match', {
      target_match: live,
      score_a: 4,
      score_b: 11,
    }),
    'only the host',
  )
  await rejects(
    'a correction obeys the win-by rule',
    host.rpc('correct_match', { target_match: live, score_a: 11, score_b: 10 }),
    'win by 2',
  )
  await rejects(
    'a correction obeys the target score',
    host.rpc('correct_match', { target_match: live, score_a: 9, score_b: 2 }),
    'must reach 11',
  )
  await rejects(
    'a correction rejects an impossible margin past the target',
    host.rpc('correct_match', { target_match: live, score_a: 14, score_b: 4 }),
    'lead reaches',
  )

  const beforeFix = await roster()
  const { error: fixErr } = await host.rpc('correct_match', {
    target_match: live,
    score_a: 4,
    score_b: 11,
  })
  check('the host corrects a mistyped score', !fixErr, fixErr?.message)

  const fixed = await readMatch(live)
  check(
    'the corrected score is what reads back',
    fixed.score_a === 4 && fixed.score_b === 11,
    `got ${fixed.score_a}–${fixed.score_b}`,
  )
  check('a correction leaves the match finished', fixed.ended_at !== null)

  const afterFix = await roster()
  const gamesUnchanged = afterFix.every(
    (p) =>
      p.games_played ===
      beforeFix.find((b) => b.club_member_id === p.club_member_id).games_played,
  )
  check('a correction credits nobody with an extra game', gamesUnchanged)
  check('a correction leaves everyone in the queue', afterFix.every((p) => p.status === 'waiting'))

  // -------------------------------------------------- allow_player_scoring
  const second = await start(1, ids.slice(0, 4))
  await rejects(
    'with the toggle off, a player cannot record the score',
    players[0].client.rpc('end_match', { target_match: second, score_a: 11, score_b: 6 }),
    'only the host',
  )

  // RLS filters an UPDATE rather than refusing it: the statement succeeds and
  // matches no rows. So the proof is that the flag did not move, not an error.
  await players[0].client
    .from('sessions')
    .update({ allow_player_scoring: true })
    .eq('id', session.id)
  const { data: untouched } = await host
    .from('sessions')
    .select('allow_player_scoring')
    .eq('id', session.id)
    .single()
  check('a player cannot turn on player scoring', untouched.allow_player_scoring === false)

  const { error: toggleErr } = await host
    .from('sessions')
    .update({ allow_player_scoring: true })
    .eq('id', session.id)
  check('the host turns on player scoring', !toggleErr, toggleErr?.message)

  const { error: playerScoreErr } = await players[0].client.rpc('end_match', {
    target_match: second,
    score_a: 11,
    score_b: 6,
  })
  check('with the toggle on, a player records the score', !playerScoreErr, playerScoreErr?.message)

  const scored = await readMatch(second)
  check(
    "a player's score is stored like anyone else's",
    scored.score_a === 11 && scored.score_b === 6 && scored.ended_at !== null,
  )

  await rejects(
    'player scoring still does not let a player rewrite history',
    players[0].client.rpc('correct_match', {
      target_match: second,
      score_a: 6,
      score_b: 11,
    }),
    'only the host',
  )

  // ----------------------------------------------- data the recap reads back
  const ended = new Date().toISOString()
  await host.from('sessions').update({ status: 'ended', ended_at: ended }).eq('id', session.id)
  const { data: wrapped } = await host
    .from('sessions')
    .select(SESSION_COLS)
    .eq('id', session.id)
    .single()
  check(
    'an ended session carries the timestamps the recap needs',
    wrapped.status === 'ended' && Boolean(wrapped.started_at) && Boolean(wrapped.ended_at),
  )

  const { data: results } = await host
    .from('matches')
    .select('team_a_ids, team_b_ids, score_a, score_b, ended_at')
    .eq('session_id', session.id)
  check('both results are readable for the standings', results.length === 2)
  check(
    'every finished match has a full score',
    results.every((m) => m.ended_at && m.score_a !== null && m.score_b !== null),
  )

  // A player who was not the host must be able to open the recap and read the
  // same numbers — that is the whole point of a shareable link.
  const { data: asPlayer } = await players[1].client
    .from('matches')
    .select('score_a, score_b')
    .eq('session_id', session.id)
  check('a player who is not the host can read the recap results', asPlayer.length === 2)

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
