import { Trophy } from 'lucide-react'
import { myMemberships, useAsync } from '../lib/db'
import { Avatar } from '../components/Avatar'
import {
  DarkCard,
  EmptyState,
  ErrorNote,
  Loading,
  Pill,
  Screen,
  SectionHeading,
} from '../components/ui'

export function Profile() {
  const [view] = useAsync(myMemberships, [])
  const me = view.data?.[0] ?? null

  return (
    <Screen title="Profile">
      {view.loading ? (
        <Loading />
      ) : view.error ? (
        <ErrorNote>{view.error}</ErrorNote>
      ) : (
        <DarkCard className="flex items-center gap-4">
          <Avatar name={me?.display_name ?? '?'} size="xl" />
          <div className="min-w-0">
            <p className="truncate text-lg font-bold text-white">
              {me?.display_name ?? 'Not a member yet'}
            </p>
            <div className="mt-2">
              <Pill tone="onDark">{me ? me.skill_tier : 'No tier'}</Pill>
            </div>
          </div>
        </DarkCard>
      )}

      <SectionHeading>Record</SectionHeading>
      <EmptyState
        icon={Trophy}
        message="No matches yet."
        hint="Scores and standings start once matches are recorded in milestone 3."
      />
    </Screen>
  )
}
