import { ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { Session } from '../lib/db'
import { Card, Pill } from './ui'

/**
 * One session in a list.
 *
 * Home and the club's Sessions tab rendered two copies of this markup that had
 * already drifted apart by one pill; the photo background would have made that
 * three copies.
 *
 * With a photo the card inverts: the image fills it, a scrim goes over the
 * image, and the text turns white. The scrim is not decoration — it is the only
 * reason a join code stays readable over a shot taken into a bright gym window.
 */
export function SessionCard({ session }: { session: Session }) {
  const photo = session.photo_url

  return (
    <Link to={`/session/${session.id}`} className="block">
      <Card
        interactive
        className={`relative flex items-center gap-3 overflow-hidden ${photo ? 'min-h-24' : ''}`}
      >
        {photo && (
          <>
            <img
              src={photo}
              alt=""
              aria-hidden
              loading="lazy"
              className="absolute inset-0 h-full w-full object-cover"
            />
            {/* Flat, not a gradient. 72% is the number where the worst case —
                white text over a photo of a sunlit court — still clears 4.5:1,
                and that has to hold under the pill on the right as much as
                under the name on the left. */}
            <div aria-hidden className="absolute inset-0 bg-surface-darker/72" />
          </>
        )}

        <div className="relative min-w-0 flex-1">
          <p className={`truncate text-body font-medium ${photo ? 'text-white' : 'text-ink'}`}>
            {session.name}
          </p>
          <p className={`tnum mt-0.5 text-meta ${photo ? 'text-white/75' : 'text-muted'}`}>
            {session.court_count} {session.court_count === 1 ? 'court' : 'courts'} · code{' '}
            {session.join_code}
          </p>
        </div>

        {/* `relative` on every sibling of the photo, not just this one: an
            absolutely positioned image paints above static content, so without
            it the scrim covers the card's own text. */}
        <Pill
          tone={statusTone(session.status, Boolean(photo))}
          dot={session.status === 'live'}
          className="relative shrink-0"
        >
          {statusLabel(session.status)}
        </Pill>

        <ChevronRight
          size={18}
          className={`relative shrink-0 ${photo ? 'text-white/75' : 'text-muted'}`}
          aria-hidden
        />
      </Card>
    </Link>
  )
}

/**
 * Exported for the test. A photo forces the on-dark tones: `warn` and `neutral`
 * are a pale chip carrying dark text, which over a scrimmed photo is a hole.
 */
export function statusTone(
  status: Session['status'],
  photo: boolean,
): 'live' | 'warn' | 'warnOnDark' | 'neutral' | 'onDark' {
  if (status === 'live') return 'live'
  if (status === 'draft') return photo ? 'warnOnDark' : 'warn'
  return photo ? 'onDark' : 'neutral'
}

function statusLabel(status: Session['status']): string {
  return status === 'live' ? 'LIVE' : status === 'draft' ? 'Not started' : 'Ended'
}
