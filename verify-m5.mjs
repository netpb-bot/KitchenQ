/**
 * End-to-end check of the M5 home and profile data against the live Supabase
 * project.
 *
 * M5 added no migration. It reads matches across every session in a club for
 * the first time, which means the guarantees it leans on are RLS guarantees
 * written for M2 and never exercised this way: that a club member may read the
 * club's whole match history, that a stranger may read none of it, and that one
 * club's results never appear in another's leaderboard. That, plus the fact
 * that a host's own balance is a filter the client must apply — RLS alone hands
 * a host the whole club's ledger — is what this script proves.
 *
 * Run: node verify-m5.mjs
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

// Mirrors MATCH_COLS in src/lib/db.ts — a renamed column must fail here loudly.
const MATCH_COLS =
  'id, session_id, court_number, team_a_ids, team_b_ids, score_a, score_b, started_at, ended_at'

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

async function makeClub(host, label, stamp) {
  const { data: clubId, error } = await host.rpc('create_club', {
    club_name: `M5 ${label} ${stamp}`,
    club_slug: `m5-${label}-${stamp}`,
    owner_name: 'Host',
  })
  if (error) throw new Error(`create_club(${label}): ${error.message}`)
  return clubId
}

/** Four guests the host typed in, so the script never needs four phones. */
async function makeGuests(host, clubId, names) {
  const { data, error } = await host
    .from('club_members')
    .insert(names.map((display_name) => ({ club_id: clubId, display_name })))
    .select('id, display_name')
  if (error) throw new Error(`create guests: ${error.message}`)
  // Insert order is not a promise; index by name so the fixtures stay readable.
  return new Map(data.map((m) => [m.display_name, m.id]))
}

async function makeLiveSession(host, clubId, name, code, fee = 0) {
  const { data, error } = await host
    .from('sessions')
    .insert({ club_id: clubId, name, join_code: code, court_count: 1, fee_amount: fee })
    .select('id')
    .single()
  if (error) throw new Error(`create session ${name}: ${error.message}`)
  const { error: liveErr } = await host
    .from('sessions')
    .update({ status: 'live', started_at: new Date().toISOString() })
    .eq('id', data.id)
  if (liveErr) throw new Error(`start session ${name}: ${liveErr.message}`)
  return data.id
}

async function addToSession(host, sessionId, memberIds) {
  const { error } = await host
    .from('session_players')
    .insert(memberIds.map((club_member_id) => ({ session_id: sessionId, club_member_id })))
  if (error) throw new Error(`add players: ${error.message}`)
}

async function playMatch(host, sessionId, teamA, teamB, scoreA, scoreB) {
  const { data: matchId, error } = await host.rpc('start_match', {
    target_session: sessionId,
    court: 1,
    team_a: teamA,
    team_b: teamB,
  })
  if (error) throw new Error(`start_match: ${error.message}`)
  const { error: endErr } = await host.rpc('end_match', {
    target_match: matchId,
    score_a: scoreA,
    score_b: scoreB,
  })
  if (endErr) throw new Error(`end_match: ${endErr.message}`)
  return matchId
}

/** The query src/lib/db.ts#listClubMatches makes, verbatim. */
function clubMatches(client, clubId) {
  return client
    .from('matches')
    .select(`${MATCH_COLS}, sessions!inner(club_id)`)
    .eq('sessions.club_id', clubId)
    .not('ended_at', 'is', null)
    .order('ended_at', { ascending: false })
}

/**
 * The wins/losses/points half of src/lib/standings.ts, reimplemented here on
 * purpose. If the app and an independent reading of the same rows ever
 * disagree, one of them is lying to a player about their record.
 */
function tally(memberIds, matches) {
  const rows = new Map(
    [...memberIds].map((id) => [id, { games: 0, wins: 0, losses: 0, for: 0, against: 0 }]),
  )
  const credit = (ids, scored, conceded) => {
    for (const id of ids) {
      const row = rows.get(id)
      if (!row) continue
      row.games++
      if (scored > conceded) row.wins++
      else row.losses++
      row.for += scored
      row.against += conceded
    }
  }
  for (const m of matches) {
    credit(m.team_a_ids, m.score_a, m.score_b)
    credit(m.team_b_ids, m.score_b, m.score_a)
  }
  return rows
}

/* ---------------------------------------------------------------------- run */

const run = async () => {
  console.log('\nM5 home & profiles — live verification\n')

  const host = await anonClient()
  const stamp = Date.now()
  const FEE = 100

  // ------------------------------------------------------------------- setup
  const clubId = await makeClub(host, 'club', stamp)
  const m = await makeGuests(host, clubId, ['Ana', 'Ben', 'Cara', 'Dan'])
  const four = [m.get('Ana'), m.get('Ben'), m.get('Cara'), m.get('Dan')]

  const { data: hostMember, error: hostErr } = await host
    .from('club_members')
    .select('id')
    .eq('club_id', clubId)
    .eq('role', 'owner')
    .single()
  if (hostErr) throw new Error(`find host membership: ${hostErr.message}`)

  const night1 = await makeLiveSession(host, clubId, 'Tuesday open play', `A${String(stamp).slice(-5)}`, FEE)
  const night2 = await makeLiveSession(host, clubId, 'Thursday open play', `B${String(stamp).slice(-5)}`)
  await addToSession(host, night1, [...four, hostMember.id])
  await addToSession(host, night2, four)

  // Two nights, three results. Worked out by hand below so the leaderboard has
  // something to be right or wrong about.
  await playMatch(host, night1, [m.get('Ana'), m.get('Ben')], [m.get('Cara'), m.get('Dan')], 11, 7)
  await playMatch(host, night1, [m.get('Ana'), m.get('Cara')], [m.get('Ben'), m.get('Dan')], 6, 11)
  await playMatch(host, night2, [m.get('Ana'), m.get('Dan')], [m.get('Ben'), m.get('Cara')], 11, 9)

  // A second club, played on the same evening, that must never leak into the
  // first one's leaderboard.
  const otherClubId = await makeClub(host, 'other', stamp)
  const o = await makeGuests(host, otherClubId, ['Ana', 'Ben', 'Cara', 'Dan'])
  const otherNight = await makeLiveSession(host, otherClubId, 'Other club', `C${String(stamp).slice(-5)}`)
  await addToSession(host, otherNight, [o.get('Ana'), o.get('Ben'), o.get('Cara'), o.get('Dan')])
  await playMatch(host, otherNight, [o.get('Ana'), o.get('Ben')], [o.get('Cara'), o.get('Dan')], 11, 0)

  // ------------------------------------------------- reading the whole club
  const { data: all, error: allErr } = await clubMatches(host, clubId)
  check('the club-wide match query runs', !allErr, allErr?.message)
  check('it returns every finished match across both nights', all?.length === 3, `got ${all?.length}`)
  check(
    'it spans more than one session',
    new Set(all.map((x) => x.session_id)).size === 2,
  )
  check(
    'no other club appears in it',
    all.every((x) => x.session_id === night1 || x.session_id === night2),
  )
  check(
    'it comes back newest first',
    all.every((x, i) => i === 0 || all[i - 1].ended_at >= x.ended_at),
  )

  const { data: otherAll } = await clubMatches(host, otherClubId)
  check('the other club reads only its own match', otherAll?.length === 1)

  // A match still on court must not count toward anyone's record.
  const { data: liveMatch, error: liveErr } = await host.rpc('start_match', {
    target_session: night2,
    court: 1,
    team_a: [m.get('Ana'), m.get('Ben')],
    team_b: [m.get('Cara'), m.get('Dan')],
  })
  if (liveErr) throw new Error(`start live match: ${liveErr.message}`)
  const { data: withLive } = await clubMatches(host, clubId)
  check('a match still being played is left out', withLive?.length === 3, `got ${withLive?.length}`)
  await host.rpc('cancel_match', { target_match: liveMatch })

  // ------------------------------------------------------- the record itself
  const table = tally(new Set(four), all)
  const ana = table.get(m.get('Ana'))
  const ben = table.get(m.get('Ben'))
  const cara = table.get(m.get('Cara'))
  const dan = table.get(m.get('Dan'))

  // Hand-computed from the three results above:
  //   Ana  W L W   2–1   for 28  against 27   +1
  //   Ben  W W L   2–1   for 31  against 24   +7
  //   Cara L L L   0–3   for 22  against 33  −11
  //   Dan  L W W   2–1   for 29  against 26   +3
  check('Ana is 2–1 across two sessions', ana.wins === 2 && ana.losses === 1, JSON.stringify(ana))
  check('Ben is 2–1', ben.wins === 2 && ben.losses === 1, JSON.stringify(ben))
  check('Cara is 0–3', cara.wins === 0 && cara.losses === 3, JSON.stringify(cara))
  check('Dan is 2–1', dan.wins === 2 && dan.losses === 1, JSON.stringify(dan))
  check('point differentials match the hand calculation', ana.for - ana.against === 1 && ben.for - ben.against === 7 && cara.for - cara.against === -11 && dan.for - dan.against === 3)
  check(
    'every point scored is a point conceded',
    [...table.values()].reduce((sum, r) => sum + r.for - r.against, 0) === 0,
  )
  check(
    'three players tie on record, so the leaderboard must break it on points',
    ben.for - ben.against > dan.for - dan.against &&
      dan.for - dan.against > ana.for - ana.against,
  )

  // --------------------------------------------------------- what RLS allows
  const stranger = await anonClient()
  const { data: peeked } = await clubMatches(stranger, clubId)
  check('someone who is not in the club reads no matches', peeked?.length === 0, `got ${peeked?.length}`)

  const { data: strangerMembers } = await stranger
    .from('club_members')
    .select('id')
    .eq('club_id', clubId)
  // Names are deliberately readable so join-by-code can resolve them; results
  // are not. The leaderboard is the private half.
  check('but names stay readable, as join-by-code needs', strangerMembers.length > 0)

  // ------------------------------------------------------ the host's balance
  const { data: everyEntry } = await host
    .from('ledger_entries')
    .select('id, club_member_id, amount_due, amount_paid')
    .eq('session_id', night1)
  check('the host, as admin, is handed the whole session ledger', everyEntry?.length === 5, `got ${everyEntry?.length}`)

  const { data: myEntries } = await host
    .from('ledger_entries')
    .select('id, club_member_id, amount_due, amount_paid')
    .in('club_member_id', [hostMember.id])
  check(
    'filtering by their own membership leaves only their own line',
    myEntries?.length === 1,
    `got ${myEntries?.length}`,
  )
  check(
    'and it is the fee they actually owe',
    myEntries?.length === 1 && Number(myEntries[0].amount_due) === FEE,
  )
  const owed = (myEntries ?? []).reduce(
    (sum, e) => sum + Math.max(0, Number(e.amount_due) - Number(e.amount_paid)),
    0,
  )
  check('so home shows one fee outstanding, not the club total', owed === FEE, `got ${owed}`)

  // ---------------------------------------------------------------- teardown
  const { error: delA } = await host.from('clubs').delete().eq('id', clubId)
  const { error: delB } = await host.from('clubs').delete().eq('id', otherClubId)
  check('both throwaway clubs are deleted', !delA && !delB, delA?.message ?? delB?.message)

  console.log(`\n${passed} passed, ${failed} failed\n`)
  process.exit(failed === 0 ? 0 : 1)
}

run().catch((e) => {
  console.error(`\nABORTED: ${e.message}\n`)
  process.exit(1)
})
