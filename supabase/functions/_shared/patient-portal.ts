import { createClient, type SupabaseClient, type User } from 'https://esm.sh/@supabase/supabase-js@2.57.4'

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function defaultKey(jsonName: string): string | undefined {
  const raw = Deno.env.get(jsonName)
  if (!raw) return undefined
  try {
    const keys = JSON.parse(raw)
    return typeof keys.default === 'string' ? keys.default : undefined
  } catch {
    return undefined
  }
}

export type PortalRequestContext = {
  actor: User
  userClient: SupabaseClient
  admin: SupabaseClient
  anonymous: SupabaseClient
}

export async function portalRequestContext(request: Request): Promise<PortalRequestContext | Response> {
  const authorization = request.headers.get('Authorization')
  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
    ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY')
    ?? defaultKey('SUPABASE_PUBLISHABLE_KEYS')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SECRET_KEY')
  if (!authorization?.startsWith('Bearer ') || !url || !anonKey || !serviceKey) {
    return json({ error: 'Autenticación o configuración incompleta.' }, 401)
  }

  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  const { data, error } = await userClient.auth.getUser()
  if (error || !data.user) return json({ error: 'Inicia sesión para administrar el acceso al portal.' }, 401)

  return {
    actor: data.user,
    userClient,
    admin: createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }),
    anonymous: createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }),
  }
}

export async function verifyClinicOwner(context: PortalRequestContext, clinicId: string) {
  const { data, error } = await context.userClient
    .from('clinic_members')
    .select('role')
    .eq('clinic_id', clinicId)
    .eq('user_id', context.actor.id)
    .maybeSingle()
  return !error && data?.role === 'owner'
}

export function portalRedirectUrl(): string | null {
  const configured = Deno.env.get('PATIENT_PORTAL_REDIRECT_URL')?.trim()
  if (!configured) return null
  try {
    const url = new URL(configured)
    const allowedProtocol = url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))
    if (!allowedProtocol || url.username || url.password || url.pathname.replace(/\/$/, '') !== '/portal') return null
    return url.toString()
  } catch {
    return null
  }
}
