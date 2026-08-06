/**
 * End-to-end check of pair requests against the live Supabase project.
 *
 * The matchmaker decides lineups in the browser, so nothing about *who ends up
 * on which team* can be proved here — queue.test.ts owns that. What has to hold
 * on the server is the part a crafted request could otherwise forge: who may
 * ask whom, who may answer, that saying yes to one ask says no to the rest, and
 * that a pairing is spent by the game it was made for and by nothing else.
 *
 * Needs three separate anonymous identities, because "only the player who was
 * asked can answer" is meaningless from one session.
 *
 * Run: node verify-pairs.mjs
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

async function anonClient() {
  const client = createClient(URL, KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error } = await client.auth.signInAnonymously()
  if (error) throw new Error(`anonymous sign-in failed: ${error.message}`)
  return client
}

/* ------------------------------------------------------------------ helpers */

const ask = (client, sessionId, memberId) =>
  client.rpc('request_pair', { target_session: sessionId, target_member: memberId })

const answer = (client, requestId, next) =>
  client.rpc('respond_pair', { target_request: requestId, next_status: next })

async function statusOf(client, requestId) {
  const { data } = await client
    .from('pair_requests')
    .select('status')
    .eq('id', requestId)
    .single()
  return data?.status ?? null
}

/** Their club_members.id in this club, which is what every id below refers to. */
async function memberIdOf(client, clubId) {
  const { data } = await client
    .from('club_members')
    .select('id')
    .eq('club_id', clubId)
    .single()
  return data.id
}

async function run() {
  const stamp = Date.now().toString(36)
  const host = await anonClient()
  const alex = await anonClient()
  const blair = await anonClient()
  const casey = await anonClient()

  const { data: clubId, error: clubErr } = await host.rpc('create_club', {
    club_name: `Pairs ${stamp}`,
    club_slug: `pairs-${stamp}`,
    owner_name: 'Host',
  })
  if (clubErr) throw new Error(`create_club: ${clubErr.message}`)

  const code = `PR${stamp.slice(-4).toUpperCase()}`
  const { data: session, error: sessionErr } = await host
    .from('sessions')
    .insert({ club_id: clubId, name: 'Pair night', join_code: code, court_count: 1 })
    .select('id')
    .single()
  if (sessionErr) throw new Error(`create session: ${sessionErr.message}`)
  const sessionId = session.id

  await host
    .from('sessions')
    .update({ status: 'live', started_at: new Date().toISOString() })
    .eq('id', sessionId)

  // Two guests, so a court can be filled without two more phones — and so there
  // is somebody present who has no account to answer with.
  const { data: guests, error: guestErr } = await host
    .from('club_members')
    .insert([
      { club_id: clubId, display_name: 'Guest One' },
      { club_id: clubId, display_name: 'Guest Two' },
    ])
    .select('id, display_name')
  if (guestErr) throw new Error(`create guests: ${guestErr.message}`)
  await host
    .from('session_players')
    .insert(guests.map((g) => ({ session_id: sessionId, club_member_id: g.id })))

  for (const [client, name] of [
    [alex, 'Alex'],
    [blair, 'Blair'],
    [casey, 'Casey'],
  ]) {
    const { error } = await client.rpc('join_session', { code, player_name: name })
    if (error) throw new Error(`${name} join: ${error.message}`)
  }

  const alexId = await memberIdOf(alex, clubId)
  const blairId = await memberIdOf(blair, clubId)
  const caseyId = await memberIdOf(casey, clubId)

  // ------------------------------------------------------------------ asking
  console.log('\nasking')

  const { data: request, error: askErr } = await ask(alex, sessionId, blairId)
  check('a waiting player can ask another waiting player', !askErr && !!request, askErr?.message)

  const { data: again } = await ask(alex, sessionId, blairId)
  check('asking twice is the same open ask, not a second one', again === request, `got ${again}`)

  const { error: selfErr } = await ask(alex, sessionId, alexId)
  check('you cannot pair with yourself', !!selfErr, 'the RPC allowed it')

  const { error: guestErr2 } = await ask(alex, sessionId, guests[0].id)
  check('a guest cannot be asked — no account to answer with', !!guestErr2, 'the RPC allowed it')

  // The host created the club but never joined the queue.
  const { error: benchErr } = await ask(host, sessionId, blairId)
  check('somebody not in the queue cannot ask', !!benchErr, 'the RPC allowed it')

  // --------------------------------------------------------------- answering
  console.log('\nanswering')

  const { error: wrongErr } = await answer(alex, request, 'accepted')
  check('the player who asked cannot accept their own ask', !!wrongErr, 'the RPC allowed it')

  const { error: strangerErr } = await answer(casey, request, 'declined')
  check('a bystander cannot answer somebody else\'s ask', !!strangerErr, 'the RPC allowed it')

  const { error: badStateErr } = await answer(blair, request, 'consumed')
  check('a pending ask cannot be marked spent by hand', !!badStateErr, 'the RPC allowed it')

  // Casey asks Blair too, so accepting Alex has something to clear.
  const { data: caseyAsk, error: caseyErr } = await ask(casey, sessionId, blairId)
  check('two people can have an open ask with the same player', !caseyErr, caseyErr?.message)

  const { error: acceptErr } = await answer(blair, request, 'accepted')
  check('the player who was asked can accept', !acceptErr, acceptErr?.message)
  check('and the pairing is live', (await statusOf(host, request)) === 'accepted')
  check(
    'saying yes to one ask says no to the rest',
    (await statusOf(host, caseyAsk)) === 'declined',
    `got ${await statusOf(host, caseyAsk)}`,
  )

  const { error: takenErr } = await ask(casey, sessionId, alexId)
  check('somebody already paired cannot be asked again', !!takenErr, 'the RPC allowed it')

  // ---------------------------------------------------------- spending it
  console.log('\nspending the pairing')

  const { data: cancelled, error: startErr } = await host.rpc('start_match', {
    target_session: sessionId,
    court: 1,
    team_a: [alexId, blairId],
    team_b: [guests[0].id, guests[1].id],
  })
  if (startErr) throw new Error(`start_match: ${startErr.message}`)

  await host.rpc('cancel_match', { target_match: cancelled })
  check(
    'a cancelled match does not cost them the pairing',
    (await statusOf(host, request)) === 'accepted',
    `got ${await statusOf(host, request)}`,
  )

  const { data: match, error: restartErr } = await host.rpc('start_match', {
    target_session: sessionId,
    court: 1,
    team_a: [alexId, blairId],
    team_b: [guests[0].id, guests[1].id],
  })
  if (restartErr) throw new Error(`start_match (2): ${restartErr.message}`)

  const { error: endErr } = await host.rpc('end_match', {
    target_match: match,
    score_a: 11,
    score_b: 6,
  })
  check('the match ends', !endErr, endErr?.message)
  check(
    'and the pairing is spent by the game it was made for',
    (await statusOf(host, request)) === 'consumed',
    `got ${await statusOf(host, request)}`,
  )

  // Both are waiting again, unpaired, so the whole thing can start over.
  const { data: fresh, error: freshErr } = await ask(alex, sessionId, blairId)
  check('a spent pairing frees them both to ask again', !freshErr && !!fresh, freshErr?.message)

  const { error: unpairErr } = await answer(blair, fresh, 'accepted')
  check('accepting the new one works', !unpairErr, unpairErr?.message)
  await answer(alex, fresh, 'cancelled')
  check(
    'and either of them can back out before the match',
    (await statusOf(host, fresh)) === 'cancelled',
    `got ${await statusOf(host, fresh)}`,
  )

  // --------------------------------------------------------------- isolation
  console.log('\nreach')

  const stranger = await anonClient()
  const { data: leaked } = await stranger
    .from('pair_requests')
    .select('id')
    .eq('session_id', sessionId)
  check('somebody outside the club reads none of it', (leaked ?? []).length === 0, `got ${leaked?.length}`)

  const { error: writeErr } = await blair
    .from('pair_requests')
    .update({ status: 'accepted' })
    .eq('id', fresh)
  const stillCancelled = (await statusOf(host, fresh)) === 'cancelled'
  check(
    'and a direct write cannot go around the functions',
    !!writeErr || stillCancelled,
    'the table took the update',
  )

  // ---------------------------------------------------------------- teardown
  const { error: delErr } = await host.from('clubs').delete().eq('id', clubId)
  check('the throwaway club is deleted', !delErr, delErr?.message)

  console.log(`\n${passed} passed, ${failed} failed\n`)
  process.exit(failed === 0 ? 0 : 1)
}

run().catch((e) => {
  console.error(`\nABORTED: ${e.message}\n`)
  process.exit(1)
})
