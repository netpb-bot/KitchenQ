import { NavLink } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import { Banknote, History, House, Trophy, User, Users, Zap } from 'lucide-react'

export type Tab = { to: string; label: string; icon: LucideIcon; end?: boolean }

/** App level. */
const APP_TABS: Tab[] = [
  { to: '/', label: 'Home', icon: House, end: true },
  { to: '/clubs', label: 'Clubs', icon: Users },
  { to: '/profile', label: 'Profile', icon: User },
]

/** Session level — relative to /session/:id, so these are built per session. */
export function sessionTabs(sessionId: string): Tab[] {
  const base = `/session/${sessionId}`
  return [
    { to: base, label: 'Live', icon: Zap, end: true },
    { to: `${base}/ranks`, label: 'Ranks', icon: Trophy },
    { to: `${base}/history`, label: 'History', icon: History },
    { to: `${base}/fees`, label: 'Fees', icon: Banknote },
  ]
}

/** Shared presentation for both levels. */
export function TabBar({ tabs, label }: { tabs: Tab[]; label: string }) {
  return (
    <nav
      aria-label={label}
      className="fixed inset-x-0 bottom-0 z-20 border-t border-hairline bg-surface pb-[env(safe-area-inset-bottom)]"
    >
      <div
        className="grid"
        style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
      >
        {tabs.map(({ to, label: text, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex flex-col items-center justify-center gap-1 py-2.5 text-[11px] font-semibold transition-colors ${
                isActive ? 'text-primary' : 'text-muted'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <Icon
                  size={22}
                  strokeWidth={isActive ? 2.5 : 2}
                  fill={isActive ? 'currentColor' : 'none'}
                  fillOpacity={isActive ? 0.12 : 0}
                  aria-hidden
                />
                {text}
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}

export function AppTabBar() {
  return <TabBar tabs={APP_TABS} label="Main" />
}
