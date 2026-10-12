import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type BcvRate = { rate: string; asOf: string }

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

function dateKeyInTimezone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function parseDolarVzlaRate(payload: unknown): BcvRate {
  if (!payload || typeof payload !== 'object' || !('current' in payload)) {
    throw new Error('DolarVZLA devolvió una respuesta sin tasa actual.')
  }

  const today = dateKeyInTimezone(new Date(), 'America/Caracas')
  const parseRecord = (record: unknown): { rate: string; asOf: string; date: string } => {
    if (!record || typeof record !== 'object' || !('usd' in record) || !('date' in record)) {
      throw new Error('DolarVZLA devolvió una respuesta incompleta para la tasa BCV.')
    }
    const rawRate = record.usd
    const rate = typeof rawRate === 'number' || typeof rawRate === 'string' ? String(rawRate) : ''
    const date = typeof record.date === 'string' ? record.date : ''
    const dateMatch = date.match(/^\d{4}-\d{2}-\d{2}$/)?.[0]
    const effectiveDate = dateMatch ? new Date(`${dateMatch}T12:00:00.000Z`) : null
    if (!/^\d{1,12}(?:\.\d{1,10})?$/.test(rate) || !Number.isFinite(Number(rate)) || Number(rate) <= 0 || !dateMatch || !effectiveDate || Number.isNaN(effectiveDate.getTime()) || effectiveDate.toISOString().slice(0, 10) !== dateMatch) {
      throw new Error('La tasa o fecha BCV publicada por DolarVZLA no es válida.')
    }
    return { rate, asOf: effectiveDate.toISOString(), date: dateMatch }
  }

  const current = parseRecord(payload.current)
  const selected = current.date <= today
    ? current
    : 'previous' in payload ? parseRecord(payload.previous) : null
  if (!selected || selected.date > today) {
    throw new Error(`DolarVZLA reporta una tasa futura (${current.date}) y no incluye una tasa anterior vigente para hoy.`)
  }

  const daysOld = Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${selected.date}T12:00:00Z`)) / 86_400_000)
  if (daysOld > 7) throw new Error('La última tasa BCV vigente recibida de DolarVZLA tiene más de 7 días.')
  return { rate: selected.rate, asOf: selected.asOf }
}

Deno.serve(async (request) => {
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
  try {
    const body = await request.json()
    clinicId = body?.clinic_id
    if (typeof clinicId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clinicId)) {
      return json({ error: 'Consultorio inválido.' }, 400)
    }
  } catch {
    return json({ error: 'Solicitud inválida.' }, 400)
  }

  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } })
  const { data: authData, error: authError } = await userClient.auth.getUser()
  if (authError || !authData.user) return json({ error: 'Inicia sesión para consultar la tasa.' }, 401)

  const { data: membership, error: membershipError } = await userClient
    .from('clinic_members')
    .select('clinic_id')
    .eq('clinic_id', clinicId)
    .eq('user_id', authData.user.id)
    .maybeSingle()
  if (membershipError || !membership) return json({ error: 'No perteneces a este consultorio.' }, 403)

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  let bcvRate: BcvRate
  try {
    const response = await fetch('https://rates.dolarvzla.com/bcv/current.json', {
      headers: { Accept: 'application/json', 'User-Agent': 'OdontoCuenta/1.0 (+https://www.dolarvzla.com/)' },
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) throw new Error(`DolarVZLA respondió HTTP ${response.status}.`)
    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.toLowerCase().includes('application/json')) throw new Error('DolarVZLA no devolvió un JSON válido.')
    bcvRate = parseDolarVzlaRate(await response.json())
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'No se pudo consultar la tasa BCV a través de DolarVZLA.' }, 502)
  }

  const { data, error } = await admin.rpc('record_bcv_exchange_rate', {
    p_clinic_id: clinicId,
    p_rate: bcvRate.rate,
    p_as_of: bcvRate.asOf,
    p_actor_id: authData.user.id,
  })
  if (error) return json({ error: 'La tasa se verificó, pero no se pudo guardar en el historial. ' + error.message }, 500)
  const saved = Array.isArray(data) ? data[0] : data
  if (!saved?.id) return json({ error: 'No se recibió confirmación del historial de tasas.' }, 500)
  return json({ rate: String(saved.rate), source: saved.source, provider: 'DolarVZLA', id: saved.id, as_of: saved.as_of, validated_at: saved.validated_at })
})
