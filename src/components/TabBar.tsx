import { NavLink } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import { House, Trophy, User, Users, Zap } from 'lucide-react'

export type Tab = { to: string; label: string; icon: LucideIcon; end?: boolean }

/** App level. */
const APP_TABS: Tab[] = [
  { to: '/', label: 'Home', icon: House, end: true },
  { to: '/clubs', label: 'Clubs', icon: Users },
  { to: '/profile', label: 'Profile', icon: User },
]

/**
 * Session level — relative to /session/:id, so these are built per session.
 *
 * Two, not four. History is read once a night and now sits under the standings
 * it explains; fees is a host job reached from the session header. A tab bar is
 * for the places you move between constantly, and those are Live and Standings.
 */
export function sessionTabs(sessionId: string): Tab[] {
  const base = `/session/${sessionId}`
  return [
    { to: base, label: 'Live', icon: Zap, end: true },
    { to: `${base}/standings`, label: 'Standings', icon: Trophy },
  ]
}

/** Shared presentation for both levels. */
export function TabBar({ tabs, label }: { tabs: Tab[]; label: string }) {
  return (
    <nav
      aria-label={label}
      // Full-bleed on a phone, where it sits against the bottom edge. On a
      // desktop browser it detaches into a floating pill — a nav bar spanning a
      // 2560px monitor reads as a broken site. The pill sizes to its tabs, so
      // the two-tab session bar is not a mostly-empty 26rem sled.
      className="fixed inset-x-0 bottom-0 z-20 border-t border-hairline bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:inset-x-auto md:left-1/2 md:bottom-5 md:w-auto md:-translate-x-1/2 md:rounded-full md:border md:pb-0 md:shadow-pop"
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
              `flex min-h-[var(--tabbar-h)] flex-col items-center justify-center gap-1 py-2.5 text-caption font-semibold transition-colors active:scale-95 md:rounded-full md:px-7 ${
                isActive ? 'text-primary' : 'text-muted md:hover:bg-fill'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <Icon
                  size={21}
                  strokeWidth={isActive ? 2.5 : 1.9}
                  fill={isActive ? 'currentColor' : 'none'}
                  fillOpacity={isActive ? 0.14 : 0}
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
