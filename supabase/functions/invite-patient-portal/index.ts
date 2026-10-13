import {
  corsHeaders,
  isUuid,
  json,
  portalRedirectUrl,
  portalRequestContext,
  verifyClinicOwner,
} from '../_shared/patient-portal.ts'

type PortalAccess = {
  id: string
  user_id: string | null
  invited_email: string
  status: 'invited' | 'active' | 'revoked'
}

function differentEmailError(message = 'Ese correo ya está asociado a otra cuenta de OdontoCuenta. Usa otro correo para el portal.') {
  return json({ code: 'PATIENT_PORTAL_USE_DIFFERENT_EMAIL', error: message }, 409)
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Método no permitido.' }, 405)

  let body: { clinic_id?: unknown; patient_id?: unknown; email?: unknown }
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Solicitud inválida.' }, 400)
  }
  if (!isUuid(body.clinic_id) || !isUuid(body.patient_id)) return json({ error: 'Consultorio o paciente inválido.' }, 400)

  const requestContext = await portalRequestContext(request)
  if (requestContext instanceof Response) return requestContext
  const context = requestContext
  if (!await verifyClinicOwner(context, body.clinic_id)) {
    return json({ error: 'Solo la persona propietaria puede administrar el acceso del paciente.' }, 403)
  }

  // Read the address from the owner's patient record. Never accept an email or
  // Auth user ID supplied by the browser as the source of truth.
  const { data: patient, error: patientError } = await context.userClient
    .from('patients')
    .select('id, email, archived_at')
    .eq('clinic_id', body.clinic_id)
    .eq('id', body.patient_id)
    .maybeSingle()
  if (patientError) return json({ error: 'No se pudo comprobar la ficha del paciente.' }, 500)
  if (!patient || patient.archived_at) return json({ error: 'El paciente no existe o está archivado.' }, 404)
  const profileEmail = typeof patient.email === 'string' ? patient.email.trim().toLowerCase() : ''
  const suppliedEmail = body.email === undefined || body.email === null || body.email === ''
    ? profileEmail
    : typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const email = suppliedEmail
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: 'Agrega un correo válido a la ficha del paciente o escribe un correo alternativo para el portal.' }, 400)
  }

  const redirectTo = portalRedirectUrl()
  if (!redirectTo) return json({ error: 'Falta configurar PATIENT_PORTAL_REDIRECT_URL con la URL segura terminada en /portal.' }, 503)

  const { data: access, error: accessError } = await context.admin
    .from('patient_portal_access')
    .select('id, user_id, invited_email, status')
    .eq('clinic_id', body.clinic_id)
    .eq('patient_id', body.patient_id)
    .maybeSingle<PortalAccess>()
  if (accessError) return json({ error: 'No se pudo consultar el estado del acceso al portal.' }, 500)

  // A live or pending account must first be revoked before changing the email
  // or replacing the person who owns this one-patient account.
  if (access && access.status !== 'revoked' && access.invited_email.toLowerCase() !== email) {
    return json({ error: 'Revoca el acceso actual antes de cambiar el correo del portal.' }, 409)
  }

  const { data: existingUserId, error: lookupError } = await context.admin.rpc('find_auth_user_by_email', { p_email: email })
  if (lookupError) return json({ error: 'No se pudo comprobar el correo en las cuentas de acceso.' }, 500)
  let userId = typeof existingUserId === 'string' ? existingUserId : null
  let invitationSent = false
  let createdAuthUser = false

  if (userId) {
    const { data: staffMembership, error: staffError } = await context.admin
      .from('clinic_members')
      .select('clinic_id')
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle()
    if (staffError) return json({ error: 'No se pudo comprobar si el correo pertenece al equipo de un consultorio.' }, 500)
    if (staffMembership) return differentEmailError('Ese correo ya pertenece al personal de un consultorio. Usa otro correo para el portal del paciente.')

    const { data: otherAccess, error: otherAccessError } = await context.admin
      .from('patient_portal_access')
      .select('clinic_id, patient_id')
      .eq('user_id', userId)
      .maybeSingle()
    if (otherAccessError) return json({ error: 'No se pudo comprobar si el correo ya tiene un portal de paciente.' }, 500)
    if (otherAccess && (otherAccess.clinic_id !== body.clinic_id || otherAccess.patient_id !== body.patient_id)) {
      return differentEmailError('Ese correo ya tiene acceso al portal de otro paciente. Usa un correo distinto; cada acceso corresponde a una sola persona.')
    }

    if (access?.status === 'active' && access.user_id === userId && access.invited_email.toLowerCase() === email) {
      return json({ access_id: access.id, email, status: 'active', invitation_sent: false, already_active: true })
    }

    // Existing non-staff Auth users cannot be sent a second invite through
    // inviteUserByEmail. Send a passwordless link without creating accounts;
    // the database activation RPC still requires this email to be verified.
    const { data: accessId, error: createError } = await context.admin.rpc('create_patient_portal_invitation', {
      p_clinic_id: body.clinic_id,
      p_patient_id: body.patient_id,
      p_user_id: userId,
      p_email: email,
      p_actor_id: context.actor.id,
    })
    if (createError || typeof accessId !== 'string') {
      return json({ error: createError?.code === '23505'
        ? 'Este paciente ya tiene una invitación o acceso activo. Revoca el acceso actual antes de reemplazarlo.'
        : 'No se pudo registrar la invitación del paciente.' }, createError?.code === '23505' ? 409 : 500)
    }

    const { error: otpError } = await context.anonymous.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false, emailRedirectTo: redirectTo },
    })
    if (otpError) {
      return json({ access_id: accessId, email, status: 'invited', invitation_sent: false,
        warning: 'El acceso quedó pendiente, pero no se pudo enviar el correo. Intenta reenviar la invitación.' })
    }
    return json({ access_id: accessId, email, status: 'invited', invitation_sent: true })
  } else {
    const { data: invitedUser, error: inviteError } = await context.admin.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: { odonto_portal: 'patient' },
    })
    if (inviteError || !invitedUser.user) {
      // A simultaneous request can create the same account between lookup and
      // invite. Do not silently bind to it: a retry will apply the staff and
      // one-patient checks against the now-existing Auth user.
      return json({ error: 'No se pudo enviar la invitación. Revisa el correo o vuelve a intentarlo.' }, 502)
    }
    userId = invitedUser.user.id
    invitationSent = true
    createdAuthUser = true
  }

  const { data: accessId, error: createError } = await context.admin.rpc('create_patient_portal_invitation', {
    p_clinic_id: body.clinic_id,
    p_patient_id: body.patient_id,
    p_user_id: userId,
    p_email: email,
    p_actor_id: context.actor.id,
  })
  if (createError || typeof accessId !== 'string') {
    // In a concurrent invite race the losing newly-created Auth identity must
    // not be left as an unusable account with a live invitation email.
    if (createdAuthUser && userId) await context.admin.auth.admin.deleteUser(userId)
    return json({ error: createError?.code === '23505'
      ? 'Este paciente ya tiene una invitación o acceso activo. Revoca el acceso actual antes de reemplazarlo.'
      : 'No se pudo registrar la invitación del paciente.' }, createError?.code === '23505' ? 409 : 500)
  }

  return json({ access_id: accessId, email, status: 'invited', invitation_sent: invitationSent })
})
