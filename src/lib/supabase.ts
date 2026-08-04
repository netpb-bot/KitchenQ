import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isConfigured = Boolean(url && anonKey)

// Placeholder values keep createClient from throwing at import time when the app
// is unconfigured; App renders the setup screen instead of a blank page.
export const supabase = createClient(
  url || 'http://localhost',
  anonKey || 'anon',
  { auth: { persistSession: true, autoRefreshToken: true } },
)
