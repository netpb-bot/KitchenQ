/**
 * End-to-end check of the M4 payments ledger against the live Supabase project.
 *
 * The ledger is maintained entirely by database triggers, so this is where it
 * gets proved: entries appear for every way a player can arrive, the fee
 * follows a change of price, money already collected is never destroyed, and a
 * player can read their own balance but cannot touch it.
 *
 * Run: node verify-m4.mjs
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

const run = async () => {
  console.log('\nM4 payments ledger — live verification\n')

  const host = await anonClient()
  const stamp = Date.now()
  const FEE = 100
  const RAISED = 150

  // ------------------------------------------------------------------ setup
  const { data: clubId, error: clubErr } = await host.rpc('create_club', {
    club_name: `M4 verification ${stamp}`,
    club_slug: `m4-verify-${stamp}`,
    owner_name: 'Host',
  })
  if (clubErr) throw new Error(`create_club: ${clubErr.message}`)

  const { data: session, error: sessErr } = await host
    .from('sessions')
    .insert({
      club_id: clubId,
      name: 'Fee verification',
      join_code: `F${String(stamp).slice(-5)}`,
      court_count: 1,
      fee_amount: FEE,
    })
    .select('id, join_code, fee_amount')
    .single()
  if (sessErr) throw new Error(`create session: ${sessErr.message}`)
  const code = session.join_code

  const ledger = async () =>
    (
      await host
        .from('ledger_entries')
        .select('id, club_member_id, amount_due, amount_paid, status')
        .eq('session_id', session.id)
    ).data

  const entryFor = async (memberId) => (await ledger()).find((e) => e.club_member_id === memberId)

  // ------------------------------------------- an entry per arriving player
  await host.rpc('join_session', { code, player_name: 'Host' })
  check('joining by code creates a ledger entry', (await ledger()).length === 1)

  const player = await anonClient()
  await player.rpc('join_session', { code, player_name: 'Ana' })

  // The third route in: a guest the host typed, then added to the session.
  const { data: guest, error: guestErr } = await host
    .from('club_members')
    .insert({ club_id: clubId, display_name: 'Bea', skill_tier: 'intermediate' })
    .select('id')
    .single()
  if (guestErr) throw new Error(`create guest: ${guestErr.message}`)
  await host
    .from('session_players')
    .insert({ session_id: session.id, club_member_id: guest.id })

  const all = await ledger()
  check('every way of arriving is billed', all.length === 3)
  check('a guest without a phone is billed too', Boolean(await entryFor(guest.id)))
  check(
    'everyone owes the session fee',
    all.every((e) => Number(e.amount_due) === FEE),
  )
  check('nobody starts out paid', all.every((e) => e.status === 'unpaid'))

  // ---------------------------------------------------------- the fee moves
  await host.from('sessions').update({ fee_amount: RAISED }).eq('id', session.id)
  check(
    'raising the fee reprices every unpaid line',
    (await ledger()).every((e) => Number(e.amount_due) === RAISED),
  )

  // ---------------------------------------------------------- collecting it
  const anaMember = (await ledger()).find((e) => e.club_member_id !== guest.id)
  const { error: payErr } = await host
    .from('ledger_entries')
    .update({ amount_paid: 60 })
    .eq('id', anaMember.id)
  check('the host records a partial payment', !payErr, payErr?.message)

  const partial = (await ledger()).find((e) => e.id === anaMember.id)
  check('a part payment is derived as partial', partial.status === 'partial')

  await host.from('ledger_entries').update({ amount_paid: RAISED }).eq('id', anaMember.id)
  check(
    'paying in full is derived as paid',
    (await ledger()).find((e) => e.id === anaMember.id).status === 'paid',
  )

  await host.from('ledger_entries').update({ amount_paid: 0 }).eq('id', anaMember.id)
  check(
    'undoing a payment returns the line to unpaid',
    (await ledger()).find((e) => e.id === anaMember.id).status === 'unpaid',
  )

  // The client never writes `status`; a wrong one must be corrected anyway.
  await host
    .from('ledger_entries')
    .update({ amount_paid: 0, status: 'paid' })
    .eq('id', anaMember.id)
  check(
    'a status the client tries to force is overruled by the amounts',
    (await ledger()).find((e) => e.id === anaMember.id).status === 'unpaid',
  )

  // --------------------------------------------------- removing a player
  const guestEntry = await entryFor(guest.id)
  await host
    .from('session_players')
    .update({ status: 'left' })
    .eq('session_id', session.id)
    .eq('club_member_id', guest.id)
  check('removing a player who paid nothing drops their fee', !(await entryFor(guest.id)))
  check('the rest of the sheet is untouched', (await ledger()).length === 2)

  // Coming back is an update, not an insert — the fee has to reappear, or
  // anyone the host removed plays the rest of the night free.
  await host
    .from('session_players')
    .update({ status: 'waiting' })
    .eq('session_id', session.id)
    .eq('club_member_id', guest.id)
  check('a player who returns is billed again', Boolean(await entryFor(guest.id)))

  // Money already collected must survive the same removal.
  await host
    .from('ledger_entries')
    .update({ amount_paid: RAISED })
    .eq('id', (await entryFor(guest.id)).id)
  await host
    .from('session_players')
    .update({ status: 'left' })
    .eq('session_id', session.id)
    .eq('club_member_id', guest.id)
  const survivor = await entryFor(guest.id)
  check('removing a player who already paid keeps the record', Boolean(survivor))
  check('and keeps the amount', survivor && Number(survivor.amount_paid) === RAISED)
  check('the earlier entry id is unrelated to the new one', guestEntry.id !== survivor.id)

  // --------------------------------------------------------- what a player sees
  const { data: mine } = await player
    .from('ledger_entries')
    .select('id, club_member_id, amount_due, amount_paid, status')
    .eq('session_id', session.id)
  check('a player sees exactly one line — their own', mine.length === 1)
  check('and it is the right amount', Number(mine[0].amount_due) === RAISED)

  await player.from('ledger_entries').update({ amount_paid: RAISED }).eq('id', mine[0].id)
  const afterTamper = (await ledger()).find((e) => e.id === mine[0].id)
  check(
    'a player cannot mark themselves paid',
    Number(afterTamper.amount_paid) === 0,
    `amount_paid is ${afterTamper.amount_paid}`,
  )

  await player.from('ledger_entries').delete().eq('id', mine[0].id)
  check(
    'a player cannot delete their own fee',
    (await ledger()).some((e) => e.id === mine[0].id),
  )

  // ------------------------------------------------- the club-wide overview
  const { data: clubWide } = await host
    .from('ledger_entries')
    .select('amount_due, amount_paid, sessions!inner(club_id)')
    .eq('sessions.club_id', clubId)
  const outstanding = clubWide.reduce(
    (sum, e) => sum + Math.max(0, Number(e.amount_due) - Number(e.amount_paid)),
    0,
  )
  check('the host reads the whole club ledger', clubWide.length === 3)
  check(
    'total outstanding is the host and the player, both unpaid',
    outstanding === RAISED * 2,
    `got ${outstanding}`,
  )

  const { data: playerWide } = await player
    .from('ledger_entries')
    .select('amount_due, sessions!inner(club_id)')
    .eq('sessions.club_id', clubId)
  check('a player reads only their own club balance', playerWide.length === 1)

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
