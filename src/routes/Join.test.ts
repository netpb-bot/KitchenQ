import { describe, expect, it } from 'vitest'
import { checkName, isUnclaimedGuest } from './Join'
import type { Member } from '../lib/db'

const member = (over: Partial<Member> & { display_name: string }): Member => ({
  id: over.display_name.toLowerCase(),
  club_id: 'club',
  user_id: null,
  skill_tier: 'intermediate',
  role: 'member',
  ...over,
})

// The host has been keeping a record for Mike, who has never opened the app.
const guestMike = member({ display_name: 'Mike' })
// Priya joined on her own phone, so her name is nobody else's to take.
const realPriya = member({ display_name: 'Priya', user_id: 'auth-priya' })
// A co-host whose auth user was deleted. user_id is null exactly like a guest's,
// which is what makes this row dangerous rather than merely unusual.
const orphanedHost = member({ display_name: 'Dana', role: 'admin' })

const roster = [guestMike, realPriya, orphanedHost]

describe('isUnclaimedGuest', () => {
  it('is a member row with no auth user behind it', () => {
    expect(isUnclaimedGuest(guestMike)).toBe(true)
  })

  it('is not somebody who signed in for themselves', () => {
    expect(isUnclaimedGuest(realPriya)).toBe(false)
  })

  // The one that matters: on delete set null leaves an owner or co-host row
  // looking exactly like a guest. Offering it would hand out the role.
  it('is not an orphaned owner or co-host row', () => {
    expect(isUnclaimedGuest(orphanedHost)).toBe(false)
    expect(isUnclaimedGuest(member({ display_name: 'Sam', role: 'owner' }))).toBe(false)
  })
})

describe('checkName', () => {
  it('lets an unused name through', () => {
    expect(checkName(roster, 'Mike R')).toEqual({ kind: 'free' })
    expect(checkName(roster, 'Michael')).toEqual({ kind: 'free' })
  })

  // An empty field is the starting state; there is nothing to warn about yet.
  it('lets an empty name through', () => {
    expect(checkName(roster, '')).toEqual({ kind: 'free' })
    expect(checkName(roster, '   ')).toEqual({ kind: 'free' })
  })

  it('offers the guest record the host has been keeping', () => {
    expect(checkName(roster, 'Mike')).toEqual({ kind: 'claimable', guest: guestMike })
  })

  it('matches the way the database matches, not character by character', () => {
    expect(checkName(roster, 'mike')).toEqual({ kind: 'claimable', guest: guestMike })
    expect(checkName(roster, '  MIKE  ')).toEqual({ kind: 'claimable', guest: guestMike })
  })

  // Two different people called Mike is the case this screen exists to get
  // right. Once the first has claimed the row, the second must be told to pick
  // another name rather than offered a takeover.
  it('will not offer a takeover of somebody with their own login', () => {
    expect(checkName(roster, 'Priya')).toEqual({ kind: 'taken' })
    expect(checkName([{ ...guestMike, user_id: 'auth-mike' }], 'Mike')).toEqual({ kind: 'taken' })
  })

  it('will not offer a takeover of an orphaned co-host row', () => {
    expect(checkName(roster, 'Dana')).toEqual({ kind: 'taken' })
  })
})
