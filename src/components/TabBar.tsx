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
      // Full-bleed on a phone, where it sits against the bottom edge. On a
      // desktop browser it detaches into a floating pill the width of the app
      // column — a nav bar spanning a 2560px monitor reads as a broken site.
      className="fixed inset-x-0 bottom-0 z-20 border-t border-hairline bg-surface pb-[env(safe-area-inset-bottom)] md:inset-x-auto md:left-1/2 md:bottom-5 md:w-[26rem] md:-translate-x-1/2 md:rounded-full md:border md:pb-0 md:shadow-pop"
    >
      <div
        className="grid md:px-2"
        style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
      >
        {tabs.map(({ to, label: text, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              // A NavLink is a plain <a>, which the 44px rule in index.css does
              // not match. The app's most-tapped control should not depend on
              // the icon size for its target height.
              `flex min-h-[var(--tabbar-h)] flex-col items-center justify-center gap-1 py-2.5 text-[11px] font-semibold transition-colors active:scale-95 md:rounded-full ${
                isActive ? 'text-primary' : 'text-muted md:hover:bg-tint/50'
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
