export type PatientPortalAccount = {
  clinic: {
    name: string
    timezone: string
    local_currency: string
    local_precision: number
  }
  patient: {
    full_name: string
    email: string
    phone: string | null
  }
  summary: {
    active_plan_count: number
    total_agreed_usd_cents: number
    paid_usd_cents: number
    balance_usd_cents: number
  }
  plans: Array<{
    id: string
    plan_code?: string
    description: string
    status: string
    starts_on: string | null
    total_usd_cents: number
    paid_usd_cents: number
    balance_usd_cents: number
    installments: Array<{
      id: string
      sequence: number
      due_on: string
      amount_usd_cents: number
      paid_usd_cents: number
      balance_usd_cents: number
      status: string
    }>
  }>
  payments: Array<{
    id: string
    receipt_number: number | null
    received_at: string
    amount_usd_cents: number
    received_currency: string
    received_local_minor: number | null
    exchange_rate: number | string | null
    method: string
    status: string
    receipt_snapshot: Record<string, unknown> | null
  }>
}

export type PatientPortalAccessStatus = 'not_invited' | 'invited' | 'active' | 'revoked'
