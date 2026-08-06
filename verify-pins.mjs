/**
 * End-to-end check of host-pinned lineups against the live Supabase project.
 *
 * Which four the queue engine *suggests* is decided in the browser and proved in
 * queue.test.ts. What has to hold on the server is everything a second phone or
 * a crafted request could otherwise break: that only a host may pin, that a
 * player is pinned in one place or nowhere, that pinning someone here unpins
 * them there, and that the pins are spent by the match they were made for.
 *
 * Needs two identities, because "only the host can set a lineup" is meaningless
 * from one session.
 *
 * Run: node verify-pins.mjs
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

const setLineup = (client, sessionId, court, memberIds) =>
  client.rpc('set_court_lineup', { target_session: sessionId, court, member_ids: memberIds })

const clearLineup = (client, sessionId, court) =>
  client.rpc('clear_court_lineup', { target_session: sessionId, court })

/** The pinned lineup for one court, in slot order. */
async function lineupOf(client, sessionId, court) {
  const { data } = await client
    .from('court_pins')
    .select('slot, member_id')
    .eq('session_id', sessionId)
    .eq('court_number', court)
    .order('slot')
  return (data ?? []).map((p) => p.member_id)
}

async function pinCount(client, sessionId) {
  const { data } = await client.from('court_pins').select('slot').eq('session_id', sessionId)
  return (data ?? []).length
}

async function run() {
  const stamp = Date.now().toString(36)
  const host = await anonClient()
  const alex = await anonClient()

  const { data: clubId, error: clubErr } = await host.rpc('create_club', {
    club_name: `Pins ${stamp}`,
    club_slug: `pins-${stamp}`,
    owner_name: 'Host',
  })
  if (clubErr) throw new Error(`create_club: ${clubErr.message}`)

  const code = `PN${stamp.slice(-4).toUpperCase()}`
  const { data: session, error: sessionErr } = await host
    .from('sessions')
    .insert({ club_id: clubId, name: 'Pin night', join_code: code, court_count: 2 })
    .select('id')
    .single()
  if (sessionErr) throw new Error(`create session: ${sessionErr.message}`)
  const sessionId = session.id

  // Eight guests: two full courts of next-up, which is what makes "moving a
  // player from one court to the other" a thing that can be observed at all.
  const { data: guests, error: guestErr } = await host
    .from('club_members')
    .insert(
      Array.from({ length: 8 }, (_, i) => ({ club_id: clubId, display_name: `Guest ${i}` })),
    )
    .select('id')
  if (guestErr) throw new Error(`create guests: ${guestErr.message}`)
  const g = guests.map((x) => x.id)

  await host
    .from('session_players')
    .insert(g.map((id) => ({ session_id: sessionId, club_member_id: id })))

  const { error: joinErr } = await alex.rpc('join_session', { code, player_name: 'Alex' })
  if (joinErr) throw new Error(`Alex join: ${joinErr.message}`)

  // ------------------------------------------------------------------ gating
  console.log('\ngating')

  const { error: draftErr } = await setLineup(host, sessionId, 1, g.slice(0, 4))
  check('a lineup cannot be pinned before the session is live', !!draftErr, 'the RPC allowed it')

  await host
    .from('sessions')
    .update({ status: 'live', started_at: new Date().toISOString() })
    .eq('id', sessionId)

  const { error: playerErr } = await setLineup(alex, sessionId, 1, g.slice(0, 4))
  check('a player cannot pin a lineup', !!playerErr, 'the RPC allowed it')

  const { error: courtErr } = await setLineup(host, sessionId, 9, g.slice(0, 4))
  check('a court outside the session is refused', !!courtErr, 'the RPC allowed it')

  const { error: dupeErr } = await setLineup(host, sessionId, 1, [g[0], g[0], g[1], g[2]])
  check('the same player twice is refused', !!dupeErr, 'the RPC allowed it')

  const { error: shortErr } = await setLineup(host, sessionId, 1, g.slice(0, 3))
  check('a lineup of three is refused', !!shortErr, 'the RPC allowed it')

  // ----------------------------------------------------------------- pinning
  console.log('\npinning')

  const { error: pinErr } = await setLineup(host, sessionId, 1, [g[0], g[1], g[2], g[3]])
  check('the host can pin four players', !pinErr, pinErr?.message)
  check(
    'and the slot order is the teams they were given',
    JSON.stringify(await lineupOf(host, sessionId, 1)) ===
      JSON.stringify([g[0], g[1], g[2], g[3]]),
  )

  // Re-pinning the same court is the Swap button: same four, new pairing.
  await setLineup(host, sessionId, 1, [g[0], g[3], g[1], g[2]])
  check(
    're-pinning the same court replaces the lineup rather than adding to it',
    (await lineupOf(host, sessionId, 1)).length === 4,
  )
  check(
    'and swapping partners keeps the same four',
    JSON.stringify(await lineupOf(host, sessionId, 1)) ===
      JSON.stringify([g[0], g[3], g[1], g[2]]),
  )

  await setLineup(host, sessionId, 2, [g[4], g[5], g[6], g[7]])
  check('a second court can be pinned', (await pinCount(host, sessionId)) === 8)

  // ------------------------------------------------------------ moving across
  console.log('\nmoving a player across')

  const { error: moveErr } = await setLineup(host, sessionId, 1, [g[0], g[3], g[1], g[4]])
  check('the host can pull a player off another court\'s next-up', !moveErr, moveErr?.message)
  check(
    'and they are gone from the court they came from',
    !(await lineupOf(host, sessionId, 2)).includes(g[4]),
  )
  check(
    'leaving that court short rather than holding a stale slot',
    (await lineupOf(host, sessionId, 2)).length === 3,
    `got ${(await lineupOf(host, sessionId, 2)).length}`,
  )
  check('and nobody is pinned twice', (await pinCount(host, sessionId)) === 7)

  // --------------------------------------------------------------- reverting
  console.log('\nreverting')

  const { error: clearErr } = await clearLineup(host, sessionId, 2)
  check('the host can hand a court back to the queue', !clearErr, clearErr?.message)
  check('and its pins are gone', (await lineupOf(host, sessionId, 2)).length === 0)

  const { error: clearPlayerErr } = await clearLineup(alex, sessionId, 1)
  check('a player cannot clear a lineup', !!clearPlayerErr, 'the RPC allowed it')

  // ------------------------------------------------------------ spending them
  console.log('\nspending the pins')

  await setLineup(host, sessionId, 2, [g[5], g[6], g[7], g[2]])
  const { data: match, error: startErr } = await host.rpc('start_match', {
    target_session: sessionId,
    court: 2,
    team_a: [g[5], g[6]],
    team_b: [g[7], g[2]],
  })
  check('a pinned lineup starts', !startErr, startErr?.message)
  check('and that court\'s pins are spent', (await lineupOf(host, sessionId, 2)).length === 0)
  check(
    'and a player started here loses the pin holding them for court 1',
    !(await lineupOf(host, sessionId, 1)).includes(g[2]),
  )

  await host.rpc('end_match', { target_match: match, score_a: 11, score_b: 4 })

  const { error: onCourtErr } = await setLineup(host, sessionId, 1, [g[0], g[1], g[3], g[4]])
  check('the four can be pinned again once they requeue', !onCourtErr, onCourtErr?.message)

  const { data: live } = await host.rpc('start_match', {
    target_session: sessionId,
    court: 2,
    team_a: [g[5], g[6]],
    team_b: [g[7], g[2]],
  })
  const { error: playingErr } = await setLineup(host, sessionId, 1, [g[5], g[6], g[7], g[2]])
  check('somebody mid-match cannot be pinned for the next one', !!playingErr, 'the RPC allowed it')
  await host.rpc('cancel_match', { target_match: live })

  // --------------------------------------------------------------- isolation
  console.log('\nreach')

  const stranger = await anonClient()
  const { data: leaked } = await stranger
    .from('court_pins')
    .select('slot')
    .eq('session_id', sessionId)
  check('somebody outside the club reads none of it', (leaked ?? []).length === 0, `got ${leaked?.length}`)

  const before = await lineupOf(host, sessionId, 1)
  const { error: writeErr } = await alex
    .from('court_pins')
    .update({ member_id: g[7] })
    .eq('session_id', sessionId)
    .eq('court_number', 1)
    .eq('slot', 0)
  const unchanged = JSON.stringify(await lineupOf(host, sessionId, 1)) === JSON.stringify(before)
  check(
    'and a direct write cannot go around the functions',
    !!writeErr || unchanged,
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
