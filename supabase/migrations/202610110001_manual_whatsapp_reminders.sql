alter table public.clinics
  add column whatsapp_message_template text not null default 'Hola, {nombre}. Te escribimos de {clínica} para recordarte que tu cuota de {monto} vence el {fecha}. Si ya realizaste el pago, puedes ignorar este mensaje. Si tienes alguna duda, responde por aquí o llámanos al {teléfono}. Si no deseas recibir recordatorios por WhatsApp, responde BAJA.'
    check (char_length(whatsapp_message_template) between 1 and 1000);

alter table public.patients
  add column whatsapp_consent_at timestamptz;
