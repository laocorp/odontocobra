import { createClient } from '@supabase/supabase-js'

const runtimeConfig = typeof window === 'undefined' ? undefined : window.__ODONTOCUENTA_CONFIG__
const url = runtimeConfig?.supabaseUrl?.trim() || import.meta.env.VITE_SUPABASE_URL?.trim()
const key = runtimeConfig?.supabasePublishableKey?.trim() || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
const isPatientPortalRoute = typeof window !== 'undefined' && window.location.pathname.startsWith('/portal')

export const supabase = url && key ? createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: !isPatientPortalRoute },
}) : null
export const patientPortalSupabase = url && key ? createClient(url, key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: isPatientPortalRoute,
    storageKey: 'odontocuenta-patient-portal-auth',
  },
}) : null
export const cloudConfigured = Boolean(supabase)
