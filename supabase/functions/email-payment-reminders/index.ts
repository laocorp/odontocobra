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

function safeEqual(left: string, right: string): boolean {
  const size = Math.max(left.length, right.length)
  let difference = left.length ^ right.length
  for (let index = 0; index < size; index += 1) {
    difference |= (left.charCodeAt(index % Math.max(left.length, 1)) || 0)
      ^ (right.charCodeAt(index % Math.max(right.length, 1)) || 0)
  }
  return difference === 0
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Método no permitido.' }, 405)

  const secret = Deno.env.get('ODONTO_EMAIL_REMINDERS_SECRET')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const url = Deno.env.get('SUPABASE_URL')
  if (!secret || !serviceKey || !url) return json({ error: 'Servicio no configurado.' }, 503)

  const authorization = request.headers.get('Authorization') ?? ''
  if (!authorization.startsWith('Bearer ') || !safeEqual(authorization.slice(7), secret)) {
    return json({ error: 'No autorizado.' }, 401)
  }

  let body: { action?: string; dispatch_id?: string }
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Solicitud inválida.' }, 400)
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  if (body.action === 'claim') {
    const { data, error } = await admin.rpc('claim_email_payment_reminders')
    if (error) return json({ error: 'No se pudieron preparar los recordatorios.' }, 500)
    return json({ reminders: data ?? [] })
  }

  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  if (!['sent', 'failed'].includes(body.action ?? '') || typeof body.dispatch_id !== 'string' || !uuid.test(body.dispatch_id)) {
    return json({ error: 'Solicitud inválida.' }, 400)
  }

  const { error } = await admin.rpc('finish_email_payment_reminder', {
    p_dispatch_id: body.dispatch_id,
    p_status: body.action,
  })
  if (error) return json({ error: 'No se pudo registrar el resultado del recordatorio.' }, 500)
  return json({ ok: true })
})
