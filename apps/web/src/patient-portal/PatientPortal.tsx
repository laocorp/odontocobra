import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { AlertCircle, ArrowDownToLine, CalendarDays, Check, ChevronDown, CircleDollarSign, Clock3, FileText, LogOut, ShieldCheck, UserRound } from 'lucide-react'
import { downloadReceiptPdf, downloadStatementPdf, type ReceiptPdfData, type StatementPdfData } from '../receipt-pdf'
import { formatPortalDate, formatPortalDateTime, formatPortalPaymentAmount, formatPortalUsd, portalDateInTimezone, portalStatusLabel, portalStatusTone } from './portal-format'
import type { PatientPortalAccount, PatientPortalAccessStatus } from './portal-types'
import './patient-portal.css'

export type PortalAccount = PatientPortalAccount
export type { PatientPortalAccessStatus } from './portal-types'

export type PatientPortalProps = {
  activateAccess: () => Promise<void>
  loadAccount: () => Promise<PatientPortalAccount>
  isSessionActive: () => Promise<boolean>
  requestLoginLink: (email: string) => Promise<void>
  signOut: () => Promise<void>
  onExit?: () => void
}

export function PatientPortal({ activateAccess, loadAccount, isSessionActive, requestLoginLink, signOut, onExit }: PatientPortalProps) {
  const [account, setAccount] = useState<PatientPortalAccount | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [revoked, setRevoked] = useState(false)
  const [authRequired, setAuthRequired] = useState(false)
  const [noAccess, setNoAccess] = useState(false)
  const [loginEmail, setLoginEmail] = useState('')
  const [loginSent, setLoginSent] = useState(false)
  const [sendingLogin, setSendingLogin] = useState(false)
  const [loginError, setLoginError] = useState<string | null>(null)
  const closedRef = useRef(false)
  const hadPortalAccessRef = useRef(false)
  const activationRef = useRef(activateAccess)
  const accountLoaderRef = useRef(loadAccount)
  const sessionCheckerRef = useRef(isSessionActive)
  const loginRequesterRef = useRef(requestLoginLink)
  const signOutRef = useRef(signOut)
  const onExitRef = useRef(onExit)
  useEffect(() => {
    let theme: string | null = null
    try { theme = window.localStorage.getItem('odontocuenta-theme') } catch { /* Use the default light theme. */ }
    document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light'
  }, [])
  activationRef.current = activateAccess
  accountLoaderRef.current = loadAccount
  sessionCheckerRef.current = isSessionActive
  loginRequesterRef.current = requestLoginLink
  signOutRef.current = signOut
  onExitRef.current = onExit

  async function closeRevokedSession() {
    if (closedRef.current) return
    closedRef.current = true
    setRevoked(true)
    setAccount(null)
    setError(null)
    try { await signOutRef.current() } catch { /* The portal state is cleared locally; keep the revocation notice visible. */ }
  }

  async function refreshAccount() {
    setLoading(true)
    setError(null)
    try {
      await activationRef.current()
      const next = await accountLoaderRef.current()
      hadPortalAccessRef.current = true
      setAccount(next)
    } catch (caught) {
      const details = errorDetails(caught)
      const message = `${details.message} ${details.code}`.toUpperCase()
      if (message.includes('PORTAL_AUTH_REQUIRED')) {
        setAccount(null)
        setAuthRequired(true)
        setNoAccess(false)
      } else if (hadPortalAccessRef.current && (message.includes('PORTAL_NO_ACCESS') || details.code === '42501' || /42501|revoc|inactive|not active/i.test(details.message))) {
        await closeRevokedSession()
      } else if (message.includes('PORTAL_NO_ACCESS')) {
        setAccount(null)
        setAuthRequired(false)
        setNoAccess(true)
        try { await signOutRef.current() } catch { /* Do not keep an unlinked Auth session on this device. */ }
      } else if (details.code === '42501' || /42501|not invited|email.*match|no invitation/i.test(details.message)) {
        setAccount(null)
        setAuthRequired(false)
        setNoAccess(true)
        try { await signOutRef.current() } catch { /* A denied portal identity should not remain signed in locally. */ }
      } else {
        setError('No pudimos cargar tu cuenta en este momento. Intenta de nuevo.')
      }
    } finally {
      setLoading(false)
    }
  }

  async function logout() {
    setAccount(null)
    hadPortalAccessRef.current = false
    try { await signOutRef.current() } catch { /* Local portal state is already cleared. */ } finally { onExitRef.current?.() }
  }

  useEffect(() => {
    let stopped = false
    const check = async () => {
      try {
        const active = await sessionCheckerRef.current()
        if (!active && hadPortalAccessRef.current && !stopped) await closeRevokedSession()
      } catch {
        // A transient network error must not sign the patient out. Every data RPC still checks access.
      }
    }
    const checkWhenVisible = () => {
      if (document.visibilityState === 'visible') void check()
    }
    const checkOnFocus = () => { void check() }
    void refreshAccount()
    const timer = window.setInterval(() => { void check() }, 12_000)
    document.addEventListener('visibilitychange', checkWhenVisible)
    window.addEventListener('focus', checkOnFocus)
    return () => {
      stopped = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', checkWhenVisible)
      window.removeEventListener('focus', checkOnFocus)
    }
  }, [])

  if (revoked) return <PortalStatusScreen
    icon={<ShieldCheck size={24} />}
    title="El acceso fue cerrado"
    description="La sesión se cerró porque el consultorio revocó el acceso a este portal. Si necesitas entrar de nuevo, comunícate con el consultorio."
    action={onExit ? <button className="patient-portal-button patient-portal-button--primary" onClick={onExit}>Volver al inicio</button> : undefined}
  />

  if (authRequired) return <LoginLinkScreen
    email={loginEmail}
    onEmailChange={setLoginEmail}
    busy={sendingLogin}
    sent={loginSent}
    error={loginError}
    onSubmit={async () => {
      setLoginError(null)
      if (!loginEmail.trim() || !loginEmail.includes('@')) {
        setLoginError('Escribe el correo donde recibiste la invitación.')
        return false
      }
      setSendingLogin(true)
      try {
        await loginRequesterRef.current(loginEmail.trim())
        setLoginSent(true)
        return true
      } catch (caught) {
        const details = errorDetails(caught)
        setLoginError(details.message || 'No se pudo enviar el enlace. Verifica el correo e intenta de nuevo.')
        return false
      } finally { setSendingLogin(false) }
    }}
  />

  if (noAccess) return <PortalStatusScreen
    icon={<ShieldCheck size={24} />}
    title="No hay un acceso activo"
    description="Este correo todavía no tiene acceso al portal. Pide al consultorio que te envíe una invitación o verifica que estés usando el correo invitado."
    action={onExit ? <button className="patient-portal-button patient-portal-button--primary" onClick={onExit}>Volver al inicio</button> : undefined}
  />

  if (loading && !account) return <PortalStatusScreen
    icon={<span className="patient-portal-spinner" />}
    title="Cargando tu cuenta"
    description="Estamos consultando de forma segura tu información de pagos."
  />

  if (error || !account) return <PortalStatusScreen
    icon={<AlertCircle size={24} />}
    title="No se pudo cargar la cuenta"
    description={error ?? 'Intenta de nuevo en unos momentos.'}
    action={<button className="patient-portal-button patient-portal-button--primary" onClick={() => void refreshAccount()}>Intentar de nuevo</button>}
  />

  return <main className="patient-portal">
    <header className="patient-portal-header">
      <div className="patient-portal-brand"><img src="/pwa-icon.svg" alt="" /><span>OdontoCuenta</span><small>Portal del paciente</small></div>
      <button className="patient-portal-button patient-portal-button--quiet" onClick={() => void logout()}><LogOut size={16} /> Salir</button>
    </header>

    <div className="patient-portal-content">
      <section className="patient-portal-welcome">
        <div><p className="patient-portal-eyebrow">TU CUENTA EN {account.clinic.name}</p><h1>Hola, {firstName(account.patient.full_name)}</h1><p>Consulta tus planes, cuotas y pagos registrados.</p></div>
        <button className="patient-portal-button patient-portal-button--secondary" onClick={() => downloadStatement(account)}><ArrowDownToLine size={17} /> Estado de cuenta</button>
      </section>

      <section className="patient-portal-balance" aria-label="Resumen de cuenta">
        <div className="patient-portal-balance-copy"><span>Saldo pendiente</span><strong>{formatPortalUsd(account.summary.balance_usd_cents)}</strong><small>{account.summary.active_plan_count} {account.summary.active_plan_count === 1 ? 'plan activo' : 'planes activos'}</small></div>
        <div className="patient-portal-balance-shield"><ShieldCheck size={22} /><span>Información privada</span></div>
        <div className="patient-portal-balance-stats">
          <div><span>Total acordado</span><b>{formatPortalUsd(account.summary.total_agreed_usd_cents)}</b></div>
          <div><span>Abonado</span><b>{formatPortalUsd(account.summary.paid_usd_cents)}</b></div>
        </div>
      </section>

      <section className="patient-portal-section">
        <div className="patient-portal-section-heading"><div><p className="patient-portal-eyebrow">SEGUIMIENTO</p><h2>Planes y cuotas</h2></div><span className="patient-portal-count">{account.plans.length}</span></div>
        {account.plans.length ? <div className="patient-portal-plans">{account.plans.map(plan => <article className="patient-portal-plan" key={plan.id}>
          <div className="patient-portal-plan-heading"><div className="patient-portal-plan-icon"><FileText size={18} /></div><div className="patient-portal-plan-title"><h3>{plan.description || 'Plan de tratamiento'}</h3><span>{plan.starts_on ? `Desde ${formatPortalDate(plan.starts_on)}` : 'Plan de pago'}</span></div><strong>{formatPortalUsd(plan.balance_usd_cents)}</strong></div>
          <div className="patient-portal-progress" aria-label={`Abonado ${formatPortalUsd(plan.paid_usd_cents)} de ${formatPortalUsd(plan.total_usd_cents)}`}><i style={{ width: `${progressPercent(plan.paid_usd_cents, plan.total_usd_cents)}%` }} /></div>
          <div className="patient-portal-plan-totals"><span>Abonado <b>{formatPortalUsd(plan.paid_usd_cents)}</b></span><span>Total <b>{formatPortalUsd(plan.total_usd_cents)}</b></span></div>
          {plan.installments.length > 0 && <details className="patient-portal-installments"><summary><span><CalendarDays size={15} /> Ver cuotas ({plan.installments.length})</span><ChevronDown size={16} /></summary><div className="patient-portal-installment-list">{plan.installments.map(installment => <div className="patient-portal-installment" key={installment.id}><div><b>Cuota {installment.sequence}</b><span>Vence {formatPortalDate(installment.due_on)}</span></div><span className={`patient-portal-status patient-portal-status--${portalStatusTone(installment.status)}`}>{portalStatusLabel(installment.status)}</span><strong>{formatPortalUsd(installment.balance_usd_cents)}</strong></div>)}</div></details>}
        </article>)}</div> : <div className="patient-portal-empty"><FileText size={21} /><p>No hay planes registrados en tu cuenta todavía.</p></div>}
      </section>

      <section className="patient-portal-section patient-portal-payments-section">
        <div className="patient-portal-section-heading"><div><p className="patient-portal-eyebrow">REGISTRO</p><h2>Pagos y recibos</h2></div><span className="patient-portal-count">{account.payments.length}</span></div>
        {account.payments.length ? <div className="patient-portal-payments">{account.payments.map(payment => <article className="patient-portal-payment" key={payment.id}>
          <div className="patient-portal-payment-icon"><CircleDollarSign size={19} /></div><div className="patient-portal-payment-info"><b>Recibo {payment.receipt_number ? `N.º ${payment.receipt_number}` : 'de pago'}</b><span>{formatPortalDateTime(payment.received_at, account.clinic.timezone)} · {methodLabel(payment.method)}</span><small>{portalStatusLabel(payment.status)}</small></div><div className="patient-portal-payment-amount"><strong>{formatPortalPaymentAmount(payment, account)}</strong><small>Equiv. {formatPortalUsd(payment.amount_usd_cents)} USD</small></div><button className="patient-portal-icon-button" aria-label={`Descargar recibo ${payment.receipt_number ?? ''}`} title="Descargar recibo" onClick={() => downloadReceipt(account, payment)}><ArrowDownToLine size={17} /></button>
        </article>)}</div> : <div className="patient-portal-empty"><Clock3 size={21} /><p>Aún no hay pagos registrados.</p></div>}
      </section>

      <footer className="patient-portal-footer"><ShieldCheck size={17} /><span>Tu información de cobros solo está disponible para ti y el consultorio.</span></footer>
    </div>
  </main>
}

export type PatientPortalAccessCardProps = {
  patientName: string
  patientEmail: string
  status: PatientPortalAccessStatus
  invitedAt?: string | null
  busy?: boolean
  error?: string | null
  onInvite: (email: string) => Promise<void>
  onRevoke: () => Promise<void>
}

export function PatientPortalAccessCard({ patientName, patientEmail, status, invitedAt, busy = false, error, onInvite, onRevoke }: PatientPortalAccessCardProps) {
  const [email, setEmail] = useState(patientEmail)
  const [localError, setLocalError] = useState<string | null>(null)
  const [confirmingRevoke, setConfirmingRevoke] = useState(false)
  const active = status === 'active'
  const invited = status === 'invited'
  const conflict = /email_in_use|user_already_exists|already registered|staff account|correo.*registrad/i.test(`${error ?? ''} ${localError ?? ''}`)

  useEffect(() => setEmail(patientEmail), [patientEmail])

  async function invite() {
    setLocalError(null)
    if (!email.trim() || !email.includes('@')) {
      setLocalError('Escribe un correo válido para enviar la invitación.')
      return
    }
    try { await onInvite(email.trim()) } catch (caught) {
      setLocalError(caught instanceof Error ? caught.message : 'No se pudo enviar la invitación.')
    }
  }

  async function revoke() {
    try {
      await onRevoke()
      setConfirmingRevoke(false)
    } catch (caught) {
      setLocalError(caught instanceof Error ? caught.message : 'No se pudo revocar el acceso.')
      setConfirmingRevoke(false)
    }
  }

  return <section className="patient-portal-access-card" aria-labelledby="patient-portal-access-title">
    <div className="patient-portal-access-head"><span className="patient-portal-access-icon"><UserRound size={18} /></span><div><h3 id="patient-portal-access-title">Acceso al portal del paciente</h3><p>Una cuenta personal para que {patientName} consulte su saldo y sus pagos.</p></div><span className={`patient-portal-access-state patient-portal-access-state--${status}`}>{accessLabel(status)}</span></div>
    {(status === 'not_invited' || status === 'revoked' || conflict) && <label className="patient-portal-access-email">Correo para la invitación<input type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="paciente@correo.com" disabled={busy} /></label>}
    {invited && <p className="patient-portal-access-note">Invitación enviada a <b>{patientEmail}</b>{invitedAt ? ` · ${formatPortalDate(invitedAt)}` : ''}. El acceso estará disponible cuando acepte la invitación.</p>}
    {active && <p className="patient-portal-access-note"><Check size={15} /> Acceso activo para <b>{patientEmail}</b>. Solo puede consultar la información de este paciente.</p>}
    {(localError || error) && <p className="patient-portal-access-error" role="alert">{conflict ? 'Ese correo ya tiene una cuenta del consultorio. Usa otro correo para el acceso del paciente.' : localError ?? error}</p>}
    <div className="patient-portal-access-actions">
      {!active && !invited && <button type="button" className="patient-portal-button patient-portal-button--primary" onClick={() => void invite()} disabled={busy}>{busy ? 'Enviando…' : status === 'revoked' ? 'Enviar nueva invitación' : 'Invitar al portal'}</button>}
      {invited && <button type="button" className="patient-portal-button patient-portal-button--secondary" onClick={() => void invite()} disabled={busy}>{busy ? 'Enviando…' : 'Reenviar invitación'}</button>}
      {(active || invited) && (confirmingRevoke ? <><span className="patient-portal-revoke-confirm">{active ? 'Se cerrará su sesión.' : 'La invitación dejará de funcionar.'}</span><button type="button" className="patient-portal-button patient-portal-button--danger" onClick={() => void revoke()} disabled={busy}>{busy ? 'Revocando…' : 'Confirmar revocación'}</button><button type="button" className="patient-portal-button patient-portal-button--quiet" onClick={() => setConfirmingRevoke(false)} disabled={busy}>Cancelar</button></> : <button type="button" className="patient-portal-button patient-portal-button--quiet" onClick={() => setConfirmingRevoke(true)}>{active ? 'Revocar acceso' : 'Cancelar invitación'}</button>)}
    </div>
  </section>
}

function PortalStatusScreen({ icon, title, description, action }: { icon: ReactNode; title: string; description: string; action?: ReactNode }) {
  return <main className="patient-portal patient-portal-status-screen"><section className="patient-portal-status-card"><div className="patient-portal-status-mark">{icon}</div><h1>{title}</h1><p>{description}</p>{action}</section></main>
}

function LoginLinkScreen({ email, onEmailChange, busy, sent, error, onSubmit }: {
  email: string
  onEmailChange: (value: string) => void
  busy: boolean
  sent: boolean
  error: string | null
  onSubmit: () => Promise<boolean>
}) {
  const [changingEmail, setChangingEmail] = useState(false)
  return <main className="patient-portal patient-portal-status-screen">
    <section className="patient-portal-status-card patient-portal-login-card">
      <div className="patient-portal-brand patient-portal-login-brand"><img src="/pwa-icon.svg" alt="" /><span>OdontoCuenta</span></div>
      <div className="patient-portal-status-mark"><UserRound size={23} /></div>
      <p className="patient-portal-eyebrow">PORTAL DEL PACIENTE</p>
      <h1>{sent && !changingEmail ? 'Revisa tu correo' : 'Consulta tu cuenta'}</h1>
      {sent && !changingEmail ? <p>Si este correo tiene una invitación, te enviaremos un enlace seguro para entrar. Ábrelo en este dispositivo para ver tu estado de cuenta.</p> : <><p>Ingresa el correo donde recibiste la invitación del consultorio.</p><form className="patient-portal-login-form" onSubmit={event => { event.preventDefault(); void onSubmit().then(success => { if (success) setChangingEmail(false) }) }}>
        <label htmlFor="patient-portal-login-email">Correo electrónico</label>
        <input id="patient-portal-login-email" type="email" autoComplete="email" inputMode="email" value={email} onChange={event => onEmailChange(event.target.value)} placeholder="tu@correo.com" required disabled={busy} />
        {error && <p className="patient-portal-login-error" role="alert">{error}</p>}
        <button className="patient-portal-button patient-portal-button--primary" type="submit" disabled={busy}>{busy ? 'Enviando enlace…' : 'Enviar enlace de acceso'}</button>
      </form></>}
      {sent && !changingEmail && <button className="patient-portal-button patient-portal-button--secondary" onClick={() => setChangingEmail(true)}>Usar otro correo</button>}
      <div className="patient-portal-login-foot"><ShieldCheck size={15} /> El portal solo muestra la información de tu propia cuenta.</div>
    </section>
  </main>
}

function firstName(name: string) { return name.trim().split(/\s+/)[0] || 'paciente' }
function progressPercent(paid: number, total: number) { return total <= 0 ? 0 : Math.min(100, Math.max(0, (paid / total) * 100)) }
function methodLabel(method: string) {
  const labels: Record<string, string> = { cash: 'Efectivo', transfer: 'Transferencia', card: 'Tarjeta', mobile_payment: 'Pago móvil', zelle: 'Zelle', other: 'Otro' }
  return labels[method] ?? method
}
function accessLabel(status: PatientPortalAccessStatus) {
  const labels: Record<PatientPortalAccessStatus, string> = { not_invited: 'Sin acceso', invited: 'Invitado', active: 'Activo', revoked: 'Revocado' }
  return labels[status]
}

function errorDetails(error: unknown) {
  if (error && typeof error === 'object') {
    const record = error as { code?: unknown; message?: unknown }
    return {
      code: typeof record.code === 'string' ? record.code : '',
      message: typeof record.message === 'string' ? record.message : error instanceof Error ? error.message : '',
    }
  }
  if (error instanceof Error) return { code: '', message: error.message }
  return { code: '', message: '' }
}

function downloadStatement(account: PatientPortalAccount) {
  const plans = account.plans.map(plan => `${plan.description} · ${formatPortalUsd(plan.total_usd_cents)} · ${portalStatusLabel(plan.status)}`)
  const installments = account.plans.flatMap(plan => plan.installments.filter(item => item.balance_usd_cents > 0).map(item => `${plan.description} · cuota ${item.sequence} · vence ${formatPortalDate(item.due_on)} · pendiente ${formatPortalUsd(item.balance_usd_cents)}`))
  const payments = account.payments.map(payment => ({
    date: formatPortalDateTime(payment.received_at, account.clinic.timezone),
    receipt: payment.receipt_number ? `Recibo ${payment.receipt_number}` : 'Recibo',
    method: methodLabel(payment.method),
    received: formatPortalPaymentAmount(payment, account),
    equivalent: `${formatPortalUsd(payment.amount_usd_cents)} USD`,
    rate: payment.exchange_rate ? `${payment.exchange_rate} ${account.clinic.local_currency}/USD` : 'No disponible',
    status: portalStatusLabel(payment.status),
  }))
  const data: StatementPdfData = {
    clinicName: account.clinic.name,
    patientName: account.patient.full_name,
    patientId: '',
    phone: account.patient.phone ?? '',
    cutoff: formatPortalDate(portalDateInTimezone(new Date(), account.clinic.timezone)),
    totalAgreed: `${formatPortalUsd(account.summary.total_agreed_usd_cents)} USD`,
    paid: `${formatPortalUsd(account.summary.paid_usd_cents)} USD`,
    balance: `${formatPortalUsd(account.summary.balance_usd_cents)} USD`,
    plans,
    installments,
    payments,
  }
  downloadStatementPdf(data)
}

function downloadReceipt(account: PatientPortalAccount, payment: PatientPortalAccount['payments'][number]) {
  const snapshot = payment.receipt_snapshot ?? {}
  const snapshotText = (key: string) => typeof snapshot[key] === 'string' ? snapshot[key] as string : ''
  const localPrecision = typeof snapshot.local_precision === 'number' ? snapshot.local_precision : account.clinic.local_precision
  const localAmount = payment.received_local_minor == null ? undefined : `Bs. ${new Intl.NumberFormat('es-VE', { minimumFractionDigits: localPrecision, maximumFractionDigits: localPrecision }).format(payment.received_local_minor / (10 ** localPrecision))}`
  const data: ReceiptPdfData = {
    clinicName: snapshotText('clinic_name') || account.clinic.name,
    receiptNumber: String(payment.receipt_number ?? snapshot.receipt_number ?? payment.id.slice(0, 8)),
    patientName: snapshotText('patient_name') || account.patient.full_name,
    date: formatPortalDateTime(payment.received_at, account.clinic.timezone),
    plan: snapshotText('installment_description') || snapshotText('plan_name') || 'Abono a cuenta',
    method: methodLabel(payment.method),
    receivedAmount: formatPortalPaymentAmount(payment, account),
    usdEquivalent: `${formatPortalUsd(payment.amount_usd_cents)} USD`,
    vesEquivalent: payment.received_currency === 'VES' ? undefined : localAmount,
    rate: payment.exchange_rate ? `${payment.exchange_rate} ${account.clinic.local_currency}/USD` : undefined,
    remaining: snapshotText('remaining_balance') || 'Consulta tu estado de cuenta para ver el saldo actual',
    status: portalStatusLabel(payment.status),
  }
  downloadReceiptPdf(data)
}
