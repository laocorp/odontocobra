import { describe, expect, it } from 'vitest'
import { formatPortalDate, formatPortalPaymentAmount, formatPortalUsd, portalDateInTimezone, portalStatusLabel, portalStatusTone } from './portal-format'
import type { PatientPortalAccount } from './portal-types'

const account: PatientPortalAccount = {
  clinic: { name: 'Clínica de prueba', timezone: 'America/Caracas', local_currency: 'VES', local_precision: 2 },
  patient: { full_name: 'Paciente Ejemplo', email: 'paciente@example.test', phone: null },
  summary: { active_plan_count: 1, total_agreed_usd_cents: 10000, paid_usd_cents: 3333, balance_usd_cents: 6667 },
  plans: [],
  payments: [],
}

describe('patient portal formatters', () => {
  it('formats money from integer cents', () => {
    expect(formatPortalUsd(3333)).toContain('33,33')
  })

  it('formats a date-only due date without shifting it across device timezones', () => {
    expect(formatPortalDate('2026-10-12')).toBe('12 oct. 2026')
    expect(formatPortalDate(portalDateInTimezone(new Date('2026-10-12T06:00:00Z'), 'Pacific/Kiritimati'))).toBe('12 oct. 2026')
    expect(formatPortalDate(portalDateInTimezone(new Date('2026-10-12T23:00:00Z'), 'America/Los_Angeles'))).toBe('12 oct. 2026')
    expect(formatPortalDate(portalDateInTimezone(new Date('2026-10-12T23:00:00Z'), 'Pacific/Kiritimati'))).toBe('13 oct. 2026')
  })

  it('shows received VES amount using clinic minor-unit precision', () => {
    const payment = { id: 'p1', receipt_number: 1, received_at: '2026-10-12T12:00:00Z', amount_usd_cents: 3333, received_currency: 'VES', received_local_minor: 123456, exchange_rate: 37, method: 'cash', status: 'confirmed', receipt_snapshot: null }
    expect(formatPortalPaymentAmount(payment, account)).toContain('1.234,56')
  })

  it('maps financial statuses to readable labels and tones', () => {
    expect(portalStatusLabel('overdue')).toBe('Vencida')
    expect(portalStatusTone('overdue')).toBe('overdue')
    expect(portalStatusLabel('paid')).toBe('Pagada')
    expect(portalStatusTone('paid')).toBe('paid')
  })
})
