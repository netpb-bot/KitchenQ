import { Handshake } from 'lucide-react'
import {
  respondPair,
  useAction,
  type Member,
  type PairRequest,
  type SessionPlayer,
} from '../lib/db'
import { Button } from './ui'

/**
 * Asks waiting on an answer.
 *
 * Rendered by the session shell, so it shows on Standings and Fees too rather
 * than only on Live. The person who sent it is standing courtside watching for
 * a yes; a request that sat quietly behind a tab would be worse than no feature
 * at all. Amber rather than the session's green: this is the one card on the
 * screen that will not resolve itself.
 */
export function PairInbox({
  requests,
  players,
  me,
  reload,
}: {
  requests: PairRequest[]
  players: SessionPlayer[]
  me: Member | null
  reload: () => void
}) {
  const incoming = requests.filter((r) => r.status === 'pending' && r.to_member === me?.id)
  if (incoming.length === 0) return null

  const names = new Map(players.map((p) => [p.club_members.id, p.club_members.display_name]))

  return (
    <div className="mt-4 space-y-2" role="status" aria-live="polite">
      {incoming.map((request) => (
        <PairAsk
          key={request.id}
          request={request}
          name={names.get(request.from_member) ?? 'Someone'}
          reload={reload}
        />
      ))}
    </div>
  )
}

function PairAsk({
  request,
  name,
  reload,
}: {
  request: PairRequest
  name: string
  reload: () => void
}) {
  const [busy, error, run] = useAction()

  const answer = (next: 'accepted' | 'declined') =>
    run(async () => {
      await respondPair(request.id, next)
      reload()
    })

  return (
    <div className="rounded-card bg-warn-tint px-4 py-3 ring-1 ring-warn/20">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Handshake size={18} className="shrink-0 text-warn" aria-hidden />
        <p className="min-w-0 flex-1 text-body font-medium text-warn">
          {name} wants to play with you
        </p>
        {/* Decline first would put the destructive answer under the thumb. */}
        <Button size="sm" loading={busy} onClick={() => answer('accepted')}>
          Accept
        </Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => answer('declined')}>
          Decline
        </Button>
      </div>
      <p className="mt-1 text-meta text-warn/80">
        You'll be on the same team next game, from whichever of you is further back in the
        queue.
      </p>
      {error && <p className="mt-1 text-meta font-medium text-danger">{error}</p>}
    </div>
  )
}
