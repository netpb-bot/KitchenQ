import { useEffect, useRef } from 'react'
import { Link, useParams } from 'react-router-dom'
import { QRCodeCanvas } from 'qrcode.react'
import { ChevronLeft, Download } from 'lucide-react'
import { getSession, joinUrl, useAsync, type Session } from '../lib/db'
import { Button, ErrorNote, Loading } from '../components/ui'

/**
 * Held up at the net post so arrivals can scan instead of squinting at a code
 * read out over court noise. The QR is just the share link — everything behind
 * it already existed, so a scan lands on Join with the code filled and only a
 * name left to type.
 *
 * Deliberately not a SessionScreen: that wrapper renders the whole stats header
 * above its children, and this screen is one square that wants the viewport.
 */
export function SessionQr() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const [view, reload] = useAsync(() => getSession(sessionId!), [sessionId])

  useWakeLock()

  return (
    <main className="mx-auto flex min-h-dvh max-w-[30rem] flex-col bg-page px-4 pb-8">
      <Link
        to={`/session/${sessionId}`}
        className="-ml-1 inline-flex min-h-11 shrink-0 items-center gap-1 self-start pt-3 text-meta font-medium text-muted"
      >
        <ChevronLeft size={17} aria-hidden />
        Session
      </Link>

      {view.loading ? (
        <Loading label="Loading session…" />
      ) : view.error ? (
        <ErrorNote onRetry={reload}>{view.error}</ErrorNote>
      ) : (
        <Poster session={view.data!} />
      )}
    </main>
  )
}

function Poster({ session }: { session: Session }) {
  const frame = useRef<HTMLDivElement>(null)
  const url = joinUrl(session.join_code)

  // join_session refuses an ended session, so a QR here would scan straight
  // into an error. Say so on this side of the camera instead.
  const closed = session.status === 'ended'

  function save() {
    const canvas = frame.current?.querySelector('canvas')
    if (!canvas) return
    const link = document.createElement('a')
    // The code, not the session name: names are free text and would need
    // sanitising before they can be a filename.
    link.download = `kitchenq-${session.join_code}.png`
    link.href = canvas.toDataURL('image/png')
    link.click()
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 py-6 text-center">
      <h1 className="text-title font-semibold text-ink">{session.name}</h1>

      {closed ? (
        <p className="max-w-xs text-body text-muted">
          This session has ended, so there is nothing left to scan into. Reopen it
          from the session screen to let players join again.
        </p>
      ) : (
        <>
          {/* White and black outright rather than theme tokens: a camera reads
              contrast, and the palette is not guaranteed to keep enough of it.
              The canvas renders at 640px and downscales, so it stays crisp on a
              phone and the saved PNG is still big enough for a group chat. */}
          <div ref={frame} className="rounded-card bg-white p-4 shadow-lift">
            <QRCodeCanvas
              value={url}
              // size is the bitmap, not the box: it is what makes the saved PNG
              // big enough to be useful, and the library scales the backing
              // store by devicePixelRatio on top of it.
              size={640}
              level="M"
              marginSize={2}
              bgColor="#ffffff"
              fgColor="#000000"
              // qrcode.react writes style={{width: size, height: size}} straight
              // onto the canvas, so w-full and h-auto never applied — only max-w
              // did, because max-width is a separate property rather than a
              // competing declaration. That clamped the width to 320 and left
              // the height at 640, stretching the code 2:1 and making it hard to
              // scan. Dimensions have to be inline to win; the library spreads
              // this prop last.
              style={{ width: '100%', height: 'auto' }}
              className="aspect-square max-w-[20rem]"
            />
          </div>

          <div>
            <p className="text-meta font-medium uppercase text-muted">Or type this code</p>
            <p className="tnum mt-1 text-display font-semibold tracking-[0.18em] text-ink">
              {session.join_code}
            </p>
          </div>

          {/* A QR that will not scan is otherwise a dead end, so the typed path
              stays on screen next to it. */}
          <p className="max-w-xs text-meta text-muted">
            Point a phone camera at the code, or open{' '}
            <span className="font-medium text-ink">{location.host}/join</span> and enter
            it by hand.
          </p>

          <Button variant="secondary" size="sm" icon={Download} onClick={save}>
            Save image
          </Button>
        </>
      )}
    </div>
  )
}

/**
 * Keeps the screen up while the QR is showing — a host props the phone against
 * a bag and walks off, and a dimmed screen is an unscannable one.
 *
 * Re-acquired on visibilitychange because the lock is dropped whenever the tab
 * hides and is never restored on its own. Failures are swallowed: the API is
 * missing on older iOS Safari and on insecure origins, and a dimming screen is
 * not something a host can act on.
 */
function useWakeLock() {
  useEffect(() => {
    let lock: WakeLockSentinel | null = null
    let dropped = false

    const acquire = () => {
      if (document.visibilityState !== 'visible') return
      navigator.wakeLock?.request('screen').then(
        (held) => {
          // Unmounted while the request was in flight.
          if (dropped) void held.release()
          else lock = held
        },
        () => {},
      )
    }

    acquire()
    document.addEventListener('visibilitychange', acquire)
    return () => {
      dropped = true
      document.removeEventListener('visibilitychange', acquire)
      void lock?.release()
    }
  }, [])
}
