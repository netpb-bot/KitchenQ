import { BrowserRouter, Navigate, Outlet, Route, Routes, useParams } from 'react-router-dom'
import { AppTabBar, TabBar, sessionTabs } from './components/TabBar'
import { isConfigured } from './lib/supabase'
import { Card, Screen } from './components/ui'
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

  return (
    <BrowserRouter>
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
