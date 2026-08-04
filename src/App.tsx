import { Component, useEffect } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import {
  BrowserRouter,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useParams,
} from 'react-router-dom'
import { AppTabBar, TabBar, sessionTabs } from './components/TabBar'
import { isConfigured } from './lib/supabase'
import { Button, Card, Screen } from './components/ui'
import { Home } from './routes/Home'
import { Clubs } from './routes/Clubs'
import { ClubDetail } from './routes/ClubDetail'
import { Join } from './routes/Join'
import { Profile } from './routes/Profile'
import {
  SessionFees,
  SessionHistory,
  SessionLive,
  SessionRanks,
} from './routes/SessionScreens'

export default function App() {
  if (!isConfigured) return <SetupNeeded />
  // One boundary at the root. A render throw mid-session currently blanks the
  // screen with twelve people waiting on the host's phone.
  return (
    <ErrorBoundary>
      <Router />
    </ErrorBoundary>
  )
}

function Router() {
  return (
    <BrowserRouter>
      <RouteFocus />
      <Routes>
        {/* App level */}
        <Route element={<AppLayout />}>
          <Route path="/" element={<Home />} />
          <Route path="/clubs" element={<Clubs />} />
          <Route path="/clubs/:clubId" element={<ClubDetail />} />
          <Route path="/join" element={<Join />} />
          <Route path="/profile" element={<Profile />} />
        </Route>

        {/* Session level — owns the screen, with its own tab bar. */}
        <Route path="/session/:sessionId" element={<SessionLayout />}>
          <Route index element={<SessionLive />} />
          <Route path="ranks" element={<SessionRanks />} />
          <Route path="history" element={<SessionHistory />} />
          <Route path="fees" element={<SessionFees />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

/**
 * Moves focus to the page heading on every navigation. Without it a keyboard or
 * screen-reader user taps a tab and nothing announces — focus stays wherever it
 * was on the screen they just left.
 */
function RouteFocus() {
  const { pathname } = useLocation()
  useEffect(() => {
    const heading = document.querySelector('h1')
    if (!heading) return
    heading.setAttribute('tabindex', '-1')
    heading.focus({ preventScroll: true })
  }, [pathname])
  return null
}

class ErrorBoundary extends Component<{ children: ReactNode }, { message: string }> {
  state = { message: '' }

  static getDerivedStateFromError(error: unknown) {
    return { message: error instanceof Error ? error.message : String(error) }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('KitchenQ crashed', error, info.componentStack)
  }

  render() {
    if (!this.state.message) return this.props.children
    return (
      <Screen title="Something broke" subtitle="The session itself is safe.">
        <Card className="border border-danger-tint">
          <p className="font-semibold text-danger">KitchenQ hit an error and stopped.</p>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Nothing you recorded is lost — scores and payments live on the server, not
            in this screen. Reloading should put you back where you were.
          </p>
          <p className="mt-3 break-words text-xs text-muted">{this.state.message}</p>
          <div className="mt-4">
            <Button full onClick={() => location.reload()}>
              Reload
            </Button>
          </div>
        </Card>
      </Screen>
    )
  }
}

function AppLayout() {
  return (
    <>
      <Outlet />
      <AppTabBar />
    </>
  )
}

function SessionLayout() {
  const { sessionId } = useParams()
  return (
    <>
      <Outlet />
      <TabBar tabs={sessionTabs(sessionId!)} label="Session" />
    </>
  )
}

function SetupNeeded() {
  return (
    <Screen title="Setup" subtitle="KitchenQ needs a Supabase connection.">
      <Card className="border border-warn-tint">
        <p className="font-semibold text-warn">Supabase is not configured.</p>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Copy <span className="font-semibold text-ink">.env.example</span> to{' '}
          <span className="font-semibold text-ink">.env</span>, fill in{' '}
          <span className="font-semibold text-ink">VITE_SUPABASE_URL</span> and{' '}
          <span className="font-semibold text-ink">VITE_SUPABASE_ANON_KEY</span>, then
          restart the dev server. Full steps are in the README.
        </p>
      </Card>
    </Screen>
  )
}
