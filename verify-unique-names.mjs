/**
 * End-to-end check that a club cannot hold two players with the same name,
 * against the live Supabase project. Creates two throwaway clubs, tries every
 * way there is to sneak a duplicate in, then deletes both.
 * Run: node verify-unique-names.mjs
 *
 * The client-side checks in AddGuestForm, MemberRow and Join are advisory — they
 * exist so a host is told before they submit. Everything here tests the only
 * layer that a stale roster, a second phone or a bypassed form cannot get past:
 * the club_members_unique_name index from migration 0008.
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

/** Written as an escape on purpose: a literal one is invisible in a diff. */
const NBSP = String.fromCharCode(160)

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

/** A write that has to be refused by the unique index specifically. */
function refused(label, { error }) {
  if (!error) return check(label, false, 'the write succeeded')
  check(label, error.code === '23505', `got ${error.code}: ${error.message}`)
}

async function anonClient() {
  const client = createClient(URL, KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error } = await client.auth.signInAnonymously()
  if (error) throw new Error(`anonymous sign-in failed: ${error.message}`)
  return client
}

async function makeClub(host, label, stamp) {
  const { data: clubId, error: clubErr } = await host.rpc('create_club', {
    club_name: `Name verification ${label} ${stamp}`,
    club_slug: `name-verify-${label}-${stamp}`,
    owner_name: 'Host',
  })
  if (clubErr) throw new Error(`create_club(${label}): ${clubErr.message}`)

  const code = `N${label}${String(stamp).slice(-4)}`.toUpperCase()
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
  console.log('\nUnique player names — live verification\n')

  const stamp = Date.now()
  const host = await anonClient()
  const club = await makeClub(host, 'a', stamp)
  const other = await makeClub(host, 'b', stamp)

  // ------------------------------------------------- is the guard rail live?
  //
  // PostgREST cannot read pg_indexes, so the index is proved the only way it
  // can be from out here: by making it do its job. Everything below is
  // meaningless if this passes, so a failure aborts rather than tallies.
  const { data: mike, error: mikeErr } = await addGuest(host, club.clubId, 'Mike')
  if (mikeErr) throw new Error(`could not create the first guest: ${mikeErr.message}`)

  const again = await addGuest(host, club.clubId, 'Mike')
  if (!again.error || again.error.code !== '23505') {
    throw new Error(
      'the same name was accepted twice — migration 0008_unique_names.sql has not ' +
        'been applied to this project',
    )
  }
  check('the same name cannot be added twice', true)

  // ----------------------------------------------------------- normalisation
  refused('a different case is the same name', await addGuest(host, club.clubId, 'mike'))
  refused('padding is the same name', await addGuest(host, club.clubId, '  Mike  '))
  refused('shouting is the same name', await addGuest(host, club.clubId, 'MIKE'))
  refused(
    'non-breaking padding is the same name',
    await addGuest(host, club.clubId, `${NBSP}Mike${NBSP}`),
  )

  const { data: joann, error: joannErr } = await addGuest(host, club.clubId, '  Jo   Ann  ')
  check('the trigger stores a normalised name', joann?.display_name === 'Jo Ann', joannErr?.message)
  refused('collapsed whitespace is the same name', await addGuest(host, club.clubId, 'Jo Ann'))
  // Why the trigger translates chr(160) before its \s pass: without that, the
  // database would keep these two apart while the browser check merged them.
  refused(
    'a non-breaking space between names is the same name',
    await addGuest(host, club.clubId, `Jo${NBSP}Ann`),
  )

  check(
    'a genuinely different name is fine',
    !(await addGuest(host, club.clubId, 'Mike R')).error,
  )

  // --------------------------------------------------------------- the race
  //
  // The case no client-side check can ever cover: two hosts on two phones
  // adding the same walk-in at the same instant.
  const race = await Promise.all([
    addGuest(host, club.clubId, 'Race Condition'),
    addGuest(host, club.clubId, 'Race Condition'),
  ])
  const won = race.filter((r) => !r.error).length
  check('two simultaneous adds of one name yield exactly one row', won === 1, `${won} succeeded`)

  // ------------------------------------------------------------- joining in
  const walkIn = await anonClient()
  refused(
    'joining by code cannot take a name already in the club',
    await walkIn.rpc('join_session', { code: club.code, player_name: 'Mike' }),
  )

  const { error: freshErr } = await walkIn.rpc('join_session', {
    code: club.code,
    player_name: 'Mike T',
  })
  check('joining with a distinguishable name works', !freshErr, freshErr?.message)

  // Claiming is the way out of that collision, and must still work: it moves an
  // auth user onto the existing row rather than writing a second name.
  const realMike = await anonClient()
  const { error: claimErr } = await realMike.rpc('claim_member', {
    code: club.code,
    target_member: mike.id,
  })
  check('the real Mike can still claim the guest row', !claimErr, claimErr?.message)

  // ---------------------------------------------------------------- renaming
  const { data: renamer } = await addGuest(host, club.clubId, 'Temporary Name')
  refused(
    'a rename cannot land on a name someone else holds',
    await host.from('club_members').update({ display_name: 'Mike' }).eq('id', renamer.id),
  )
  refused(
    'a rename cannot land on it in a different case either',
    await host.from('club_members').update({ display_name: 'MIKE' }).eq('id', renamer.id),
  )

  const { error: selfErr } = await host
    .from('club_members')
    .update({ display_name: 'Temporary Name' })
    .eq('id', renamer.id)
  check('renaming to your own current name is not a collision', !selfErr, selfErr?.message)

  // ------------------------------------------------------------ other clubs
  const { error: elsewhereErr } = await addGuest(host, other.clubId, 'Mike')
  check('the same name in another club is fine', !elsewhereErr, elsewhereErr?.message)

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
