import {
  corsHeaders,
  isUuid,
  json,
  portalRequestContext,
  verifyClinicOwner,
} from '../_shared/patient-portal.ts'

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Método no permitido.' }, 405)

  let body: { clinic_id?: unknown; access_id?: unknown }
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Solicitud inválida.' }, 400)
  }
  if (!isUuid(body.clinic_id) || !isUuid(body.access_id)) return json({ error: 'Consultorio o acceso inválido.' }, 400)

  const requestContext = await portalRequestContext(request)
  if (requestContext instanceof Response) return requestContext
  const context = requestContext
  if (!await verifyClinicOwner(context, body.clinic_id)) {
    return json({ error: 'Solo la persona propietaria puede administrar el acceso del paciente.' }, 403)
  }

  const { error } = await context.admin.rpc('revoke_patient_portal_access', {
    p_clinic_id: body.clinic_id,
    p_access_id: body.access_id,
    p_actor_id: context.actor.id,
  })
  if (error) {
    if (error.code === 'P0002') return json({ error: 'No se encontró un acceso de paciente para revocar.' }, 404)
    return json({ error: 'No se pudo revocar el acceso al portal.' }, 500)
  }

  // The account read/session RPC checks the revoked status on every call. The
  // portal polls that check on each open device and clears its local Auth
  // session when it sees false, so no service-role token or patient JWT is
  // needed here to close the other browser sessions.
  return json({ ok: true, access_revoked: true })
})
