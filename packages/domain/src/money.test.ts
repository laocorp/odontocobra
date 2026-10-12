import { describe, expect, it } from 'vitest'
import {
  cents,
  convertLocalMinorToUsdCents,
  convertUsdCentsToLocalMinor,
  localInputToMinor,
  splitInstallments,
  usdInputToCents,
} from './money'

describe('splitInstallments', () => {
  it('puts every rounding remainder cent in the last installment', () => {
    const installments = splitInstallments(cents(10_000), 3)

    expect(installments.map((item) => item.amountCents)).toEqual([3_333, 3_333, 3_334])
    expect(installments.reduce((sum, item) => sum + item.amountCents, 0)).toBe(10_000)
  })

  it('keeps an even split even and numbers installments from one', () => {
    const installments = splitInstallments(cents(9_999), 3)

    expect(installments).toEqual([
      { sequence: 1, amountCents: 3_333 },
      { sequence: 2, amountCents: 3_333 },
      { sequence: 3, amountCents: 3_333 },
    ])
  })

  it('rejects impossible installment counts and totals', () => {
    type UsdCents = Parameters<typeof splitInstallments>[0]

    expect(() => splitInstallments(cents(100), 0)).toThrow(RangeError)
    expect(() => splitInstallments(cents(100), 121)).toThrow(RangeError)
    expect(() => splitInstallments(cents(2), 3)).toThrow(RangeError)
    expect(() => splitInstallments(-1 as UsdCents, 1)).toThrow(RangeError)
    expect(() => splitInstallments(1.5 as UsdCents, 1)).toThrow(RangeError)
    expect(() => splitInstallments((Number.MAX_SAFE_INTEGER + 1) as UsdCents, 1)).toThrow(RangeError)
  })
})

describe('money input parsing', () => {
  it('accepts comma decimals without using floating-point arithmetic', () => {
    expect(usdInputToCents('123,45')).toBe(12_345)
    expect(localInputToMinor('1234,56', 2)).toBe(123_456)
  })

  it('rejects extra precision, signs, and invalid local precision', () => {
    expect(() => usdInputToCents('1,001')).toThrow(RangeError)
    expect(() => usdInputToCents('-1,00')).toThrow(RangeError)
    expect(() => localInputToMinor('1,234', 2)).toThrow(RangeError)
    expect(() => localInputToMinor('1', 5)).toThrow(RangeError)
  })
})

describe('USD and local-currency conversions', () => {
  it('converts with exact decimal arithmetic and half-up local rounding', () => {
    const localMinor = convertUsdCentsToLocalMinor(cents(12_345), '36.5', 2)

    expect(localMinor).toBe(450_593)
    expect(convertLocalMinorToUsdCents(localMinor, '36.5', 2)).toBe(12_345)
  })

  it('rounds half a USD cent upward and rejects invalid rates', () => {
    expect(convertLocalMinorToUsdCents(1, '200', 0)).toBe(1)
    expect(() => convertUsdCentsToLocalMinor(cents(100), '0', 2)).toThrow(RangeError)
    expect(() => convertLocalMinorToUsdCents(1, '-2', 2)).toThrow(RangeError)
  })

  it('rejects invalid USD cent values before conversion', () => {
    type UsdCents = Parameters<typeof convertUsdCentsToLocalMinor>[0]

    expect(() => convertUsdCentsToLocalMinor(-1 as UsdCents, '36.5', 2)).toThrow(RangeError)
    expect(() => convertUsdCentsToLocalMinor(1.5 as UsdCents, '36.5', 2)).toThrow(RangeError)
    expect(() => convertUsdCentsToLocalMinor((Number.MAX_SAFE_INTEGER + 1) as UsdCents, '36.5', 2)).toThrow(RangeError)
    expect(convertUsdCentsToLocalMinor(cents(0), '36.5', 2)).toBe(0)
  })
})
