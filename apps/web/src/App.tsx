import './statement-print.css'
import './payment-allocation.css'
import './team.css'
import './service-description.css'
import { cloneElement, isValidElement, useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type FormEvent, type ReactNode, type SetStateAction } from 'react'
import type { Session } from '@supabase/supabase-js'
import { cloudConfigured, supabase } from './supabase'
import { cents, convertLocalMinorToUsdCents, convertUsdCentsToLocalMinor, localInputToMinor, sumPaymentAllocationCents, usdInputToCents, validatePaymentAllocationTotal } from '@odontocuenta/domain'
import { downloadPlanPdf, downloadReceiptPdf, downloadStatementPdf, printReceiptDocument, printStatementPdf, type PlanPdfData, type ReceiptPdfData, type StatementPdfData } from './receipt-pdf'
import {
  Activity, ArrowDownLeft, ArrowDownRight, ArrowRight, Bell, BriefcaseMedical,
  CalendarDays, Check, ChevronDown, CircleDollarSign, ClipboardList, CreditCard, Download, Ellipsis,
  FileText, Filter, HeartPulse, Home, LogOut, MessageCircle, MoreHorizontal, Plus, Search, Settings, ShieldCheck,
  Moon, Stethoscope, Sun, TrendingUp, UserRound, Users, Wallet, X,
} from 'lucide-react'

type Page = 'Inicio' | 'Pacientes' | 'Planes de pago' | 'Pagos' | 'Servicios' | 'Reportes' | 'Configuración'
type Patient = { id: string | number; name: string; nationalId?: string; phone: string; email: string; address?: string; whatsappConsentAt?: string | null; status: 'Al día' | 'Pendiente' | 'Vencido'; balance: number; initials: string }
type Plan = { id: string | number; planCode: string; patientId?: string; patient: string; treatment: string; total: number; paid: number; nextDue: string; status: 'Al día' | 'Por vencer' | 'Vencido'; items?: { id: string; name: string; category: string; description?: string; amount: number }[] }
type Payment = { id: string | number; patientId?: string; patient: string; concept: string; amount: number; amountCents?: number; currency: string; method: string; date: string; receivedAt?: string; status: string; receiptNumber?: number | null; receiptSnapshot?: Record<string, unknown> | null; receivedCurrency?: string; receivedLocalMinor?: number | null; completedEquivalentLocalMinor?: number | null; exchangeRate?: number | string | null; rateAsOf?: string | null; rateSource?: string | null; rateValidatedAt?: string | null; localPrecision?: number; installment?: string; balanceAfter?: number }
type UnpaidInstallment = { id: string; patient_id: string; plan_id: string; due_on: string; sequence: number; balance_usd_cents: number; status: string; description: string }
type ServiceItem = { id: string | number; name: string; category: string; description?: string; priceCents: number }
type PlanServiceLine = { serviceId: string; name: string; category?: string; description?: string; amount: string }
type ExchangeRate = { id: string; rate: string; source: string; asOf: string; validatedAt: string }
type AuditEvent = { id: number; actor_id: string; action: string; entity_type: string; entity_id: string | null; details: Record<string, unknown>; created_at: string }

const DEFAULT_WHATSAPP_MESSAGE_TEMPLATE = 'Hola, {nombre}. Te escribimos de {clínica} para recordarte que tu cuota de {monto} correspondiente a {tratamiento} vence el {fecha}. Si ya realizaste el pago, puedes ignorar este mensaje. Si tienes alguna duda, responde por aquí o llámanos al {teléfono}. Si no deseas recibir recordatorios por WhatsApp, responde BAJA.'
const renderWhatsAppMessage = (template: string, values: Record<string, string>) => template.replace(/\{([^{}]+)\}/g, (placeholder, key: string) => values[key] ?? placeholder)
const whatsappUrl = (phone: string, message: string) => {
  const digits = phone.replace(/\D/g, '')
  return digits ? `https://wa.me/${digits}?text=${encodeURIComponent(message)}` : ''
}
function printDocument(mode: 'report') {
  document.body.dataset.printMode = mode
  window.addEventListener('afterprint', () => { delete document.body.dataset.printMode }, { once: true })
  window.print()
  window.setTimeout(() => {
    if (document.body.dataset.printMode === mode) delete document.body.dataset.printMode
  }, 1000)
}

const demoServiceCatalog: ServiceItem[] = [
  { id: 1, name: 'Consulta odontológica', category: 'Consulta', priceCents: 3500 },
  { id: 2, name: 'Limpieza dental', category: 'Preventivo', priceCents: 8500 },
  { id: 3, name: 'Ortodoncia', category: 'Especialidad', priceCents: 84000 },
  { id: 4, name: 'Blanqueamiento', category: 'Estética', priceCents: 11000 },
  { id: 5, name: 'Implante dental', category: 'Cirugía', priceCents: 58000 },
  { id: 6, name: 'Resina compuesta', category: 'Restauración', priceCents: 6500 },
]

const starterPatients: Patient[] = [
  { id: 1, name: 'María Fernanda Rojas', nationalId: 'V-20.314.587', phone: '+58 412 555 0182', email: 'maria.rojas@email.com', status: 'Pendiente', balance: 280, initials: 'MR' },
  { id: 2, name: 'Andrés Castillo', nationalId: 'V-18.742.306', phone: '+58 414 320 7721', email: 'andres.c@email.com', status: 'Al día', balance: 0, initials: 'AC' },
  { id: 3, name: 'Valentina Pérez', nationalId: 'V-24.105.938', phone: '+58 424 203 1955', email: 'vale.perez@email.com', status: 'Vencido', balance: 145, initials: 'VP' },
  { id: 4, name: 'Carlos Eduardo Méndez', nationalId: 'V-16.893.421', phone: '+58 416 804 0290', email: 'c.mendez@email.com', status: 'Al día', balance: 0, initials: 'CM' },
  { id: 5, name: 'Sofía Hernández', nationalId: 'V-22.567.814', phone: '+58 412 731 4860', email: 'sofia.h@email.com', status: 'Pendiente', balance: 420, initials: 'SH' },
]
const starterPlans: Plan[] = [
  { id: 1, planCode: 'PL-000003', patientId: '1', patient: 'María Fernanda Rojas', treatment: 'Ortodoncia · Plan integral', total: 840, paid: 560, nextDue: '15 oct 2026', status: 'Por vencer' },
  { id: 2, planCode: 'PL-000002', patientId: '3', patient: 'Valentina Pérez', treatment: 'Implante dental · Pieza 26', total: 580, paid: 435, nextDue: 'Venció el 8 oct', status: 'Vencido' },
  { id: 3, planCode: 'PL-000001', patientId: '5', patient: 'Sofía Hernández', treatment: 'Diseño de sonrisa', total: 1_260, paid: 840, nextDue: '18 oct 2026', status: 'Al día' },
]
const starterPayments: Payment[] = [
  { id: 1, patientId: '2', patient: 'Andrés Castillo', concept: 'Limpieza dental', amount: 85, currency: 'USD', method: 'Pago móvil', date: 'Hoy, 10:42', status: 'Confirmado' },
  { id: 2, patientId: '1', patient: 'María Fernanda Rojas', concept: 'Abono · Ortodoncia', amount: 140, currency: 'USD', method: 'Efectivo', date: 'Ayer, 16:20', status: 'Confirmado' },
  { id: 3, patientId: '4', patient: 'Carlos Eduardo Méndez', concept: 'Blanqueamiento', amount: 110, currency: 'USD', method: 'Transferencia', date: '9 oct, 09:15', status: 'Confirmado' },
]
const paymentMethodLabels: Record<string, string> = { cash: 'Efectivo', mobile_payment: 'Pago móvil', bank_transfer: 'Transferencia', card: 'Tarjeta', other: 'Otro' }
const money = (n: number | null) => n === null ? '—' : `$${new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`
function formatClinicDateTime(value: string | Date, timezone: string) {
  return new Intl.DateTimeFormat('es-VE', { dateStyle: 'medium', timeStyle: 'short', timeZone: timezone }).format(new Date(value))
}
function formatClinicDate(value: string | Date, timezone: string, style: 'medium' | 'long' = 'medium') {
  return new Intl.DateTimeFormat('es-VE', { dateStyle: style, timeZone: timezone }).format(new Date(value))
}
function clinicTimeGreeting(timezone: string) {
  const hour = Number(new Intl.DateTimeFormat('en-US', { hour: '2-digit', hourCycle: 'h23', timeZone: timezone }).format(new Date()))
  return hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches'
}
function formatDueDate(value: string) {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number)
  return new Intl.DateTimeFormat('es-VE', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, day, 12)))
}
function clinicDateInputValue(timezone: string) {
  return dateKeyInTimezone(new Date(), timezone)
}

function dateKeyInTimezone(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}
function escapeCsvCell(value: unknown) {
  const text = String(value ?? '')
  const safe = /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text
  return `"${safe.replaceAll('"', '""')}"`
}
function daysUntilClinicDate(value: string, timezone: string) {
  const dateKey = (date: string) => {
    const [year, month, day] = date.slice(0, 10).split('-').map(Number)
    return Date.UTC(year, month - 1, day)
  }
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  return Math.round((dateKey(value) - dateKey(today)) / 86400000)
}
function receiptInstallmentFromSnapshot(snapshot?: Record<string, unknown> | null) {
  const allocations = snapshot?.allocation_lines
  if (!Array.isArray(allocations)) return undefined
  const labels = allocations.flatMap(value => {
    if (!value || typeof value !== 'object') return []
    const row = value as Record<string, unknown>
    const description = typeof row.plan_description === 'string' ? row.plan_description : 'Plan'
    const sequence = typeof row.sequence === 'number' ? row.sequence : null
    const amount = typeof row.amount_usd_cents === 'number' ? ' (' + money(row.amount_usd_cents / 100) + ')' : ''
    return [sequence === null ? description + amount : description + ' · cuota ' + sequence + amount]
  })
  return labels.length ? labels.join(', ') : undefined
}
function snapshotUsdCents(snapshot?: Record<string, unknown> | null, field = 'balance_after_usd_cents') {
  const value = snapshot?.[field]
  return typeof value === 'number' && Number.isFinite(value) ? value / 100 : undefined
}
function paymentUsdCents(payment: Payment) {
  return payment.amountCents ?? Math.round(payment.amount * 100)
}
function paymentLocalMinor(payment: Payment) {
  const currency = payment.receivedCurrency ?? payment.currency
  if (currency === 'VES' && typeof payment.receivedLocalMinor === 'number') return payment.receivedLocalMinor
  if (currency === 'USD' && typeof payment.completedEquivalentLocalMinor === 'number') return payment.completedEquivalentLocalMinor
  if (!payment.exchangeRate || !(payment.rateSource === 'BCV' || payment.rateValidatedAt)) return null
  try { return convertUsdCentsToLocalMinor(cents(paymentUsdCents(payment)), String(payment.exchangeRate), payment.localPrecision ?? 2) } catch { return null }
}
function formatLocalMinor(minor: number, precision = 2) {
  return `Bs. ${new Intl.NumberFormat('es-VE', { minimumFractionDigits: precision, maximumFractionDigits: precision }).format(minor / (10 ** precision))}`
}
function receiptPdfData(payment: Payment, clinicName: string, timezone: string): ReceiptPdfData {
  const snapshot = payment.receiptSnapshot ?? {}
  const snapshotPatient = snapshot.patient_name
  const patientName = typeof snapshotPatient === 'string' ? snapshotPatient : payment.patient
  const snapshotClinic = snapshot.clinic_name
  const receiptClinic = typeof snapshotClinic === 'string' ? snapshotClinic : clinicName
  const snapshotNumber = snapshot.receipt_number
  const receiptNumber = payment.receiptNumber ?? (typeof snapshotNumber === 'number' || typeof snapshotNumber === 'string' ? snapshotNumber : payment.id)
  const currency = payment.receivedCurrency ?? payment.currency
  const localMinor = paymentLocalMinor(payment)
  const verifiedRate = Boolean(payment.exchangeRate && (payment.rateSource === 'BCV' || payment.rateValidatedAt))
  const bolivarAmount = localMinor
  const rateDate = payment.rateAsOf ? formatClinicDate(payment.rateAsOf, timezone) : ''
  return {
    clinicName: receiptClinic,
    receiptNumber: String(receiptNumber),
    patientName,
    date: payment.receivedAt ? formatClinicDateTime(payment.receivedAt, timezone) : payment.date,
    plan: payment.installment ?? receiptInstallmentFromSnapshot(snapshot) ?? 'Abono a cuenta',
    method: payment.method,
    receivedAmount: currency === 'VES' && typeof payment.receivedLocalMinor === 'number' ? formatLocalMinor(payment.receivedLocalMinor, payment.localPrecision ?? 2) : `${money(payment.amount)} USD`,
    usdEquivalent: `${money(payment.amount)} USD`,
    vesEquivalent: bolivarAmount === null ? undefined : formatLocalMinor(bolivarAmount, payment.localPrecision ?? 2),
    rate: verifiedRate ? `${payment.rateSource === 'BCV' ? 'BCV' : 'validada'} · ${payment.exchangeRate} Bs./USD${rateDate ? ` · ${rateDate}` : ''}` : currency === 'USD' ? 'Pendiente de tasa BCV verificada' : 'No disponible',
    remaining: (payment.balanceAfter ?? snapshotUsdCents(snapshot)) === undefined ? 'Consultar estado de cuenta' : money(payment.balanceAfter ?? snapshotUsdCents(snapshot) ?? 0),
    status: payment.status === 'Confirmado' && currency === 'USD' && !verifiedRate ? 'Pendiente de tasa BCV' : payment.status,
  }
}
function createIdempotencyKey() {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()
  // randomUUID may be absent when the app is opened over HTTP on the clinic LAN.
  const bytes = new Uint8Array(16)
  if (typeof globalThis.crypto?.getRandomValues !== 'function') throw new Error('Web Crypto no está disponible')
  globalThis.crypto.getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

const navGroups: { title: string; items: { label: Page; icon: typeof Home }[] }[] = [
  { title: 'GENERAL', items: [{ label: 'Inicio', icon: Home }, { label: 'Pacientes', icon: Users }, { label: 'Planes de pago', icon: ClipboardList }, { label: 'Pagos', icon: CreditCard }] },
  { title: 'GESTIÓN', items: [{ label: 'Servicios', icon: Stethoscope }, { label: 'Reportes', icon: Activity }] },
  { title: 'CUENTA', items: [{ label: 'Configuración', icon: Settings }] },
]

function Logo() { return <div className="brand-mark"><span className="leaf leaf-one" /><span className="leaf leaf-two" /><span>OdontoCuenta</span></div> }
function Badge({ children, tone = 'neutral', title }: { children: ReactNode; tone?: string; title?: string }) { return <span className={`badge ${tone}`} title={title}>{children}</span> }
function Modal({ title, subtitle, close, children }: { title: string; subtitle?: string; close: () => void; children: ReactNode }) {
  const modalRef = useRef<HTMLElement>(null)
  const closeRef = useRef(close)
  closeRef.current = close

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null
    const modal = modalRef.current
    if (!modal) return

    const getFocusable = () => Array.from(modal.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )).filter(element => element.getClientRects().length > 0)

    const initialFocus = modal.querySelector<HTMLElement>(
      'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button[type="submit"]:not([disabled])',
    ) ?? getFocusable()[0] ?? modal
    initialFocus.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = getFocusable()
      if (!focusable.length) {
        event.preventDefault()
        modal.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || !modal.contains(document.activeElement))) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [])

  return <div className="overlay" onMouseDown={e => e.target === e.currentTarget && close()}><section ref={modalRef} className="modal" role="dialog" aria-modal="true" aria-labelledby="app-modal-title" tabIndex={-1}><header className="modal-head"><div><p className="eyebrow">ODONTOCUENTA</p><h2 id="app-modal-title">{title}</h2>{subtitle && <p className="muted">{subtitle}</p>}</div><button type="button" className="icon-button" onClick={close} aria-label="Cerrar"><X size={19} /></button></header>{ensureNamedControls(children)}</section></div>
}

export function App() {
  const [darkMode, setDarkMode] = useState(() => {
    try { return window.localStorage.getItem('odontocuenta-theme') === 'dark' } catch { return false }
  })
  const [session, setSession] = useState<Session | null>(null)
  const [sessionReady, setSessionReady] = useState(!cloudConfigured)
  const [clinicId, setClinicId] = useState<string | null>(null)
  const [membershipRole, setMembershipRole] = useState<string | null>(null)
  const [clinicLookupDone, setClinicLookupDone] = useState(!cloudConfigured)
  const [clinicSetupName, setClinicSetupName] = useState('')
  const [clinicSetupBusy, setClinicSetupBusy] = useState(false)
  const [clinicSetupError, setClinicSetupError] = useState('')
  const [clinicLoadError, setClinicLoadError] = useState('')
  const suggestedClinicName = typeof session?.user.user_metadata?.clinic_name === 'string'
    ? session.user.user_metadata.clinic_name.trim().slice(0, 120)
    : ''
  useEffect(() => {
    if (suggestedClinicName) setClinicSetupName(current => current || suggestedClinicName)
  }, [session?.user.id, suggestedClinicName])
  const [clinicName, setClinicName] = useState('Clínica Sonrisa')
  const [clinicOwnerName, setClinicOwnerName] = useState(cloudConfigured ? '' : 'Daniela Ríos')
  const [clinicPhone, setClinicPhone] = useState(() => {
    try { return (JSON.parse(localStorage.getItem('odontocuenta:clinic-profile') ?? '{}') as Record<string, string>).phone ?? '' } catch { return '' }
  })
  const [whatsappMessageTemplate, setWhatsappMessageTemplate] = useState(() => {
    try { return (JSON.parse(localStorage.getItem('odontocuenta:clinic-profile') ?? '{}') as Record<string, string>).whatsappMessageTemplate ?? DEFAULT_WHATSAPP_MESSAGE_TEMPLATE } catch { return DEFAULT_WHATSAPP_MESSAGE_TEMPLATE }
  })
  const [clinicTimezone, setClinicTimezone] = useState('America/Caracas')
  const [clinicLocalCurrency, setClinicLocalCurrency] = useState('VES')
  const [clinicLocalPrecision, setClinicLocalPrecision] = useState(2)
  const [currentExchangeRate, setCurrentExchangeRate] = useState<ExchangeRate | null>(null)
  const [monthlyCollectedUsdCents, setMonthlyCollectedUsdCents] = useState<number | null>(cloudConfigured ? null : 248_500)
  const [monthlyConfirmedPaymentCount, setMonthlyConfirmedPaymentCount] = useState<number | null>(cloudConfigured ? null : starterPayments.length)
  const [page, setPage] = useState<Page>('Inicio')
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false)
  const [topMenu, setTopMenu] = useState<'alerts' | 'profile' | null>(null)
  const topActionsRef = useRef<HTMLDivElement>(null)
  const [modal, setModal] = useState<'patient' | 'payment' | 'plan' | null>(null)
  const [patients, setPatients] = useState<Patient[]>(cloudConfigured ? [] : starterPatients)
  const [services, setServices] = useState<ServiceItem[]>(cloudConfigured ? [] : demoServiceCatalog)
  const [payments, setPayments] = useState<Payment[]>(cloudConfigured ? [] : starterPayments)
  const [plans, setPlans] = useState<Plan[]>(cloudConfigured ? [] : starterPlans)
  const [installments, setInstallments] = useState<UnpaidInstallment[]>([])
  const [search, setSearch] = useState('')
  const [patientFilter, setPatientFilter] = useState('Todos')
  const [planFilter, setPlanFilter] = useState('Todos los planes')
  const [toast, setToast] = useState('')
  const [showBalance, setShowBalance] = useState(true)
  const [patientName, setPatientName] = useState('')
  const [patientNationalId, setPatientNationalId] = useState('')
  const [patientPhone, setPatientPhone] = useState('')
  const [patientEmail, setPatientEmail] = useState('')
  const [patientAddress, setPatientAddress] = useState('')
  const [patientWhatsappConsent, setPatientWhatsappConsent] = useState(false)
  const [editingPatient, setEditingPatient] = useState<Patient | null>(null)
  const [statementPatient, setStatementPatient] = useState<Patient | null>(null)
  const [receiptPayment, setReceiptPayment] = useState<Payment | null>(null)
  const [paymentPatient, setPaymentPatient] = useState('')
  const [paymentAllocations, setPaymentAllocations] = useState<Record<string, string>>({})
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentCurrency, setPaymentCurrency] = useState<'USD' | 'VES'>('USD')
  const [paymentConcept, setPaymentConcept] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [paymentSubmitting, setPaymentSubmitting] = useState(false)
  const paymentAttempt = useRef<{ signature: string; key: string } | null>(null)
  const paymentSubmitLock = useRef(false)
  const [planPatient, setPlanPatient] = useState('')
  const [planServiceChoice, setPlanServiceChoice] = useState('')
  const [planItems, setPlanItems] = useState<PlanServiceLine[]>([])
  const [planInstallments, setPlanInstallments] = useState('1')
  const [planFirstDue, setPlanFirstDue] = useState(() => clinicDateInputValue(clinicTimezone))
  const notify = useCallback((message: string) => { setToast(message); window.setTimeout(() => setToast(''), 3200) }, [])
  const attentionPlans = useMemo(() => plans.filter(plan => plan.status === 'Vencido' || plan.status === 'Por vencer'), [plans])
  const profileInitials = clinicOwnerName.trim().replace(/^dra?\.?\s*/i, '').split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || session?.user.email?.slice(0, 1).toUpperCase() || 'U'
  const connectionLabel = !cloudConfigured
    ? 'Datos de demostración'
    : clinicLoadError
      ? 'Sin conexión'
      : clinicLookupDone ? 'Conectado' : 'Conectando'
  const connectionStateClass = !cloudConfigured
    ? ''
    : clinicLoadError
      ? 'connection-error'
      : clinicLookupDone ? 'connected-pill' : ''
  const signOut = useCallback(async () => {
    if (!supabase) {
      notify('Esta sesión de demostración no está conectada a una cuenta.')
      setTopMenu(null)
      return
    }
    const { error } = await supabase.auth.signOut()
    if (error) { notify('No se pudo cerrar la sesión. Inténtalo de nuevo.'); return }
    setTopMenu(null)
  }, [notify])
  useEffect(() => {
    if (!topMenu) return
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !topActionsRef.current?.contains(event.target)) setTopMenu(null)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setTopMenu(null)
      if (topMenu === 'profile' && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        const items = Array.from(topActionsRef.current?.querySelectorAll<HTMLElement>('.profile-popover [role="menuitem"]') ?? [])
        if (!items.length) return
        event.preventDefault()
        const current = items.indexOf(document.activeElement as HTMLElement)
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : event.key === 'ArrowUp' ? (current <= 0 ? items.length - 1 : current - 1) : (current + 1) % items.length
        items[next].focus()
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [topMenu])
  useEffect(() => {
    const theme = darkMode ? 'dark' : 'light'
    document.documentElement.dataset.theme = theme
    try { window.localStorage.setItem('odontocuenta-theme', theme) } catch { /* Theme still applies for this session. */ }
  }, [darkMode])
  const totalDue = plans.reduce((sum, plan) => sum + plan.total - plan.paid, 0)
  const paymentUsdPreviewCents = useMemo(() => {
    if (paymentCurrency !== 'VES' || !currentExchangeRate || !paymentAmount) return null
    try { return convertLocalMinorToUsdCents(localInputToMinor(paymentAmount, clinicLocalPrecision), currentExchangeRate.rate, clinicLocalPrecision) } catch { return null }
  }, [paymentCurrency, currentExchangeRate, paymentAmount, clinicLocalPrecision])
  const paymentTotalUsdCents = useMemo(() => {
    if (!paymentAmount) return null
    if (paymentCurrency === 'VES') return paymentUsdPreviewCents
    try { return usdInputToCents(paymentAmount) } catch { return null }
  }, [paymentCurrency, paymentAmount, paymentUsdPreviewCents])
  const paymentAllocationTotalCents = useMemo(() => {
    const amounts = Object.values(paymentAllocations).flatMap(value => {
      try { const amount = usdInputToCents(value); return amount > 0 ? [amount] : [] } catch { return [] }
    })
    try { return sumPaymentAllocationCents(amounts) } catch { return null }
  }, [paymentAllocations])

  useEffect(() => {
    if (!supabase) return
    let alive = true
    supabase.auth.getSession().then(({ data }) => {
      if (alive) { setSession(data.session); setSessionReady(true) }
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      setSessionReady(true)
      setClinicId(null)
      setMembershipRole(null)
      setClinicLookupDone(false)
      setPatients([])
    })
    return () => { alive = false; subscription.unsubscribe() }
  }, [])

  useEffect(() => {
    if (!cloudConfigured) return
    if (!supabase || !clinicId) { setServices([]); return }
    let alive = true
    void supabase.from('services').select('id, name, category, description, base_price_usd_cents').eq('clinic_id', clinicId).eq('active', true).order('name').then(({ data, error }) => {
      if (!alive) return
      if (error) { notify('No pudimos cargar el catálogo de servicios.'); return }
      setServices((data ?? []).map(row => ({ id: row.id, name: row.name, category: row.category, description: row.description ?? '', priceCents: row.base_price_usd_cents })))
    })
    return () => { alive = false }
  }, [clinicId])

  useEffect(() => {
    if (!supabase || !session?.user) return
    let alive = true
    setClinicLookupDone(false)
    setClinicLoadError('')
    void (async () => {
      const { data: memberships, error } = await supabase.from('clinic_members').select('clinic_id, role').eq('user_id', session.user.id).order('created_at', { ascending: true })
      if (!alive) return
      if (error) { setClinicLoadError('No pudimos consultar tu consultorio. Revisa las migraciones y vuelve a cargar.'); setClinicLookupDone(true); return }
      if (!memberships?.length) { setClinicId(null); setMembershipRole(null); setClinicLoadError(''); setClinicLookupDone(true); return }
      const activeClinic = memberships[0].clinic_id
      const { data: clinic } = await supabase.from('clinics').select('name, owner_display_name, timezone, local_currency, local_precision, contact_phone, whatsapp_message_template').eq('id', activeClinic).maybeSingle()
      const { data: patientRows, error: patientError } = await supabase.from('patients').select('id, full_name, national_id, phone, email, address, whatsapp_consent_at').eq('clinic_id', activeClinic).is('archived_at', null).order('full_name')
      if (!alive) return
      if (patientError) { setClinicLoadError('No pudimos cargar tu consultorio. Revisa las migraciones y vuelve a cargar.'); setClinicLookupDone(true); return }
      setClinicId(activeClinic)
      setMembershipRole(memberships[0].role)
      setClinicName(clinic?.name ?? 'Mi consultorio')
      setClinicOwnerName(clinic?.owner_display_name ?? '')
      setClinicPhone(clinic?.contact_phone ?? '')
      setWhatsappMessageTemplate(clinic?.whatsapp_message_template ?? DEFAULT_WHATSAPP_MESSAGE_TEMPLATE)
      setClinicTimezone(clinic?.timezone ?? 'America/Caracas')
      setClinicLocalCurrency(clinic?.local_currency ?? 'VES')
      setClinicLocalPrecision(clinic?.local_precision ?? 2)
      const mappedPatients: Patient[] = (patientRows ?? []).map((p, i) => ({ id: p.id, name: p.full_name, nationalId: p.national_id ?? '', phone: p.phone ?? 'Sin teléfono', email: p.email ?? '', address: p.address ?? '', whatsappConsentAt: p.whatsapp_consent_at ?? null, status: 'Al día', balance: 0, initials: p.full_name.split(' ').slice(0, 2).map((x: string) => x[0]).join('').toUpperCase() || `P${i + 1}` }))
      setPatients(mappedPatients)
      const { data: planRows } = await supabase.from('treatment_plans').select('id, plan_code, patient_id, description, total_usd_cents').eq('clinic_id', activeClinic).eq('status', 'active').order('created_at', { ascending: false })
      const planIds = (planRows ?? []).map(row => row.id)
      const { data: planItemRows } = planIds.length ? await supabase.from('plan_items').select('plan_id, service_id, service_name, service_category, service_description, amount_usd_cents').eq('clinic_id', activeClinic).in('plan_id', planIds).order('created_at') : { data: [] }
      const { data: installmentRows } = await supabase.from('installment_balances').select('installment_id, plan_id, patient_id, sequence, due_on, amount_usd_cents, paid_usd_cents, balance_usd_cents, balance_status').eq('clinic_id', activeClinic).order('due_on')
      if (!alive) return
      const nextPlans: Plan[] = (planRows ?? []).map(row => {
        const installments = (installmentRows ?? []).filter(item => item.plan_id === row.id)
        const firstOpen = installments.find(item => item.balance_usd_cents > 0)
        const overdue = installments.some(item => item.balance_status === 'overdue' && item.balance_usd_cents > 0)
        const dueDays = firstOpen?.due_on ? daysUntilClinicDate(firstOpen.due_on, clinicTimezone) : null
        const dueSoon = dueDays !== null && dueDays >= 0 && dueDays <= 7
        return { id: row.id, planCode: row.plan_code, patientId: row.patient_id, patient: mappedPatients.find(p => p.id === row.patient_id)?.name ?? 'Paciente', treatment: row.description, total: row.total_usd_cents / 100, paid: installments.reduce((sum, item) => sum + item.paid_usd_cents, 0) / 100, nextDue: firstOpen?.due_on ? formatDueDate(firstOpen.due_on) : 'Al día', status: overdue ? 'Vencido' : dueSoon ? 'Por vencer' : 'Al día', items: (planItemRows ?? []).filter(item => item.plan_id === row.id).map(item => ({ id: item.service_id, name: item.service_name, category: item.service_category, description: item.service_description ?? '', amount: item.amount_usd_cents / 100 })) }
      })
      setPlans(nextPlans)
      const openRows = (installmentRows ?? []).filter(item => item.balance_usd_cents > 0)
      const descriptions = new Map((planRows ?? []).map(row => [row.id, row.description]))
      setInstallments(openRows.map(item => ({ id: item.installment_id, patient_id: item.patient_id, plan_id: item.plan_id, due_on: item.due_on, sequence: item.sequence, balance_usd_cents: item.balance_usd_cents, status: item.balance_status, description: descriptions.get(item.plan_id) ?? 'Plan de tratamiento' })))
      const balances = new Map<string, { amount: number; overdue: boolean }>()
      for (const item of installmentRows ?? []) if (item.balance_usd_cents > 0) {
        const current = balances.get(item.patient_id) ?? { amount: 0, overdue: false }
        balances.set(item.patient_id, { amount: current.amount + item.balance_usd_cents / 100, overdue: current.overdue || item.balance_status === 'overdue' })
      }
      setPatients(mappedPatients.map(patient => {
        const balance = balances.get(String(patient.id))
        return { ...patient, balance: balance?.amount ?? 0, status: balance?.overdue ? 'Vencido' : (balance?.amount ?? 0) > 0 ? 'Pendiente' : 'Al día' }
      }))
      const { data: paymentRows } = await supabase.from('payments').select('id, patient_id, amount_usd_cents, received_currency, received_local_minor, exchange_rate, rate_source, rate_as_of, rate_validated_at, method, received_at, receipt_number, receipt_snapshot').eq('clinic_id', activeClinic).order('received_at', { ascending: false }).limit(50)
      const { data: reversalRows } = await supabase.from('payment_reversals').select('payment_id').eq('clinic_id', activeClinic)
      const paymentIds = (paymentRows ?? []).map(row => row.id)
      const { data: rateCompletionRows } = paymentIds.length
        ? await supabase.from('payment_receipt_rate_completions').select('payment_id, exchange_rate, rate_source, rate_as_of, rate_validated_at, equivalent_local_minor').eq('clinic_id', activeClinic).in('payment_id', paymentIds)
        : { data: [] }
      if (!alive) return
      const reversedIds = new Set((reversalRows ?? []).map(row => row.payment_id))
      const rateCompletions = new Map((rateCompletionRows ?? []).map(row => [row.payment_id, row]))
      setPayments((paymentRows ?? []).map(row => {
        const completion = rateCompletions.get(row.id)
        return { id: row.id, patientId: row.patient_id, patient: mappedPatients.find(p => p.id === row.patient_id)?.name ?? String(row.receipt_snapshot?.patient_name ?? 'Paciente'), concept: `Recibo #${row.receipt_number ?? '—'}`, amount: row.amount_usd_cents / 100, amountCents: row.amount_usd_cents, currency: 'USD', method: paymentMethodLabels[row.method] ?? 'Otro', date: new Intl.DateTimeFormat('es-VE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(row.received_at)), receivedAt: row.received_at, status: reversedIds.has(row.id) ? 'Revertido' : 'Confirmado', receiptNumber: row.receipt_number, receiptSnapshot: row.receipt_snapshot, receivedCurrency: row.received_currency, receivedLocalMinor: row.received_local_minor, completedEquivalentLocalMinor: completion ? Number(completion.equivalent_local_minor) : null, exchangeRate: row.exchange_rate ?? completion?.exchange_rate, rateSource: row.rate_source ?? completion?.rate_source, rateAsOf: row.rate_as_of ?? completion?.rate_as_of, rateValidatedAt: row.rate_validated_at ?? completion?.rate_validated_at, localPrecision: typeof row.receipt_snapshot?.local_precision === 'number' ? row.receipt_snapshot.local_precision : 2, installment: receiptInstallmentFromSnapshot(row.receipt_snapshot), balanceAfter: snapshotUsdCents(row.receipt_snapshot) }
      }))
      setClinicLoadError('')
      setClinicLookupDone(true)
    })().catch(() => {
      if (!alive) return
      setClinicLoadError('No pudimos conectarnos con Supabase. Revisa tu conexión y vuelve a cargar.')
      setClinicLookupDone(true)
    })
    return () => { alive = false }
  }, [session, notify])

  useEffect(() => {
    if (!supabase || !clinicId) { setCurrentExchangeRate(null); return }
    let alive = true
    void supabase.from('exchange_rates_client').select('id, rate, source, as_of, validated_at').eq('clinic_id', clinicId).eq('local_currency', clinicLocalCurrency).order('as_of', { ascending: false }).order('validated_at', { ascending: false }).limit(50).then(({ data, error }) => {
      if (!alive) return
      if (error) { setCurrentExchangeRate(null); return }
      const today = dateKeyInTimezone(new Date(), clinicTimezone)
      const applicable = (data ?? []).find(row => dateKeyInTimezone(new Date(row.as_of), clinicTimezone) === today)
      setCurrentExchangeRate(applicable ? { id: applicable.id, rate: String(applicable.rate), source: applicable.source, asOf: applicable.as_of, validatedAt: applicable.validated_at } : null)
    })
    return () => { alive = false }
  }, [clinicId, clinicTimezone, clinicLocalCurrency])

  useEffect(() => {
    if (!supabase || !clinicId || clinicLocalCurrency !== 'VES') return
    let alive = true
    void supabase.functions.invoke('bcv-rate', { body: { clinic_id: clinicId } }).then(({ data, error }) => {
      if (!alive || error || !data?.id || !data?.as_of || !data?.rate) return
      const today = dateKeyInTimezone(new Date(), clinicTimezone)
      const effectiveDay = dateKeyInTimezone(new Date(data.as_of), clinicTimezone)
      if (effectiveDay === today) setCurrentExchangeRate({ id: data.id, rate: String(data.rate), source: data.source, asOf: data.as_of, validatedAt: data.validated_at })
    }).catch(() => undefined)
    return () => { alive = false }
  }, [clinicId, clinicTimezone, clinicLocalCurrency])

  useEffect(() => {
    if (!supabase || !clinicId) { setMonthlyCollectedUsdCents(cloudConfigured ? null : 248_500); setMonthlyConfirmedPaymentCount(cloudConfigured ? null : payments.length); return }
    let alive = true
    void supabase.rpc('clinic_payment_metrics', { p_clinic_id: clinicId }).then(({ data, error }) => {
      if (!alive) return
      if (error) { setMonthlyCollectedUsdCents(null); setMonthlyConfirmedPaymentCount(null); return }
      const cents = Number(data?.monthly_collected_usd_cents)
      const count = Number(data?.confirmed_payment_count)
      setMonthlyCollectedUsdCents(Number.isFinite(cents) && cents >= 0 ? cents : null)
      setMonthlyConfirmedPaymentCount(Number.isSafeInteger(count) && count >= 0 ? count : null)
    }, () => { if (alive) { setMonthlyCollectedUsdCents(null); setMonthlyConfirmedPaymentCount(null) } })
    return () => { alive = false }
  }, [clinicId, payments])

  useEffect(() => {
    if (!supabase || !clinicId) return
    const pending = payments.filter(payment => (payment.status === 'Confirmado' || payment.status === 'Revertido') && (payment.receivedCurrency ?? payment.currency) === 'USD' && !payment.exchangeRate)
    if (!pending.length) return
    let alive = true
    const client = supabase
    void Promise.all(pending.map(async payment => {
      const { data, error } = await client.rpc('complete_pending_payment_receipt_rate', { p_clinic_id: clinicId, p_payment_id: String(payment.id) })
      if (error || !data?.exchange_rate) return null
      return { id: payment.id, exchangeRate: String(data.exchange_rate), rateSource: String(data.rate_source), rateAsOf: String(data.rate_as_of), rateValidatedAt: String(data.rate_validated_at), completedEquivalentLocalMinor: Number(data.equivalent_local_minor) }
    })).then(completions => {
      if (!alive) return
      for (const completion of completions) if (completion) {
        const update = { exchangeRate: completion.exchangeRate, rateSource: completion.rateSource, rateAsOf: completion.rateAsOf, rateValidatedAt: completion.rateValidatedAt, completedEquivalentLocalMinor: completion.completedEquivalentLocalMinor }
        setPayments(list => list.map(payment => payment.id === completion.id ? { ...payment, ...update } : payment))
        setReceiptPayment(payment => payment?.id === completion.id ? { ...payment, ...update } : payment)
      }
    }).catch(() => undefined)
    return () => { alive = false }
  }, [clinicId, payments, currentExchangeRate])

  const filteredPatients = useMemo(() => patients.filter(p => {
    const matchText = `${p.name} ${p.nationalId ?? ''} ${p.phone} ${p.email}`.toLowerCase().includes(search.toLowerCase())
    return matchText && (patientFilter === 'Todos' || p.status === patientFilter)
  }), [patients, search, patientFilter])
  const localizedPayments = useMemo(() => payments.map(payment => payment.receivedAt ? { ...payment, date: formatClinicDateTime(payment.receivedAt, clinicTimezone) } : payment), [payments, clinicTimezone])

  const openModal = (type: 'patient' | 'payment' | 'plan') => {
    if (type === 'patient') { setEditingPatient(null); setPatientName(''); setPatientNationalId(''); setPatientPhone(''); setPatientEmail(''); setPatientAddress(''); setPatientWhatsappConsent(false) }
    if (type === 'payment') { setPaymentPatient(''); setPaymentAllocations({}); setPaymentAmount(''); setPaymentConcept(''); setPaymentCurrency('USD') }
    if (type === 'plan') { setPlanPatient(''); setPlanServiceChoice(''); setPlanItems([]); setPlanInstallments('1'); setPlanFirstDue(clinicDateInputValue(clinicTimezone)) }
    setModal(type); setMobileMoreOpen(false)
  }
  const exportPaymentsCsv = async () => {
    const searchTerm = search.toLowerCase()
    if (!supabase || !clinicId) {
      downloadPaymentsCsv(payments.filter(payment => `${payment.patient} ${payment.concept} ${payment.method}`.toLowerCase().includes(searchTerm)), clinicTimezone)
      return
    }
    try {
      const rows: Array<{ id: string; patient_id: string; amount_usd_cents: number; received_currency: string; received_local_minor: number | null; exchange_rate: number | null; rate_source: string | null; rate_as_of: string | null; rate_validated_at: string | null; method: string; received_at: string; receipt_number: number | null; receipt_snapshot: Record<string, unknown> | null }> = []
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await supabase.from('payments').select('id, patient_id, amount_usd_cents, received_currency, received_local_minor, exchange_rate, rate_source, rate_as_of, rate_validated_at, method, received_at, receipt_number, receipt_snapshot').eq('clinic_id', clinicId).order('received_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + 499)
        if (error) throw error
        rows.push(...(data ?? []))
        if (!data || data.length < 500) break
      }
      const ids = rows.map(row => row.id)
      const reversedIds = new Set<string>()
      const rateCompletions = new Map<string, { exchange_rate: number | string; rate_source: string; rate_as_of: string; rate_validated_at: string; equivalent_local_minor: number | string }>()
      for (let offset = 0; offset < ids.length; offset += 400) {
        const chunk = ids.slice(offset, offset + 400)
        const [{ data: reversalRows, error: reversalError }, { data: completionRows, error: completionError }] = await Promise.all([
          supabase.from('payment_reversals').select('payment_id').eq('clinic_id', clinicId).in('payment_id', chunk),
          supabase.from('payment_receipt_rate_completions').select('payment_id, exchange_rate, rate_source, rate_as_of, rate_validated_at, equivalent_local_minor').eq('clinic_id', clinicId).in('payment_id', chunk),
        ])
        if (reversalError) throw reversalError
        if (completionError) throw completionError
        for (const row of reversalRows ?? []) reversedIds.add(row.payment_id)
        for (const row of completionRows ?? []) rateCompletions.set(row.payment_id, row)
      }
      const allPayments: Payment[] = rows.map(row => {
        const completion = rateCompletions.get(row.id)
        return { id: row.id, patientId: row.patient_id, patient: patients.find(p => p.id === row.patient_id)?.name ?? String(row.receipt_snapshot?.patient_name ?? 'Paciente'), concept: `Recibo #${row.receipt_number ?? '—'}`, amount: row.amount_usd_cents / 100, amountCents: row.amount_usd_cents, currency: 'USD', method: paymentMethodLabels[row.method] ?? 'Otro', date: new Intl.DateTimeFormat('es-VE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(row.received_at)), receivedAt: row.received_at, status: reversedIds.has(row.id) ? 'Revertido' : 'Confirmado', receiptNumber: row.receipt_number, receiptSnapshot: row.receipt_snapshot, receivedCurrency: row.received_currency, receivedLocalMinor: row.received_local_minor, completedEquivalentLocalMinor: completion ? Number(completion.equivalent_local_minor) : null, exchangeRate: row.exchange_rate ?? completion?.exchange_rate, rateSource: row.rate_source ?? completion?.rate_source, rateAsOf: row.rate_as_of ?? completion?.rate_as_of, rateValidatedAt: row.rate_validated_at ?? completion?.rate_validated_at, localPrecision: typeof row.receipt_snapshot?.local_precision === 'number' ? row.receipt_snapshot.local_precision : clinicLocalPrecision, installment: receiptInstallmentFromSnapshot(row.receipt_snapshot), balanceAfter: snapshotUsdCents(row.receipt_snapshot) }
      })
      downloadPaymentsCsv(allPayments.filter(payment => `${payment.patient} ${payment.concept} ${payment.method}`.toLowerCase().includes(searchTerm)), clinicTimezone)
    } catch {
      notify('No pudimos exportar el historial completo. Inténtalo de nuevo.')
    }
  }
  const editPatient = (patient: Patient) => {
    setEditingPatient(patient); setPatientName(patient.name); setPatientNationalId(patient.nationalId ?? '')
    setPatientPhone(patient.phone); setPatientEmail(patient.email); setPatientAddress(patient.address ?? ''); setPatientWhatsappConsent(Boolean(patient.whatsappConsentAt)); setModal('patient')
  }
  const closePatientModal = () => { setModal(null); setEditingPatient(null) }
  const reversePayment = async (payment: Payment) => {
    if (!supabase || !clinicId || membershipRole !== 'owner') return
    const reason = window.prompt(`Motivo de reversión para ${payment.concept} (${money(payment.amount)}):`)?.trim()
    if (!reason) return
    if (reason.length < 5) { notify('Indica un motivo de al menos cinco caracteres.'); return }
    let reversalError: { message: string } | null = null
    try {
      const result = await supabase.rpc('reverse_payment', { p_clinic_id: clinicId, p_payment_id: payment.id, p_reason: reason })
      reversalError = result.error
    } catch (cause) {
      notify(cause instanceof Error ? `No se pudo confirmar la reversión. ${cause.message}` : 'No se pudo confirmar la reversión.')
      return
    }
    if (reversalError) { notify(reversalError.message.includes('revertido') ? 'Este pago ya fue revertido.' : 'No se pudo revertir el pago. ' + reversalError.message); return }
    setPayments(list => list.map(item => item.id === payment.id ? { ...item, status: 'Revertido' } : item))
    notify('Pago revertido y registrado en la auditoría. Actualizando saldos…')
    window.setTimeout(() => window.location.reload(), 350)
  }

  const savePatient = async (e: FormEvent) => {
    e.preventDefault()
    const name = patientName.trim()
    const nationalId = patientNationalId.trim()
    const digits = patientPhone.replace(/\D/g, '')
    const normalizedPhone = digits.startsWith('58') ? `+${digits}` : digits.startsWith('0') ? `+58${digits.slice(1)}` : `+58${digits}`
    const email = patientEmail.trim()
    const address = patientAddress.trim()
    const whatsappConsentAt = patientWhatsappConsent ? editingPatient?.whatsappConsentAt || new Date().toISOString() : null
    if (name.split(/\s+/).filter(Boolean).length < 2) { notify('Escribe al menos un nombre y un apellido.'); return }
    if (!nationalId) { notify('Completa la cédula de identidad.'); return }
    if (!/^\+58\d{10}$/.test(normalizedPhone)) { notify('Escribe un teléfono venezolano válido con código +58.'); return }
    const initials = name.split(' ').slice(0, 2).map(x => x[0]).join('').toUpperCase()
    if (supabase && clinicId && editingPatient) {
      try {
        const { error } = await supabase.from('patients').update({ full_name: name, national_id: nationalId, phone: normalizedPhone, email: email || null, address: address || null, whatsapp_consent_at: whatsappConsentAt }).eq('clinic_id', clinicId).eq('id', String(editingPatient.id))
        if (error) { notify('No se pudo actualizar el paciente. ' + error.message); return }
      } catch (cause) {
        notify(cause instanceof Error ? `No se pudo actualizar el paciente. ${cause.message}` : 'No se pudo actualizar el paciente.')
        return
      }
      setPatients(list => list.map(p => p.id === editingPatient.id ? { ...p, name, nationalId, phone: normalizedPhone, email, address, whatsappConsentAt, initials } : p))
      setPlans(list => list.map(plan => plan.patient === editingPatient.name ? { ...plan, patient: name } : plan))
    } else if (supabase && clinicId) {
      try {
        const { data, error } = await supabase.from('patients').insert({ clinic_id: clinicId, full_name: name, national_id: nationalId, phone: normalizedPhone, email: email || null, address: address || null, whatsapp_consent_at: whatsappConsentAt }).select('id, full_name, national_id, phone, email, address, whatsapp_consent_at').single()
        if (error) { notify('No se pudo guardar el paciente. ' + error.message); return }
        setPatients(list => [{ id: data.id, name: data.full_name, nationalId: data.national_id, phone: data.phone, email: data.email ?? '', address: data.address ?? '', whatsappConsentAt: data.whatsapp_consent_at, status: 'Al día', balance: 0, initials }, ...list])
      } catch (cause) {
        notify(cause instanceof Error ? `No se pudo guardar el paciente. ${cause.message}` : 'No se pudo guardar el paciente.')
        return
      }
    } else if (editingPatient) {
      setPatients(list => list.map(p => p.id === editingPatient.id ? { ...p, name, nationalId, phone: normalizedPhone, email, address, whatsappConsentAt, initials } : p))
      setPlans(list => list.map(plan => plan.patient === editingPatient.name ? { ...plan, patient: name } : plan))
    } else {
      setPatients(list => [{ id: Date.now(), name, nationalId, phone: normalizedPhone, email, address, whatsappConsentAt, status: 'Al día', balance: 0, initials }, ...list])
    }
    setPatientName(''); setPatientNationalId(''); setPatientPhone(''); setPatientEmail(''); setPatientAddress(''); setPatientWhatsappConsent(false)
    setEditingPatient(null); setModal(null)
    notify(editingPatient ? 'Datos del paciente actualizados' : 'Paciente agregado a la lista')
  }
  const archivePatient = async (patient: Patient) => {
    if (patient.balance > 0) { notify('No se puede archivar mientras tenga saldo pendiente.'); return }
    if (!window.confirm(`¿Archivar a ${patient.name}? Sus pagos y planes se conservarán.`)) return
    if (supabase && clinicId) {
      try {
        const { error } = await supabase.from('patients').update({ archived_at: new Date().toISOString() }).eq('clinic_id', clinicId).eq('id', String(patient.id))
        if (error) { notify('No se pudo archivar el paciente. ' + error.message); return }
      } catch (cause) {
        notify(cause instanceof Error ? `No se pudo archivar el paciente. ${cause.message}` : 'No se pudo archivar el paciente.')
        return
      }
    }
    setPatients(list => list.filter(p => p.id !== patient.id))
    notify('Paciente archivado; sus registros financieros se conservaron.')
  }
  const savePayment = async (e: FormEvent) => {
    e.preventDefault()
    if (paymentSubmitting || paymentSubmitLock.current) return
    let amountCents: number
    let receivedLocalMinor: number | null = null
    if (paymentCurrency === 'USD') {
      try { amountCents = usdInputToCents(paymentAmount) } catch { notify('Escribe un monto válido con hasta dos decimales.'); return }
    } else {
      if (!currentExchangeRate) { notify('No hay una tasa validada para hoy. Registra el abono en USD o valida la tasa con la persona propietaria.'); return }
      try {
        receivedLocalMinor = localInputToMinor(paymentAmount, clinicLocalPrecision)
        amountCents = convertLocalMinorToUsdCents(receivedLocalMinor, currentExchangeRate.rate, clinicLocalPrecision)
      } catch (cause) { notify(cause instanceof Error ? cause.message : 'Revisa el monto en Bs.'); return }
    }
    const amount = amountCents / 100
    if (!paymentPatient || amountCents <= 0) return
    const patient = patients.find(p => String(p.id) === paymentPatient)
    if (!patient) return
    if (supabase && clinicId) {
      let allocations: { installment_id: string; amount_cents: number }[]
      try {
        allocations = Object.entries(paymentAllocations).map(([installment_id, value]) => ({ installment_id, amount_cents: usdInputToCents(value) }))
      } catch {
        notify('Escribe el monto en USD asignado a cada cuota seleccionada.')
        return
      }
      if (!allocations.length) { notify('Selecciona una o más cuotas y asigna a cada una una parte del pago.'); return }
      const selectedInstallments = allocations.map(allocation => installments.find(item => item.id === allocation.installment_id && item.patient_id === String(patient.id)))
      if (selectedInstallments.some(item => !item)) { notify('Una de las cuotas seleccionadas ya no está disponible. Actualiza la página e inténtalo de nuevo.'); return }
      if (allocations.some((allocation, index) => allocation.amount_cents > (selectedInstallments[index]?.balance_usd_cents ?? 0))) { notify('Una asignación supera el saldo de su cuota. Ajusta los montos antes de guardar.'); return }
      try {
        validatePaymentAllocationTotal(amountCents, allocations.map(allocation => allocation.amount_cents))
      } catch (cause) {
        notify(cause instanceof Error ? cause.message : 'La suma asignada debe coincidir exactamente con el pago.')
        return
      }
      const installment = selectedInstallments[0]!
      const rateId = paymentCurrency === 'VES' ? currentExchangeRate?.id ?? null : null
      const signature = JSON.stringify([clinicId, patient.id, allocations, amountCents, paymentCurrency, receivedLocalMinor, rateId, paymentMethod, paymentConcept.trim()])
      if (paymentAttempt.current && paymentAttempt.current.signature !== signature) {
        notify('Hay un pago anterior pendiente de confirmación. Conserva los mismos datos y vuelve a intentar para consultar ese resultado antes de registrar otro pago.')
        return
      }
      if (!paymentAttempt.current) {
        try {
          paymentAttempt.current = { signature, key: createIdempotencyKey() }
        } catch {
          notify('Este navegador no pudo generar una clave segura para el pago. Abre la app en un navegador actualizado e inténtalo de nuevo.')
          return
        }
      }
      if (paymentSubmitLock.current) return
      paymentSubmitLock.current = true
      setPaymentSubmitting(true)
      let rpcResult
      try {
        rpcResult = await supabase.rpc('record_payment', {
          p_clinic_id: clinicId, p_patient_id: String(patient.id), p_amount_usd_cents: amountCents,
          p_method: paymentMethod, p_allocations: allocations,
          p_idempotency_key: paymentAttempt.current.key, p_notes: paymentConcept || null,
          p_received_currency: paymentCurrency, p_received_local_minor: receivedLocalMinor, p_exchange_rate_id: rateId,
        })
      } catch (cause) {
        paymentSubmitLock.current = false
        setPaymentSubmitting(false)
        notify(`No se pudo confirmar el resultado del pago. Conservé la misma clave para reintentar sin duplicarlo. No cambies los datos.${cause instanceof Error ? ` ${cause.message}` : ''}`)
        return
      }
      const { data, error } = rpcResult
      if (error) {
        paymentSubmitLock.current = false
        setPaymentSubmitting(false)
        if (typeof error.code === 'string' && error.code) paymentAttempt.current = null
        notify('No se pudo confirmar el abono. ' + error.message)
        return
      }
      const result = Array.isArray(data) ? data[0] : data
      if (!result?.payment_id || !result?.receipt_number) {
        paymentSubmitLock.current = false
        setPaymentSubmitting(false)
        notify('El servidor no confirmó el número del pago. Conservé los datos para consultar el mismo intento; no registres otro abono todavía.')
        return
      }
      let receiptQuery
      try {
        receiptQuery = await supabase.from('payments').select('received_currency, received_local_minor, exchange_rate, rate_source, rate_as_of, rate_validated_at, received_at, receipt_number, receipt_snapshot').eq('clinic_id', clinicId).eq('id', result.payment_id).maybeSingle()
      } catch (cause) {
        paymentSubmitLock.current = false
        setPaymentSubmitting(false)
        notify(`El pago puede haberse guardado, pero no pudimos confirmar su recibo. Conservé la misma clave para reintentar sin duplicarlo. No cambies los datos.${cause instanceof Error ? ` ${cause.message}` : ''}`)
        return
      }
      const { data: receiptRow, error: receiptError } = receiptQuery
      if (receiptError || !receiptRow || String(receiptRow.receipt_number) !== String(result.receipt_number) || !receiptRow.receipt_snapshot || typeof receiptRow.receipt_snapshot !== 'object') {
        paymentSubmitLock.current = false
        setPaymentSubmitting(false)
        notify(`El pago puede haberse guardado, pero no pudimos confirmar su recibo. Conservé la misma clave para reintentar sin duplicarlo. No cambies los datos.${receiptError?.message ? ` ${receiptError.message}` : ''}`)
        return
      }
      paymentAttempt.current = null
      paymentSubmitLock.current = false
      setPaymentSubmitting(false)
      const receipt = receiptRow.receipt_number
      const snapshot = receiptRow.receipt_snapshot as Record<string, unknown>
      const afterCents = snapshot?.balance_after_usd_cents
      const receivedAt = receiptRow.received_at
      const savedPayment: Payment = { id: result.payment_id, patientId: String(patient.id), patient: patient.name, concept: `Recibo #${receipt}`, amount, amountCents, currency: receiptRow.received_currency, method: paymentMethodLabels[paymentMethod] ?? 'Otro', date: new Intl.DateTimeFormat('es-VE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(receivedAt)), receivedAt, status: 'Confirmado', receiptNumber: receipt, receiptSnapshot: snapshot, receivedCurrency: receiptRow.received_currency, receivedLocalMinor: receiptRow.received_local_minor, exchangeRate: receiptRow.exchange_rate, rateSource: receiptRow.rate_source, rateAsOf: receiptRow.rate_as_of, rateValidatedAt: receiptRow.rate_validated_at, localPrecision: typeof snapshot.local_precision === 'number' ? snapshot.local_precision : clinicLocalPrecision, installment: `${installment.description} · cuota ${installment.sequence}`, balanceAfter: typeof afterCents === 'number' ? afterCents / 100 : undefined }
      savedPayment.installment = allocations.map(allocation => {
        const item = installments.find(row => row.id === allocation.installment_id)
        return item ? item.description + ' · cuota ' + item.sequence + ' (' + money(allocation.amount_cents / 100) + ')' : ''
      }).filter(Boolean).join(' + ')
      setPayments(list => [savedPayment, ...list])
      setReceiptPayment(savedPayment)
      downloadReceiptPdf(receiptPdfData(savedPayment, clinicName, clinicTimezone))
      const allocatedByInstallment = new Map(allocations.map(allocation => [allocation.installment_id, allocation.amount_cents]))
      setInstallments(list => list.map(item => allocatedByInstallment.has(item.id) ? { ...item, balance_usd_cents: item.balance_usd_cents - (allocatedByInstallment.get(item.id) ?? 0) } : item).filter(item => item.balance_usd_cents > 0))
      setPatients(list => list.map(p => {
        if (p.id !== patient.id) return p
        const remainingCents = Math.max(0, usdInputToCents(p.balance.toFixed(2)) - amountCents)
        return { ...p, balance: remainingCents / 100, status: remainingCents === 0 ? 'Al día' : p.status }
      }))
      const allocatedByPlan = new Map<string, number>()
      for (const allocation of allocations) {
        const planId = installments.find(item => item.id === allocation.installment_id)?.plan_id
        if (planId) allocatedByPlan.set(planId, (allocatedByPlan.get(planId) ?? 0) + allocation.amount_cents)
      }
      setPlans(list => list.map(p => {
        const planPaymentCents = allocatedByPlan.get(String(p.id))
        if (p.patientId !== String(patient.id) || !planPaymentCents) return p
        const paidCents = usdInputToCents(p.paid.toFixed(2))
        const totalCents = usdInputToCents(p.total.toFixed(2))
        return { ...p, paid: Math.min(totalCents, paidCents + planPaymentCents) / 100 }
      }))
    } else {
      if (paymentCurrency !== 'USD') { notify('La demostración local solo admite pagos USD.'); return }
      const savedPayment: Payment = { id: Date.now(), patientId: String(patient.id), patient: patient.name, concept: paymentConcept || 'Abono a cuenta', amount, currency: 'USD', method: paymentMethodLabels[paymentMethod] ?? 'Otro', date: 'Ahora', receivedAt: new Date().toISOString(), status: 'Borrador local' }
      setPayments(list => [savedPayment, ...list])
      setReceiptPayment(savedPayment)
      setPatients(list => list.map(p => p.id === patient.id ? { ...p, balance: Math.max(0, p.balance - amount), status: Math.max(0, p.balance - amount) === 0 ? 'Al día' : 'Pendiente' } : p))
    }
    setPaymentAmount(''); setPaymentConcept(''); setPaymentAllocations({}); setPaymentCurrency('USD'); setModal(null); setPage('Pagos'); notify(cloudConfigured ? 'Abono guardado y recibo asignado' : 'Abono agregado en la demostración local')
  }
  const addPlanService = () => {
    const service = services.find(item => String(item.id) === planServiceChoice)
    if (!service) return
    if (planItems.some(item => item.serviceId === String(service.id))) { notify('Ese servicio ya está incluido en el plan.'); return }
    setPlanItems(list => [...list, { serviceId: String(service.id), name: service.name, category: service.category, description: service.description ?? '', amount: (service.priceCents / 100).toFixed(2).replace('.', ',') }])
    setPlanServiceChoice('')
  }
  const savePlan = async (e: FormEvent) => {
    e.preventDefault()
    let items: { service_id: string; amount_cents: number }[]
    try { items = planItems.map(item => ({ service_id: item.serviceId, amount_cents: usdInputToCents(item.amount) })) }
    catch { notify('Revisa el precio acordado de cada servicio.'); return }
    const amountCents = items.reduce((sum, item) => sum + item.amount_cents, 0)
    const total = amountCents / 100
    const treatment = planItems.map(item => item.name).join(' · ')
    const installmentCount = Number(planInstallments)
    const patient = patients.find(p => String(p.id) === planPatient)
    if (!patient || !items.length || !Number.isSafeInteger(amountCents) || amountCents <= 0 || !Number.isInteger(installmentCount) || installmentCount < 1 || installmentCount > 120 || amountCents < installmentCount) { notify('Selecciona uno o más servicios y revisa el monto y las cuotas.'); return }
    if (supabase && clinicId) {
      const { data, error } = await supabase.rpc('create_treatment_plan', { p_clinic_id: clinicId, p_patient_id: String(patient.id), p_installment_count: installmentCount, p_first_due_on: planFirstDue, p_items: items })
      if (error) { notify('No se pudo crear el plan. ' + error.message); return }
      const created = Array.isArray(data) ? data[0] : data
      if (!created?.plan_id || !created?.plan_code) { notify('El plan se creó, pero no recibimos su código. Actualiza la página para verlo.'); return }
      setPlans(list => [{ id: String(created.plan_id), planCode: created.plan_code, patientId: String(patient.id), patient: patient.name, treatment, total, paid: 0, nextDue: formatDueDate(planFirstDue), status: 'Al día', items: planItems.map(item => ({ id: item.serviceId, name: item.name, category: item.category ?? 'General', description: item.description ?? '', amount: usdInputToCents(item.amount) / 100 })) }, ...list])
    } else {
      const planCode = `PL-${String(plans.length + 1).padStart(6, '0')}`
      setPlans(list => [{ id: Date.now(), planCode, patientId: String(patient.id), patient: patient.name, treatment, total, paid: 0, nextDue: formatDueDate(planFirstDue), status: 'Al día', items: planItems.map(item => ({ id: item.serviceId, name: item.name, category: item.category ?? 'General', description: item.description ?? '', amount: usdInputToCents(item.amount) / 100 })) }, ...list])
    }
    setPatients(list => list.map(p => p.id === patient.id ? { ...p, balance: p.balance + total, status: 'Pendiente' } : p))
    setPlanPatient(''); setPlanServiceChoice(''); setPlanItems([]); setPlanInstallments('1'); setModal(null); setPage('Planes de pago'); notify(cloudConfigured ? 'Plan creado en el consultorio' : 'Plan agregado en la demostración local')
  }

  const pageSubtitle: Record<Page, string> = {
    Inicio: 'Un vistazo claro a las cuentas de tu consultorio.', Pacientes: 'La información de contacto y sus cuentas, en un solo lugar.',
    'Planes de pago': 'Tratamientos, cuotas y saldos por cobrar.', Pagos: 'Cada abono registrado, con su detalle y comprobante.',
    Servicios: 'Tu catálogo de tratamientos y precios base.', Reportes: 'Entiende cómo se mueve la cobranza de tu consultorio.', Configuración: 'Personaliza la información de tu clínica y equipo.',
  }

  if (cloudConfigured && !sessionReady) return <LoadingScreen />
  if (cloudConfigured && !session) return <AuthScreen />
  if (cloudConfigured && session && !clinicLookupDone) return <LoadingScreen />
  if (cloudConfigured && session && clinicLookupDone && !clinicId) return <ClinicSetupScreen
    clinicName={clinicSetupName}
    onClinicNameChange={setClinicSetupName}
    onSubmit={async event => {
      event.preventDefault()
      if (!supabase) return
      setClinicSetupBusy(true)
      setClinicSetupError('')
      try {
        const { error } = await supabase.rpc('create_clinic_for_current_user', { p_name: clinicSetupName.trim() })
        if (error) throw error
        window.location.reload()
      } catch (cause) {
        setClinicSetupError(cause instanceof Error ? cause.message : 'No pudimos crear el consultorio.')
        setClinicSetupBusy(false)
      }
    }}
    busy={clinicSetupBusy}
    error={clinicSetupError}
    loadError={clinicLoadError}
    email={session.user.email ?? ''}
    onRetry={() => window.location.reload()}
    onSignOut={() => { if (supabase) void supabase.auth.signOut() }}
  />

  return <div className="app-shell">
    <style>{`
      html[data-theme="dark"] { color-scheme: dark; background: #191715; }
      html[data-theme="dark"] body { background: #191715 !important; color: #f5f0e8 !important; }
      html[data-theme="dark"] .app-shell { min-height: 100vh; background: #191715 !important; color: #f5f0e8 !important; }
      html[data-theme="dark"] .sidebar,
      html[data-theme="dark"] .topbar,
      html[data-theme="dark"] .panel,
      html[data-theme="dark"] .stat-card,
      html[data-theme="dark"] .service-card,
      html[data-theme="dark"] .due-item,
      html[data-theme="dark"] .team-member,
      html[data-theme="dark"] .team-list,
      html[data-theme="dark"] .table-wrap,
      html[data-theme="dark"] .payment-allocation-row,
      html[data-theme="dark"] .plan-service-line,
      html[data-theme="dark"] .payment-allocation-list,
      html[data-theme="dark"] .plan-service-list,
      html[data-theme="dark"] .modal,
      html[data-theme="dark"] .clinic-switch,
      html[data-theme="dark"] .app-footer { background-color: #24211e !important; color: #f5f0e8 !important; border-color: #494239 !important; }
      html[data-theme="dark"] .main-area,
      html[data-theme="dark"] .page-wrap { background: #191715 !important; color: #f5f0e8 !important; }
      html[data-theme="dark"] .app-shell .app-footer { background-image: none !important; }
      html[data-theme="dark"] .app-shell .footer-icon { background: #393226 !important; border-color: #594a2f !important; color: #f3da8a !important; }
      html[data-theme="dark"] .app-shell .footer-icon svg { color: #f3da8a !important; stroke: #f3da8a !important; }
      html[data-theme="dark"] .app-shell .service-overview { background: #24211e !important; border-color: #494239 !important; }
      html[data-theme="dark"] .app-shell .service-overview-icon { background: #393226 !important; color: #f3da8a !important; }
      html[data-theme="dark"] .app-shell .service-overview-stat strong { color: #f3da8a !important; }
      html[data-theme="dark"] .app-shell .row-action { background: #302b24 !important; border-color: #494239 !important; color: #f5f0e8 !important; }
      html[data-theme="dark"] .app-shell .row-action-primary { background: #e2c577 !important; border-color: #e2c577 !important; color: #2c251a !important; }
      html[data-theme="dark"] .app-shell .row-action-danger { background: #482b29 !important; border-color: #68403b !important; color: #ffc3b8 !important; }
      html[data-theme="dark"] .app-shell .payment-reversed { color: #ffc3b8 !important; }
      html[data-theme="dark"] .app-shell .key-balance { color: #f3da8a !important; }
      html[data-theme="dark"] .app-shell .mobile-card-list .mobile-table-card { background: #24211e !important; border-color: #494239 !important; box-shadow: none !important; }
      html[data-theme="dark"] .app-shell .mobile-card-list .mobile-table-card td::before { color: #b4c7be !important; }
        html[data-theme="dark"] .app-shell * { border-color: #494239 !important; }
        html[data-theme="dark"] .app-shell svg { stroke: currentColor !important; }
        html[data-theme="dark"] .app-shell input,
        html[data-theme="dark"] .app-shell select,
        html[data-theme="dark"] .app-shell textarea {
          color: #f5f0e8 !important;
          background-color: #191715 !important;
          border-color: #494239 !important;
          color-scheme: dark;
        }
        html[data-theme="dark"] .app-shell input::placeholder,
        html[data-theme="dark"] .app-shell textarea::placeholder {
          color: #a99f91 !important;
          opacity: 1;
        }
        html[data-theme="dark"] .app-shell input:disabled,
        html[data-theme="dark"] .app-shell select:disabled,
        html[data-theme="dark"] .app-shell textarea:disabled {
          color: #c1b9ae !important;
          background-color: #302b24 !important;
          opacity: 1;
        }
        html[data-theme="dark"] .app-shell option {
          color: #f5f0e8 !important;
          background: #191715 !important;
        }
      html[data-theme="dark"] .app-shell .muted,
      html[data-theme="dark"] .app-shell small,
      html[data-theme="dark"] .app-shell .eyebrow { color: #b4c7be !important; }
      html[data-theme="dark"] .app-shell input,
      html[data-theme="dark"] .app-shell select,
      html[data-theme="dark"] .app-shell textarea { background: #191715 !important; color: #f5f0e8 !important; border-color: #494239 !important; }
      html[data-theme="dark"] .app-shell input::placeholder,
      html[data-theme="dark"] .app-shell textarea::placeholder { color: #a99f91 !important; }
      html[data-theme="dark"] .app-shell button:not(.primary):not(.mobile-add) { color: #e7ddca; }
      html[data-theme="dark"] .app-shell .button.secondary,
      html[data-theme="dark"] .app-shell .button.subtle,
      html[data-theme="dark"] .app-shell .icon-button,
      html[data-theme="dark"] .app-shell .theme-toggle { background: #302b24 !important; color: #f5f0e8 !important; border-color: #494239 !important; }
      html[data-theme="dark"] .app-shell .button.primary { color: #fff !important; }
      html[data-theme="dark"] .app-shell .demo-pill,
      html[data-theme="dark"] .app-shell .connected-pill,
      html[data-theme="dark"] .app-shell [class*="toast"] { background: #393226 !important; color: #f3da8a !important; }
      html[data-theme="dark"] .app-shell .clinic-avatar,
      html[data-theme="dark"] .app-shell .profile-avatar,
      html[data-theme="dark"] .app-shell .top-avatar,
      html[data-theme="dark"] .app-shell .person-avatar,
      html[data-theme="dark"] .app-shell .nav-count { background: #393226 !important; color: #f3da8a !important; }
      html[data-theme="dark"] .app-shell [class*="stat-icon"],
      html[data-theme="dark"] .app-shell [class*="date-tile"] { background: #393226 !important; border-color: #594a2f !important; color: #f3da8a !important; }
      html[data-theme="dark"] .app-shell .clinic-avatar svg,
      html[data-theme="dark"] .app-shell .profile-avatar svg,
      html[data-theme="dark"] .app-shell .top-avatar svg,
      html[data-theme="dark"] .app-shell .person-avatar svg { color: #f3da8a !important; stroke: #f3da8a !important; }
      html[data-theme="dark"] .app-shell [class*="stat-icon"] svg,
      html[data-theme="dark"] .app-shell [class*="date-tile"] svg { color: #f3da8a !important; stroke: #f3da8a !important; }
      html[data-theme="dark"] .app-shell .action-icon.inverse svg,
      html[data-theme="dark"] .app-shell .button.primary svg,
      html[data-theme="dark"] .app-shell .mobile-add svg { color: #493718 !important; stroke: #493718 !important; background: transparent !important; }
      html[data-theme="dark"] .app-shell .hero-actions .action-icon.inverse { background: #f3da8a !important; border-color: #f7e6b5 !important; color: #493718 !important; box-shadow: 0 5px 14px rgba(0, 0, 0, .2) !important; }
      html[data-theme="dark"] .app-shell .hero-actions .action-icon.inverse svg { color: #493718 !important; stroke: #493718 !important; }
      html[data-theme="dark"] .app-shell .nav-link.active { background: #393226 !important; color: #f3da8a !important; }
      html[data-theme="dark"] .app-shell .mobile-more-menu { background: #24211e !important; color: #f5f0e8 !important; border-color: #494239 !important; box-shadow: 0 14px 36px rgba(0,0,0,.42) !important; }
      html[data-theme="dark"] .app-shell .mobile-more-menu button { color: #e8f1ec !important; }
      html[data-theme="dark"] .app-shell .mobile-more-menu button:active { background: #393226 !important; }
      html[data-theme="dark"] .app-shell .mobile-nav { background: rgba(36, 33, 30, .96) !important; border-color: #494239 !important; box-shadow: 0 9px 28px rgba(0, 0, 0, .34) !important; }
      html[data-theme="dark"] .app-shell .mobile-nav > button { color: #a99f91 !important; }
      html[data-theme="dark"] .app-shell .mobile-nav > button.selected { background: transparent !important; color: #f3da8a !important; }
      html[data-theme="dark"] .app-shell .mobile-nav > button.selected:before { background: #393226 !important; }
      html[data-theme="dark"] .app-shell .mobile-nav .mobile-add { background: #e2c577 !important; border-color: #191715 !important; color: #2c251a !important; }
      html[data-theme="dark"] .app-shell .mobile-nav .mobile-add svg { color: #493718 !important; stroke: #493718 !important; }
      html[data-theme="dark"] .app-shell .mobile-more-menu { background: #24211e !important; color: #f5f0e8 !important; border-color: #494239 !important; }
      html[data-theme="dark"] .app-shell .mobile-more-menu button { color: #f5f0e8 !important; }
      html[data-theme="dark"] .app-shell .mobile-more-menu button:active { background: #393226 !important; }
      html[data-theme="dark"] .app-shell .dashboard-priority,
      html[data-theme="dark"] .app-shell .dashboard-activity { background: #24211e !important; border-color: #494239 !important; }
      html[data-theme="dark"] .app-shell .dashboard-priority .due-item { background: transparent !important; border-color: #494239 !important; }
      html[data-theme="dark"] .app-shell .dashboard-priority .date-tile { background: #302b24 !important; border-color: #494239 !important; }
      html[data-theme="dark"] .app-shell .dashboard-priority .date-tile.is-overdue { background: #3b2926 !important; border-color: #65403a !important; }
      html[data-theme="dark"] .app-shell .dashboard-empty .round-icon { background: #393226 !important; border-color: #594a2f !important; color: #f3da8a !important; }
      html[data-theme="dark"] .app-shell .chart-area svg { stroke: none !important; }
      html[data-theme="dark"] .app-shell .chart-area svg path[fill] { stroke: none !important; }
      html[data-theme="dark"] .app-shell .chart-area svg path[stroke] { stroke: #e2c577 !important; }
      html[data-theme="dark"] .app-shell .chart-area svg stop { stop-color: #e2c577 !important; }
      html[data-theme="dark"] .app-shell .toast { background: #302b24 !important; color: #f5f0e8 !important; }
      html[data-theme="dark"] .app-shell .section-intro,
      html[data-theme="dark"] .app-shell .report-heading,
      html[data-theme="dark"] .app-shell .tip-banner,
      html[data-theme="dark"] .app-shell .form-note,
      html[data-theme="dark"] .app-shell .notice-card,
      html[data-theme="dark"] .app-shell .team-invite,
      html[data-theme="dark"] .app-shell .empty-state,
      html[data-theme="dark"] .app-shell .settings-menu { background: #302b24 !important; color: #e5d9c2 !important; border-color: #494239 !important; }
      html[data-theme="dark"] .app-shell .settings-menu button,
      html[data-theme="dark"] .app-shell .settings-menu button.selected { background: #302b24 !important; color: #f5f0e8 !important; border-color: #494239 !important; }
      html[data-theme="dark"] .app-shell .settings-menu button.selected { background: #393226 !important; color: #f3da8a !important; }
      html[data-theme="dark"] .app-shell .intro-icon,
      html[data-theme="dark"] .app-shell .tip-icon,
      html[data-theme="dark"] .app-shell .round-icon,
      html[data-theme="dark"] .app-shell .service-icon,
      html[data-theme="dark"] .app-shell .report-icon,
      html[data-theme="dark"] .app-shell .audit-event-mark,
      html[data-theme="dark"] .app-shell .badge,
      html[data-theme="dark"] .app-shell [class*="service-tone-"] { background: #393226 !important; color: #f3da8a !important; border-color: #594a2f !important; }
      html[data-theme="dark"] .app-shell .disabled-select,
      html[data-theme="dark"] .app-shell .select-lite,
      html[data-theme="dark"] .app-shell .filter-control { background: #191715 !important; color: #f5f0e8 !important; border-color: #494239 !important; }
      html[data-theme="dark"] .app-shell .statement-content,
      html[data-theme="dark"] .app-shell .statement-overview,
      html[data-theme="dark"] .app-shell .statement-section,
      html[data-theme="dark"] .app-shell .receipt-document,
      html[data-theme="dark"] .app-shell .receipt-patient,
      html[data-theme="dark"] .app-shell .receipt-details { background: #24211e !important; color: #f5f0e8 !important; border-color: #494239 !important; }
      html[data-theme="dark"] .app-shell .badge.warning { background: #493b20 !important; color: #f4d88f !important; border-color: #65512b !important; }
      html[data-theme="dark"] .app-shell .badge.danger,
      html[data-theme="dark"] .app-shell .receipt-reversed,
      html[data-theme="dark"] .app-shell .audit-error { background: #482b29 !important; color: #ffc3b8 !important; border-color: #68403b !important; }
      html[data-theme="dark"] .app-shell .donut { background: radial-gradient(#24211e 54%, transparent 56%), conic-gradient(#d8b66d 0deg, #d8b66d 48%, #f3da8a 48%, #f3da8a 76%, #d88372 76%, #d88372 90%, #77746f 90%) !important; }
      /* Final dark-theme pass: keep every success, form, and status accent in warm brand colors. */
      html[data-theme="dark"] .app-shell :is(.sidebar,.topbar,.panel,.stat-card,.service-card,.due-item,.team-member,.team-list,.table-wrap,.payment-allocation-row,.plan-service-line,.payment-allocation-list,.plan-service-list,.modal,.clinic-switch,.app-footer,.service-overview,.mobile-card-list .mobile-table-card,.statement-content,.statement-overview,.statement-section,.receipt-document,.receipt-patient,.receipt-details,.notice-card) { background-color: #24211e !important; border-color: #494239 !important; }
      /* Full audit fixes: strengthen supporting text and give every control a usable hit area. */
      html[data-theme="light"] .app-shell .badge.warning { color: #73551f !important; }
      html[data-theme="light"] .app-shell .progress-caption span { color: #665d51 !important; }
      html[data-theme="light"] .app-shell .row-action-primary { background: #e9bf50 !important; border-color: #d4a936 !important; color: #302411 !important; }
      html[data-theme="light"] .app-shell .row-action-danger { color: #6b4f49 !important; }
      html[data-theme="light"] .app-shell :is(.section-intro p,.report-heading p,.service-price small,.legend span,.settings-menu button:not(.selected),.settings-title p,.settings-actions,.disabled-select) { color: #665d51 !important; }
      html[data-theme="light"] .app-shell .settings-title .clinic-avatar.large { color: #73551f !important; }
      html[data-theme="light"] .app-shell :is(.clinic-avatar,.top-avatar,.clinic-avatar.large) { color: #73551f !important; }
      html[data-theme="light"] .app-shell .team-member-avatar { background: #f3e8cd !important; border-color: #e5d3a7 !important; color: #785b23 !important; }
      html[data-theme="light"] .app-shell .disabled-select span { color: #665d51 !important; }
      html[data-theme="light"] .app-shell .settings-actions span { color: #665d51 !important; }
      html[data-theme="light"] .app-shell .row-action { color: #514638 !important; }
      html[data-theme="light"] .app-shell .row-action-danger { color: #68443c !important; }
      html[data-theme="light"] .app-shell .button.secondary.compact { color: #514638 !important; }
      html[data-theme="light"] .app-shell .hero-chip { color: #fff8e8 !important; }
      html[data-theme="light"] .app-shell .hero-copy > p { color: #fff8e8 !important; }
      html[data-theme="light"] .app-shell .hero-copy > p button { color: #fff4d6 !important; }
      html[data-theme="light"] .app-shell .hero-foot { color: #fff4d6 !important; }
      html[data-theme="light"] .app-shell .secure-label { color: #fff4d6 !important; }
      html[data-theme="light"] .app-shell .settings-panel .clinic-avatar.large { color: #73551f !important; }
      html[data-theme="light"] body .app-shell .settings-panel .settings-title > .clinic-avatar.large { color: #73551f !important; background: #f3e8cd !important; }
      html[data-theme="light"] .app-shell .tip-banner p,
      html[data-theme="light"] .app-shell .donut span,
      html[data-theme="light"] .app-shell .notice-card p,
      html[data-theme="light"] .app-shell .statement-plan-items small { color: #665d51 !important; }
      html[data-theme="light"] .app-shell .tip-banner > button { color: #785b23 !important; }
      html[data-theme="light"] .app-shell .hero-foot { border-top-color: rgb(255 244 214 / 34%) !important; }
      html[data-theme="light"] .app-shell .button.secondary.compact { background: #fffdf9 !important; color: #514638 !important; border-color: #e2d7c8 !important; }
      html[data-theme="dark"] .app-shell .button.secondary.compact { background: #393226 !important; color: #f3e6c7 !important; border-color: #594a2f !important; }
      html[data-theme="dark"] .app-shell .row-action { background: #393226 !important; color: #f3e6c7 !important; border-color: #594a2f !important; }
      html[data-theme="dark"] .app-shell .row-action-primary { background: #e8c66a !important; color: #302411 !important; border-color: #e8c66a !important; }
      html[data-theme="dark"] .app-shell .row-action-danger { background: #482b29 !important; color: #ffd0c5 !important; border-color: #68403b !important; }
      html[data-theme="light"] .app-shell :is(.hero-chip,.secure-label) { border-color: rgb(255 244 214 / 34%) !important; }
      html[data-theme="light"] .app-shell .hero-chip svg { color: #ffdf82 !important; }
      html[data-theme="light"] .app-shell :is(.icon-button,.icon-button svg,.row-menu,.row-menu svg,.search-box,.search-box svg) { color: #74685a !important; }
      html[data-theme="light"] .app-shell :is(.clinic-switch > svg,.nav-link:not(.active) svg,.mobile-nav > button:not(.selected) svg,.profile > svg,.settings-actions svg) { color: #74614a !important; stroke: currentColor !important; }
      html[data-theme="light"] .app-shell .stat-icon.peach svg { color: #85532d !important; stroke: currentColor !important; }
      html[data-theme="light"] .app-shell .service-tone-1 { background: #f3eee5 !important; color: #74614a !important; }
      html[data-theme="light"] body .app-shell .settings-panel .whatsapp-template-help small { color: #665d51 !important; }
      html[data-theme="light"] body .app-shell .settings-panel .whatsapp-preview span { color: #785b23 !important; }
      html[data-theme="light"] body .app-shell .footer-brand { color: #665d51 !important; font-size: 12px !important; }
      html[data-theme="light"] .app-shell :is(.icon-button,.search-box,.filter-control) { border-color: #ded5c8 !important; }
      html[data-theme="light"] .app-shell :is(.badge.success,.stat-icon.green,.stat-icon.mint,.service-tone-0,.service-tone-3,.help-icon,.clinic-avatar,.profile-avatar,.top-avatar,.green-dot,.dot.green-dot,.progress-track i,.badge.success i) { background-color: #f3e8cd !important; border-color: #e5d3a7 !important; color: #785b23 !important; }
      html[data-theme="light"] .app-shell :is(.amount-positive,.badge.success) { color: #785b23 !important; }
      html[data-theme="light"] .app-shell .badge.green { background: #f3e8cd !important; border-color: #e5d3a7 !important; color: #785b23 !important; }
      html[data-theme="light"] .app-shell .donut { background: radial-gradient(#fff 54%, transparent 56%), conic-gradient(#d4ac54 0deg, #d4ac54 48%, #a98542 48%, #a98542 76%, #c77c68 76%, #c77c68 90%, #eee4d3 90%) !important; }
      html[data-theme="light"] .app-shell :is(.notification i,.secure-label i) { background-color: #e9c86f !important; }
      html[data-theme="light"] .app-shell :is(.hero-chip,.action-icon,.hero-mark,.secure-label) { background-color: rgb(255 246 225 / 12%) !important; border-color: rgb(255 244 214 / 34%) !important; }
      html[data-theme="light"] .app-shell .action-icon.inverse { background: #f3d577 !important; border-color: #f3d577 !important; color: #49391c !important; }
      html[data-theme="dark"] .app-shell :is(.form-note,.settings-actions,.settings-menu button,.notice-card,.tip-banner,.tip-icon,.intro-icon,.report-icon,.round-icon,.settings-title .clinic-avatar.large) { background-color: #302b24 !important; border-color: #494239 !important; color: #e5d9c2 !important; }
      html[data-theme="dark"] .app-shell .team-invite { background: #24211e !important; border-color: #494239 !important; color: #f5f0e8 !important; }
      html[data-theme="dark"] .app-shell .team-member-avatar { background: #393226 !important; border-color: #594a2f !important; color: #f3da8a !important; }
      html[data-theme="dark"] .app-shell :is(.stat-icon.green,.stat-icon.mint,.service-tone-0,.service-tone-1,.service-tone-2,.service-tone-3,.help-icon,.clinic-avatar,.profile-avatar,.top-avatar,.round-icon,.tip-icon,.intro-icon,.report-icon) { background: #393226 !important; color: #f3da8a !important; }
      html[data-theme="dark"] .app-shell :is(.amount-positive,.amount-negative,.nav-link.active,.nav-link.active svg,.text-link,.panel-bottom-link,.service-action,.service-menu .text-link,.settings-menu button.selected) { color: #f3da8a !important; }
      html[data-theme="dark"] .app-shell :is(.badge.success,.badge.warning,.badge.danger,.badge.neutral) { background: #393226 !important; border-color: #594a2f !important; color: #f3da8a !important; }
      html[data-theme="dark"] .app-shell .badge.green { background: #393226 !important; border-color: #594a2f !important; color: #f3da8a !important; }
      html[data-theme="dark"] .app-shell :is(.green-dot,.dot.green-dot,.progress-track i,.badge.success i) { background-color: #e8c66a !important; }
      html[data-theme="dark"] .app-shell .donut { background: radial-gradient(#24211e 54%, transparent 56%), conic-gradient(#e8c66a 0deg, #e8c66a 48%, #c39a50 48%, #c39a50 76%, #c77c68 76%, #c77c68 90%, #494239 90%) !important; }
      html[data-theme="dark"] .app-shell :is(.notice-card,.form-note,.tip-banner,.form-note.success,.form-note.warning,.settings-actions) { color: #e5d9c2 !important; }
      .app-shell .search-box input { height: 100%; min-height: 24px; }
      .app-shell .filter-control select { height: 100%; min-height: 24px; }
      .app-shell :is(.service-menu .text-link,.service-action) { min-height: 36px; padding: 8px; }
      .app-shell .service-menu .text-link { justify-content: center; }
      html[data-theme="dark"] .app-shell :is(.main-area,.page-wrap) { background-color: #191715 !important; }
      html[data-theme="dark"] .app-shell :is(.nav-count,.badge.success,.badge.neutral,.connected-pill,.demo-pill.connected-pill,[class*="service-tone-"],.service-icon,.service-overview-icon) { background: #393226 !important; color: #f3da8a !important; border-color: #594a2f !important; }
      html[data-theme="dark"] .app-shell :is(.secure-label,.badge.success,.key-balance,.amount-positive,.service-price,.service-overview-stat strong) { color: #f3da8a !important; }
      html[data-theme="dark"] .app-shell :is(.secure-label i,.demo-pill i,.connected-pill i,.notification > i,.badge.success i) { background: #d8b66d !important; }
      html[data-theme="dark"] .app-shell :is(.service-overview-icon svg,.service-icon svg,.badge.success svg,.badge.neutral svg) { color: #f3da8a !important; stroke: currentColor !important; }
      html[data-theme="dark"] .app-shell :is(input,select,textarea,.disabled-select,.select-lite,.filter-control) { background: #191715 !important; color: #f5f0e8 !important; border-color: #494239 !important; }
      html[data-theme="dark"] .app-shell :is(input,textarea)::placeholder { color: #c1b9ae !important; }
      html[data-theme="dark"] .app-shell :is(input,select,textarea):focus { border-color: #d8b66d !important; box-shadow: 0 0 0 3px rgb(216 182 109 / 18%) !important; }
      html[data-theme="dark"] .app-shell :is(.notice-card,.settings-menu button.selected,.payment-allocation-row,.plan-service-line,.team-member,.team-list,.mobile-table-card,.table-wrap,.round-icon,.tip-icon,.intro-icon,.report-icon) { border-color: #494239 !important; }
      html[data-theme="dark"] .app-shell :is(.form-note,.settings-menu button,.settings-menu button.selected) { border-color: #494239 !important; }
      html[data-theme="dark"] .app-shell .settings-menu button:not(.selected) { background: #302b24 !important; color: #c1b9ae !important; border-color: #494239 !important; }
      html[data-theme="dark"] .app-shell .settings-menu button.selected { background: #393226 !important; color: #f3da8a !important; border-color: #594a2f !important; }
      html[data-theme="dark"] .app-shell .notice-card { background: #24211e !important; color: #f5f0e8 !important; border-color: #494239 !important; }
      html[data-theme="dark"] .app-shell option { background: #191715 !important; color: #f5f0e8 !important; }
      html[data-theme="dark"] .app-shell .progress-track { background: #494239 !important; }
      html[data-theme="dark"] .app-shell :is(.round-icon,.tip-icon,.intro-icon,.report-icon) { background: #302b24 !important; color: #f3da8a !important; }
      html[data-theme="dark"] .app-shell .footer-icon,
      html[data-theme="dark"] .app-shell .footer-icon svg { background: #393226 !important; border-color: #594a2f !important; color: #f3da8a !important; stroke: #f3da8a !important; }
      html[data-theme="dark"] .app-shell :is(.secure-label,.hero-copy > p button) { color: #e7ddca !important; }
      html[data-theme="dark"] .app-shell :is(.dashboard-empty b,.mobile-table-card b,.service-card h3,.service-overview > b,.notice-card b,.stat-card b,.donut > strong) { color: #f5f0e8 !important; }
      html[data-theme="dark"] .app-shell :is(.service-overview-note,.service-overview-stat > span,.notice-card > span) { color: #c1b9ae !important; }
      html[data-theme="dark"] .app-shell .notice-card > span { background: #393226 !important; border-color: #594a2f !important; }
      html[data-theme="dark"] .app-shell .notice-card > span svg { color: #f3da8a !important; stroke: currentColor !important; }
      html[data-theme="dark"] .app-shell .hero-actions > button { color: #e7ddca !important; }
      /* Final overrides must follow legacy dark rules above: these panels were still green. */
      html[data-theme="dark"] .app-shell :is(.form-note,.whatsapp-template-help,.whatsapp-preview,.whatsapp-consent) { background: #2a2621 !important; color: #eee7dc !important; border-color: #51483a !important; }
      html[data-theme="dark"] .app-shell :is(.form-note,.whatsapp-template-help,.whatsapp-preview,.whatsapp-consent) :is(svg,strong,b,span) { color: #eee7dc !important; }
      html[data-theme="dark"] .app-shell :is(.whatsapp-preview > span,.settings-title .clinic-avatar.large,.settings-menu button.selected svg) { color: #e4c475 !important; }
      html[data-theme="dark"] .app-shell .settings-title .clinic-avatar.large { background: #393226 !important; border-color: #594a2f !important; }
      html[data-theme="dark"] .app-shell .whatsapp-consent input { accent-color: #d9b65d !important; }
      html[data-theme="dark"] .app-shell :is(.whatsapp-template-help small,.whatsapp-consent small) { color: #c8bda9 !important; }
      html[data-theme="dark"] .app-shell :is(.form-note,.whatsapp-template-help,.whatsapp-preview,.whatsapp-consent) a { color: #e4c475 !important; }
      html[data-theme="light"] .app-shell :is(.form-note,.whatsapp-template-help,.whatsapp-preview,.whatsapp-consent) { background: #f6f1e8 !important; color: #655b4d !important; border-color: #e8dcc8 !important; }
      html[data-theme="light"] .app-shell :is(.whatsapp-preview > span,.settings-title .clinic-avatar.large,.settings-menu button.selected svg) { color: #9a7433 !important; }
      html[data-theme="light"] .app-shell .settings-title .clinic-avatar.large { background: #f2e9d8 !important; border-color: #e8dcc8 !important; }
      html[data-theme="light"] .app-shell .whatsapp-consent input { accent-color: #b38a40 !important; }
      html[data-theme="light"] .app-shell :is(.whatsapp-template-help small,.whatsapp-consent small) { color: #817565 !important; }
      /* Brighter, clearer gold for key actions and selected states. */
      html[data-theme="light"] .app-shell .button.primary { background: #e9bf50 !important; color: #302411 !important; border-color: #e9bf50 !important; box-shadow: 0 5px 14px rgb(185 138 42 / 18%) !important; }
      html[data-theme="light"] .app-shell .button.primary svg { color: #302411 !important; stroke: currentColor !important; }
      html[data-theme="light"] .app-shell :is(.nav-link.active,.settings-menu button.selected) { background: #fbf1d7 !important; color: #785a1f !important; }
      html[data-theme="light"] .app-shell :is(.nav-link.active svg,.settings-menu button.selected svg) { color: #9a7433 !important; }
      html[data-theme="dark"] .app-shell :is(.button.primary,.mobile-nav .mobile-add,.hero-actions .action-icon.inverse) { background: #f3cf62 !important; color: #302411 !important; border-color: #f3cf62 !important; box-shadow: 0 5px 16px rgb(0 0 0 / 22%) !important; }
      html[data-theme="dark"] .app-shell :is(.button.primary,.mobile-nav .mobile-add,.hero-actions .action-icon.inverse) svg { color: #302411 !important; stroke: currentColor !important; }
      html[data-theme="dark"] .app-shell :is(.nav-link.active,.settings-menu button.selected) { background: #40351f !important; color: #ffe28a !important; border-color: #705b2c !important; }
      html[data-theme="dark"] .app-shell :is(.nav-link.active svg,.settings-menu button.selected svg,.hero-chip svg) { color: #ffe28a !important; stroke: currentColor !important; }
      html[data-theme="dark"] .app-shell .hero-copy > p button,
      html[data-theme="light"] .app-shell .hero-copy > p button { display: inline-flex !important; align-items: center; min-height: 32px; padding: 6px 8px; border-radius: 7px; vertical-align: middle; }
      html[data-theme="dark"] .app-shell .tip-banner > button,
      html[data-theme="light"] .app-shell .tip-banner > button { min-height: 36px; padding: 8px 10px; border-radius: 8px; }
      html[data-theme="light"] .app-shell :is(.clinic-switch small,.profile-text small,.nav-group > p,.breadcrumb,.page-heading .muted,.muted,.date-tile > span,th,.stat-card > small,.cell-sub,.due-info > span,.due-info > small,.panel-head p,.listing-panel > p) { color: #6e6559 !important; }
      html[data-theme="light"] .app-shell .breadcrumb .slash { color: #756752 !important; }
      html[data-theme="light"] .app-shell .eyebrow { color: #6b6257 !important; }
      html[data-theme="light"] .app-shell .eyebrow span { color: #8a641f !important; }
      html[data-theme="light"] .app-shell .eyebrow,
      html[data-theme="light"] .app-shell .eyebrow span { font-size: 12px !important; }
      html[data-theme="dark"] .app-shell .eyebrow,
      html[data-theme="dark"] .app-shell .eyebrow span { font-size: 12px !important; }
      html[data-theme="light"] .app-shell .profile-avatar { color: #75551d !important; }
      html[data-theme="light"] .app-shell :is(.text-link,.panel-bottom-link) { color: #785a1f !important; }
      html[data-theme="light"] .app-shell .mobile-nav > button > span { color: #6e6559 !important; font-size: 12px !important; line-height: 1.15; }
      html[data-theme="light"] .app-shell .mobile-nav > button.selected > span { color: #785a1f !important; }
      html[data-theme="dark"] .app-shell .mobile-nav > button > span { font-size: 12px !important; line-height: 1.15; }
      html[data-theme="light"] .app-shell .mobile-nav > button,
      html[data-theme="dark"] .app-shell .mobile-nav > button { font-size: 12px !important; }
      html[data-theme="dark"] .app-shell :is(.hero-actions .action-icon:not(.inverse),.hero-chip,.secure-label,.hero-foot) { background-color: rgb(255 248 230 / 10%) !important; border-color: rgb(255 241 203 / 25%) !important; }
      html[data-theme="light"] .app-shell :is(.nav-group > p,.date-tile > span,th,.stat-card > small,.cell-sub,.due-info > span,.due-info > small,.tip-banner p,.app-footer) { font-size: 12px !important; }
      html[data-theme="dark"] .app-shell :is(.nav-group > p,.date-tile > span,th,.stat-card > small,.cell-sub,.due-info > span,.due-info > small,.tip-banner p,.app-footer) { font-size: 12px !important; }
      html[data-theme="light"] .app-shell :is(td,.panel-head p,.listing-panel > p,.tip-banner b,.stat-label) { font-size: 12px !important; }
      html[data-theme="dark"] .app-shell :is(td,.panel-head p,.listing-panel > p,.tip-banner b,.stat-label) { font-size: 12px !important; }
      html[data-theme="light"] .app-shell :is(.hero-label,.secure-label,.hero-chip,.hero-foot,.hero-actions > button,.badge,.nav-count) { font-size: 12px !important; }
      html[data-theme="dark"] .app-shell :is(.hero-label,.secure-label,.hero-chip,.hero-foot,.hero-actions > button,.badge,.nav-count) { font-size: 12px !important; }
      html[data-theme="light"] .app-shell :is(.text-link,.panel-bottom-link,.tip-banner > button) { font-size: 12px !important; }
      html[data-theme="dark"] .app-shell :is(.text-link,.panel-bottom-link,.tip-banner > button) { font-size: 12px !important; }
      html[data-theme="light"] .app-shell :is(.hero-copy > p button,.person-avatar) { font-size: 12px !important; }
      html[data-theme="dark"] .app-shell :is(.hero-copy > p button,.person-avatar) { font-size: 12px !important; }
      .theme-toggle { display: inline-flex; align-items: center; gap: 7px; min-height: 38px; padding: 0 12px; border: 1px solid #e7ded2; border-radius: 999px; background: #fffdfa; color: #785a2c; font: inherit; font-size: 12px; font-weight: 650; cursor: pointer; white-space: nowrap; }
      .theme-toggle-icon { display: inline-flex; line-height: 1; }
      @media (max-width: 640px) {
        .theme-toggle { width: 38px; min-width: 38px; padding: 0; justify-content: center; }
        .theme-toggle-label { display: none; }
        .top-actions .top-avatar { display: grid; }
      }
      .top-actions { position: relative; }
      .top-actions .top-avatar { border: 0; padding: 0; cursor: pointer; }
      .top-actions .top-avatar:focus-visible { outline: 3px solid #d4ac54; outline-offset: 3px; }
      .top-popover { position: absolute; z-index: 80; top: calc(100% + 12px); right: 0; width: min(360px, calc(100vw - 24px)); max-height: min(70vh, 520px); overflow: auto; border: 1px solid #e5dbca; border-radius: 16px; background: #fffdf9; color: #302b24; box-shadow: 0 18px 48px rgb(49 39 23 / 18%); text-align: left; }
      .top-popover-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 14px; padding: 17px 18px 13px; border-bottom: 1px solid #eee6da; }
      .top-popover-head > div,.profile-popover-user > span:last-child { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
      .top-popover b { color: #342c20; font-size: 13px; }
      .top-popover small { color: #766d60; font-size: 11px; line-height: 1.4; }
      .popover-close { width: 32px; height: 32px; display: grid; place-items: center; flex: none; border: 1px solid #e5dbca; border-radius: 50%; background: transparent; color: #625849; }
      .popover-list { padding: 4px 8px; }
      .alert-item { width: 100%; display: flex; align-items: center; gap: 11px; padding: 12px 9px; border: 0; border-bottom: 1px solid #f0e9de; background: transparent; color: #746b5e; text-align: left; }
      .alert-item:last-child { border-bottom: 0; }
      .alert-item:hover,.profile-popover > button:hover { background: #f8f1e5; }
      .alert-item > svg { flex: none; color: #876721; }
      .alert-symbol { width: 36px; height: 36px; display: grid; place-items: center; flex: none; border-radius: 11px; background: #f3e8cd; color: #785b23; }
      .alert-symbol.is-overdue { background: #f4e5df; color: #854c3d; }
      .alert-copy { display: flex; flex: 1; flex-direction: column; gap: 3px; min-width: 0; }
      .alert-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .alerts-empty { display: flex; align-items: center; gap: 11px; padding: 18px; }
      .alerts-empty > div { display: flex; flex-direction: column; gap: 4px; }
      .popover-foot { margin: 0; padding: 8px 17px 13px; color: #766d60; font-size: 11px; }
      .profile-popover { width: min(300px, calc(100vw - 24px)); padding: 9px; }
      .profile-popover-user { display: flex; align-items: center; gap: 10px; padding: 9px 8px 14px; }
      .profile-popover-user > span:last-child b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .profile-popover-clinic { display: flex; flex-direction: column; gap: 5px; margin: 0 0 7px; padding: 12px 9px; border-top: 1px solid #eee6da; border-bottom: 1px solid #eee6da; }
      .profile-popover-clinic small { font-size: 9px; letter-spacing: .8px; }
      .profile-popover > button { width: 100%; display: flex; align-items: center; gap: 10px; min-height: 42px; padding: 9px; border: 0; border-radius: 9px; background: transparent; color: #514638; text-align: left; font-size: 12px; }
      .profile-popover > button svg { color: #876721; stroke: currentColor; opacity: 1; }
      html[data-theme="light"] .profile-popover > button svg { color: #876721; stroke: currentColor; opacity: 1; }
      .profile-popover > button.profile-signout { color: #704b3d; }
      html[data-theme="dark"] .top-popover { border-color: #494239; background: #24211e; color: #f5f0e8; box-shadow: 0 18px 48px rgb(0 0 0 / 42%); }
      html[data-theme="dark"] .top-popover b { color: #f5f0e8; }
      html[data-theme="dark"] .top-popover small,html[data-theme="dark"] .popover-foot { color: #c1b9ae; }
      html[data-theme="dark"] .top-popover-head,html[data-theme="dark"] .profile-popover-clinic { border-color: #494239; }
      html[data-theme="dark"] .popover-close { border-color: #594f42; color: #e5d9c2; }
      html[data-theme="dark"] .alert-item { border-color: #39342c; color: #c1b9ae; }
      html[data-theme="dark"] .alert-item > svg,html[data-theme="dark"] .profile-popover > button svg { color: #f3da8a !important; stroke: currentColor !important; opacity: 1 !important; }
      html[data-theme="dark"] .alert-symbol { background: #393226; color: #f3da8a; }
      html[data-theme="dark"] .alert-symbol.is-overdue { background: #49352d; color: #e6a48b; }
      html[data-theme="dark"] .alert-item:hover,html[data-theme="dark"] .profile-popover > button:hover { background: #302b24; }
      html[data-theme="dark"] .profile-popover > button { color: #e5d9c2; }
      html[data-theme="dark"] .profile-popover > button.profile-signout { color: #e6b9a6; }
      @media (max-width: 640px) {
        .top-popover { top: calc(100% + 8px); right: -3px; }
        .top-actions { gap: 7px; }
        .top-actions .notification,.top-actions .top-avatar { width: 36px; height: 36px; }
      }
      @media (max-width: 768px) {
        html body .app-shell input:not([type="checkbox"]):not([type="radio"]),
        html body .app-shell select,
        html body .app-shell textarea { font-size: 16px !important; }
      }
      html[data-theme="light"] body .app-shell .page-wrap .settings-layout .settings-content .settings-panel .whatsapp-template-help > small { color: #665d51 !important; }
      html[data-theme="light"] body .app-shell .page-wrap .settings-layout .settings-content .settings-panel .whatsapp-preview > span { color: #785b23 !important; }
      html[data-theme="light"] body .app-shell .empty-state { background-color: #f8f3e9 !important; border: 1px solid #e7dcc8 !important; color: #665d51 !important; }
      html[data-theme="light"] body .app-shell .empty-state :is(p,span,b) { color: #665d51 !important; }
      html[data-theme="dark"] body .app-shell .empty-state { background-color: #302b24 !important; border: 1px solid #494239 !important; color: #e5d9c2 !important; }
      html[data-theme="dark"] body .app-shell .empty-state :is(p,span,b) { color: #e5d9c2 !important; }
      html[data-theme="light"] body .app-shell small { font-size: 12px !important; }
      html[data-theme="dark"] body .app-shell small { font-size: 12px !important; }
      html[data-theme="light"] body .app-shell :is(.due-amount,.profile-text b,.due-info b,.person b,.footer-brand,.footer-brand span) { font-size: 12px !important; }
      html[data-theme="dark"] body .app-shell :is(.due-amount,.profile-text b,.due-info b,.person b,.footer-brand,.footer-brand span) { font-size: 12px !important; }
      html[data-theme="light"] body .app-shell :is(.row-actions button,.progress-caption,.table-foot,.service-card h3,.donut > span,.legend b,.settings-title p,.field > span,.disabled-select span,.settings-actions > span,.notice-card b,.notice-card p) { font-size: 12px !important; }
      html[data-theme="dark"] body .app-shell :is(.row-actions button,.progress-caption,.table-foot,.service-card h3,.donut > span,.legend b,.settings-title p,.field > span,.disabled-select span,.settings-actions > span,.notice-card b,.notice-card p) { font-size: 12px !important; }
      html[data-theme="light"] body .app-shell :is(.section-intro b,.section-intro p,.report-heading b,.report-heading p,.app-footer .footer-brand > b) { font-size: 12px !important; }
      html[data-theme="dark"] body .app-shell :is(.section-intro b,.section-intro p,.report-heading b,.report-heading p,.app-footer .footer-brand > b) { font-size: 12px !important; }
      html[data-theme="light"] body .app-shell .whatsapp-preview > span { font-size: 12px !important; }
      html[data-theme="dark"] body .app-shell .whatsapp-preview > span { font-size: 12px !important; }
      html[data-theme="light"] body .app-shell .modal-head .muted,
      html[data-theme="dark"] body .app-shell .modal-head .muted { font-size: 12px !important; }
      html[data-theme="light"] body .app-shell .amount-input > span,
      html[data-theme="dark"] body .app-shell .amount-input > span { font-size: 12px !important; }
      html[data-theme="light"] body .app-shell .modal button:not(.icon-button),
      html[data-theme="dark"] body .app-shell .modal button:not(.icon-button) { font-size: 12px !important; }
      html body .app-shell .plan-service-line .text-link { min-height: 28px; padding: 4px 8px; }
      /* Final dark palette override: legacy component rules above must not reintroduce green. */
      html[data-theme="dark"],
      html[data-theme="dark"] body,
      html[data-theme="dark"] .app-shell,
      html[data-theme="dark"] .main-area,
      html[data-theme="dark"] .page-wrap { background: #191715 !important; color: #f5f0e8 !important; }
      html[data-theme="dark"] .sidebar,
      html[data-theme="dark"] .topbar,
      html[data-theme="dark"] .panel,
      html[data-theme="dark"] .stat-card,
      html[data-theme="dark"] .service-card,
      html[data-theme="dark"] .due-item,
      html[data-theme="dark"] .settings-panel,
      html[data-theme="dark"] .settings-menu,
      html[data-theme="dark"] .modal,
      html[data-theme="dark"] .clinic-switch,
      html[data-theme="dark"] .table-wrap,
      html[data-theme="dark"] .app-footer,
      html[data-theme="dark"] .help-card,
      html[data-theme="dark"] .tip-banner,
      html[data-theme="dark"] .notice-card,
      html[data-theme="dark"] .team-list,
      html[data-theme="dark"] .team-member,
      html[data-theme="dark"] .mobile-table-card,
      html[data-theme="dark"] .payment-allocation-row,
      html[data-theme="dark"] .plan-service-line { background-color: #24211e !important; color: #f5f0e8 !important; border-color: #494239 !important; }
      html[data-theme="dark"] .clinic-switch,
      html[data-theme="dark"] .help-card,
      html[data-theme="dark"] .tip-banner,
      html[data-theme="dark"] .notice-card,
      html[data-theme="dark"] .plan-total-row { background-color: #302b24 !important; }
      html[data-theme="dark"] :is(.footer-icon,.help-icon,.clinic-avatar,.round-icon,.tip-icon,.intro-icon,.report-icon,.service-icon,.service-overview-icon,.stat-icon,.notice-card > span) { background-color: #393226 !important; border-color: #594a2f !important; color: #f3da8a !important; }
      html[data-theme="dark"] :is(.footer-icon,.help-icon,.clinic-avatar,.round-icon,.tip-icon,.intro-icon,.report-icon,.service-icon,.service-overview-icon,.stat-icon,.notice-card > span) svg { color: #f3da8a !important; stroke: currentColor !important; }
      html[data-theme="dark"] :is(.badge.success,.badge.neutral,.connected-pill,.demo-pill.connected-pill,.secure-label,.service-tone-0,[class*="service-tone-"]) { background-color: #393226 !important; border-color: #594a2f !important; color: #f3da8a !important; }
      html[data-theme="dark"] :is(.badge.success i,.connected-pill i,.demo-pill i,.secure-label i,.notification > i) { background-color: #e2c577 !important; }
      html[data-theme="dark"] :is(.nav-link.active,.settings-menu button.selected) { background-color: #393226 !important; border-color: #594a2f !important; color: #f3da8a !important; }
      html[data-theme="dark"] :is(.button.secondary,.button.subtle,.icon-button,.theme-toggle,.row-action,.mobile-more-menu,.mobile-nav) { background-color: #302b24 !important; border-color: #494239 !important; color: #f5f0e8 !important; }
      html[data-theme="dark"] :is(.row-action-primary,.button.primary) { background-color: #e2c577 !important; border-color: #e2c577 !important; color: #2c251a !important; }
      html[data-theme="dark"] :is(input,select,textarea,.disabled-select,.select-lite,.filter-control) { background-color: #191715 !important; border-color: #494239 !important; color: #f5f0e8 !important; }
      html[data-theme="dark"] :is(input,textarea)::placeholder { color: #a99f91 !important; }
      html[data-theme="dark"] :is(input,select,textarea):focus { border-color: #d8b66d !important; box-shadow: 0 0 0 3px rgb(216 182 109 / 18%) !important; }
      html[data-theme="dark"] .hero-card { background: linear-gradient(118deg,#302d29,#484238 58%,#62543a) !important; }
      html[data-theme="dark"] .app-footer { background: linear-gradient(110deg,#24211e,#2c2822 72%) !important; }
      html[data-theme="dark"] :is(.notice-card,.form-note,.whatsapp-template-help,.whatsapp-preview,.whatsapp-consent,.empty-state) { background-color: #302b24 !important; border-color: #494239 !important; color: #e7ddca !important; }
      html[data-theme="dark"] :is(.notice-card,.form-note,.whatsapp-template-help,.whatsapp-preview,.whatsapp-consent,.empty-state) :is(p,span,b,strong,small,svg) { color: inherit; }
      html[data-theme="dark"] .mobile-nav > button.selected { color: #f3da8a !important; }
      html[data-theme="dark"] .mobile-nav > button.selected:before,
      html[data-theme="dark"] .mobile-more-menu button:active,
      html[data-theme="dark"] .row-action:hover { background-color: #393226 !important; }
      html body .app-shell input:not([type="checkbox"]):not([type="radio"]),
      html body .app-shell select,
      html body .app-shell textarea { font-size: 14px; }
      .app-shell .field > label { color: var(--brand-taupe); font-size: 12px; font-weight: 700; }
      .app-shell .chart svg stop { stop-color: #d8b66d !important; }
      .app-shell .chart svg path[stroke] { stroke: #c7a05b !important; }
      .app-shell .dot.green-dot { background-color: #c7a05b !important; }
      @media (max-width: 768px) {
        html body .app-shell input:not([type="checkbox"]):not([type="radio"]),
        html body .app-shell select,
        html body .app-shell textarea { font-size: 16px !important; }
      }
    `}</style>
    <aside className="sidebar">
      <div className="sidebar-brand"><Logo /></div>
      <div className="clinic-switch"><div className="clinic-avatar">OD</div><div><b>{clinicName}</b><small>{cloudConfigured ? 'Cuenta conectada' : 'Plan profesional'}</small></div><ChevronDown size={16} /></div>
      <nav aria-label="Navegación principal">{navGroups.map(group => <div className="nav-group" key={group.title}><p>{group.title}</p>{group.items.map(({ label, icon: Icon }) => <button className={`nav-link ${page === label ? 'active' : ''}`} aria-current={page === label ? 'page' : undefined} key={label} onClick={() => { setPage(label); setMobileMoreOpen(false) }}><Icon size={18} strokeWidth={1.9} /><span>{label}</span>{label === 'Planes de pago' && <span className="nav-count">{plans.length}</span>}</button>)}</div>)}</nav>
      <div className="sidebar-bottom"><button className="profile" type="button" onClick={() => void signOut()}><span className="profile-avatar">{profileInitials}</span><span className="profile-text"><b>{session?.user.email ?? 'Dra. Daniela Ríos'}</b><small>{cloudConfigured ? 'Cerrar sesión' : 'Administradora'}</small></span><MoreHorizontal size={19} /></button></div>
    </aside>
    <main className="main-area">
      <header className="topbar"><div className="mobile-brand"><Logo /></div><div className="breadcrumb"><span>{clinicName}</span><span className="slash">/</span><b>{page}</b></div><div className="top-actions" ref={topActionsRef}><span className={`demo-pill ${connectionStateClass}`} role="status" aria-live="polite" aria-label={cloudConfigured ? `Supabase: ${connectionLabel}` : connectionLabel} title={cloudConfigured ? `Conexión con Supabase: ${connectionLabel.toLowerCase()}` : connectionLabel}><i aria-hidden="true" />{connectionLabel}</span><button className="icon-button notification" type="button" aria-label={`Alertas de cobranza${attentionPlans.length ? `, ${attentionPlans.length} pendientes` : ''}`} title="Alertas de cobranza" aria-haspopup="dialog" aria-expanded={topMenu === 'alerts'} onClick={() => setTopMenu(current => current === 'alerts' ? null : 'alerts')}><Bell size={19} />{attentionPlans.length > 0 && <i aria-hidden="true" />}</button><button className="theme-toggle" type="button" aria-label={darkMode ? 'Activar modo claro' : 'Activar modo oscuro'} title={darkMode ? 'Activar modo claro' : 'Activar modo oscuro'} onClick={() => setDarkMode(value => !value)}><span className="theme-toggle-icon" aria-hidden="true">{darkMode ? <Sun size={16} /> : <Moon size={16} />}</span><span className="theme-toggle-label">{darkMode ? 'Modo claro' : 'Modo oscuro'}</span></button><button className="top-avatar" type="button" aria-label="Abrir menú de perfil" aria-haspopup="menu" aria-expanded={topMenu === 'profile'} onClick={() => setTopMenu(current => current === 'profile' ? null : 'profile')}>{profileInitials}</button>
        {topMenu === 'alerts' && <section className="top-popover alerts-popover" role="dialog" aria-label="Alertas de cobranza"><div className="top-popover-head"><div><b>Alertas de cobranza</b><small>{attentionPlans.length ? `${attentionPlans.length} requieren atención` : 'Todo está al día'}</small></div><button type="button" className="popover-close" aria-label="Cerrar alertas" onClick={() => setTopMenu(null)}><X size={16} /></button></div>{attentionPlans.length ? <div className="popover-list">{attentionPlans.slice(0, 5).map(plan => <button type="button" className="alert-item" key={plan.id} onClick={() => { setPage('Planes de pago'); setTopMenu(null) }}><span className={`alert-symbol ${plan.status === 'Vencido' ? 'is-overdue' : ''}`}><Bell size={16} /></span><span className="alert-copy"><b>{plan.status === 'Vencido' ? 'Cuota vencida' : 'Próximo vencimiento'}</b><small>{plan.patient} · {plan.treatment}</small><small>{plan.nextDue}</small></span><ArrowRight size={16} /></button>)}</div> : <div className="alerts-empty"><span className="alert-symbol"><Check size={17} /></span><div><b>Sin alertas pendientes</b><small>Te avisaremos cuando una cuota necesite atención.</small></div></div>}{attentionPlans.length > 5 && <p className="popover-foot">Mostrando 5 de {attentionPlans.length} alertas.</p>}</section>}
        {topMenu === 'profile' && <section className="top-popover profile-popover" role="menu" aria-label="Menú de perfil"><div className="profile-popover-user"><span className="profile-avatar">{profileInitials}</span><span><b>{session?.user.email ?? 'Dra. Daniela Ríos'}</b><small>{membershipRole === 'owner' ? 'Propietaria' : cloudConfigured ? 'Asistente' : 'Administradora'}</small></span></div><div className="profile-popover-clinic"><small>CONSULTORIO</small><b>{clinicName}</b></div><button type="button" role="menuitem" onClick={() => { setPage('Configuración'); setTopMenu(null) }}><Settings size={17} /> Configuración de cuenta</button><button type="button" role="menuitem" className="profile-signout" onClick={() => void signOut()}><LogOut size={17} /> {cloudConfigured ? 'Cerrar sesión' : 'Sesión de demostración'}</button></section>}
      </div></header>
      <div className="page-wrap"><div className="page-heading"><div><p className="eyebrow">MI CONSULTORIO <span>·</span> {new Intl.DateTimeFormat('es-VE', { weekday: 'long', day: 'numeric', month: 'short', timeZone: clinicTimezone }).format(new Date()).toLocaleUpperCase('es-VE')}</p><h1>{page === 'Inicio' ? `${clinicTimeGreeting(clinicTimezone)}, ${clinicOwnerName.trim().replace(/^Dra\\.?\\s*/i, '').split(/\\s+/)[0] || 'Doctora'}` : page}</h1><p className="muted">{pageSubtitle[page]}</p></div><div className="heading-actions">{page === 'Pacientes' && (!cloudConfigured || membershipRole === 'owner') && <button className="button primary" onClick={() => openModal('patient')}><Plus size={17} /> Nuevo paciente</button>}{page === 'Planes de pago' && (!cloudConfigured || membershipRole === 'owner') && <button className="button primary" onClick={() => openModal('plan')}><Plus size={17} /> Crear plan</button>}{page === 'Pagos' && <button className="button primary" onClick={() => openModal('payment')}><Plus size={17} /> Registrar abono</button>}{page === 'Inicio' && <button className="button primary" onClick={() => openModal('payment')}><Plus size={17} /> Registrar pago</button>}</div></div>
        <div className="page-content">
        {page === 'Inicio' && <Dashboard patients={patients} plans={plans} payments={localizedPayments} totalDue={totalDue} monthlyCollectedUsdCents={monthlyCollectedUsdCents} showBalance={showBalance} setShowBalance={setShowBalance} go={setPage} open={openModal} canManage={!cloudConfigured || membershipRole === 'owner'} />}
        {page === 'Pacientes' && <Patients patients={filteredPatients} search={search} setSearch={setSearch} filter={patientFilter} setFilter={setPatientFilter} open={openModal} canManage={!cloudConfigured || membershipRole === 'owner'} onEdit={editPatient} onArchive={archivePatient} onStatement={setStatementPatient} />}
        {page === 'Planes de pago' && <Plans plans={plans} patients={patients} installments={installments} clinicName={clinicName} clinicPhone={clinicPhone} timezone={clinicTimezone} search={search} setSearch={setSearch} filter={planFilter} setFilter={setPlanFilter} open={openModal} canCreate={!cloudConfigured || membershipRole === 'owner'} />}
        {page === 'Pagos' && <Payments payments={localizedPayments} search={search} setSearch={setSearch} monthlyCollectedUsdCents={monthlyCollectedUsdCents} canReverse={cloudConfigured && membershipRole === 'owner'} onReverse={reversePayment} onReceipt={setReceiptPayment} onExport={() => void exportPaymentsCsv()} />}
        {page === 'Servicios' && <Services notify={notify} clinicId={clinicId} services={services} setServices={setServices} canManage={!cloudConfigured || membershipRole === 'owner'} onUse={service => { setPlanPatient(''); setPlanServiceChoice(''); setPlanItems([{ serviceId: String(service.id), name: service.name, category: service.category, description: service.description ?? '', amount: (service.priceCents / 100).toFixed(2).replace('.', ',') }]); setPlanInstallments('1'); setModal('plan') }} />}
        {page === 'Reportes' && <Reports clinicName={clinicName} totalDue={totalDue} payments={localizedPayments} plans={plans} timezone={clinicTimezone} monthlyCollectedUsdCents={monthlyCollectedUsdCents} monthlyConfirmedPaymentCount={monthlyConfirmedPaymentCount} />}
        {page === 'Configuración' && <SettingsPage notify={notify} clinicId={clinicId} clinicName={clinicName} onClinicName={setClinicName} onOwnerName={setClinicOwnerName} onPhone={setClinicPhone} onWhatsappTemplate={setWhatsappMessageTemplate} onTimezone={setClinicTimezone} canManage={!cloudConfigured || membershipRole === 'owner'} timezone={clinicTimezone} onRateSaved={setCurrentExchangeRate} />}
        {page === 'Configuración' && (!cloudConfigured || membershipRole === 'owner') && <div className="audit-launcher-row"><AuditLauncher clinicId={clinicId} /></div>}
        </div>
        <footer className="app-footer">
          <div className="footer-trust">
            <span className="footer-icon"><ShieldCheck size={18} /></span>
            <strong>Tus datos, en buenas manos</strong>
          </div>
          <div className="footer-brand"><b>OdontoCuenta</b><span>Cobros claros, sonrisas tranquilas</span></div>
        </footer>
      </div>
    </main>
    {mobileMoreOpen && <><button type="button" className="mobile-more-scrim" onClick={() => setMobileMoreOpen(false)} aria-label="Cerrar menú" /><nav className="mobile-more-menu" aria-label="Más opciones" role="menu">{navGroups.flatMap(group => group.items).filter(({ label }) => !['Inicio', 'Pacientes', 'Planes de pago'].includes(label)).map(({ label, icon: Icon }) => <button type="button" role="menuitem" key={label} onClick={() => { setPage(label); setMobileMoreOpen(false) }}><Icon size={18} /><span>{label}</span>{page === label && <Check size={16} />}</button>)}</nav></>}
    <nav className="mobile-nav" aria-label="Navegación móvil">{[{ name: 'Inicio' as Page, icon: Home }, { name: 'Pacientes' as Page, icon: Users }, { name: 'new' as const, icon: Plus }, { name: 'Planes de pago' as Page, icon: ClipboardList }, { name: 'Más' as const, icon: Ellipsis }].map(({ name, icon: Icon }) => name === 'new' ? <button type="button" className="mobile-add" key={name} onClick={() => openModal('payment')} aria-label="Registrar abono"><Icon size={25} /></button> : <button type="button" key={name} className={page === name ? 'selected' : name === 'Más' && mobileMoreOpen ? 'selected' : ''} aria-current={name !== 'Más' && page === name ? 'page' : undefined} aria-haspopup={name === 'Más' ? 'menu' : undefined} aria-expanded={name === 'Más' ? mobileMoreOpen : undefined} onClick={() => name === 'Más' ? setMobileMoreOpen(value => !value) : setPage(name)}><Icon size={19} /><span>{name === 'Planes de pago' ? 'Planes' : name}</span></button>)}</nav>

    {modal === 'patient' && <Modal title={editingPatient ? "Editar paciente" : "Nuevo paciente"} subtitle={editingPatient ? "Actualiza sus datos de contacto." : "Datos para identificarlo y llevar su cuenta."} close={closePatientModal}><form className="form" onSubmit={savePatient}><Field label="Nombre y apellidos"><input required autoFocus maxLength={160} placeholder="Ej. Laura García" value={patientName} onChange={e => setPatientName(e.target.value)} /></Field><Field label="Cédula de identidad"><input required maxLength={30} placeholder="Ej. V-12.345.678" value={patientNationalId} onChange={e => setPatientNationalId(e.target.value)} /></Field><Field label="Teléfono venezolano"><input required inputMode="tel" placeholder="+58 412 000 0000" value={patientPhone} onChange={e => setPatientPhone(e.target.value)} /></Field><Field label="Correo electrónico (opcional)"><input type="email" maxLength={254} value={patientEmail} onChange={e => setPatientEmail(e.target.value)} /></Field><Field label="Dirección (opcional)"><input maxLength={300} value={patientAddress} onChange={e => setPatientAddress(e.target.value)} /></Field><label className="whatsapp-consent"><input name="patient-whatsapp-consent" type="checkbox" checked={patientWhatsappConsent} onChange={e => setPatientWhatsappConsent(e.target.checked)} /><span><b>Acepta recibir recordatorios por WhatsApp</b><small>Actívalo solo después de que la persona haya dado su autorización explícita.</small></span></label><div className="form-note"><ShieldCheck size={16} /> Solo guardamos información de contacto y cobro.</div><div className="modal-actions"><button type="button" className="button secondary" onClick={closePatientModal}>Cancelar</button><button className="button primary"><Check size={16} /> {editingPatient ? "Guardar cambios" : "Guardar paciente"}</button></div></form></Modal>}
    {modal === 'payment' && <Modal title="Registrar un abono" subtitle="Guarda el pago recibido y asígnalo a una o varias cuotas." close={() => setModal(null)}><form className="form" onSubmit={savePayment}><Field label="Paciente"><select required value={paymentPatient} onChange={e => { setPaymentPatient(e.target.value); setPaymentAllocations({}) }}><option value="">Selecciona un paciente</option>{patients.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>{cloudConfigured && <Field label="Distribución por cuotas (USD)"><div className="payment-allocation-list">{!paymentPatient ? <div className="form-note">Selecciona un paciente para ver sus cuotas.</div> : installments.filter(item => item.patient_id === paymentPatient).length === 0 ? <div className="form-note">Este paciente no tiene cuotas pendientes para aplicar un pago.</div> : installments.filter(item => item.patient_id === paymentPatient).map(item => { const selected = Object.prototype.hasOwnProperty.call(paymentAllocations, item.id); return <div className={'payment-allocation-row ' + (selected ? 'selected' : '')} key={item.id}><input type="checkbox" aria-label={'Aplicar a cuota ' + item.sequence} checked={selected} onChange={e => setPaymentAllocations(current => { const next = { ...current }; if (e.target.checked) next[item.id] = ''; else delete next[item.id]; return next })} /><span><b>{item.description} · cuota {item.sequence}</b><small>{money(item.balance_usd_cents / 100)} pendiente</small></span>{selected && <input type="text" inputMode="decimal" placeholder="0,00" aria-label={'Monto aplicado a cuota ' + item.sequence + ' en USD'} value={paymentAllocations[item.id]} onChange={e => setPaymentAllocations(current => ({ ...current, [item.id]: e.target.value }))} />}</div>})}</div><p className="form-note"><ShieldCheck size={16} /> Selecciona una o varias cuotas e indica cuánto del pago en USD corresponde a cada una. Asignado {paymentAllocationTotalCents === null ? '—' : money(paymentAllocationTotalCents / 100)} de {paymentTotalUsdCents === null ? 'Pendiente' : money(paymentTotalUsdCents / 100)} USD.</p></Field>}<Field label="Moneda recibida"><select value={paymentCurrency} onChange={e => { setPaymentCurrency(e.target.value as 'USD' | 'VES'); setPaymentAmount('') }}><option value="USD">USD — Dólares</option>{cloudConfigured && <option value="VES" disabled={!currentExchangeRate}>{clinicLocalCurrency === 'VES' ? 'VES — Bolívares (Bs.)' : `${clinicLocalCurrency} — Moneda local`}{!currentExchangeRate ? ' · sin tasa vigente' : ''}</option>}</select></Field><Field label={paymentCurrency === 'VES' ? `Monto recibido (${clinicLocalCurrency === 'VES' ? 'Bs.' : clinicLocalCurrency})` : 'Monto recibido'}><div className="amount-input"><span>{paymentCurrency === 'VES' ? 'Bs.' : '$'}</span><input required type="text" inputMode="decimal" placeholder="0,00" value={paymentAmount} onChange={e => setPaymentAmount(e.target.value)} /><b>{paymentCurrency}</b></div></Field>{paymentCurrency === 'VES' && currentExchangeRate && <div className="form-note"><ShieldCheck size={16} /> Tasa {currentExchangeRate.source === 'BCV' ? 'BCV' : 'manual validada'}: {currentExchangeRate.rate} Bs./USD · vigente {formatClinicDate(currentExchangeRate.asOf, clinicTimezone)}{paymentUsdPreviewCents !== null && <> · Equivale a {money(paymentUsdPreviewCents / 100)} USD, monto a distribuir</>}</div>}<Field label="Nota o concepto"><input placeholder="Ej. Abono de hoy" value={paymentConcept} onChange={e => setPaymentConcept(e.target.value)} /></Field><Field label="Método de pago"><select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}><option value="cash">Efectivo</option><option value="mobile_payment">Pago móvil</option><option value="bank_transfer">Transferencia</option><option value="card">Tarjeta</option><option value="other">Otro</option></select></Field><div className="form-note"><ShieldCheck size={16} /> El pago confirmado conserva su recibo; los errores se corrigen mediante una reversión auditada.</div><div className="modal-actions"><button type="button" className="button secondary" onClick={() => setModal(null)}>Cancelar</button><button className="button primary"><Check size={16} /> Guardar abono</button></div></form></Modal>}
    {modal === 'plan' && <Modal title="Crear plan de pago" subtitle="Elige uno o más servicios y acuerda las cuotas." close={() => { setModal(null); setPlanItems([]); setPlanServiceChoice('') }}><form className="form" onSubmit={savePlan}><Field label="Paciente"><select required value={planPatient} onChange={e => setPlanPatient(e.target.value)}><option value="">Selecciona un paciente</option>{patients.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field><Field label="Agregar servicio"><div className="service-plan-picker"><select value={planServiceChoice} onChange={e => setPlanServiceChoice(e.target.value)}><option value="">Selecciona del catálogo</option>{services.filter(service => !planItems.some(item => item.serviceId === String(service.id))).map(service => <option key={service.id} value={service.id}>{service.name} · {money(service.priceCents / 100)}</option>)}</select><button type="button" className="button secondary compact" onClick={addPlanService} disabled={!planServiceChoice}>Añadir</button></div></Field>{planItems.length > 0 ? <div className="plan-service-list">{planItems.map(item => <div className="plan-service-line" key={item.serviceId}><div><b>{item.name}</b><small>Precio acordado · USD</small></div><div className="amount-input"><span>$</span><input required type="text" inputMode="decimal" value={item.amount} onChange={e => setPlanItems(list => list.map(line => line.serviceId === item.serviceId ? { ...line, amount: e.target.value } : line))} aria-label={`Precio acordado de ${item.name}`} /><button type="button" className="text-link" aria-label={`Quitar ${item.name}`} onClick={() => setPlanItems(list => list.filter(line => line.serviceId !== item.serviceId))}>Quitar</button></div></div>)}</div> : <div className="form-note"><ShieldCheck size={16} /> Selecciona del catálogo al menos un servicio para continuar.</div>}<div className="plan-total-row"><span>Total acordado</span><b>{money(planItems.reduce((sum, item) => { try { return sum + usdInputToCents(item.amount) } catch { return sum } }, 0) / 100)}</b></div><div className="two-fields"><Field label="Cantidad de cuotas"><input type="number" required min="1" max="120" value={planInstallments} onChange={e => setPlanInstallments(e.target.value)} /></Field><Field label="Primera fecha de pago"><input type="date" required value={planFirstDue} onChange={e => setPlanFirstDue(e.target.value)} /></Field></div><div className="form-note"><ShieldCheck size={16} /> El total se conserva exacto y la última cuota absorbe cualquier centavo restante.</div><div className="modal-actions"><button type="button" className="button secondary" onClick={() => { setModal(null); setPlanItems([]); setPlanServiceChoice('') }}>Cancelar</button><button className="button primary" disabled={!planItems.length}><Check size={16} /> Crear plan</button></div></form></Modal>}
    {statementPatient && <PatientStatement clinicName={clinicName} clinicPhone={clinicPhone} messageTemplate={whatsappMessageTemplate} clinicId={clinicId} patient={statementPatient} plans={plans} payments={localizedPayments} installments={installments} timezone={clinicTimezone} close={() => setStatementPatient(null)} />}
    {receiptPayment && <ReceiptPreview clinicName={clinicName} timezone={clinicTimezone} payment={receiptPayment} close={() => setReceiptPayment(null)} />}
    {toast && <div className="toast"><Check size={16} /> {toast}</div>}
  </div>
}

function PatientStatement({ clinicName, clinicPhone, messageTemplate, patient, clinicId, plans, payments, installments, timezone, close }: { clinicName: string; clinicPhone: string; messageTemplate: string; patient: Patient; clinicId: string | null; plans: Plan[]; payments: Payment[]; installments: UnpaidInstallment[]; timezone: string; close: () => void }) {
  const patientPlans = plans.filter(plan => String(plan.patientId ?? '') === String(patient.id))
  const openInstallments = installments.filter(item => String(item.patient_id) === String(patient.id))
  const fallbackPayments = payments.filter(payment => String(payment.patientId ?? '') === String(patient.id))
  const [patientPaymentRows, setPatientPayments] = useState<Payment[]>(fallbackPayments)
  const patientPayments = patientPaymentRows.map(payment => payment.receivedAt ? { ...payment, date: formatClinicDateTime(payment.receivedAt, timezone) } : payment)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const total = patientPlans.reduce((sum, plan) => sum + plan.total, 0)
  const paid = patientPlans.reduce((sum, plan) => sum + plan.paid, 0)

  useEffect(() => {
    if (!supabase || !clinicId) { setPatientPayments(fallbackPayments); return }
    let alive = true
    const client = supabase
    setHistoryLoading(true)
    setHistoryError('')
    void (async () => {
      const rows: Array<{ id: string; patient_id: string; amount_usd_cents: number; received_currency: string; received_local_minor: number | null; exchange_rate: number | null; rate_source: string | null; rate_as_of: string | null; rate_validated_at: string | null; method: string; received_at: string; receipt_number: number | null; receipt_snapshot: Record<string, unknown> | null }> = []
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await client.from('payments').select('id, patient_id, amount_usd_cents, received_currency, received_local_minor, exchange_rate, rate_source, rate_as_of, rate_validated_at, method, received_at, receipt_number, receipt_snapshot').eq('clinic_id', clinicId).eq('patient_id', String(patient.id)).order('received_at', { ascending: false }).range(offset, offset + 499)
        if (error) throw error
        rows.push(...(data ?? []))
        if (!data || data.length < 500) break
      }
      const ids = rows.map(row => row.id)
      const pendingRateRows = rows.filter(row => row.received_currency === 'USD' && row.exchange_rate == null)
      await Promise.all(pendingRateRows.map(async row => {
        try { await client.rpc('complete_pending_payment_receipt_rate', { p_clinic_id: clinicId, p_payment_id: row.id }) } catch { /* Keep the statement available if rate completion is temporarily unavailable. */ }
      }))
      let reversedIds = new Set<string>()
      let rateCompletions = new Map<string, { exchange_rate: number | string; rate_source: string; rate_as_of: string; rate_validated_at: string; equivalent_local_minor: number | string }>()
      if (ids.length) {
        const { data, error } = await supabase.from('payment_reversals').select('payment_id').eq('clinic_id', clinicId).in('payment_id', ids)
        if (error) throw error
        reversedIds = new Set((data ?? []).map(row => row.payment_id))
        const { data: completionRows } = await supabase.from('payment_receipt_rate_completions').select('payment_id, exchange_rate, rate_source, rate_as_of, rate_validated_at, equivalent_local_minor').eq('clinic_id', clinicId).in('payment_id', ids)
        rateCompletions = new Map((completionRows ?? []).map(row => [row.payment_id, row]))
      }
      if (!alive) return
      setPatientPayments(rows.map(row => {
        const completion = rateCompletions.get(row.id)
        return { id: row.id, patientId: row.patient_id, patient: patient.name, concept: `Recibo #${row.receipt_number ?? '—'}`, amount: row.amount_usd_cents / 100, amountCents: row.amount_usd_cents, currency: 'USD', method: paymentMethodLabels[row.method] ?? 'Otro', date: formatClinicDateTime(row.received_at, timezone), receivedAt: row.received_at, status: reversedIds.has(row.id) ? 'Revertido' : 'Confirmado', receiptNumber: row.receipt_number, receiptSnapshot: row.receipt_snapshot, receivedCurrency: row.received_currency, receivedLocalMinor: row.received_local_minor, completedEquivalentLocalMinor: completion ? Number(completion.equivalent_local_minor) : null, exchangeRate: row.exchange_rate ?? completion?.exchange_rate, rateSource: row.rate_source ?? completion?.rate_source, rateAsOf: row.rate_as_of ?? completion?.rate_as_of, rateValidatedAt: row.rate_validated_at ?? completion?.rate_validated_at, localPrecision: typeof row.receipt_snapshot?.local_precision === 'number' ? row.receipt_snapshot.local_precision : 2, installment: receiptInstallmentFromSnapshot(row.receipt_snapshot), balanceAfter: snapshotUsdCents(row.receipt_snapshot) }
      }))
    })().catch(() => { if (alive) setHistoryError('No se pudo cargar el historial completo de abonos.') }).finally(() => { if (alive) setHistoryLoading(false) })
    return () => { alive = false }
  }, [clinicId, patient.id, payments])

  const cutoff = formatClinicDate(new Date(), timezone, 'long')
  const exportStatement = (action: 'download' | 'print' = 'download') => {
    const pdfData: StatementPdfData = {
      clinicName,
      patientName: patient.name,
      patientId: patient.nationalId ?? '',
      phone: patient.phone,
      cutoff,
      totalAgreed: money(total),
      paid: money(paid),
      balance: money(Math.max(patient.balance, total - paid)),
      plans: patientPlans.flatMap(plan => [
        `${plan.planCode} · ${plan.treatment} · acordado ${money(plan.total)} · abonado ${money(plan.paid)} · saldo ${money(Math.max(0, plan.total - plan.paid))}`,
        ...(plan.items ?? []).map(item => `  ${item.name} · ${item.category}${item.description ? ` · ${item.description}` : ''} · ${money(item.amount)}`),
      ]),
      installments: openInstallments.map(item => `${item.description} · cuota ${item.sequence} · vence ${formatDueDate(item.due_on)} · ${item.status === 'overdue' ? 'vencida' : 'pendiente'} · ${money(item.balance_usd_cents / 100)}`),
      payments: patientPayments.map(payment => {
        const currency = payment.receivedCurrency ?? 'USD'
        const verifiedRate = Boolean(payment.exchangeRate && (payment.rateSource === 'BCV' || payment.rateValidatedAt))
        const bolivarMinor = paymentLocalMinor(payment)
        const rateDate = payment.rateAsOf ? formatClinicDate(payment.rateAsOf, timezone) : ''
        return {
          date: payment.date,
          receipt: payment.concept,
          method: payment.method,
          received: currency === 'VES' && typeof payment.receivedLocalMinor === 'number' ? formatLocalMinor(payment.receivedLocalMinor, payment.localPrecision ?? 2) : `${money(payment.amount)} USD`,
          equivalent: `${money(payment.amount)} USD${bolivarMinor === null ? '' : ` / ${formatLocalMinor(bolivarMinor, payment.localPrecision ?? 2)}`}`,
          rate: verifiedRate ? `${payment.rateSource === 'BCV' ? 'BCV' : 'validada'} ${payment.exchangeRate} Bs./USD ${rateDate}` : currency === 'USD' ? 'Pendiente tasa BCV verificada' : '—',
          status: payment.status,
        }
      }),
    }
    if (action === 'print') printStatementPdf(pdfData)
    else downloadStatementPdf(pdfData)
  }
  const exportStatementCsv = () => {
    const rows: string[][] = [
      ['Fecha de corte', cutoff],
      ['Paciente', patient.name],
      ['Cédula', patient.nationalId ?? ''],
      ['Teléfono', patient.phone],
      [],
      ['Tipo', 'Fecha', 'Detalle', 'Método', 'Monto recibido', 'Equivalente USD', 'Equivalente Bs.', 'Tasa', 'Estado'],
      ...patientPlans.map(plan => ['Plan', '', `${plan.planCode} · ${plan.treatment}`, '', '', money(plan.total), '', '', plan.status]),
      ...patientPlans.flatMap(plan => (plan.items ?? []).map(item => ['Servicio', '', `${plan.treatment} · ${item.name}${item.description ? ` · ${item.description}` : ''}`, '', '', money(item.amount), '', '', 'Acordado'])),
      ...openInstallments.map(item => ['Cuota', item.due_on, `${item.description} · ${item.sequence}`, '', '', money(item.balance_usd_cents / 100), '', '', item.status === 'overdue' ? 'Vencida' : 'Pendiente']),
      ...patientPayments.map(payment => {
        const currency = payment.receivedCurrency ?? 'USD'
        const verifiedRate = Boolean(payment.exchangeRate && (payment.rateSource === 'BCV' || payment.rateValidatedAt))
        const bolivarMinor = paymentLocalMinor(payment)
        const paymentDate = payment.receivedAt ? formatClinicDateTime(payment.receivedAt, timezone) : payment.date
        const rateDate = payment.rateAsOf ? formatClinicDate(payment.rateAsOf, timezone) : ''
        return ['Pago', paymentDate, payment.concept, payment.method, currency === 'VES' && typeof payment.receivedLocalMinor === 'number' ? formatLocalMinor(payment.receivedLocalMinor, payment.localPrecision ?? 2) : `${payment.amount.toFixed(2)} USD`, `${payment.amount.toFixed(2)} USD`, bolivarMinor === null ? '' : formatLocalMinor(bolivarMinor, payment.localPrecision ?? 2), verifiedRate ? `${payment.exchangeRate} ${payment.rateSource ?? ''} ${rateDate}` : 'Pendiente BCV', payment.status]
      }),
    ]
    const csv = rows.map(row => row.map(escapeCsvCell).join(',')).join('\r\n')
    const url = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `OdontoCuenta-estado-cuenta-${patient.name.normalize('NFKD').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '')}.csv`
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return <Modal title="Estado de cuenta" subtitle={patient.name} close={close}>
    <div className="statement-content">
      <div className="statement-contact">
        <div className="statement-contact-details">
          {patient.nationalId && <span><small>Cédula</small><b>{patient.nationalId}</b></span>}
          <span><small>Teléfono</small><b>{patient.phone}</b></span>
        </div>
      </div>
      <small className="muted statement-cutoff">Fecha de corte: {cutoff}</small>
      <div className="statement-overview">
        <article className="stat-card"><span className="stat-label">Planes activos</span><strong>{patientPlans.length}</strong></article>
        <article className="stat-card"><span className="stat-label">Total acordado</span><strong>{money(total)}</strong></article>
        <article className="stat-card"><span className="stat-label">Saldo pendiente</span><strong>{money(Math.max(patient.balance, total - paid))}</strong></article>
      </div>
      <section className="statement-section statement-section--plans"><h3>Planes de tratamiento</h3>
        {patientPlans.length ? patientPlans.map(plan => <article className="due-item statement-entry statement-entry--plan" key={plan.id}><div className="due-info"><b>{plan.planCode} · {plan.treatment}</b>{plan.items?.length ? <div className="statement-plan-items">{plan.items.map(item => <small key={item.id}>{item.name} · {item.category}{item.description ? ` · ${item.description}` : ''} · {money(item.amount)}</small>)}</div> : null}<span>{money(plan.paid)} abonados de {money(plan.total)}</span><small>Próxima cuota: {plan.nextDue} · {plan.status}</small></div><b className="due-amount">{money(Math.max(0, plan.total - plan.paid))}</b></article>) : <p className="muted">Este paciente aún no tiene planes activos.</p>}
      </section>
      <section className="statement-section statement-section--installments"><h3>Cuotas abiertas</h3>
        {openInstallments.length ? openInstallments.map(item => {
          const message = renderWhatsAppMessage(messageTemplate, { nombre: patient.name, clínica: clinicName, monto: money(item.balance_usd_cents / 100), fecha: formatDueDate(item.due_on), tratamiento: item.description, teléfono: clinicPhone || 'este número' })
          const link = patient.whatsappConsentAt ? whatsappUrl(patient.phone, message) : ''
          return <article className="due-item statement-entry statement-entry--installment" key={item.id}><div className="due-info"><b>{item.description} · Cuota {item.sequence}</b><span>Vence {formatDueDate(item.due_on)}</span><small>{item.status === 'overdue' ? 'Vencida' : 'Pendiente'}</small></div><b className="due-amount">{money(item.balance_usd_cents / 100)}</b>{link ? <a className="button secondary compact whatsapp-send" href={link} target="_blank" rel="noopener noreferrer"><MessageCircle size={15} /> Preparar WhatsApp</a> : <button className="button secondary compact whatsapp-send" type="button" disabled title={patient.whatsappConsentAt ? 'Agrega un teléfono válido al paciente' : 'Registra su autorización en la ficha del paciente'}><MessageCircle size={15} /> WhatsApp</button>}</article>
        }) : <p className="muted">Sin cuotas abiertas detalladas.</p>}
      </section>
      <section className="statement-section"><h3>{supabase && clinicId ? 'Historial de abonos' : 'Abonos recientes'}</h3>
        {historyError && <p className="audit-error">{historyError}</p>}
        {historyLoading && <p className="muted">Cargando historial completo…</p>}
        {!historyLoading && patientPayments.length ? <div className="table-wrap"><table><thead><tr><th>FECHA</th><th>CONCEPTO</th><th>FORMA DE PAGO</th><th>RECIBIDO</th><th>EQUIVALENTE USD / Bs.</th><th>TASA</th></tr></thead><tbody>{patientPayments.map(payment => { const currency = payment.receivedCurrency ?? 'USD'; const verifiedRate = Boolean(payment.exchangeRate && (payment.rateSource === 'BCV' || payment.rateValidatedAt)); const bolivarMinor = paymentLocalMinor(payment); const rateDate = payment.rateAsOf ? formatClinicDate(payment.rateAsOf, timezone) : ''; return <tr key={payment.id}><td>{payment.date}</td><td>{payment.concept}</td><td>{payment.method}<small className="cell-sub">{payment.status}</small></td><td>{currency === 'VES' && typeof payment.receivedLocalMinor === 'number' ? formatLocalMinor(payment.receivedLocalMinor, payment.localPrecision ?? 2) : money(payment.amount) + ' USD'}</td><td>{payment.status === 'Revertido' ? '—' : `${money(payment.amount)} USD${bolivarMinor === null ? ' · Bs. pendiente' : ` · ${formatLocalMinor(bolivarMinor, payment.localPrecision ?? 2)}`}`}</td><td>{verifiedRate ? `${payment.rateSource === 'BCV' ? 'BCV' : 'Validada'} · ${payment.exchangeRate}${rateDate ? ` · ${rateDate}` : ''}` : 'Pendiente'}</td></tr> })}</tbody></table></div> : !historyLoading && <p className="muted">Todavía no hay abonos recientes.</p>}
      </section>
      <p className="form-note">Montos expresados en USD. El equivalente en Bs. se podrá mostrar cuando haya una tasa BCV verificada.</p>
      <div className="modal-actions"><button type="button" className="button secondary" onClick={() => exportStatement('print')}>Imprimir</button><button type="button" className="button secondary" onClick={exportStatementCsv} disabled={historyLoading || Boolean(historyError)}><Download size={16} /> CSV</button><button type="button" className="button primary" onClick={() => exportStatement('download')} disabled={historyLoading || Boolean(historyError)}><Download size={16} /> Descargar PDF</button><button className="button secondary" onClick={close}>Cerrar</button></div>
    </div>
  </Modal>
}
function LoadingScreen() {
  return <main className="auth-shell loading-screen" aria-busy="true" aria-live="polite">
    <div className="loading-brand"><Logo /></div>
    <section className="loading-content" aria-label="Preparando tu consultorio">
      <div className="loading-card">
        <div className="loading-step is-active">
          <span className="loading-step-icon"><Wallet size={20} strokeWidth={1.9} /></span>
          <strong>Pacientes y fichas</strong>
          <span className="loading-step-status"><span className="loading-spinner" /></span>
        </div>
        <div className="loading-step">
          <span className="loading-step-icon"><ClipboardList size={20} strokeWidth={1.9} /></span>
          <strong>Planes de tratamiento</strong>
          <span className="loading-step-status"><i /></span>
        </div>
        <div className="loading-step">
          <span className="loading-step-icon"><TrendingUp size={20} strokeWidth={1.9} /></span>
          <strong>Pagos y resumen</strong>
          <span className="loading-step-status"><i /></span>
        </div>
      </div>
      <h1>Preparando tu consultorio…</h1>
      <p>Conectando tus datos de forma segura</p>
      <div className="auth-loading" role="progressbar" aria-label="Cargando OdontoCuenta" />
    </section>
    <div className="loading-foot"><ShieldCheck size={15} /> <span>Tu información se mantiene protegida</span></div>
  </main>
}
function ClinicSetupScreen({ clinicName, onClinicNameChange, onSubmit, busy, error, loadError, email, onRetry, onSignOut }: { clinicName: string; onClinicNameChange: (value: string) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; busy: boolean; error: string; loadError: string; email: string; onRetry: () => void; onSignOut: () => void }) {
  return <main className="auth-shell"><section className="auth-card"><div className="auth-brand"><Logo /><span className="auth-shield"><ShieldCheck size={17} /></span></div><span className="auth-kicker">COBROS CLAROS, SONRISAS TRANQUILAS</span><h1>{loadError ? 'No pudimos cargar tu consultorio' : 'Prepara tu consultorio'}</h1><p className="auth-description">{loadError ? 'Revisa la conexión y las migraciones de Supabase antes de continuar.' : 'Tu cuenta aún no está asociada a un consultorio. Crea el espacio para empezar a registrar pacientes y cobros.'}</p>{loadError ? <><div className="auth-alert error">{loadError}</div><button className="button primary auth-submit" onClick={onRetry}>Volver a intentar <ArrowRight size={16} /></button></> : <form className="form" onSubmit={onSubmit}><Field label="Nombre del consultorio"><input name="clinicName" required minLength={2} maxLength={120} value={clinicName} onChange={event => onClinicNameChange(event.target.value)} placeholder="Ej. Clínica Sonrisa" /></Field>{error && <div className="auth-alert error">{error}</div>}<button className="button primary auth-submit" disabled={busy}>{busy ? 'Creando espacio…' : 'Crear consultorio'} <ArrowRight size={16} /></button></form>}<div className="auth-switch"><span>{email}</span><button type="button" onClick={onSignOut}>Cerrar sesión</button></div></section></main>
}
function AuthScreen() {
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [clinicName, setClinicName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setMessage(''); setBusy(true)
    try {
      if (!supabase) return
      if (mode === 'signup') {
        const { error: signupError, data } = await supabase.auth.signUp({ email, password, options: { data: { clinic_name: clinicName.trim() || 'Mi consultorio' } } })
        if (signupError) throw signupError
        if (!data.session) setMessage('Revisa tu correo para confirmar la cuenta. La clínica se creará al activar el acceso.')
      } else {
        const { error: loginError } = await supabase.auth.signInWithPassword({ email, password })
        if (loginError) throw loginError
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No pudimos iniciar sesión.') }
    finally { setBusy(false) }
  }
  return <main className="auth-shell"><section className="auth-card"><div className="auth-brand"><Logo /><span className="auth-shield"><ShieldCheck size={17} /></span></div><span className="auth-kicker">COBROS CLAROS, SONRISAS TRANQUILAS</span><h1>{mode === 'login' ? 'Qué bueno verte' : 'Abre tu consultorio'}</h1><p className="auth-description">{mode === 'login' ? 'Ingresa a tu espacio de cobranza odontológica.' : 'Crea tu cuenta para organizar las cuentas de tu clínica.'}</p><form className="form" onSubmit={submit}>{mode === 'signup' && <Field label="Nombre del consultorio"><input name="clinicName" required value={clinicName} onChange={e => setClinicName(e.target.value)} placeholder="Ej. Clínica Sonrisa" /></Field>}<Field label="Correo electrónico"><input name="email" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="tu@correo.com" /></Field><Field label="Contraseña"><input name="password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={8} required value={password} onChange={e => setPassword(e.target.value)} placeholder="Al menos 8 caracteres" /></Field>{error && <div className="auth-alert error">{error}</div>}{message && <div className="auth-alert success">{message}</div>}<button className="button primary auth-submit" disabled={busy}>{busy ? 'Un momento…' : mode === 'login' ? 'Iniciar sesión' : 'Crear cuenta'} <ArrowRight size={16} /></button></form><div className="auth-switch">{mode === 'login' ? '¿Primera vez en OdontoCuenta?' : '¿Ya tienes una cuenta?'} <button onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); setMessage('') }}>{mode === 'login' ? 'Crear cuenta' : 'Iniciar sesión'}</button></div><div className="auth-privacy"><ShieldCheck size={15} /><span>Protegemos la información de tu consultorio.<br />No almacenamos historias clínicas.</span></div></section></main>
}

function nameFieldControls(children: ReactNode, fieldName: string, sequence = { value: 0 }): ReactNode {
  if (Array.isArray(children)) return children.map((child, index) => {
    const named = nameFieldControls(child, fieldName, sequence)
    return isValidElement(named) && named.key === null ? cloneElement(named, { key: `${fieldName}-${index}` }) : named
  })
  if (!isValidElement<{ children?: ReactNode; id?: string; name?: string; type?: string; 'aria-label'?: string }>(children) || typeof children.type !== 'string') return children
  if (/^(input|select|textarea)$/i.test(children.type)) {
    sequence.value += 1
    const controlId = sequence.value === 1 ? fieldName : `${fieldName}-${sequence.value}`
    const dateLabel = children.type.toLowerCase() === 'input' && children.props.type === 'date' && !children.props['aria-label']
      ? { 'aria-label': fieldName.replace(/-/g, ' ') }
      : {}
    return cloneElement(children, {
      ...(!children.props.name ? { name: controlId } : {}),
      ...(!children.props.id ? { id: controlId } : {}),
      ...dateLabel,
    })
  }
  return cloneElement(children, { children: nameFieldControls(children.props.children, fieldName, sequence) })
}

function ensureNamedControls(children: ReactNode, sequence = { value: 0 }): ReactNode {
  if (Array.isArray(children)) return children.map((child, index) => {
    const named = ensureNamedControls(child, sequence)
    return isValidElement(named) && named.key === null ? cloneElement(named, { key: `modal-control-${index}` }) : named
  })
  if (!isValidElement<{ children?: ReactNode; name?: string; 'aria-label'?: string; placeholder?: string; type?: string }>(children) || typeof children.type !== 'string') return children
  if (/^(input|select|textarea)$/i.test(children.type) && !children.props.name) {
    sequence.value += 1
    const source = children.props['aria-label'] || children.props.placeholder || `control-${sequence.value}`
    const name = source.toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `control-${sequence.value}`
    return cloneElement(children, { name })
  }
  return cloneElement(children, { children: ensureNamedControls(children.props.children, sequence) })
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  const name = label.toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'field'
  const hasControl = hasLabelableControl(children)
  return <div className="field">{hasControl ? <label htmlFor={name}>{label}</label> : <span>{label}</span>}{nameFieldControls(children, name)}</div>
}
function hasLabelableControl(children: ReactNode): boolean {
  if (Array.isArray(children)) return children.some(hasLabelableControl)
  if (!isValidElement<{ children?: ReactNode }>(children) || typeof children.type !== 'string') return false
  if (/^(input|select|textarea)$/i.test(children.type)) return true
  return hasLabelableControl(children.props.children)
}
function Dashboard({ patients, plans, payments, totalDue, monthlyCollectedUsdCents, showBalance, setShowBalance, go, open, canManage }: { patients: Patient[]; plans: Plan[]; payments: Payment[]; totalDue: number; monthlyCollectedUsdCents: number | null; showBalance: boolean; setShowBalance: (v: boolean) => void; go: (p: Page) => void; open: (m: 'patient' | 'payment' | 'plan') => void; canManage: boolean }) {
  const overdue = plans.filter(p => p.status === 'Vencido').length
  const dueSoon = plans.filter(p => p.status === 'Por vencer').length
  const pendingPatients = patients.filter(p => p.balance > 0).length
  const monthlyCollected = monthlyCollectedUsdCents === null ? null : monthlyCollectedUsdCents / 100
  const priorityPlans = [...plans].sort((a, b) => {
    const priority = { Vencido: 0, 'Por vencer': 1, 'Al día': 2 }
    return priority[a.status] - priority[b.status]
  }).slice(0, 3)
  return <>
    <section className="hero-card"><div className="hero-pattern" /><div className="hero-top"><div className="hero-label"><div className="hero-mark"><Stethoscope size={18} /></div><span>RESUMEN DE TU CONSULTORIO</span></div><span className="secure-label"><i /> CUENTA SEGURA</span></div><div className="hero-main"><div className="hero-copy"><p>Saldo pendiente por cobrar <button onClick={() => setShowBalance(!showBalance)}>{showBalance ? 'Ocultar' : 'Mostrar'}</button></p><strong>{showBalance ? money(totalDue) : '••••••'}</strong><div className="hero-chip"><TrendingUp size={15} /> {overdue ? `${overdue} cuenta${overdue > 1 ? 's' : ''} vencida${overdue > 1 ? 's' : ''}` : 'Tu cobranza está al día'}</div></div><div className="hero-actions"><button onClick={() => open('payment')}><span className="action-icon inverse"><ArrowDownLeft size={20} /></span><b>Registrar abono</b></button>{canManage && <button onClick={() => open('patient')}><span className="action-icon"><UserRound size={20} /></span><b>Nuevo paciente</b></button>}{canManage && <button onClick={() => open('plan')}><span className="action-icon"><ClipboardList size={20} /></span><b>Crear plan</b></button>}</div></div><div className="hero-foot"><span><Users size={15} /> {patients.length} pacientes registrados</span><span><CalendarDays size={15} /> {dueSoon} cuotas por vencer</span></div></section>
    <section className="panel due-panel dashboard-priority">
      <div className="panel-head">
        <div><h2>{overdue ? 'Vencimientos que requieren atención' : 'Próximos vencimientos'}</h2><p>{overdue ? `${overdue} plan${overdue === 1 ? '' : 'es'} vencido${overdue === 1 ? '' : 's'} · revisa a quién contactar` : 'Cuotas próximas para dar seguimiento'}</p></div>
        <span className="round-icon"><CalendarDays size={18} /></span>
      </div>
      {priorityPlans.length ? priorityPlans.map(p => {
        const dueDate = p.nextDue.match(/(\d{1,2})\s+([a-záéíóú]+)/i)
        const month = dueDate?.[2].slice(0, 3).toLocaleUpperCase('es') ?? '—'
        const statusLabel = p.status === 'Vencido' ? 'Vencido' : p.status === 'Por vencer' ? 'Por vencer' : 'Próxima cuota'
        return <div className="due-item" key={p.id}>
          <div className={`date-tile ${p.status === 'Vencido' ? 'is-overdue' : ''}`}><b>{dueDate?.[1] ?? '—'}</b><span>{month}</span></div>
          <div className="due-info"><b>{p.patient}</b><span>{p.treatment}</span><small>{p.nextDue} · {statusLabel}</small></div>
          <b className="due-amount">{money(p.total - p.paid)}</b>
        </div>
      }) : <div className="dashboard-empty"><span className="round-icon"><Check size={18} /></span><div><b>Sin vencimientos pendientes</b><p>Los próximos pagos de tus planes aparecerán aquí.</p></div></div>}
      <button className="panel-bottom-link" onClick={() => go('Planes de pago')}>Ver planes de pago <ArrowRight size={15} /></button>
    </section>
    <section className="panel movements dashboard-activity">
      <div className="panel-head"><div><h2>Pagos recientes</h2><p>Los últimos movimientos de tu consultorio</p></div><button className="text-link" onClick={() => go('Pagos')}>Ver todos <ArrowRight size={16} /></button></div>
      {payments.length ? <div className="table-wrap"><table><thead><tr><th>PACIENTE</th><th>CONCEPTO</th><th>FECHA</th><th className="right">MONTO</th></tr></thead><tbody>{payments.slice(0, 4).map((p, i) => <tr key={p.id}><td><PersonName name={p.patient} initials={p.patient.split(' ').map(x => x[0]).slice(0, 2).join('')} tone={i} /></td><td><b>{p.concept}</b><small className="cell-sub">{p.method}</small></td><td className="muted">{p.date}</td><td className="right">{p.status === 'Revertido' ? <b style={{ color: '#a3423f' }}>Revertido</b> : <b className="amount-positive">+ {money(p.amount)}</b>}<small className="cell-sub">{p.status}</small></td></tr>)}</tbody></table></div> : <div className="dashboard-empty"><span className="round-icon"><CreditCard size={18} /></span><div><b>Aún no hay pagos registrados</b><p>Cuando registres un abono, aparecerá en esta lista.</p></div></div>}
    </section>
    <div className="stats-grid dashboard-stats"><StatCard label="Cobrado este mes" value={monthlyCollected === null ? '—' : money(monthlyCollected)} caption={cloudConfigured ? monthlyCollected === null ? 'Resumen no disponible' : 'Abonos registrados este mes' : '↑ 12% respecto al mes pasado'} icon={<CircleDollarSign size={19} />} tone="green" /><StatCard label="Por cobrar" value={money(totalDue)} caption="En planes activos" icon={<Wallet size={19} />} tone="mint" /><StatCard label="Pacientes activos" value={String(patients.length)} caption={`${pendingPatients} con saldo pendiente`} icon={<Users size={19} />} tone="lavender" /><StatCard label="Cuotas vencidas" value={String(overdue)} caption="Requieren seguimiento" icon={<CalendarDays size={19} />} tone="peach" /></div>
    <section className="tip-banner"><span className="tip-icon"><BriefcaseMedical size={19} /></span><div><b>{overdue > 0 ? 'Un buen seguimiento hace la diferencia' : 'Tu cobranza está al día'}</b><p>{overdue > 0 ? <>Tienes {overdue} cuenta{overdue === 1 ? '' : 's'} vencida{overdue === 1 ? '' : 's'}. Puedes contactar al paciente desde su perfil.</> : 'No hay cuentas vencidas por revisar.'}</p></div><button onClick={() => go('Pacientes')}>Ver pacientes <ArrowRight size={15} /></button></section>
  </>
}
function StatCard({ label, value, caption, icon, tone }: { label: string; value: string; caption: string; icon: ReactNode; tone: string }) { return <article className="stat-card"><div className={`stat-icon ${tone}`}>{icon}</div><span className="stat-label">{label}</span><strong>{value}</strong><small>{caption}</small></article> }
function PersonName({ name, initials, tone = 0 }: { name: string; initials: string; tone?: number }) { return <div className="person"><span className={`person-avatar tone-${tone % 5}`}>{initials}</span><b>{name}</b></div> }
function SearchBar({ value, onChange, placeholder = 'Buscar...' }: { value: string; onChange: (v: string) => void; placeholder?: string }) { const name = `buscar-${placeholder.toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/^buscar\s*/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`; return <label className="search-box"><Search size={17} aria-hidden="true" /><input aria-label={placeholder} name={name} placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)} /></label> }
function downloadPaymentsCsv(payments: Payment[], timezone: string) {
  const rows = [['Paciente', 'Plan / cuota', 'Monto base USD', 'Monto recibido', 'Moneda recibida', 'Equivalente Bs.', 'Tasa aplicada', 'Fuente de tasa', 'Fecha de vigencia', 'Forma de pago', 'Fecha', 'Estado'], ...payments.map(p => {
    const snapshot = p.receiptSnapshot ?? {}
    const localPrecision = typeof p.localPrecision === 'number' ? p.localPrecision : typeof snapshot.local_precision === 'number' ? snapshot.local_precision : 2
    const receivedCurrency = p.receivedCurrency ?? (p.currency === 'VES' ? 'VES' : 'USD')
    const amountCents = p.amountCents ?? Math.round(p.amount * 100)
    const receivedAmount = receivedCurrency === 'VES' && p.receivedLocalMinor != null
      ? (p.receivedLocalMinor / 10 ** localPrecision).toFixed(localPrecision)
      : (amountCents / 100).toFixed(2)
    let localEquivalent = ''
    if (typeof p.completedEquivalentLocalMinor === 'number') {
      localEquivalent = (p.completedEquivalentLocalMinor / 10 ** localPrecision).toFixed(localPrecision)
    } else if (p.exchangeRate != null && p.rateAsOf) {
      try {
        localEquivalent = (convertUsdCentsToLocalMinor(cents(amountCents), String(p.exchangeRate), localPrecision) / 10 ** localPrecision).toFixed(localPrecision)
      } catch { /* Keep the equivalent blank when its saved rate cannot be parsed. */ }
    }
    const rateDate = p.rateAsOf ? formatClinicDate(p.rateAsOf, timezone) : ''
    const receivedDate = p.receivedAt ? formatClinicDateTime(p.receivedAt, timezone) : p.date
    return [p.patient, p.installment ?? '', (amountCents / 100).toFixed(2), receivedAmount, receivedCurrency, localEquivalent, p.exchangeRate == null ? '' : String(p.exchangeRate), p.rateSource ?? '', rateDate, p.method, receivedDate, p.status]
  })]
  const csv = `\uFEFF${rows.map(row => row.map(escapeCsvCell).join(',')).join('\r\n')}`
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a'); link.href = url; link.download = `odontocuenta-pagos-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); URL.revokeObjectURL(url)
}
function Patients({ patients, search, setSearch, filter, setFilter, open, canManage, onEdit, onArchive, onStatement }: { patients: Patient[]; search: string; setSearch: (v: string) => void; filter: string; setFilter: (v: string) => void; open: (m: 'patient' | 'payment' | 'plan') => void; canManage: boolean; onEdit: (patient: Patient) => void; onArchive: (patient: Patient) => void; onStatement: (patient: Patient) => void }) {
  return (
    <section className="panel listing-panel listing-panel--patients">
      <div className="list-toolbar">
        <SearchBar value={search} onChange={setSearch} placeholder="Buscar por nombre, cédula o teléfono" />
        <div className="toolbar-right">
          <div className="filter-control"><Filter size={15} /><select name="patient-status-filter" aria-label="Filtrar pacientes por estado de cuenta" value={filter} onChange={event => setFilter(event.target.value)}><option>Todos</option><option>Al día</option><option>Pendiente</option><option>Vencido</option></select></div>
          {canManage && <button className="button primary compact mobile-create-action" onClick={() => open('patient')}><Plus size={16} /> Nuevo paciente</button>}
        </div>
      </div>
      <div className="table-wrap mobile-card-list">
        <table>
          <thead><tr><th>PACIENTE</th><th>TELÉFONO</th><th>ESTADO DE CUENTA</th><th>SALDO</th><th>ACCIONES</th></tr></thead>
          <tbody>{patients.map((patient, index) => (
            <tr className="mobile-table-card" key={patient.id}>
              <td data-label="Paciente"><div className="patient-row-info"><PersonName name={patient.name} initials={patient.initials} tone={index} /><small className="cell-sub patient-email">{patient.nationalId ? 'C.I. ' + patient.nationalId : patient.email || 'Paciente nuevo'}</small></div></td>
              <td data-label="Teléfono">{patient.phone || 'Sin teléfono'}</td>
              <td data-label="Estado"><Badge tone={patient.status === 'Al día' ? 'success' : patient.status === 'Vencido' ? 'danger' : 'warning'} title={patient.status === 'Pendiente' ? 'Tiene saldo por pagar; ninguna cuota vencida según el registro.' : undefined}><i />{patient.status === 'Pendiente' ? 'Con saldo' : patient.status}</Badge></td>
              <td data-label="Saldo"><b className="key-balance">{money(patient.balance)}</b></td>
              <td data-label="Acciones"><div className="row-actions"><button type="button" className="row-action row-action-primary" onClick={() => onStatement(patient)}>Ver cuenta</button>{canManage && <><button type="button" className="row-action" onClick={() => onEdit(patient)}>Editar</button><button type="button" className="row-action row-action-danger" onClick={() => onArchive(patient)}>Archivar</button></>}</div></td>
            </tr>
          ))}</tbody>
        </table>
        {patients.length === 0 && <Empty title="No encontramos pacientes" body="Prueba con otro nombre o cambia el filtro." />}
      </div>
      <div className="table-foot"><span>Mostrando <b>{patients.length}</b> pacientes</span><span>Información de contacto y cobranza</span></div>
    </section>
  )
}
function Plans({ plans, patients, installments, clinicName, clinicPhone, timezone, search, setSearch, filter, setFilter, open, canCreate }: { plans: Plan[]; patients: Patient[]; installments: UnpaidInstallment[]; clinicName: string; clinicPhone: string; timezone: string; search: string; setSearch: (v: string) => void; filter: string; setFilter: (v: string) => void; open: (m: 'patient' | 'payment' | 'plan') => void; canCreate: boolean }) {
  const list = plans.filter(plan => (plan.planCode + ' ' + plan.patient + ' ' + plan.treatment).toLowerCase().includes(search.toLowerCase()))
    .filter(plan => filter === 'Todos los planes' || plan.status === filter)
  const countLabel = plans.length + ' ' + (plans.length === 1 ? 'plan activo' : 'planes activos')
  const downloadPlan = (plan: Plan) => {
    const patient = patients.find(item => String(item.id) === String(plan.patientId)) ?? patients.find(item => item.name === plan.patient)
    const balance = Math.max(0, Math.round((plan.total - plan.paid) * 100)) / 100
    const openPlanInstallments = installments.filter(item => String(item.plan_id) === String(plan.id))
    const data: PlanPdfData = {
      clinicName,
      clinicPhone,
      planCode: plan.planCode,
      patientName: patient?.name ?? plan.patient,
      patientId: patient?.nationalId ?? '',
      patientPhone: patient?.phone ?? '',
      treatment: plan.treatment,
      issuedAt: formatClinicDate(new Date(), timezone, 'long'),
      total: money(plan.total),
      paid: money(plan.paid),
      balance: money(balance),
      hasBalance: balance > 0,
      status: plan.status,
      nextDue: plan.nextDue,
      items: (plan.items ?? []).map(item => [item.name, item.category, item.description && item.description !== item.name ? item.description : null, money(item.amount)].filter(Boolean).join(' · ')),
      installments: openPlanInstallments.map(item => `Cuota ${item.sequence} · vence ${formatDueDate(item.due_on)} · ${item.status === 'overdue' ? 'vencida' : 'pendiente'} · saldo ${money(item.balance_usd_cents / 100)}`),
    }
    downloadPlanPdf(data)
  }
  return (
    <section className="panel listing-panel listing-panel--plans">
      <div className="list-toolbar">
        <SearchBar value={search} onChange={setSearch} placeholder="Buscar código, paciente o tratamiento" />
        <div className="toolbar-right">
          <div className="filter-control"><Filter size={15} /><select name="plan-status-filter" aria-label="Filtrar planes de pago" value={filter} onChange={event => setFilter(event.target.value)}><option>Todos los planes</option><option>Al día</option><option>Por vencer</option><option>Vencido</option></select></div>
          {canCreate && <button className="button primary compact mobile-create-action" onClick={() => open('plan')}><Plus size={16} /> Crear plan</button>}
        </div>
      </div>
      <div className="table-wrap mobile-card-list">
        <table>
            <thead><tr><th>PACIENTE / TRATAMIENTO</th><th>PROGRESO DEL PLAN</th><th>PRÓXIMA CUOTA</th><th>ESTADO</th><th className="right">SALDO</th><th>CONSTANCIA</th></tr></thead>
          <tbody>{list.map((plan, index) => {
            const pct = plan.total > 0 ? Math.min(100, Math.round(plan.paid / plan.total * 100)) : 0
            return <tr className="mobile-table-card" key={plan.id}>
              <td data-label="Paciente / tratamiento"><div className="patient-row-info"><PersonName name={plan.patient} initials={plan.patient.split(' ').map(part => part[0]).slice(0, 2).join('')} tone={index} /><small className="cell-sub patient-email">{plan.planCode} · {plan.treatment}</small></div></td>
              <td data-label="Progreso"><div className="plan-progress"><div className="progress-caption"><b>{money(plan.paid)}</b><span>{pct}%</span></div><div className="progress-track"><i style={{ width: String(pct) + '%' }} /></div><small className="cell-sub">de {money(plan.total)}</small></div></td>
              <td data-label="Próxima cuota">{plan.nextDue}</td>
              <td data-label="Estado"><Badge tone={plan.status === 'Vencido' ? 'danger' : plan.status === 'Por vencer' ? 'warning' : 'success'}><i />{plan.status}</Badge></td>
              <td data-label="Saldo" className="right"><b className="key-balance">{money(Math.max(0, plan.total - plan.paid))}</b></td>
              <td data-label="Constancia"><button type="button" className="row-action row-action-primary" onClick={() => downloadPlan(plan)} aria-label={`Descargar constancia PDF del plan ${plan.planCode} de ${plan.patient}`}><Download size={14} /> PDF del plan</button></td>
            </tr>
          })}</tbody>
        </table>
        {list.length === 0 && <Empty title={plans.length ? 'Sin resultados' : 'Todavía no hay planes'} body={plans.length ? 'Prueba con otro filtro o término de búsqueda.' : 'Crea un plan para organizar las cuotas de un tratamiento.'} />}
      </div>
      <div className="table-foot"><span>{countLabel}</span><span>Montos base expresados en USD</span></div>
    </section>
  )
}
function Payments({ payments, search, setSearch, monthlyCollectedUsdCents, canReverse, onReverse, onReceipt, onExport }: { payments: Payment[]; search: string; setSearch: (v: string) => void; monthlyCollectedUsdCents: number | null; canReverse: boolean; onReverse: (payment: Payment) => void; onReceipt: (payment: Payment) => void; onExport: () => void }) {
  const list = payments.filter(payment => (payment.patient + ' ' + payment.concept + ' ' + payment.method).toLowerCase().includes(search.toLowerCase()))
  const lastConfirmed = payments.find(payment => payment.status === 'Confirmado')
  const monthly = monthlyCollectedUsdCents === null ? null : monthlyCollectedUsdCents / 100
  return (
    <>
      <div className="stats-grid payment-stats">
        <StatCard label="Cobrado este mes" value={monthly === null ? '—' : money(monthly)} caption={monthly === null ? 'Resumen no disponible' : 'Pagos confirmados'} icon={<CircleDollarSign size={19} />} tone="green" />
        <StatCard label="Pagos cargados" value={String(payments.length)} caption="Movimientos recientes" icon={<CreditCard size={19} />} tone="mint" />
        <StatCard label="Último abono" value={lastConfirmed ? money(lastConfirmed.amount) : '$0,00'} caption={lastConfirmed?.date ?? 'Sin movimientos'} icon={<ArrowDownLeft size={19} />} tone="lavender" />
        <StatCard label="Pagos revertidos" value={String(payments.filter(payment => payment.status === 'Revertido').length)} caption="Con motivo y auditoría" icon={<Check size={19} />} tone="peach" />
      </div>
      <section className="panel listing-panel listing-panel--payments">
        <div className="list-toolbar">
          <div><h2>Historial de pagos</h2><p>Recibos y abonos de todos tus pacientes</p></div>
          <div className="toolbar-right"><SearchBar value={search} onChange={setSearch} placeholder="Buscar movimiento" /><button className="button secondary compact" onClick={onExport}><Download size={15} /> CSV</button></div>
        </div>
        <div className="table-wrap mobile-card-list">
          <table>
            <thead><tr><th>PACIENTE</th><th>CONCEPTO</th><th>FORMA DE PAGO</th><th>FECHA</th><th className="right">MONTO</th><th>ACCIONES</th></tr></thead>
            <tbody>{list.map((payment, index) => (
              <tr className="mobile-table-card" key={payment.id}>
                <td data-label="Paciente"><PersonName name={payment.patient} initials={payment.patient.split(' ').map(part => part[0]).slice(0, 2).join('')} tone={index} /></td>
                <td data-label="Concepto">{payment.concept}</td>
                <td data-label="Forma de pago">{payment.method}</td>
                <td data-label="Fecha">{payment.date}</td>
                <td data-label="Monto"><div className="payment-summary"><b className={payment.status === 'Revertido' ? 'payment-reversed' : 'amount-positive'}>{payment.status === 'Revertido' ? 'Revertido' : '+ ' + money(payment.amount)}</b><small className="cell-sub">{payment.status}</small></div></td>
                <td data-label="Acciones"><div className="row-actions"><button type="button" className="row-action row-action-primary" onClick={() => onReceipt(payment)}>Ver recibo</button>{canReverse && payment.status === 'Confirmado' && <button type="button" className="row-action row-action-danger" onClick={() => onReverse(payment)}>Revertir</button>}</div></td>
              </tr>
            ))}</tbody>
          </table>
          {list.length === 0 && <Empty title="No encontramos pagos" body="Prueba con otro nombre o concepto." />}
        </div>
      </section>
    </>
  )
}
function ReceiptPreview({ clinicName, timezone, payment, close }: { clinicName: string; timezone: string; payment: Payment; close: () => void }) {
  const snapshot = payment.receiptSnapshot ?? {}
  const patientName = typeof snapshot.patient_name === 'string' ? snapshot.patient_name : payment.patient
  const receiptClinic = typeof snapshot.clinic_name === 'string' ? snapshot.clinic_name : clinicName
  const snapshotReceiptNumber = snapshot.receipt_number
  const receiptNumber = payment.receiptNumber ?? (typeof snapshotReceiptNumber === 'number' || typeof snapshotReceiptNumber === 'string' ? snapshotReceiptNumber : null)
  const receivedCurrency = payment.receivedCurrency ?? payment.currency
  const hasVerifiedRate = Boolean(payment.exchangeRate && (payment.rateSource === 'BCV' || payment.rateValidatedAt))
  const receiptRatePending = payment.status === 'Confirmado' && receivedCurrency === 'USD' && !hasVerifiedRate
  const receiptStatus = receiptRatePending ? 'Pendiente de tasa BCV' : payment.status
  const bolivarEquivalent = paymentLocalMinor(payment)
  const rateDate = payment.rateAsOf ? formatClinicDate(payment.rateAsOf, timezone) : null
  return <Modal title={payment.status === 'Borrador local' ? 'Vista previa del recibo' : 'Recibo de pago'} subtitle={payment.status === 'Borrador local' ? 'Demostración local · no es un comprobante confirmado.' : 'Constancia del abono registrado en OdontoCuenta.'} close={close}>
    <article className="receipt-document">
      <div className="receipt-brand"><div className="receipt-issuer"><Logo /><span>{receiptClinic}</span></div><Badge tone={payment.status === 'Revertido' ? 'peach' : receiptRatePending || payment.status === 'Borrador local' ? 'neutral' : 'green'}>{receiptStatus}</Badge></div>
      <p className="eyebrow">RECIBO DE PAGO</p>
      <h2>{receiptNumber ? `N.º ${receiptNumber}` : 'Pendiente de numeración'}</h2>
      <p className="receipt-patient">{patientName}</p>
      <dl className="receipt-details">
        <div><dt>Fecha</dt><dd>{payment.receivedAt ? formatClinicDateTime(payment.receivedAt, timezone) : payment.date}</dd></div>
        <div><dt>Plan / cuota</dt><dd>{payment.installment ?? receiptInstallmentFromSnapshot(snapshot) ?? 'Abono a cuenta'}</dd></div>
        <div><dt>Método</dt><dd>{payment.method}</dd></div>
        <div><dt>Monto recibido</dt><dd>{typeof payment.receivedLocalMinor === 'number' && receivedCurrency === 'VES' ? formatLocalMinor(payment.receivedLocalMinor, payment.localPrecision ?? 2) : money(payment.amount) + ' USD'}</dd></div>
        <div><dt>Equivalente en USD</dt><dd>{money(payment.amount)}</dd></div>
        {bolivarEquivalent !== null && <div><dt>{receivedCurrency === 'VES' ? 'Monto recibido' : 'Equivalente en Bs.'}</dt><dd>{formatLocalMinor(bolivarEquivalent, payment.localPrecision ?? 2)}</dd></div>}
        {hasVerifiedRate && <div><dt>Tasa {payment.rateSource === 'BCV' ? 'BCV' : 'validada'}</dt><dd>{payment.exchangeRate} Bs./USD{rateDate ? ` · ${rateDate}` : ''}</dd></div>}
        <div><dt>Saldo de la cuota</dt><dd>{payment.balanceAfter !== undefined ? money(payment.balanceAfter) : 'Consulta el estado de cuenta'}</dd></div>
      </dl>
      {receivedCurrency === 'USD' && !hasVerifiedRate && <p className="receipt-note">Equivalente en Bs. pendiente de una tasa BCV verificada.</p>}
      {payment.status === 'Revertido' && <p className="receipt-note receipt-reversed">Este pago fue revertido. No representa un saldo vigente.</p>}
      <p className="receipt-footnote">Este comprobante registra un pago dentro del sistema; no es una factura fiscal.</p>
    </article>
    <div className="modal-actions"><button className="button secondary" onClick={close}>Cerrar</button><button className="button secondary" onClick={() => printReceiptDocument(receiptPdfData(payment, clinicName, timezone))}>Imprimir</button><button className="button primary" onClick={() => downloadReceiptPdf(receiptPdfData(payment, clinicName, timezone))}><Download size={16} /> Descargar PDF</button></div>
  </Modal>
}
function Services({ notify, clinicId, services, setServices, canManage, onUse }: { notify: (text: string) => void; clinicId: string | null; services: ServiceItem[]; setServices: Dispatch<SetStateAction<ServiceItem[]>>; canManage: boolean; onUse: (service: ServiceItem) => void }) {
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [category, setCategory] = useState('General')
  const [description, setDescription] = useState('')
  const [price, setPrice] = useState('')
  const [editing, setEditing] = useState<ServiceItem | null>(null)
  const save = async (event: FormEvent) => {
    event.preventDefault()
    let priceCents: number
    try { priceCents = usdInputToCents(price) } catch { notify('Escribe un precio válido con hasta dos decimales.'); return }
    if (priceCents <= 0 || !name.trim() || description.trim().length > 500 || !canManage) return
    if (supabase && clinicId && editing) {
      try {
        const { error } = await supabase.from('services').update({ name: name.trim(), category: category.trim() || 'General', description: description.trim(), base_price_usd_cents: priceCents }).eq('clinic_id', clinicId).eq('id', String(editing.id))
        if (error) { notify('No se pudo actualizar el servicio. ' + error.message); return }
      } catch (cause) {
        notify(cause instanceof Error ? `No se pudo actualizar el servicio. ${cause.message}` : 'No se pudo actualizar el servicio.')
        return
      }
      setServices(list => list.map(service => service.id === editing.id ? { ...service, name: name.trim(), category: category.trim() || 'General', description: description.trim(), priceCents } : service))
    } else if (supabase && clinicId) {
      try {
        const { data, error } = await supabase.from('services').insert({ clinic_id: clinicId, name: name.trim(), category: category.trim() || 'General', description: description.trim(), base_price_usd_cents: priceCents }).select('id, name, category, description, base_price_usd_cents').single()
        if (error) { notify('No se pudo agregar el servicio. ' + error.message); return }
        setServices(list => [...list, { id: data.id, name: data.name, category: data.category, description: data.description ?? '', priceCents: data.base_price_usd_cents }])
      } catch (cause) {
        notify(cause instanceof Error ? `No se pudo agregar el servicio. ${cause.message}` : 'No se pudo agregar el servicio.')
        return
      }
    } else if (editing) setServices(list => list.map(service => service.id === editing.id ? { ...service, name: name.trim(), category: category.trim() || 'General', description: description.trim(), priceCents } : service))
    else setServices(list => [...list, { id: Date.now(), name: name.trim(), category: category.trim() || 'General', description: description.trim(), priceCents }])
    setName(''); setCategory('General'); setDescription(''); setPrice(''); setEditing(null); setShowForm(false); notify(editing ? 'Servicio actualizado; los planes existentes conservan sus valores' : cloudConfigured ? 'Servicio guardado' : 'Servicio agregado en la demostración local')
  }
  const edit = (service: ServiceItem) => { setEditing(service); setName(service.name); setCategory(service.category); setDescription(service.description ?? ''); setPrice((service.priceCents / 100).toFixed(2).replace('.', ',')); setShowForm(true) }
  const archive = async (service: ServiceItem) => {
    if (!canManage || !window.confirm(`¿Archivar “${service.name}”? Los planes existentes conservarán su descripción y precio.`)) return
    if (supabase && clinicId) {
      try {
        const { error } = await supabase.from('services').update({ active: false }).eq('clinic_id', clinicId).eq('id', String(service.id))
        if (error) { notify('No se pudo archivar el servicio. ' + error.message); return }
      } catch (cause) {
        notify(cause instanceof Error ? `No se pudo archivar el servicio. ${cause.message}` : 'No se pudo archivar el servicio.')
        return
      }
    }
    setServices(list => list.filter(item => item.id !== service.id)); notify('Servicio archivado; los planes existentes se conservaron')
  }
  const icons = [<Stethoscope size={18} />, <HeartPulse size={18} />, <Activity size={18} />, <SparkleIcon />, <BriefcaseMedical size={18} />, <CircleDollarSign size={18} />]
  return (
    <>
      <div className="section-intro">
        <div><span className="intro-icon"><Stethoscope size={20} /></span><div><b>Catálogo de servicios</b><p>Precios base en USD. Los planes guardados conservan sus valores acordados.</p></div></div>
        {canManage && <button className="button primary compact" onClick={() => { setEditing(null); setName(''); setCategory('General'); setDescription(''); setPrice(''); setShowForm(true) }}><Plus size={16} /> Nuevo servicio</button>}
      </div>
      <div className={services.length > 0 && services.length <= 2 ? 'services-layout services-layout--compact' : 'services-layout'}>
        <div className="service-grid">
          {services.map((service, index) => (
            <article className="service-card" key={service.id}>
              <div className={'service-icon service-tone-' + (index % 4)}>{icons[index % icons.length]}</div>
              {canManage && <div className="service-menu"><button className="row-menu" aria-label={'Editar ' + service.name} onClick={() => edit(service)}><MoreHorizontal size={18} /></button><button className="text-link" onClick={() => archive(service)}>Archivar</button></div>}
              <Badge>{service.category}</Badge>
              <h3>{service.name}</h3>
              {service.description && <p className="muted">{service.description}</p>}
              <div className="service-price">{money(service.priceCents / 100)} <small>USD</small></div>
              <button className="service-action" onClick={() => onUse(service)}>Usar en un plan <ArrowRight size={14} /></button>
            </article>
          ))}
        </div>
        {services.length > 0 && services.length <= 2 && <aside className="panel service-overview">
          <div className="service-overview-heading"><span className="service-overview-icon"><Check size={18} /></span><div><b>Catálogo listo para usar</b><p>Agrega un servicio a un plan en un solo paso.</p></div></div>
          <div className="service-overview-stat"><strong>{services.length}</strong><span>{services.length === 1 ? 'servicio activo' : 'servicios activos'}</span></div>
          <p className="service-overview-note">Si actualizas un precio, los planes existentes conservan el valor acordado con cada paciente.</p>
        </aside>}
      </div>
      {services.length === 0 && <div className="panel"><Empty title="Aún no hay servicios" body="Agrega los tratamientos que ofrece tu consultorio." /></div>}
      {showForm && <Modal title={editing ? 'Editar servicio' : 'Nuevo servicio'} subtitle={editing ? 'Los planes existentes mantienen una copia de lo acordado.' : 'Guarda un servicio y su precio base en USD.'} close={() => { setShowForm(false); setEditing(null) }}><form className="form" onSubmit={save}><Field label="Nombre del servicio"><input required autoFocus maxLength={140} value={name} onChange={event => setName(event.target.value)} placeholder="Ej. Limpieza dental" /></Field><Field label="Categoría"><input maxLength={80} value={category} onChange={event => setCategory(event.target.value)} placeholder="Ej. Preventivo" /></Field><Field label="Descripción (opcional)"><textarea maxLength={500} rows={3} value={description} onChange={event => setDescription(event.target.value)} placeholder="Detalle breve del servicio" /></Field><Field label="Precio base"><div className="amount-input"><span>$</span><input required inputMode="decimal" value={price} onChange={event => setPrice(event.target.value)} placeholder="0,00" /><b>USD</b></div></Field><div className="modal-actions"><button type="button" className="button secondary" onClick={() => { setShowForm(false); setEditing(null) }}>Cancelar</button><button className="button primary"><Check size={16} /> {editing ? 'Guardar cambios' : 'Guardar servicio'}</button></div></form></Modal>}
    </>
  )}
function SparkleIcon() { return <TrendingUp size={18} /> }
function Reports({ clinicName, totalDue, payments, plans, timezone, monthlyCollectedUsdCents, monthlyConfirmedPaymentCount }: { clinicName: string; totalDue: number; payments: Payment[]; plans: Plan[]; timezone: string; monthlyCollectedUsdCents: number | null; monthlyConfirmedPaymentCount: number | null }) {
  const monthly = cloudConfigured ? monthlyCollectedUsdCents === null ? null : monthlyCollectedUsdCents / 100 : 2485
  const reportMonth = new Intl.DateTimeFormat('es-VE', { month: 'long', timeZone: timezone }).format(new Date())
  const paymentCount = cloudConfigured ? monthlyConfirmedPaymentCount === null ? '—' : String(monthlyConfirmedPaymentCount) : String(payments.length)
  return <><div className="print-report-heading"><Logo /><div><b>{clinicName}</b><span>Reporte de cobranza · {new Intl.DateTimeFormat('es-VE', { dateStyle: 'long', timeZone: timezone }).format(new Date())}</span></div></div><div className="report-heading"><div><span className="report-icon"><TrendingUp size={20} /></span><div><b>Resumen de {reportMonth}</b><p>Una vista rápida del estado de las cuentas.</p></div></div><button className="button secondary compact" onClick={() => printDocument('report')}><Download size={15} /> Imprimir reporte</button></div><div className="stats-grid report-stats"><StatCard label="Ingresos del mes" value={money(monthly)} caption={cloudConfigured ? "Ingresos confirmados este mes" : "↑ 12% vs. septiembre"} icon={<ArrowDownRight size={19} />} tone="green" /><StatCard label="Saldo pendiente" value={money(totalDue)} caption="Distribuido en planes activos" icon={<Wallet size={19} />} tone="mint" /><StatCard label="Abonos recibidos" value={paymentCount} caption={cloudConfigured ? "Este mes" : "Movimientos de muestra"} icon={<CreditCard size={19} />} tone="lavender" /><StatCard label="Planes en seguimiento" value={String(plans.length)} caption="Con cuotas pendientes" icon={<ClipboardList size={19} />} tone="peach" /></div><div className={cloudConfigured ? 'content-grid report-content report-content--summary' : 'content-grid report-content'}>{!cloudConfigured && <section className="panel chart-panel"><div className="panel-head"><div><h2>Ingresos en el tiempo</h2><p>Comparativo de los últimos 6 meses</p></div><button className="select-lite">Últimos 6 meses <ChevronDown size={14} /></button></div><div className="chart"><div className="chart-y"><span>$3.000</span><span>$2.000</span><span>$1.000</span><span>$0</span></div><div className="chart-area"><div className="chart-grid"><i /><i /><i /><i /></div><svg viewBox="0 0 640 190" preserveAspectRatio="none"><defs><linearGradient id="chartFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#138568" stopOpacity=".25" /><stop offset="1" stopColor="#138568" stopOpacity="0" /></linearGradient></defs><path d="M0 145 C45 138 55 96 105 108 S165 123 210 92 S265 116 315 76 S375 105 420 83 S480 104 530 54 S595 70 640 25 L640 190 L0 190 Z" fill="url(#chartFill)" /><path d="M0 145 C45 138 55 96 105 108 S165 123 210 92 S265 116 315 76 S375 105 420 83 S480 104 530 54 S595 70 640 25" fill="none" stroke="#14876b" strokeWidth="3" strokeLinecap="round" /></svg><div className="chart-x"><span>May</span><span>Jun</span><span>Jul</span><span>Ago</span><span>Sep</span><span>Oct</span></div></div></div></section>}<section className="panel breakdown"><div className="panel-head"><div><h2>Estado de cobranza</h2><p>Planes de pago activos</p></div></div><div className="donut-wrap"><div className="donut"><strong>{plans.length}</strong><span>planes</span></div></div><div className="legend"><span><i className="dot green-dot" /> Al día <b>{plans.filter(p => p.status === 'Al día').length}</b></span><span><i className="dot amber-dot" /> Por vencer <b>{plans.filter(p => p.status === 'Por vencer').length}</b></span><span><i className="dot red-dot" /> Vencidos <b>{plans.filter(p => p.status === 'Vencido').length}</b></span></div></section></div></>
}
function SettingsPage({ notify, clinicId, clinicName, onClinicName, onOwnerName, onPhone, onWhatsappTemplate, onTimezone, canManage, timezone, onRateSaved }: { notify: (text: string) => void; clinicId: string | null; clinicName: string; onClinicName: (name: string) => void; onOwnerName: (name: string) => void; onPhone: (phone: string) => void; onWhatsappTemplate: (template: string) => void; onTimezone: (timezone: string) => void; canManage: boolean; timezone: string; onRateSaved: (rate: ExchangeRate | null) => void }) {
  const [section, setSection] = useState<'clinic' | 'team' | 'whatsapp'>('clinic')
  const [name, setName] = useState(clinicName)
  const [selectedTimezone, setSelectedTimezone] = useState(timezone)
  const [ownerName, setOwnerName] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [email, setEmail] = useState('')
  const [whatsappTemplate, setWhatsappTemplate] = useState(DEFAULT_WHATSAPP_MESSAGE_TEMPLATE)
  useEffect(() => {
    setName(clinicName)
    setSelectedTimezone(timezone)
    if (!supabase || !clinicId) {
      try {
        const saved = JSON.parse(localStorage.getItem('odontocuenta:clinic-profile') ?? '{}') as Record<string, string>
        setName(saved.name ?? clinicName); setSelectedTimezone(saved.timezone ?? timezone); setOwnerName(saved.ownerName ?? 'Dra. Daniela Ríos'); onOwnerName(saved.ownerName ?? 'Dra. Daniela Ríos'); setPhone(saved.phone ?? '+58 412 555 0140'); onPhone(saved.phone ?? '+58 412 555 0140'); setWhatsappTemplate(saved.whatsappMessageTemplate ?? DEFAULT_WHATSAPP_MESSAGE_TEMPLATE); onWhatsappTemplate(saved.whatsappMessageTemplate ?? DEFAULT_WHATSAPP_MESSAGE_TEMPLATE); setAddress(saved.address ?? 'Av. Principal, Centro Médico Los Olivos, Caracas'); setEmail(saved.email ?? 'contacto@clinica-sonrisa.com')
      } catch { setOwnerName('Dra. Daniela Ríos') }
      return
    }
    let alive = true
    void supabase.from('clinics').select('name, timezone, owner_display_name, contact_phone, contact_email, business_address, whatsapp_message_template').eq('id', clinicId).maybeSingle().then(({ data, error }) => {
      if (!alive) return
      if (error) { notify('No pudimos cargar la configuración del consultorio.'); return }
      if (data) { setName(data.name); setSelectedTimezone(data.timezone ?? timezone); setOwnerName(data.owner_display_name ?? ''); onOwnerName(data.owner_display_name ?? ''); setPhone(data.contact_phone ?? ''); onPhone(data.contact_phone ?? ''); setWhatsappTemplate(data.whatsapp_message_template ?? DEFAULT_WHATSAPP_MESSAGE_TEMPLATE); onWhatsappTemplate(data.whatsapp_message_template ?? DEFAULT_WHATSAPP_MESSAGE_TEMPLATE); setEmail(data.contact_email ?? ''); setAddress(data.business_address ?? '') }
    })
    return () => { alive = false }
  }, [clinicId, clinicName, timezone, onOwnerName, onPhone, onWhatsappTemplate])
  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!canManage) return
    if (supabase && clinicId) {
      try {
      const { error } = await supabase.from('clinics').update({ name: name.trim(), timezone: selectedTimezone, owner_display_name: ownerName.trim(), contact_phone: phone.trim() || null, contact_email: email.trim() || null, business_address: address.trim() || null }).eq('id', clinicId)
        if (error) { notify('No se pudieron guardar los datos. ' + error.message); return }
      } catch (cause) {
        notify(cause instanceof Error ? `No se pudieron confirmar los datos del consultorio. ${cause.message}` : 'No se pudieron confirmar los datos del consultorio.')
        return
      }
    } else {
      const saved = JSON.parse(localStorage.getItem('odontocuenta:clinic-profile') ?? '{}')
      localStorage.setItem('odontocuenta:clinic-profile', JSON.stringify({ ...saved, name: name.trim(), timezone: selectedTimezone, ownerName, phone, address, email }))
    }
    onClinicName(name.trim()); onOwnerName(ownerName.trim()); onPhone(phone.trim()); if (selectedTimezone !== timezone) onRateSaved(null); onTimezone(selectedTimezone); notify(cloudConfigured ? 'Datos del consultorio guardados' : 'Configuración guardada en este dispositivo')
  }
  const saveWhatsappTemplate = async (event: FormEvent) => {
    event.preventDefault()
    if (!canManage) return
    const template = whatsappTemplate.trim()
    if (!template) { notify('Escribe el mensaje que quieres usar.'); return }
    if (template.length > 1000) { notify('El mensaje no puede superar 1000 caracteres.'); return }
    if (supabase && clinicId) {
      try {
        const { error } = await supabase.from('clinics').update({ whatsapp_message_template: template }).eq('id', clinicId)
        if (error) { notify('No se pudo guardar el mensaje. ' + error.message); return }
      } catch (cause) {
        notify(cause instanceof Error ? `No se pudo guardar el mensaje. ${cause.message}` : 'No se pudo guardar el mensaje.')
        return
      }
    } else {
      const saved = JSON.parse(localStorage.getItem('odontocuenta:clinic-profile') ?? '{}')
      localStorage.setItem('odontocuenta:clinic-profile', JSON.stringify({ ...saved, whatsappMessageTemplate: template }))
    }
    onWhatsappTemplate(template)
    notify(cloudConfigured ? 'Mensaje de WhatsApp guardado' : 'Mensaje guardado en este dispositivo')
  }
  const whatsappPreview = renderWhatsAppMessage(whatsappTemplate, { nombre: 'Ana Pérez', clínica: name || 'Clínica Sonrisa', monto: '$45,00', fecha: '20 de octubre de 2026', tratamiento: 'Limpieza dental', teléfono: phone || 'este número' })
  if (section === 'team') return <div className="settings-layout"><aside className="settings-menu"><button onClick={() => setSection('clinic')}><Settings size={17} /> Datos del consultorio</button><button className="selected"><Users size={17} /> Equipo y permisos</button><button onClick={() => setSection('whatsapp')}><MessageCircle size={17} /> WhatsApp</button></aside><div className="settings-content"><TeamSettings clinicId={clinicId} canManage={canManage} notify={notify} /></div></div>
  if (section === 'whatsapp') return <div className="settings-layout"><aside className="settings-menu"><button onClick={() => setSection('clinic')}><Settings size={17} /> Datos del consultorio</button><button onClick={() => setSection('team')}><Users size={17} /> Equipo y permisos</button><button className="selected"><MessageCircle size={17} /> WhatsApp</button></aside><div className="settings-content"><section className="panel settings-panel"><div className="settings-title"><div><h2>Mensaje para WhatsApp</h2><p>Personaliza el texto que se abrirá al preparar un recordatorio manual.</p></div><span className="clinic-avatar large"><MessageCircle size={21} /></span></div><form className="settings-form" onSubmit={saveWhatsappTemplate}><Field label="Texto del mensaje"><textarea className="whatsapp-template-input" required maxLength={1000} readOnly={!canManage} value={whatsappTemplate} onChange={event => setWhatsappTemplate(event.target.value)} /></Field><div className="whatsapp-template-help"><b>Variables disponibles</b><span>{'{nombre}'} · {'{clínica}'} · {'{monto}'} · {'{fecha}'} · {'{tratamiento}'} · {'{teléfono}'}</span><small>Se reemplazan automáticamente con los datos del paciente, la clínica y la cuota.</small></div><div className="whatsapp-preview"><span>VISTA PREVIA</span><p>{whatsappPreview}</p></div><div className="form-note"><ShieldCheck size={16} /> Envía mensajes solo a personas que hayan autorizado recibir recordatorios. Si alguien pide dejar de recibirlos, desactiva su autorización en su ficha.</div><div className="settings-actions"><span><ShieldCheck size={15} /> Solo la persona propietaria puede editar este mensaje</span>{canManage && <button className="button primary"><Check size={16} /> Guardar mensaje</button>}</div></form></section></div></div>
  return <div className="settings-layout"><aside className="settings-menu"><button className="selected"><Settings size={17} /> Datos del consultorio</button><button onClick={() => setSection('team')}><Users size={17} /> Equipo y permisos</button><button onClick={() => setSection('whatsapp')}><MessageCircle size={17} /> WhatsApp</button></aside><div className="settings-content"><section className="panel settings-panel"><div className="settings-title"><div><h2>Datos del consultorio</h2><p>Esta información aparecerá en recibos y estados de cuenta.</p></div><span className="clinic-avatar large">OD</span></div><form className="settings-form" onSubmit={save}><Field label="Nombre del consultorio"><input required maxLength={120} readOnly={!canManage} value={name} onChange={e => setName(e.target.value)} /></Field><div className="two-fields"><Field label="Nombre de la odontóloga"><input maxLength={160} readOnly={!canManage} value={ownerName} onChange={e => setOwnerName(e.target.value)} /></Field><Field label="Teléfono de contacto"><input maxLength={40} readOnly={!canManage} value={phone} onChange={e => setPhone(e.target.value)} /></Field></div><Field label="Dirección"><input maxLength={300} readOnly={!canManage} value={address} onChange={e => setAddress(e.target.value)} /></Field><Field label="Correo electrónico"><input type="email" maxLength={254} readOnly={!canManage} value={email} onChange={e => setEmail(e.target.value)} /></Field><Field label="Zona horaria del consultorio"><select disabled={!canManage} value={selectedTimezone} onChange={e => setSelectedTimezone(e.target.value)}><option value="America/Caracas">Caracas (Venezuela)</option><option value="America/Guayaquil">Guayaquil (Ecuador)</option><option value="America/Bogota">Bogotá (Colombia)</option><option value="America/Panama">Ciudad de Panamá</option><option value="America/Santo_Domingo">Santo Domingo</option><option value="America/Mexico_City">Ciudad de México</option><option value="America/New_York">Nueva York</option><option value="Europe/Madrid">Madrid</option></select></Field><Field label="Moneda base de tus planes"><div className="disabled-select">USD — Dólar estadounidense <span>Los planes y saldos se llevan en USD</span></div></Field><div className="settings-actions"><span><ShieldCheck size={15} /> {canManage ? cloudConfigured ? 'Configuración protegida por el rol de propietaria' : 'Se guarda en este dispositivo de muestra' : 'Solo la persona propietaria puede editar esta información'}</span>{canManage && <button className="button primary"><Check size={16} /> Guardar cambios</button>}</div></form></section><RateSettings clinicId={clinicId} canManage={canManage} notify={notify} timezone={selectedTimezone} onRateSaved={onRateSaved} /><section className="notice-card"><span><ShieldCheck size={18} /></span><div><b>Privacidad de tus pacientes</b><p>OdontoCuenta guarda datos de contacto y cobros. La información clínica se mantiene fuera de esta plataforma.</p></div></section></div></div>
}

type ClinicMember = { user_id: string; email: string; role: 'owner' | 'assistant'; created_at: string; invitation_pending: boolean }

function TeamSettings({ clinicId, canManage, notify }: { clinicId: string | null; canManage: boolean; notify: (text: string) => void }) {
  const [members, setMembers] = useState<ClinicMember[]>([])
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const loadMembers = useCallback(async () => {
    if (!supabase || !clinicId || !canManage) { setLoading(false); return }
    const { data, error } = await supabase.rpc('list_clinic_members', { p_clinic_id: clinicId })
    if (error) { notify('No se pudo cargar el equipo. Revisa que las migraciones estén aplicadas.'); setLoading(false); return }
    setMembers((data ?? []) as ClinicMember[])
    setLoading(false)
  }, [clinicId, canManage, notify])

  useEffect(() => { void loadMembers() }, [loadMembers])

  const invite = async (event: FormEvent) => {
    event.preventDefault()
    if (!supabase || !clinicId || !canManage || saving) return
    setSaving(true)
    try {
      const { data, error } = await supabase.functions.invoke('invite-clinic-member', { body: { clinic_id: clinicId, email: email.trim() } })
      if (error) { notify(data?.error ?? error.message ?? 'No se pudo invitar a la persona.'); return }
      setEmail('')
      notify(data?.invitation_sent ? 'Invitación enviada por correo.' : 'La cuenta existente se agregó al equipo.')
      await loadMembers()
    } catch (cause) {
      notify(cause instanceof Error ? `No se pudo completar la invitación. ${cause.message}` : 'No se pudo completar la invitación.')
    } finally {
      setSaving(false)
    }
  }

  const revoke = async (member: ClinicMember) => {
    if (!supabase || !clinicId || !canManage || member.role !== 'assistant') return
    if (!window.confirm(`¿Quitar a ${member.email} del consultorio?`)) return
    try {
      const { error } = await supabase.rpc('revoke_clinic_member', { p_clinic_id: clinicId, p_user_id: member.user_id })
      if (error) { notify('No se pudo quitar el acceso. ' + error.message); return }
    } catch (cause) {
      notify(cause instanceof Error ? `No se pudo confirmar que se quitara el acceso. ${cause.message}` : 'No se pudo confirmar que se quitara el acceso.')
      return
    }
    setMembers(list => list.filter(item => item.user_id !== member.user_id))
    notify('Acceso del asistente revocado y auditado.')
  }

  if (!supabase || !clinicId) return <section className="panel settings-panel team-panel"><div className="settings-title"><div><h2>Equipo y permisos</h2><p>La gestión de asistentes necesita una clínica conectada.</p></div><span className="clinic-avatar large"><Users size={22} /></span></div><div className="empty-state">Inicia sesión en un consultorio conectado a Supabase para invitar o quitar asistentes.</div></section>

  return <section className="panel settings-panel team-panel"><div className="settings-title"><div><h2>Equipo y permisos</h2><p>Invita a una persona asistente para apoyar la cobranza.</p></div><span className="clinic-avatar large"><Users size={22} /></span></div>{!canManage ? <div className="empty-state">Solo la persona propietaria puede administrar el equipo.</div> : <><form className="team-invite" onSubmit={invite}><Field label="Correo de la asistente"><input type="email" required maxLength={254} autoComplete="email" placeholder="asistente@consultorio.com" value={email} onChange={event => setEmail(event.target.value)} /></Field><button className="button primary" disabled={saving}>{saving ? 'Enviando…' : <><Plus size={16} /> Invitar asistente</>}</button></form><p className="form-note"><ShieldCheck size={15} /> La asistente podrá consultar pacientes y registrar cobros; no podrá administrar el consultorio ni el equipo.</p>{loading ? <div className="empty-state">Cargando equipo…</div> : <div className="team-list">{members.map(member => <div className="team-member" key={member.user_id}><span className="team-member-avatar"><UserRound size={18} /></span><div className="team-member-copy"><b>{member.email || 'Cuenta sin correo visible'}</b><span>{member.role === 'owner' ? 'Propietaria' : 'Asistente'}{member.invitation_pending ? ' · Invitación pendiente' : ''}</span></div><span className="team-member-date">{member.role === 'owner' ? 'Administradora' : <button className="button subtle" onClick={() => void revoke(member)}>Quitar acceso</button>}</span></div>)}</div>}</>}</section>
}

function RateSettings({ clinicId, canManage, notify, timezone, onRateSaved }: { clinicId: string | null; canManage: boolean; notify: (text: string) => void; timezone: string; onRateSaved: (rate: ExchangeRate | null) => void }) {
  const today = dateKeyInTimezone(new Date(), timezone)
  const [rate, setRate] = useState('')
  const [asOf, setAsOf] = useState(today)
  const [reason, setReason] = useState('')
  const [latest, setLatest] = useState<{ rate: string; source: string; as_of: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const latestIsToday = latest ? dateKeyInTimezone(new Date(latest.as_of), timezone) === today : false
  useEffect(() => {
    if (!supabase || !clinicId) return
    let alive = true
    void supabase.from('exchange_rates_client').select('rate, source, as_of').eq('clinic_id', clinicId).order('as_of', { ascending: false }).order('validated_at', { ascending: false }).limit(1).maybeSingle().then(({ data, error }) => {
      if (!alive) return
      if (error) { notify('No pudimos cargar las tasas del consultorio.'); return }
      if (data) setLatest(data)
    })
    return () => { alive = false }
  }, [clinicId])
  const refreshBcv = async () => {
    if (!clinicId || !supabase) return
    setLoading(true)
    try {
      const { data, error } = await supabase.functions.invoke('bcv-rate', { body: { clinic_id: clinicId } })
      if (error || !data?.id || !data?.rate || !data?.as_of) {
        let detail = error?.message
        if (error && 'context' in error && error.context instanceof Response) {
          try {
            const body: unknown = await error.context.clone().json()
            if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') detail = body.error
          } catch {}
        }
        notify(detail ? `No se pudo verificar el BCV. ${detail}` : 'No se pudo validar la publicación oficial del BCV.')
        return
      }
      setLatest({ rate: String(data.rate), source: data.source, as_of: data.as_of })
      const effectiveDay = dateKeyInTimezone(new Date(data.as_of), timezone)
      const isRateEffective = effectiveDay <= today
      if (isRateEffective) onRateSaved({ id: data.id, rate: String(data.rate), source: data.source, asOf: data.as_of, validatedAt: data.validated_at })
      notify(isRateEffective
        ? effectiveDay === today
          ? 'Tasa BCV consultada a través de DolarVZLA y disponible para hoy.'
          : `Última tasa BCV vigente (${new Intl.DateTimeFormat('es-VE', { dateStyle: 'medium', timeZone: timezone }).format(new Date(data.as_of))}) guardada para los cobros de hoy.`
        : `DolarVZLA reporta una tasa BCV con vigencia ${new Intl.DateTimeFormat('es-VE', { dateStyle: 'medium', timeZone: timezone }).format(new Date(data.as_of))}; todavía no aplica hoy.`)
    } catch (cause) {
      notify(cause instanceof Error ? `No se pudo verificar el BCV. ${cause.message}` : 'No se pudo validar la publicación oficial del BCV.')
    } finally {
      setLoading(false)
    }
  }
  const save = async (event: FormEvent) => {
    event.preventDefault()
    const normalized = rate.trim().replace(',', '.')
    if (!clinicId || !supabase || !canManage || !/^\d{1,12}(\.\d{1,10})?$/.test(normalized) || Number(normalized) <= 0 || reason.trim().length < 5) {
      notify('Revisa la tasa y escribe un motivo de al menos 5 caracteres.'); return
    }
    setLoading(true)
    try {
      const effectiveAt = new Date(`${asOf}T12:00:00Z`).toISOString()
      const { data: rateId, error } = await supabase.rpc('record_manual_exchange_rate', { p_clinic_id: clinicId, p_rate: normalized, p_as_of: effectiveAt, p_reason: reason.trim() })
      if (error) { notify('No se pudo registrar la tasa. ' + error.message); return }
      setLatest({ rate: normalized, source: 'manual_owner', as_of: effectiveAt })
      if (typeof rateId === 'string' && dateKeyInTimezone(new Date(effectiveAt), timezone) === today) {
        onRateSaved({ id: rateId, rate: normalized, source: 'manual_owner', asOf: effectiveAt, validatedAt: new Date().toISOString() })
      }
      setRate(''); setReason(''); notify('Tasa manual registrada y auditada')
    } catch (cause) {
      notify(cause instanceof Error ? `No se pudo confirmar la tasa. ${cause.message}` : 'No se pudo confirmar la tasa.')
    } finally {
      setLoading(false)
    }
  }
  return <section className="panel settings-panel"><div className="settings-title"><div><h2>Tasa para equivalentes</h2><p>Consulta la publicación oficial del BCV. La carga manual queda auditada para la persona propietaria.</p></div><span className="badge neutral">Bs. / USD</span></div>{clinicId && supabase && <button className="button secondary compact" onClick={refreshBcv} disabled={loading}><TrendingUp size={15} /> {loading ? 'Consultando BCV…' : 'Actualizar desde BCV'}</button>}{latest ? <p className="form-note"><ShieldCheck size={16} /> {latestIsToday ? 'Tasa válida para pagos de hoy:' : 'La última tasa registrada no se usa automáticamente hoy:'} {latest.rate.replace('.', ',')} · {latest.source === 'BCV' ? 'BCV' : 'Validada por owner'} · {new Intl.DateTimeFormat('es-VE', { dateStyle: 'medium' }).format(new Date(latest.as_of))}</p> : <p className="muted">Todavía no hay una tasa validada. Sin ella, los equivalentes en Bs. quedan pendientes.</p>}{canManage && clinicId && supabase ? <form className="settings-form" onSubmit={save}><div className="two-fields"><Field label="Tasa (Bs. por USD)"><input required inputMode="decimal" placeholder="Ej. 36,5000000000" value={rate} onChange={e => setRate(e.target.value)} /></Field><Field label="Fecha de vigencia"><input required type="date" value={asOf} onChange={e => setAsOf(e.target.value)} /></Field></div><Field label="Motivo de validación manual"><input required minLength={5} maxLength={500} placeholder="Ej. Verificada con publicación BCV" value={reason} onChange={e => setReason(e.target.value)} /></Field><div className="settings-actions"><span>Solo la propietaria puede validar una tasa manual</span><button className="button primary" disabled={loading}><Check size={16} /> {loading ? 'Guardando…' : 'Registrar tasa'}</button></div></form> : <p className="form-note">La captura de tasa manual está disponible con sesión cloud y rol de propietaria.</p>}</section>
}
const auditActionLabels: Record<string, string> = {
  'patient.created': 'Paciente agregado', 'patient.updated': 'Datos de paciente actualizados', 'patient.archived': 'Paciente archivado',
  'service.created': 'Servicio agregado', 'service.updated': 'Servicio actualizado', 'service.archived': 'Servicio archivado', 'service.activated': 'Servicio reactivado',
  'clinic.updated': 'Datos del consultorio actualizados',
  'plan.created': 'Plan creado', 'payment.recorded': 'Pago registrado', 'payment.reversed': 'Pago revertido', 'exchange_rate.manual_recorded': 'Tasa manual registrada',
  'exchange_rate.bcv_imported': 'Tasa BCV importada',
}
function AuditLauncher({ clinicId }: { clinicId: string | null }) {
  const [open, setOpen] = useState(false)
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!open || !supabase || !clinicId) { setEvents([]); setLoading(false); setError(''); return }
    let alive = true
    setLoading(true); setError('')
    void supabase.from('audit_events').select('id, actor_id, action, entity_type, entity_id, details, created_at').eq('clinic_id', clinicId).order('created_at', { ascending: false }).limit(50).then(({ data, error: queryError }) => {
      if (!alive) return
      setLoading(false)
      if (queryError) { setError('No se pudo cargar el historial. Revisa que las migraciones estén aplicadas.'); return }
      setEvents((data ?? []) as AuditEvent[])
    })
    return () => { alive = false }
  }, [open, clinicId])
  return <>{!open && <button className="button secondary compact audit-launcher" onClick={() => setOpen(true)}><FileText size={15} /> Historial de cambios</button>}{open && <Modal title="Historial de cambios" subtitle="Eventos recientes registrados en este consultorio." close={() => setOpen(false)}><AuditHistory events={events} loading={loading} error={error} enabled={Boolean(supabase && clinicId)} /></Modal>}</>
}
function AuditHistory({ events, loading, error, enabled }: { events: AuditEvent[]; loading: boolean; error: string; enabled: boolean }) {
  return <section className="panel audit-panel"><div className="panel-head"><div><h2>Historial de cambios</h2><p>Últimos 50 eventos registrados en este consultorio.</p></div><span className="audit-count">{loading ? 'Cargando…' : `${events.length} eventos`}</span></div>{error && <p className="audit-error">{error}</p>}{!enabled && <Empty title="Historial disponible en Cloud" body="Conecta este consultorio a Supabase para consultar sus eventos auditados." />}{enabled && !loading && !error && events.length === 0 && <Empty title="Todavía no hay cambios registrados" body="Los cambios importantes aparecerán aquí." />}{enabled && events.length > 0 && <div className="audit-list">{events.map(event => { const changed = event.details?.changed_fields; const reason = event.details?.reason; const summary = Array.isArray(changed) && changed.length ? `Campos: ${changed.map(String).join(', ')}` : typeof reason === 'string' ? `Motivo: ${reason}` : event.entity_id ? `Registro · ${event.entity_id.slice(0, 8)}` : 'Evento del consultorio'; return <article className="audit-event" key={event.id}><span className="audit-event-mark"><ShieldCheck size={16} /></span><div className="audit-event-content"><b>{auditActionLabels[event.action] ?? event.action}</b><p>{summary}</p><small>Usuario {event.actor_id.slice(0, 8)} · {new Intl.DateTimeFormat('es-VE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(event.created_at))}</small></div></article> })}</div>}</section>
}
function Empty({ title, body }: { title: string; body: string }) { return <div className="empty-state"><span><Search size={20} /></span><b>{title}</b><p>{body}</p></div> }
