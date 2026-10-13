import type { PatientPortalAccount } from './portal-types'

export function formatPortalUsd(cents: number) {
  return new Intl.NumberFormat('es-VE', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100)
}

export function formatPortalDate(value: string | null | undefined) {
  if (!value) return 'Sin fecha'
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return 'Sin fecha'
  return new Intl.DateTimeFormat('es-VE', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    // A due date is a calendar date, not an instant; format in UTC to avoid
    // shifting it according to the patient's device timezone.
    timeZone: 'UTC',
  }).format(date)
}

export function portalDateInTimezone(value: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

export function formatPortalDateTime(value: string | null | undefined, timezone?: string) {
  if (!value) return 'Sin fecha'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Sin fecha'
  return new Intl.DateTimeFormat('es-VE', {
    dateStyle: 'medium',
    timeStyle: 'short',
    ...(timezone ? { timeZone: timezone } : {}),
  }).format(date)
}

export function formatPortalPaymentAmount(payment: PatientPortalAccount['payments'][number], account: PatientPortalAccount) {
  if (payment.received_currency !== 'VES' || payment.received_local_minor == null) {
    return `${formatPortalUsd(payment.amount_usd_cents)} USD`
  }
  const precision = Math.max(0, Math.min(4, account.clinic.local_precision || 2))
  const amount = payment.received_local_minor / (10 ** precision)
  try {
    return new Intl.NumberFormat('es-VE', {
      style: 'currency',
      currency: account.clinic.local_currency || 'VES',
      minimumFractionDigits: precision,
      maximumFractionDigits: precision,
    }).format(amount)
  } catch {
    return `${amount.toFixed(precision)} ${account.clinic.local_currency || 'VES'}`
  }
}

export function portalStatusLabel(value: string) {
  const normalized = value.toLowerCase()
  if (normalized.includes('overdue') || normalized.includes('vencid')) return 'Vencida'
  if (normalized.includes('upcoming') || normalized.includes('due_soon') || normalized.includes('por vencer')) return 'Por vencer'
  if (normalized.includes('revers') || normalized.includes('void')) return 'Revertido'
  if (normalized.includes('confirm')) return 'Confirmado'
  if (normalized.includes('paid') || normalized.includes('al día') || normalized.includes('aldia')) return 'Pagada'
  if (normalized.includes('partial') || normalized.includes('parcial')) return 'Abonada'
  if (normalized.includes('due') || normalized.includes('pendiente') || normalized.includes('open') || normalized.includes('scheduled')) return 'Pendiente'
  if (normalized.includes('active') || normalized.includes('activo')) return 'Activo'
  if (normalized.includes('cancel')) return 'Cancelado'
  return value || 'En curso'
}

export function portalStatusTone(value: string): 'paid' | 'overdue' | 'neutral' {
  const label = portalStatusLabel(value)
  if (label === 'Vencida') return 'overdue'
  if (label === 'Pagada') return 'paid'
  return 'neutral'
}
