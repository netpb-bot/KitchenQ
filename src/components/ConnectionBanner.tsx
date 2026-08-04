import { useEffect, useState } from 'react'
import { WifiOff } from 'lucide-react'
import type { Connection } from '../lib/db'

/**
 * Whether a load failed because the server could not be reached.
 *
 * `navigator.onLine` is not enough on its own: it reports true for any network
 * interface at all, so a gym wifi that has stopped routing to the internet —
 * much more common than real airplane mode — looks perfectly online while every
 * request fails. The failed request is the honest signal.
 */
export function isUnreachable(error: string | undefined): boolean {
  if (!error) return false
  return /failed to fetch|networkerror|load failed|network request failed/i.test(error)
}

/** True while the browser believes it has no network at all. */
export function useOffline(): boolean {
  const [offline, setOffline] = useState(() => !navigator.onLine)

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine)
    addEventListener('online', update)
    addEventListener('offline', update)
    return () => {
      removeEventListener('online', update)
      removeEventListener('offline', update)
    }
  }, [])

  return offline
}

/**
 * Says so when the screen has stopped being live. Without it a dropped socket
 * looks exactly like a quiet night — the roster simply stops changing, and the
 * host goes on calling names from a list that is no longer true.
 *
 * `state` is the realtime channel, which only the session screens have. Pass
 * nothing elsewhere and this is purely an offline indicator.
 */
export function ConnectionBanner({
  state = 'live',
  error,
}: {
  state?: Connection
  /** A load failure, so a wifi that connects but does not route is caught too. */
  error?: string
}) {
  const offline = useOffline()
  const unreachable = offline || isUnreachable(error)
  if (!unreachable && state !== 'dropped') return null

  return (
    <div
      role="status"
      className="mt-3 flex items-center gap-2 rounded-xl bg-warn-tint px-3 py-2.5 text-sm font-medium text-warn"
    >
      <WifiOff size={16} strokeWidth={2.25} className="shrink-0" aria-hidden />
      {unreachable
        ? "Can't reach the club right now. This is the last thing the app saw — it will catch up when you're back."
        : 'Reconnecting — you may be seeing old information.'}
    </div>
  )
}
