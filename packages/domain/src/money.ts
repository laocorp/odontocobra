import Decimal from 'decimal.js'

export type MoneyCents = number & { readonly __brand: 'MoneyCents' }
export interface InstallmentAmount { sequence: number; amountCents: MoneyCents }

export function cents(value: number): MoneyCents {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('El monto debe ser un entero de centavos no negativo.')
  return value as MoneyCents
}

/** Adds explicit installment allocations using integer USD cents only. */
export function sumPaymentAllocationCents(allocationCents: readonly number[]): number {
  return allocationCents.reduce((sum, amount) => {
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new RangeError('Cada asignación debe ser un monto positivo en centavos.')
    if (sum > Number.MAX_SAFE_INTEGER - amount) throw new RangeError('La suma de las asignaciones supera el rango permitido.')
    return sum + amount
  }, 0)
}

/** Ensures a received payment is fully assigned across one or more installments. */
export function validatePaymentAllocationTotal(paymentAmountCents: number, allocationCents: readonly number[]): void {
  cents(paymentAmountCents)
  if (paymentAmountCents <= 0) throw new RangeError('El monto del pago debe ser positivo.')
  if (allocationCents.length === 0) throw new RangeError('Asigna el pago a una o más cuotas.')
  const allocated = sumPaymentAllocationCents(allocationCents)
  if (allocated !== paymentAmountCents) throw new RangeError('La suma asignada debe coincidir exactamente con el pago.')
}

/** Parses a user-entered USD amount without passing through binary floating point. */
export function usdInputToCents(input: string): MoneyCents {
  const normalized = input.trim().replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) throw new RangeError('Escribe un monto con hasta dos decimales.')
  const decimal = new Decimal(normalized).mul(100)
  if (!decimal.isInteger() || !Number.isSafeInteger(decimal.toNumber())) throw new RangeError('El monto supera el rango permitido.')
  return cents(decimal.toNumber())
}

/** Parses a local-currency amount into integer minor units at the clinic's configured precision. */
export function localInputToMinor(input: string, localPrecision: number): number {
  if (!Number.isInteger(localPrecision) || localPrecision < 0 || localPrecision > 4) throw new RangeError('Precisión de moneda inválida.')
  const normalized = input.trim().replace(',', '.')
  const pattern = localPrecision === 0 ? /^\d+$/ : new RegExp(`^\\d+(?:\\.\\d{1,${localPrecision}})?$`)
  if (!pattern.test(normalized)) throw new RangeError(`Escribe un monto con hasta ${localPrecision} decimales.`)
  const minor = new Decimal(normalized).mul(new Decimal(10).pow(localPrecision))
  const value = minor.toNumber()
  if (!minor.isInteger() || !Number.isSafeInteger(value)) throw new RangeError('El monto supera el rango permitido.')
  return value
}

/** Divides a USD total in integer cents. The final installment absorbs every remainder cent. */
export function splitInstallments(totalCents: MoneyCents, count: number): InstallmentAmount[] {
  cents(totalCents)
  if (!Number.isInteger(count) || count < 1 || count > 120) throw new RangeError('La cantidad de cuotas debe estar entre 1 y 120.')
  if (totalCents < count) throw new RangeError('Cada cuota debe ser de al menos un centavo.')
  const base = Math.floor(totalCents / count)
  const remainder = totalCents - base * count
  return Array.from({ length: count }, (_, index) => ({
    sequence: index + 1,
    amountCents: cents(index === count - 1 ? base + remainder : base),
  }))
}

/** Converts USD minor units using an exact decimal rate, rounding the local amount once. */
export function convertUsdCentsToLocalMinor(usdCents: MoneyCents, rate: string, localPrecision: number): number {
  cents(usdCents)
  const parsedRate = new Decimal(rate)
  if (!parsedRate.isFinite() || parsedRate.lte(0)) throw new RangeError('La tasa debe ser un decimal positivo.')
  if (!Number.isInteger(localPrecision) || localPrecision < 0 || localPrecision > 4) throw new RangeError('Precisión de moneda inválida.')
  const result = new Decimal(usdCents).div(100).mul(parsedRate).mul(new Decimal(10).pow(localPrecision)).toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
  const converted = result.toNumber()
  if (!result.isInteger() || !Number.isSafeInteger(converted)) throw new RangeError('El monto convertido supera el rango permitido.')
  return converted
}

/** Converts received local minor units to USD cents with exact decimal arithmetic and half-up cent rounding. */
export function convertLocalMinorToUsdCents(localMinor: number, rate: string, localPrecision: number): MoneyCents {
  if (!Number.isSafeInteger(localMinor) || localMinor <= 0) throw new RangeError('El monto local debe ser un entero positivo de unidades menores.')
  const parsedRate = new Decimal(rate)
  if (!parsedRate.isFinite() || parsedRate.lte(0)) throw new RangeError('La tasa debe ser un decimal positivo.')
  if (!Number.isInteger(localPrecision) || localPrecision < 0 || localPrecision > 4) throw new RangeError('Precisión de moneda inválida.')
  const result = new Decimal(localMinor).div(new Decimal(10).pow(localPrecision)).div(parsedRate).mul(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
  const converted = result.toNumber()
  if (!result.isInteger() || !Number.isSafeInteger(converted) || converted <= 0) throw new RangeError('El monto convertido supera el rango permitido.')
  return cents(converted)
}

export function formatUsd(amountCents: MoneyCents): string {
  return new Intl.NumberFormat('es-VE', { style: 'currency', currency: 'USD' }).format(amountCents / 100)
}
