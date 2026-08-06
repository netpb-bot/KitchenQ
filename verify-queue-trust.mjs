/**
 * End-to-end check of 0014_queue_trust against the live Supabase project.
 *
 * The queue's order is `games_played` then `queued_at` and nothing else, and
 * both columns were reachable from a client. What has to hold on the server:
 * that stepping out of the queue and back in costs you the wait you didn't do,
 * that a cancelled match still costs its four nothing, that no row can say
 * `waiting` while its player is on court, and that a player cannot write either
 * sort key themselves.
 *
 * Needs two identities: a guest has no user_id, so "a player edits their own
 * row" is only meaningful from a signed-in one.
 *
 * Run: node verify-queue-trust.mjs
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

async function run() {
  const stamp = Date.now().toString(36)
  const host = await anonClient()
  const alex = await anonClient()

  const { data: clubId, error: clubErr } = await host.rpc('create_club', {
    club_name: `Queue trust ${stamp}`,
    club_slug: `queue-trust-${stamp}`,
    owner_name: 'Host',
  })
  if (clubErr) throw new Error(`create_club: ${clubErr.message}`)

  const code = `QT${stamp.slice(-4).toUpperCase()}`
  const { data: session, error: sessionErr } = await host
    .from('sessions')
    .insert({ club_id: clubId, name: 'Queue night', join_code: code, court_count: 1 })
    .select('id')
    .single()
  if (sessionErr) throw new Error(`create session: ${sessionErr.message}`)
  const sessionId = session.id

  const { data: guests, error: guestErr } = await host
    .from('club_members')
    .insert(
      Array.from({ length: 5 }, (_, i) => ({ club_id: clubId, display_name: `Guest ${i}` })),
    )
    .select('id')
  if (guestErr) throw new Error(`create guests: ${guestErr.message}`)
  const g = guests.map((x) => x.id)

  await host
    .from('session_players')
    .insert(g.map((id) => ({ session_id: sessionId, club_member_id: id })))

  const { error: joinErr } = await alex.rpc('join_session', { code, player_name: 'Alex' })
  if (joinErr) throw new Error(`Alex join: ${joinErr.message}`)

  const rowOf = async (memberId) => {
    const { data } = await host
      .from('session_players')
      .select('id, status, queued_at, games_played')
      .eq('session_id', sessionId)
      .eq('club_member_id', memberId)
      .single()
    return data
  }

  // By user_id, not just club_id: the club also holds the host and five guests.
  const alexUid = (await alex.auth.getUser()).data.user.id
  const { data: alexRows, error: alexErr } = await alex
    .from('club_members')
    .select('id')
    .eq('club_id', clubId)
    .eq('user_id', alexUid)
  if (alexErr || !alexRows?.length) {
    throw new Error(`find Alex: ${alexErr?.message ?? 'no member row'}`)
  }
  const alexMember = alexRows[0].id

  await host
    .from('sessions')
    .update({ status: 'live', started_at: new Date().toISOString() })
    .eq('id', sessionId)

  // ------------------------------------------------- coming back into line
  console.log('\ncoming back into line')

  const before = await rowOf(g[0])
  await host.from('session_players').update({ status: 'resting' }).eq('id', before.id)
  await host.from('session_players').update({ status: 'waiting' }).eq('id', before.id)
  const backFromRest = await rowOf(g[0])
  check(
    'sitting out and coming back restarts the wait',
    new Date(backFromRest.queued_at) > new Date(before.queued_at),
    `${before.queued_at} -> ${backFromRest.queued_at}`,
  )
  check(
    'and does not cost them a game of catch-up',
    backFromRest.games_played === before.games_played,
  )

  const removed = await rowOf(g[1])
  await host.from('session_players').update({ status: 'left' }).eq('id', removed.id)
  await host.from('session_players').update({ status: 'waiting' }).eq('id', removed.id)
  const undone = await rowOf(g[1])
  check(
    'a removed player who is put back restarts the wait too',
    new Date(undone.queued_at) > new Date(removed.queued_at),
    `${removed.queued_at} -> ${undone.queued_at}`,
  )

  const readded = await rowOf(g[2])
  await host.from('session_players').update({ status: 'left' }).eq('id', readded.id)
  await host
    .from('session_players')
    .upsert(
      { session_id: sessionId, club_member_id: g[2], status: 'waiting' },
      { onConflict: 'session_id,club_member_id' },
    )
  const readdedNow = await rowOf(g[2])
  check(
    "the host's re-add restarts the wait as well",
    new Date(readdedNow.queued_at) > new Date(readded.queued_at),
    `${readded.queued_at} -> ${readdedNow.queued_at}`,
  )

  // ------------------------------------------------------ nobody plays twice
  console.log('\nnobody plays twice')

  const four = [g[0], g[1], g[2], g[3]]
  const { data: matchId, error: startErr } = await host.rpc('start_match', {
    target_session: sessionId,
    court: 1,
    team_a: four.slice(0, 2),
    team_b: four.slice(2, 4),
  })
  check('the host starts a match', !startErr, startErr?.message)

  const onCourt = await rowOf(g[0])
  const { error: flipErr } = await host
    .from('session_players')
    .update({ status: 'waiting' })
    .eq('id', onCourt.id)
  check('a player on court cannot be put back in the queue', !!flipErr, 'the update was allowed')

  const { error: upsertErr } = await host
    .from('session_players')
    .upsert(
      { session_id: sessionId, club_member_id: g[0], status: 'waiting' },
      { onConflict: 'session_id,club_member_id' },
    )
  check('and re-adding them does not do it either', !!upsertErr, 'the upsert was allowed')

  // --------------------------------------------------- a match never played
  console.log('\na match never played')

  const beforeCancel = await rowOf(g[0])
  const { error: cancelErr } = await host.rpc('cancel_match', { target_match: matchId })
  check('the host can still cancel a match', !cancelErr, cancelErr?.message)

  const afterCancel = await rowOf(g[0])
  check('cancelling puts the four back in the queue', afterCancel.status === 'waiting')
  check(
    'and costs them nothing in wait order',
    afterCancel.queued_at === beforeCancel.queued_at,
    `${beforeCancel.queued_at} -> ${afterCancel.queued_at}`,
  )
  check('nor a game', afterCancel.games_played === beforeCancel.games_played)

  // ------------------------------------------------- a match that did happen
  console.log('\na match that did happen')

  const beforePlay = await rowOf(g[0])
  const { data: realMatch, error: realErr } = await host.rpc('start_match', {
    target_session: sessionId,
    court: 1,
    team_a: four.slice(0, 2),
    team_b: four.slice(2, 4),
  })
  check('the match starts again', !realErr, realErr?.message)

  const { error: endErr } = await host.rpc('end_match', {
    target_match: realMatch,
    score_a: 11,
    score_b: 4,
  })
  check('the host records the score', !endErr, endErr?.message)

  const afterPlay = await rowOf(g[0])
  check('a played match sends them to the back', afterPlay.status === 'waiting')
  check(
    'with a fresh wait',
    new Date(afterPlay.queued_at) > new Date(beforePlay.queued_at),
    `${beforePlay.queued_at} -> ${afterPlay.queued_at}`,
  )
  check('and a game on the board', afterPlay.games_played === beforePlay.games_played + 1)

  // ------------------------------------------------- the sort key is not yours
  console.log('\nthe sort key is not yours')

  const alexRow = await rowOf(alexMember)

  const { error: gamesErr } = await alex
    .from('session_players')
    .update({ games_played: -1 })
    .eq('id', alexRow.id)
  check('a player cannot rewrite their own games played', !!gamesErr, 'the update was allowed')

  const { error: queuedErr } = await alex
    .from('session_players')
    .update({ queued_at: new Date(0).toISOString() })
    .eq('id', alexRow.id)
  check('a player cannot backdate their own place in line', !!queuedErr, 'the update was allowed')

  const stillMine = await rowOf(alexMember)
  check(
    'and neither column moved',
    stillMine.games_played === alexRow.games_played &&
      stillMine.queued_at === alexRow.queued_at,
  )

  const { error: sitErr } = await alex
    .from('session_players')
    .update({ status: 'resting' })
    .eq('id', alexRow.id)
  check('but they can still sit out', !sitErr, sitErr?.message)

  const { error: backErr } = await alex
    .from('session_players')
    .update({ status: 'waiting' })
    .eq('id', alexRow.id)
  check('and come back', !backErr, backErr?.message)

  const alexBack = await rowOf(alexMember)
  check(
    'their own return restarts their wait too',
    new Date(alexBack.queued_at) > new Date(alexRow.queued_at),
    `${alexRow.queued_at} -> ${alexBack.queued_at}`,
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
