import { useEffect, useState } from 'react'
import { Share, X } from 'lucide-react'
import { Button, Card } from './ui'

/** Chrome fires this so a site can offer installation at a moment it chooses. */
type InstallEvent = Event & { prompt: () => Promise<void> }

const DISMISSED = 'kq.install-dismissed'

function isStandalone(): boolean {
  return (
    matchMedia('(display-mode: standalone)').matches ||
    // iOS predates the standard and still only reports it here.
    (navigator as { standalone?: boolean }).standalone === true
  )
}

function isIosSafari(): boolean {
  const ua = navigator.userAgent
  return /iPad|iPhone|iPod/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua)
}

/**
 * Offers to install the app. Worth its own component because the two platforms
 * need opposite things: Chrome hands us an event to fire, and iOS has no such
 * event at all — Safari users have to be told the manual steps or they simply
 * never install, which is half the club.
 */
export function InstallPrompt() {
  const [event, setEvent] = useState<InstallEvent | null>(null)
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISSED) === '1')

  useEffect(() => {
    const capture = (e: Event) => {
      e.preventDefault() // hold it, so we can offer at a calmer moment
      setEvent(e as InstallEvent)
    }
    addEventListener('beforeinstallprompt', capture)
    return () => removeEventListener('beforeinstallprompt', capture)
  }, [])

  if (dismissed || isStandalone()) return null

  const ios = isIosSafari()
  if (!event && !ios) return null

  function close() {
    localStorage.setItem(DISMISSED, '1')
    setDismissed(true)
  }

  return (
    <Card className="mt-3 flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-body font-medium text-ink">Add KitchenQ to your home screen</p>
        {ios ? (
          <p className="mt-1 flex flex-wrap items-center gap-1 text-meta text-muted">
            Tap <Share size={15} className="inline text-primary" aria-hidden />
            <span className="font-semibold text-ink">Share</span>, then
            <span className="font-semibold text-ink">Add to Home Screen</span>.
          </p>
        ) : (
          <>
            <p className="mt-1 text-meta text-muted">
              Opens full screen, straight to tonight's session.
            </p>
            <div className="mt-3">
              <Button
                onClick={() => {
                  void event!.prompt()
                  close()
                }}
              >
                Install
              </Button>
            </div>
          </>
        )}
      </div>
      <Button variant="ghost" icon={X} aria-label="Don't show this again" onClick={close} />
    </Card>
  )
}
