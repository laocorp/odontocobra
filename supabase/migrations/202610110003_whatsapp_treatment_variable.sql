alter table public.clinics
  alter column whatsapp_message_template set default 'Hola, {nombre}. Te escribimos de {clínica} para recordarte que tu cuota de {monto} correspondiente a {tratamiento} vence el {fecha}. Si ya realizaste el pago, puedes ignorar este mensaje. Si tienes alguna duda, responde por aquí o llámanos al {teléfono}. Si no deseas recibir recordatorios por WhatsApp, responde BAJA.';

update public.clinics
set whatsapp_message_template = 'Hola, {nombre}. Te escribimos de {clínica} para recordarte que tu cuota de {monto} correspondiente a {tratamiento} vence el {fecha}. Si ya realizaste el pago, puedes ignorar este mensaje. Si tienes alguna duda, responde por aquí o llámanos al {teléfono}. Si no deseas recibir recordatorios por WhatsApp, responde BAJA.'
where whatsapp_message_template = 'Hola, {nombre}. Te escribimos de {clínica} para recordarte que tu cuota de {monto} vence el {fecha}. Si ya realizaste el pago, puedes ignorar este mensaje. Si tienes alguna duda, responde por aquí o llámanos al {teléfono}. Si no deseas recibir recordatorios por WhatsApp, responde BAJA.';
