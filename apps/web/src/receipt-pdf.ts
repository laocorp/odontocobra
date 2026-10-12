export type ReceiptPdfData = {
  clinicName: string
  receiptNumber: string
  patientName: string
  date: string
  plan: string
  method: string
  receivedAmount: string
  usdEquivalent: string
  vesEquivalent?: string
  rate?: string
  remaining: string
  status: string
}

export type StatementPdfData = {
  clinicName: string
  patientName: string
  patientId: string
  phone: string
  cutoff: string
  totalAgreed: string
  paid: string
  balance: string
  plans: string[]
  installments: string[]
  payments: Array<{ date: string; receipt: string; method: string; received: string; equivalent: string; rate: string; status: string }>
}

const winAnsi: Record<string, number> = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87,
  'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e,
  '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96,
  '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c,
  'ž': 0x9e, 'Ÿ': 0x9f,
}

function pdfLiteral(value: string) {
  return [...value].map(character => {
    const code = character.codePointAt(0) ?? 63
    const byte = code <= 0xff ? code : winAnsi[character] ?? 63
    if (byte === 40 || byte === 41 || byte === 92) return `\\${String.fromCharCode(byte)}`
    if (byte < 32 || byte > 126) return `\\${byte.toString(8).padStart(3, '0')}`
    return String.fromCharCode(byte)
  }).join('')
}

function buildDocument(data: ReceiptPdfData) {
  const lines: string[] = []
  const text = (x: number, y: number, size: number, value: string, bold = false) => {
    lines.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x} ${y} Td (${pdfLiteral(value)}) Tj ET`)
  }
  const rect = (x: number, y: number, width: number, height: number, color: string) => {
    lines.push(`${color} rg ${x} ${y} ${width} ${height} re f`)
  }
  const fit = (value: string, max: number) => value.length > max ? `${value.slice(0, max - 3).trimEnd()}...` : value
  const rule = (y: number) => lines.push(`0.89 0.86 0.79 RG 48 ${y} m 547 ${y} l S`)

  rect(0, 0, 595, 842, '0.97 0.985 0.975')
  rect(0, 620, 595, 222, '0.25 0.23 0.20')
  rect(48, 772, 30, 30, '0.53 0.41 0.19')
  lines.push('1 1 1 rg')
  text(56, 781, 13, 'O', true)
  text(90, 785, 19, fit(data.clinicName, 30), true)
  lines.push('0.82 0.72 0.50 rg')
  text(48, 748, 9, 'COMPROBANTE DE PAGO', true)
  lines.push('1 1 1 rg')
  text(48, 714, 18, `Recibo N. ${fit(data.receiptNumber, 22)}`, true)
  lines.push('0.90 0.85 0.70 rg')
  text(48, 690, 9, fit(data.status, 58))
  lines.push('0.71 0.91 0.81 rg')
  text(350, 747, 9, 'MONTO RECIBIDO', true)
  lines.push('1 1 1 rg')
  text(350, 713, 19, fit(data.receivedAmount, 20), true)
  rect(36, 500, 523, 78, '1 1 1')
  lines.push('0.22 0.49 0.40 rg')
  text(54, 551, 8, 'PACIENTE', true)
  lines.push('0.08 0.23 0.20 rg')
  text(54, 528, 14, fit(data.patientName, 42), true)
  lines.push('0.22 0.49 0.40 rg')
  text(354, 551, 8, 'FECHA', true)
  lines.push('0.08 0.23 0.20 rg')
  text(354, 528, 10, fit(data.date, 30), true)
  rect(36, 420, 523, 58, '0.96 0.93 0.86')
  lines.push('0.22 0.49 0.40 rg')
  text(54, 455, 8, 'PAGO REGISTRADO', true)
  lines.push('0.06 0.42 0.30 rg')
  text(54, 434, 11, fit(data.usdEquivalent, 42), true)
  text(48, 392, 9, 'DETALLE DEL PAGO', true)
  lines.push('0.08 0.23 0.20 rg')
  rule(579)

  const fields: Array<[string, string]> = [
    ['Plan / cuota', data.plan],
    ['Método de pago', data.method],
    ['Equivalente en USD', data.usdEquivalent],
  ]
  if (data.vesEquivalent) fields.push(['Equivalente en Bs.', data.vesEquivalent])
  if (data.rate) fields.push(['Tasa BCV / estado', data.rate])
  fields.push(['Saldo restante de la cuota', data.remaining])
  let y = 362
  for (const [label, value] of fields) {
    lines.push('0.34 0.42 0.39 rg')
    text(48, y, 9, label)
    lines.push('0.08 0.23 0.20 rg')
    text(300, y, 9, fit(value, 43), true)
    y -= 32
    rule(y + 13)
  }

  text(48, Math.max(140, y - 20), 9, 'Comprobante de pago dentro de OdontoCuenta; no es una factura fiscal.')
  text(48, 92, 9, 'OdontoCuenta · Cobros claros, sonrisas tranquilas')

  // Redraw with a print-first composition so the receipt is clear on paper and mobile.
  rect(0, 0, 595, 842, '1 1 1')
  rect(0, 832, 595, 10, '0.53 0.41 0.19')
  rect(48, 777, 30, 30, '0.53 0.41 0.19')
  lines.push('1 1 1 rg')
  text(57, 787, 12, 'O', true)
  lines.push('0.31 0.29 0.26 rg')
  text(90, 786, 18, fit(data.clinicName, 30), true)
  lines.push('0.40 0.49 0.45 rg')
  text(400, 786, 9, 'RECIBO N. ' + fit(data.receiptNumber, 18))
  rule(758)
  lines.push('0.53 0.41 0.19 rg')
  text(48, 718, 23, 'Recibo de pago', true)
  lines.push('0.35 0.43 0.39 rg')
  text(48, 695, 10, fit(data.status, 62))
  rect(48, 594, 499, 68, '0.96 0.98 0.97')
  lines.push('0.06 0.42 0.30 rg')
  text(65, 638, 8, 'PACIENTE', true)
  lines.push('0.08 0.23 0.20 rg')
  text(65, 614, 13, fit(data.patientName, 39), true)
  lines.push('0.06 0.42 0.30 rg')
  text(355, 638, 8, 'FECHA', true)
  lines.push('0.08 0.23 0.20 rg')
  text(355, 614, 10, fit(data.date, 29), true)
  rect(48, 494, 499, 76, '0.90 0.97 0.93')
  lines.push('0.20 0.43 0.36 rg')
  text(65, 544, 8, 'MONTO RECIBIDO', true)
  lines.push('0.37 0.29 0.15 rg')
  text(65, 514, 21, fit(data.receivedAmount, 21), true)
  lines.push('0.20 0.43 0.36 rg')
  text(355, 544, 8, 'EQUIVALENTE EN USD', true)
  lines.push('0.04 0.34 0.25 rg')
  text(355, 516, 11, fit(data.usdEquivalent, 25), true)
  lines.push('0.06 0.42 0.30 rg')
  text(48, 462, 10, 'DETALLE DEL PAGO', true)
  let receiptY = 432
  for (const [label, value] of fields) {
    lines.push('0.38 0.45 0.42 rg')
    text(55, receiptY, 9, label)
    lines.push('0.08 0.23 0.20 rg')
    text(285, receiptY, 10, fit(value, 43), true)
    rule(receiptY - 13)
    receiptY -= 31
  }
  rect(48, 103, 499, 52, '0.96 0.98 0.97')
  lines.push('0.06 0.42 0.30 rg')
  text(64, 134, 8, 'INFORMACIÓN', true)
  lines.push('0.35 0.43 0.39 rg')
  text(64, 116, 8, 'Constancia de pago de OdontoCuenta; no es una factura fiscal.')
  text(48, 77, 8, 'OdontoCuenta  |  Cobros claros, sonrisas tranquilas')
  const stream = `${lines.join('\n')
    .replaceAll('0.06 0.42 0.30', '0.53 0.41 0.19')
    .replaceAll('0.06 0.32 0.25', '0.25 0.23 0.20')
    .replaceAll('0.12 0.48 0.37', '0.53 0.41 0.19')
    .replaceAll('0.08 0.23 0.20', '0.31 0.29 0.26')
    .replaceAll('0.20 0.43 0.36', '0.42 0.34 0.20')
    .replaceAll('0.04 0.34 0.25', '0.37 0.29 0.15')
    .replaceAll('0.38 0.45 0.42', '0.42 0.39 0.33')
    .replaceAll('0.40 0.49 0.45', '0.43 0.40 0.35')
    .replaceAll('0.96 0.98 0.97', '0.99 0.98 0.95')
    .replaceAll('0.90 0.97 0.93', '0.96 0.93 0.86')
    .replaceAll('0.88 0.96 0.91', '0.96 0.93 0.86')}\n`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    `<< /Length ${new TextEncoder().encode(stream).length} >>\nstream\n${stream}endstream`,
  ]
  let document = '%PDF-1.4\n'
  const offsets = [0]
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(new TextEncoder().encode(document).length)
    document += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`
  }
  const xrefOffset = new TextEncoder().encode(document).length
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets.slice(1)) document += `${String(offset).padStart(10, '0')} 00000 n \n`
  document += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`
  return new Blob([new TextEncoder().encode(document)], { type: 'application/pdf' })
}

function serializePages(streams: string[]) {
  const count = streams.length
  const fontRegularId = 3 + count
  const fontBoldId = fontRegularId + 1
  const streamStartId = fontBoldId + 1
  const pageIds = streams.map((_, index) => 3 + index)
  const objects = [
    `<< /Type /Catalog /Pages 2 0 R >>`,
    `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${count} >>`,
    ...streams.map((stream, index) => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >> >> /Contents ${streamStartId + index} 0 R >>`),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    ...streams.map(stream => `<< /Length ${new TextEncoder().encode(stream).length} >>\nstream\n${stream}endstream`),
  ]
  let document = '%PDF-1.4\n'
  const offsets: number[] = [0]
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(new TextEncoder().encode(document).length)
    document += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`
  }
  const xrefOffset = new TextEncoder().encode(document).length
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets.slice(1)) document += `${String(offset).padStart(10, '0')} 00000 n \n`
  document += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`
  return new Blob([new TextEncoder().encode(document)], { type: 'application/pdf' })
}

function buildStatementDocument(data: StatementPdfData) {
  const streams: string[] = []
  let operators: string[] = []
  let y = 0
  const text = (x: number, top: number, size: number, value: string, bold = false) => {
    operators.push('0.31 0.29 0.26 rg')
    operators.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x} ${top} Td (${pdfLiteral(value)}) Tj ET`)
  }
  const rect = (x: number, bottom: number, width: number, height: number, color: string) => {
    operators.push(`${color} rg ${x} ${bottom} ${width} ${height} re f`)
  }
  const rule = (top: number) => operators.push(`0.89 0.86 0.79 RG 48 ${top} m 547 ${top} l S`)
  const fit = (value: string, max: number) => value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value

  const finishPage = () => {
    rule(52)
    text(48, 35, 8, fit(`${data.clinicName} · Estado de cuenta · Corte ${data.cutoff}`, 90))
    streams.push(`${operators.join('\n')}\n`)
  }

  const startPage = () => {
    operators = []
    rect(0, 0, 595, 842, '1 1 1')
    rect(0, 832, 595, 10, '0.53 0.41 0.19')
    rect(48, 788, 5, 25, '0.53 0.41 0.19')
    text(64, 798, 17, fit(data.clinicName, 40), true)
    text(64, 780, 8, 'ESTADO DE CUENTA', true)

    rect(48, 700, 499, 65, '0.99 0.98 0.95')
    text(62, 744, 14, fit(data.patientName, 54), true)
    text(62, 726, 9, fit(`C.I. ${data.patientId || '—'} · Tel. ${data.phone || '—'}`, 92))
    text(62, 710, 8, `Fecha de corte: ${data.cutoff}`)

    const cards: Array<[number, string, string]> = [
      [48, 'TOTAL ACORDADO', data.totalAgreed],
      [218, 'ABONADO', data.paid],
      [388, 'SALDO PENDIENTE', data.balance],
    ]
    for (const [index, [x, label, value]] of cards.entries()) {
      rect(x, 619, 159, 68, index === 2 ? '0.96 0.93 0.86' : '0.99 0.98 0.95')
      text(x + 12, 669, 7, label, true)
      text(x + 12, 642, 14, fit(value, 24), true)
    }
    y = 600
  }

  const newPage = () => {
    finishPage()
    startPage()
  }

  const addSection = (label: string) => {
    if (y < 105) newPage()
    rect(48, y - 7, 499, 23, '0.96 0.93 0.86')
    rect(48, y - 7, 3, 23, '0.53 0.41 0.19')
    text(60, y + 1, 9, label, true)
    y -= 33
  }

  let rowIndex = 0
  const addLine = (value: string, bold = false, fontSize = 9) => {
    let remaining = value
    const parts: string[] = []
    const maxCharacters = fontSize >= 10 ? 82 : 92
    while (remaining.length > maxCharacters) {
      const boundary = remaining.lastIndexOf(' ', maxCharacters)
      const splitAt = boundary > 42 ? boundary : maxCharacters
      parts.push(remaining.slice(0, splitAt).trimEnd())
      remaining = remaining.slice(splitAt).trimStart()
    }
    parts.push(remaining)
    for (const part of parts) {
      if (y < 88) newPage()
      if (rowIndex % 2 === 1) rect(48, y - 10, 499, 25, '0.99 0.98 0.95')
      text(58, y, fontSize, part, bold)
      rule(y - 11)
      y -= 25
      rowIndex += 1
    }
  }

  startPage()
  addSection('PLANES Y SERVICIOS')
  if (data.plans.length) for (const plan of data.plans) addLine(plan)
  else addLine('No hay planes registrados a la fecha de corte.')

  addSection('CUOTAS ABIERTAS')
  if (data.installments.length) for (const installment of data.installments) addLine(installment)
  else addLine('No hay cuotas abiertas a la fecha de corte.')

  addSection('HISTORIAL DE PAGOS')
  for (const payment of data.payments) {
    if (y < 118) newPage()
    addLine(`${payment.date} · ${payment.receipt} · ${payment.method} · ${payment.received}`, true, 9.5)
    addLine(`Equivalente: ${payment.equivalent} · Tasa: ${payment.rate} · ${payment.status}`, false, 8.5)
  }
  if (data.payments.length === 0) addLine('No hay pagos registrados a la fecha de corte.')
  y -= 9
  addSection('NOTAS')
  addLine('Los saldos base se expresan en USD. Los equivalentes en moneda local dependen de la tasa verificada indicada para cada pago.')
  addLine('Este estado es informativo; cada recibo individual conserva el detalle de su pago.')
  finishPage()
  return serializePages(streams)
}

export function downloadReceiptPdf(data: ReceiptPdfData) {
  const blob = buildDocument(data)
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `OdontoCuenta-recibo-${data.receiptNumber.replace(/[^a-zA-Z0-9-]/g, '-')}.pdf`
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function printReceiptDocument(data: ReceiptPdfData) {
  const htmlEntities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
  const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => htmlEntities[character] ?? character)
  const rows: Array<[string, string]> = [
    ['Plan / cuota', data.plan],
    ['Método de pago', data.method],
    ['Equivalente en USD', data.usdEquivalent],
  ]
  if (data.vesEquivalent) rows.push(['Equivalente en Bs.', data.vesEquivalent])
  if (data.rate) rows.push(['Tasa BCV / estado', data.rate])
  rows.push(['Saldo restante de la cuota', data.remaining])
  const detailRows = rows.map(([label, value]) => `<div class="detail-row"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')
  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Recibo ${escapeHtml(data.receiptNumber)}</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #faf7f3; color: #38342f; font-family: Arial, Helvetica, sans-serif; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
  .page { position: relative; width: 210mm; min-height: 297mm; margin: 0 auto; padding: 13mm 17mm 18mm; background: #fff; }
  .top-rule { position: absolute; inset: 0 0 auto; height: 3.5mm; background: #8f6e36; }
  .brand { display: flex; align-items: center; gap: 4mm; min-height: 17mm; padding: 0 0 6mm; border-bottom: 1px solid #e7ded2; }
  .brand-mark { display: grid; place-items: center; width: 11mm; height: 11mm; flex: none; background: #8f6e36; color: #fff; font-size: 13pt; font-weight: 700; }
  .clinic { min-width: 0; flex: 1; color: #38342f; font-size: 17pt; font-weight: 700; overflow-wrap: anywhere; }
  .receipt-number { color: #77746f; font-size: 9pt; text-align: right; }
  h1 { margin: 7mm 0 1.5mm; color: #8f6e36; font-size: 23pt; line-height: 1.15; }
  .status { margin: 0; color: #77746f; font-size: 10pt; }
  .patient { display: grid; grid-template-columns: 1fr 1fr; gap: 8mm; margin-top: 10mm; padding: 6mm; background: #faf7f3; break-inside: avoid; }
  .label { margin: 0 0 2mm; color: #8f6e36; font-size: 8pt; font-weight: 700; letter-spacing: .04em; }
  .value { margin: 0; color: #38342f; font-size: 12pt; font-weight: 700; line-height: 1.35; overflow-wrap: anywhere; }
  .amounts { display: grid; grid-template-columns: 1.2fr .8fr; gap: 8mm; margin-top: 8mm; padding: 7mm 6mm; background: #f4eee7; break-inside: avoid; }
  .amount-primary { margin: 0; color: #785a2c; font-size: 19pt; font-weight: 700; line-height: 1.2; overflow-wrap: anywhere; }
  .amount-secondary { margin: 0; color: #38342f; font-size: 12pt; font-weight: 700; line-height: 1.4; overflow-wrap: anywhere; }
  h2 { margin: 8mm 0 2mm; color: #8f6e36; font-size: 9pt; letter-spacing: .04em; }
  dl { margin: 0; border-top: 1px solid #e7ded2; }
  .detail-row { display: grid; grid-template-columns: minmax(42%, 1fr) minmax(0, 1.15fr); gap: 5mm; padding: 3mm 2mm; border-bottom: 1px solid #e7ded2; break-inside: avoid; }
  dt { color: #77746f; font-size: 9pt; line-height: 1.4; }
  dd { margin: 0; color: #38342f; font-size: 9pt; font-weight: 700; line-height: 1.4; overflow-wrap: anywhere; }
  .note { margin: 8mm 0 0; padding: 4mm; border: 1px solid #e7ded2; background: #faf7f3; color: #5f574b; font-size: 8pt; line-height: 1.45; }
  .footer { margin-top: 8mm; padding-top: 3mm; border-top: 1px solid #e7ded2; color: #77746f; font-size: 8pt; }
  @media screen { body { padding: 12px 0; } .page { box-shadow: 0 3mm 12mm rgb(56 52 47 / 14%); } }
  @media print { html, body { width: 210mm; min-height: 297mm; background: #fff; } .page { margin: 0; box-shadow: none; } }
  @media (max-width: 700px) { .page { width: 100%; min-height: 100vh; padding: 18mm 8mm 12mm; } .patient, .amounts { gap: 5mm; } .clinic { font-size: 14pt; } .receipt-number { font-size: 8pt; } }
</style></head><body><main class="page"><div class="top-rule"></div>
  <header class="brand"><span class="brand-mark" aria-hidden="true">O</span><strong class="clinic">${escapeHtml(data.clinicName)}</strong><span class="receipt-number">RECIBO N.º ${escapeHtml(data.receiptNumber)}</span></header>
  <h1>Recibo de pago</h1><p class="status">${escapeHtml(data.status)}</p>
  <section class="patient"><div><p class="label">PACIENTE</p><p class="value">${escapeHtml(data.patientName)}</p></div><div><p class="label">FECHA</p><p class="value">${escapeHtml(data.date)}</p></div></section>
  <section class="amounts"><div><p class="label">MONTO RECIBIDO</p><p class="amount-primary">${escapeHtml(data.receivedAmount)}</p></div><div><p class="label">EQUIVALENTE EN USD</p><p class="amount-secondary">${escapeHtml(data.usdEquivalent)}</p></div></section>
  <h2>DETALLE DEL PAGO</h2><dl>${detailRows}</dl>
  <aside class="note">Constancia de pago registrada en OdontoCuenta. Este comprobante no es una factura fiscal.</aside>
  <footer class="footer">OdontoCuenta · Cobros claros, sonrisas tranquilas</footer>
</main><script>window.addEventListener('afterprint', () => window.close()); window.addEventListener('load', () => setTimeout(() => { window.focus(); window.print(); }, 180));</script></body></html>`

  const printWindow = window.open('', '_blank')
  if (!printWindow) {
    downloadReceiptPdf(data)
    return
  }
  printWindow.document.open()
  printWindow.document.write(html)
  printWindow.document.close()
}

export function downloadStatementPdf(data: StatementPdfData) {
  const blob = buildStatementDocument(data)
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `OdontoCuenta-estado-cuenta-${data.patientName.normalize('NFKD').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '')}.pdf`
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function printStatementPdf(data: StatementPdfData) {
  const htmlEntities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
  const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => htmlEntities[character] ?? character)
  const line = (value: string, className = '') => `<div class="detail-row ${className}"><span>${escapeHtml(value)}</span></div>`
  const rows = (values: string[], empty: string) => values.length ? values.map(value => line(value)).join('') : line(empty, 'muted')
  const payments = data.payments.length ? data.payments.map(payment => `
    <article class="payment-row">
      <div class="payment-main"><b>${escapeHtml(payment.date)} · ${escapeHtml(payment.receipt)} · ${escapeHtml(payment.method)}</b><strong>${escapeHtml(payment.received)}</strong></div>
      <div class="payment-meta"><span>Equivalente: ${escapeHtml(payment.equivalent)}</span><span>Tasa: ${escapeHtml(payment.rate)}</span><span>${escapeHtml(payment.status)}</span></div>
    </article>`).join('') : line('No hay pagos registrados a la fecha de corte.', 'muted')
  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Estado de cuenta · ${escapeHtml(data.patientName)}</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #faf7f3; color: #38342f; font-family: Arial, Helvetica, sans-serif; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
  .page { position: relative; width: 210mm; min-height: 297mm; margin: 0 auto; padding: 14mm 17mm 18mm; background: #fff; }
  .top-rule { position: absolute; top: 0; left: 0; right: 0; height: 3.5mm; background: #c7a05b; }
  .brand { display: flex; align-items: flex-start; gap: 4mm; padding-top: 1mm; }
  .brand-mark { width: 1.5mm; height: 10mm; flex: none; border-radius: 1mm; background: linear-gradient(180deg, #f3da8a, #c7a05b); }
  .clinic { margin: 0; color: #38342f; font-size: 17pt; line-height: 1.1; font-weight: 700; }
  .document-label { margin: 1.6mm 0 0; color: #8f6e36; font-size: 8pt; font-weight: 700; letter-spacing: .08em; }
  .patient { margin-top: 6mm; padding: 5mm 4mm; border: 1px solid #e7ded2; border-radius: 3mm; background: #faf7f3; break-inside: avoid; }
  .patient h1 { margin: 0 0 2mm; color: #38342f; font-size: 14pt; line-height: 1.2; }
  .patient p { margin: 1mm 0 0; color: #77746f; font-size: 9pt; }
  .summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 3mm; margin: 4mm 0 5mm; break-inside: avoid; }
  .summary-card { min-height: 22mm; padding: 4mm; border: 1px solid #e7ded2; border-radius: 3mm; background: #faf7f3; }
  .summary-card.balance { border-color: #dfc989; background: #f4eee7; }
  .summary-card span { display: block; color: #77746f; font-size: 7pt; font-weight: 700; letter-spacing: .04em; }
  .summary-card strong { display: block; margin-top: 2mm; color: #38342f; font-size: 14pt; line-height: 1; }
  section { margin-top: 4mm; break-inside: auto; }
  h2 { margin: 0 0 2mm; padding: 2.3mm 3mm; border-left: 1mm solid #c7a05b; background: #f4eee7; color: #785a2c; font-size: 9pt; letter-spacing: .02em; break-after: avoid; }
  .detail-row { padding: 2.6mm 3mm; border-bottom: 1px solid #e7ded2; color: #38342f; font-size: 9pt; line-height: 1.4; overflow-wrap: anywhere; break-inside: avoid; }
  .detail-row:nth-child(even) { background: #faf7f3; }
  .detail-row.muted { color: #77746f; }
  .payment-row { padding: 3mm; border-bottom: 1px solid #e7ded2; break-inside: avoid; }
  .payment-row:nth-child(even) { background: #faf7f3; }
  .payment-main { display: flex; justify-content: space-between; align-items: baseline; gap: 4mm; color: #38342f; font-size: 9pt; }
  .payment-main b { font-weight: 600; }
  .payment-main strong { flex: none; color: #8f6e36; }
  .payment-meta { display: flex; flex-wrap: wrap; gap: 1mm 5mm; margin-top: 1.5mm; color: #77746f; font-size: 8pt; line-height: 1.35; }
  .notes { margin-top: 4mm; padding: 3mm 4mm; border: 1px solid #e7ded2; border-radius: 2.5mm; background: #faf7f3; color: #5f574b; font-size: 8pt; line-height: 1.45; break-inside: avoid; }
  .notes p { margin: 0; } .notes p + p { margin-top: 1.5mm; }
  .footer { margin-top: 8mm; padding-top: 3mm; border-top: 1px solid #e7ded2; color: #77746f; font-size: 8pt; }
  @media screen { .page { box-shadow: 0 3mm 12mm #38342f22; } }
  @media print { html, body { background: #fff; } .page { margin: 0; box-shadow: none; } }
</style></head><body><main class="page"><div class="top-rule"></div>
  <header class="brand"><span class="brand-mark"></span><div><p class="clinic">${escapeHtml(data.clinicName)}</p><p class="document-label">ESTADO DE CUENTA</p></div></header>
  <section class="patient"><h1>${escapeHtml(data.patientName)}</h1><p>${escapeHtml(`C.I. ${data.patientId || '—'} · Tel. ${data.phone || '—'}`)}</p><p>Fecha de corte: ${escapeHtml(data.cutoff)}</p></section>
  <div class="summary"><div class="summary-card"><span>TOTAL ACORDADO</span><strong>${escapeHtml(data.totalAgreed)}</strong></div><div class="summary-card"><span>ABONADO</span><strong>${escapeHtml(data.paid)}</strong></div><div class="summary-card balance"><span>SALDO PENDIENTE</span><strong>${escapeHtml(data.balance)}</strong></div></div>
  <section><h2>PLANES Y SERVICIOS</h2>${rows(data.plans, 'No hay planes registrados a la fecha de corte.')}</section>
  <section><h2>CUOTAS ABIERTAS</h2>${rows(data.installments, 'No hay cuotas abiertas a la fecha de corte.')}</section>
  <section><h2>HISTORIAL DE PAGOS</h2>${payments}</section>
  <aside class="notes"><p>Los saldos base se expresan en USD. Los equivalentes en moneda local dependen de la tasa verificada indicada para cada pago.</p><p>Este estado es informativo; cada recibo individual conserva el detalle de su pago.</p></aside>
  <footer class="footer">${escapeHtml(`${data.clinicName} · Estado de cuenta · Corte ${data.cutoff}`)}</footer>
</main><script>window.addEventListener('afterprint', () => window.close()); window.addEventListener('load', () => setTimeout(() => { window.focus(); window.print(); }, 180));</script></body></html>`

  const printWindow = window.open('', '_blank')
  if (!printWindow) {
    downloadStatementPdf(data)
    return
  }
  printWindow.document.open()
  printWindow.document.write(html)
  printWindow.document.close()
}
