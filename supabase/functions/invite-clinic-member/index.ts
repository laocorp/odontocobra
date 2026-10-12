import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
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

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Método no permitido.' }, 405)

  const authorization = request.headers.get('Authorization')
  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? defaultKey('SUPABASE_PUBLISHABLE_KEYS')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!authorization?.startsWith('Bearer ') || !url || !anonKey || !serviceKey) {
    return json({ error: 'Autenticación o configuración incompleta.' }, 401)
  }

  let clinicId: string
  let email: string
  try {
    const body = await request.json()
    clinicId = body?.clinic_id
    email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
    if (typeof clinicId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clinicId)) {
      return json({ error: 'Consultorio inválido.' }, 400)
    }
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ error: 'Escribe un correo electrónico válido.' }, 400)
    }
  } catch {
    return json({ error: 'Solicitud inválida.' }, 400)
  }

  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: authData, error: authError } = await userClient.auth.getUser()
  if (authError || !authData.user) return json({ error: 'Inicia sesión para administrar el equipo.' }, 401)

  const { data: membership, error: membershipError } = await userClient
    .from('clinic_members')
    .select('role')
    .eq('clinic_id', clinicId)
    .eq('user_id', authData.user.id)
    .maybeSingle()
  if (membershipError || membership?.role !== 'owner') return json({ error: 'Solo la persona propietaria puede invitar asistentes.' }, 403)

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: existingUserId, error: lookupError } = await admin.rpc('find_auth_user_by_email', { p_email: email })
  if (lookupError) return json({ error: 'No se pudo comprobar la cuenta del correo indicado.' }, 500)

  let userId = existingUserId as string | null
  let invited = false
  if (!userId) {
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email)
    if (error || !data.user) return json({ error: 'No se pudo enviar la invitación. Revisa la configuración de correo de Supabase.' }, 502)
    userId = data.user.id
    invited = true
  }

  const { error: insertError } = await admin.from('clinic_members').insert({ clinic_id: clinicId, user_id: userId, role: 'assistant' })
  if (insertError) {
    if (invited) await admin.auth.admin.deleteUser(userId)
    return json({ error: insertError.code === '23505' ? 'Ese correo ya forma parte del consultorio.' : 'No se pudo agregar a la persona al equipo.' }, insertError.code === '23505' ? 409 : 500)
  }

  const { error: auditError } = await admin.from('audit_events').insert({
    clinic_id: clinicId,
    actor_id: authData.user.id,
    action: 'clinic_member.invited',
    entity_type: 'clinic_member',
    entity_id: userId,
    details: { role: 'assistant', invitation_sent: invited },
  })
  if (auditError) {
    await admin.from('clinic_members').delete().eq('clinic_id', clinicId).eq('user_id', userId)
    if (invited) await admin.auth.admin.deleteUser(userId)
    return json({ error: 'No se pudo completar el registro de auditoría.' }, 500)
  }

  return json({ user_id: userId, email, role: 'assistant', invitation_sent: invited })
})
