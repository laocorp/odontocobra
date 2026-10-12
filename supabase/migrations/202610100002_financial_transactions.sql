alter table public.payments add column receipt_snapshot jsonb not null default '{}'::jsonb;

create table public.exchange_rates (
  id uuid primary key default gen_random_uuid(), clinic_id uuid not null references public.clinics(id) on delete cascade,
  source text not null check (source in ('BCV', 'manual_owner')), rate numeric(24,10) not null check (rate > 0),
  local_currency text not null check (local_currency ~ '^[A-Z]{3}$'), as_of timestamptz not null,
  validated_at timestamptz not null default now(), validated_by uuid not null default auth.uid() references auth.users(id),
  validation_reason text check (validation_reason is null or char_length(validation_reason) <= 500),
  created_at timestamptz not null default now(), unique (clinic_id, id),
  check ((source = 'BCV' and validation_reason is null) or (source = 'manual_owner' and char_length(trim(coalesce(validation_reason, ''))) between 5 and 500))
);
create index exchange_rates_clinic_as_of_idx on public.exchange_rates(clinic_id, as_of desc);
alter table public.exchange_rates enable row level security;
create policy rates_read_clinic on public.exchange_rates for select to authenticated using (private.is_clinic_member(clinic_id));
grant select on public.exchange_rates to authenticated;

create view public.exchange_rates_client with (security_invoker = true) as
  select id, clinic_id, source, rate::text as rate, local_currency, as_of, validated_at
  from public.exchange_rates;
grant select on public.exchange_rates_client to authenticated;

create or replace function public.record_manual_exchange_rate(p_clinic_id uuid, p_rate numeric, p_as_of timestamptz, p_reason text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_currency text; v_id uuid;
begin
  if v_uid is null or not private.has_clinic_role(p_clinic_id, 'owner') then raise exception 'Solo la persona propietaria puede registrar una tasa manual.' using errcode = '42501'; end if;
  if p_rate is null or p_rate <= 0 or p_as_of is null or char_length(trim(coalesce(p_reason, ''))) not between 5 and 500 then raise exception 'Tasa, fecha o motivo inválidos.' using errcode = '22023'; end if;
  select local_currency into v_currency from public.clinics where id = p_clinic_id;
  insert into public.exchange_rates(clinic_id, source, rate, local_currency, as_of, validated_by, validation_reason)
    values (p_clinic_id, 'manual_owner', p_rate, v_currency, p_as_of, v_uid, trim(p_reason)) returning id into v_id;
  insert into public.audit_events(clinic_id, actor_id, action, entity_type, entity_id, details)
    values (p_clinic_id, v_uid, 'exchange_rate.manual_recorded', 'exchange_rate', v_id, jsonb_build_object('rate', p_rate, 'currency', v_currency, 'as_of', p_as_of, 'reason', trim(p_reason)));
  return v_id;
end;
$$;
revoke all on function public.record_manual_exchange_rate(uuid, numeric, timestamptz, text) from public, anon;
grant execute on function public.record_manual_exchange_rate(uuid, numeric, timestamptz, text) to authenticated;

create or replace function private.prevent_tenant_move()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.id <> old.id or new.clinic_id <> old.clinic_id then
    raise exception 'No se puede mover un registro a otro consultorio.' using errcode = '55000';
  end if;
  return new;
end;
$$;
create trigger patients_keep_tenant before update on public.patients
for each row execute function private.prevent_tenant_move();
create trigger services_keep_tenant before update on public.services
for each row execute function private.prevent_tenant_move();
revoke all on function private.prevent_tenant_move() from public, anon, authenticated;

drop policy plans_update_owner on public.treatment_plans;
drop policy installments_update_owner on public.installments;
revoke update on public.treatment_plans, public.installments from authenticated;

create or replace function private.prevent_plan_amount_change()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.clinic_id <> old.clinic_id or new.patient_id <> old.patient_id
     or new.total_usd_cents <> old.total_usd_cents or new.service_id is distinct from old.service_id
     or new.starts_on <> old.starts_on then
    raise exception 'El monto y el paciente de un plan son inmutables; registra un ajuste auditado.' using errcode = '55000';
  end if;
  return new;
end;
$$;
create trigger treatment_plans_keep_agreed_amount before update on public.treatment_plans
for each row execute function private.prevent_plan_amount_change();
revoke all on function private.prevent_plan_amount_change() from public, anon, authenticated;

create or replace function public.create_treatment_plan(
  p_clinic_id uuid, p_patient_id uuid, p_description text, p_total_usd_cents bigint,
  p_installment_count smallint, p_first_due_on date, p_service_id uuid default null
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid(); v_plan_id uuid; v_sequence integer;
  v_base bigint; v_remainder bigint; v_amount bigint;
begin
  if v_uid is null or not private.is_clinic_member(p_clinic_id) then raise exception 'Acceso al consultorio requerido.' using errcode = '42501'; end if;
  if p_total_usd_cents is null or p_total_usd_cents <= 0 or p_installment_count is null or p_installment_count not between 1 and 120
     or p_total_usd_cents < p_installment_count or p_first_due_on is null then
    raise exception 'Monto, fecha o cantidad de cuotas inválidos.' using errcode = '22023';
  end if;
  if char_length(trim(coalesce(p_description, ''))) < 2 or char_length(p_description) > 500 then raise exception 'Describe el tratamiento.' using errcode = '22023'; end if;
  if not exists (select 1 from public.patients p where p.clinic_id = p_clinic_id and p.id = p_patient_id and p.archived_at is null) then
    raise exception 'Paciente inexistente en este consultorio.' using errcode = '22023';
  end if;
  if p_service_id is not null and not exists (select 1 from public.services s where s.clinic_id = p_clinic_id and s.id = p_service_id and s.active) then
    raise exception 'El servicio no existe o está inactivo.' using errcode = '22023';
  end if;
  insert into public.treatment_plans(clinic_id, patient_id, service_id, description, total_usd_cents, starts_on, created_by)
    values (p_clinic_id, p_patient_id, p_service_id, trim(p_description), p_total_usd_cents, current_date, v_uid)
    returning id into v_plan_id;
  v_base := p_total_usd_cents / p_installment_count;
  v_remainder := p_total_usd_cents - v_base * p_installment_count;
  for v_sequence in 1..p_installment_count loop
    v_amount := v_base + case when v_sequence = p_installment_count then v_remainder else 0 end;
    insert into public.installments(clinic_id, plan_id, sequence, due_on, amount_usd_cents)
      values (p_clinic_id, v_plan_id, v_sequence, p_first_due_on + ((v_sequence - 1) * interval '1 month'), v_amount);
  end loop;
  insert into public.audit_events(clinic_id, actor_id, action, entity_type, entity_id, details)
    values (p_clinic_id, v_uid, 'plan.created', 'treatment_plan', v_plan_id,
      jsonb_build_object('patient_id', p_patient_id, 'total_usd_cents', p_total_usd_cents, 'installment_count', p_installment_count));
  return v_plan_id;
end;
$$;
revoke all on function public.create_treatment_plan(uuid, uuid, text, bigint, smallint, date, uuid) from public, anon;
grant execute on function public.create_treatment_plan(uuid, uuid, text, bigint, smallint, date, uuid) to authenticated;

drop policy plans_insert_clinic on public.treatment_plans;
drop policy installments_insert_clinic on public.installments;
revoke insert on public.treatment_plans, public.installments from authenticated;

-- Explicit allocation prevents unassigned abonos until the clinic chooses that policy.
drop function if exists public.record_payment(uuid, uuid, bigint, public.payment_method, jsonb, uuid, text, text);
create function public.record_payment(
  p_clinic_id uuid, p_patient_id uuid, p_amount_usd_cents bigint,
  p_method public.payment_method, p_allocations jsonb, p_idempotency_key uuid,
  p_reference text default null, p_notes text default null,
  p_received_currency text default 'USD', p_received_local_minor bigint default null,
  p_exchange_rate_id uuid default null
)
returns table(payment_id uuid, receipt_number bigint, was_duplicate boolean)
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid(); v_payment_id uuid; v_receipt_number bigint;
  v_existing public.payments%rowtype; v_item jsonb; v_allocated bigint := 0;
  v_count integer; v_due bigint; v_paid bigint; v_valid boolean;
  v_clinic_name text; v_patient_name text; v_patient_phone text; v_method_label text; v_snapshot jsonb;
  v_timezone text; v_local_currency text; v_local_precision smallint; v_exchange_rate numeric(24,10); v_rate_source text;
  v_rate_as_of timestamptz; v_rate_validated_at timestamptz; v_balance_before bigint; v_balance_after bigint;
  v_rate_id uuid; v_expected_amount_usd_cents bigint;
begin
  if v_uid is null then raise exception 'Autenticación requerida.' using errcode = '42501'; end if;
  if not private.is_clinic_member(p_clinic_id) then raise exception 'No perteneces a este consultorio.' using errcode = '42501'; end if;
  if p_amount_usd_cents is null or p_amount_usd_cents <= 0 or p_idempotency_key is null then raise exception 'Monto o clave de idempotencia inválidos.' using errcode = '22023'; end if;
  if p_received_currency is null or p_received_currency not in ('USD', 'VES') then raise exception 'Moneda recibida inválida.' using errcode = '22023'; end if;
  if p_received_currency = 'USD' and (p_received_local_minor is not null or p_exchange_rate_id is not null) then raise exception 'Un pago USD no lleva monto local ni tasa de conversión.' using errcode = '22023'; end if;
  if p_received_currency = 'VES' and (p_received_local_minor is null or p_received_local_minor <= 0 or p_exchange_rate_id is null) then raise exception 'Un pago en Bs. requiere monto y tasa vigente.' using errcode = '22023'; end if;
  if jsonb_typeof(p_allocations) <> 'array' or jsonb_array_length(p_allocations) = 0 then raise exception 'Asigna el pago a una o más cuotas.' using errcode = '22023'; end if;
  if char_length(coalesce(p_reference, '')) > 120 or char_length(coalesce(p_notes, '')) > 500 then raise exception 'Referencia o nota demasiado larga.' using errcode = '22023'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_clinic_id::text || p_idempotency_key::text, 0));
  select p.* into v_existing from public.payments p where p.clinic_id = p_clinic_id and p.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.patient_id <> p_patient_id or v_existing.amount_usd_cents <> p_amount_usd_cents or v_existing.method <> p_method
       or v_existing.reference is distinct from nullif(trim(p_reference), '')
       or v_existing.notes is distinct from nullif(trim(p_notes), '')
       or v_existing.received_currency is distinct from p_received_currency
       or v_existing.received_local_minor is distinct from p_received_local_minor
       or (p_received_currency = 'VES' and v_existing.receipt_snapshot ->> 'exchange_rate_id' is distinct from p_exchange_rate_id::text)
       or exists (select 1 from jsonb_to_recordset(p_allocations) as a(installment_id uuid, amount_cents bigint)
          full join public.payment_allocations pa on pa.clinic_id = p_clinic_id and pa.payment_id = v_existing.id and pa.installment_id = a.installment_id
          where a.amount_cents is distinct from pa.amount_usd_cents) then
      raise exception 'La clave de idempotencia ya se usó con otros datos.' using errcode = '23505';
    end if;
    return query select v_existing.id, v_existing.receipt_number, true; return;
  end if;

  if exists (select 1 from jsonb_to_recordset(p_allocations) as a(installment_id uuid, amount_cents bigint) group by a.installment_id having count(*) > 1) then
    raise exception 'Una cuota solo puede aparecer una vez.' using errcode = '22023';
  end if;
  select coalesce(sum(a.amount_cents), 0), count(*) into v_allocated, v_count
    from jsonb_to_recordset(p_allocations) as a(installment_id uuid, amount_cents bigint);
  if v_allocated <> p_amount_usd_cents or exists (select 1 from jsonb_to_recordset(p_allocations) as a(installment_id uuid, amount_cents bigint) where a.installment_id is null or a.amount_cents is null or a.amount_cents <= 0) then
    raise exception 'La suma asignada debe coincidir exactamente con el pago.' using errcode = '22023';
  end if;

  perform i.id from public.installments i
    join jsonb_to_recordset(p_allocations) as a(installment_id uuid, amount_cents bigint) on a.installment_id = i.id
    where i.clinic_id = p_clinic_id order by i.id for update of i;
  get diagnostics v_count = row_count;
  if v_count <> jsonb_array_length(p_allocations) then raise exception 'Una cuota no existe en este consultorio.' using errcode = '22023'; end if;

  for v_item in select value from jsonb_array_elements(p_allocations) loop
    select i.amount_usd_cents, coalesce((select sum(pa.amount_usd_cents)
       from public.payment_allocations pa join public.payments p on p.clinic_id = pa.clinic_id and p.id = pa.payment_id and p.status = 'confirmed'
       left join public.payment_reversals r on r.clinic_id = p.clinic_id and r.payment_id = p.id
       where pa.clinic_id = p_clinic_id and pa.installment_id = i.id and r.id is null), 0),
       (tp.patient_id = p_patient_id and tp.status = 'active')
      into v_due, v_paid, v_valid
      from public.installments i join public.treatment_plans tp on tp.clinic_id = i.clinic_id and tp.id = i.plan_id
      where i.clinic_id = p_clinic_id and i.id = (v_item ->> 'installment_id')::uuid;
    if not found or not v_valid then raise exception 'La cuota no pertenece a este paciente o su plan no está activo.' using errcode = '22023'; end if;
    if v_paid + (v_item ->> 'amount_cents')::bigint > v_due then raise exception 'El abono supera el saldo pendiente de una cuota.' using errcode = '22023'; end if;
  end loop;

  select coalesce(sum(greatest(tp.total_usd_cents - coalesce(paid.total_paid_cents, 0), 0)), 0)
    into v_balance_before
    from public.treatment_plans tp
    left join (
      select i.clinic_id, i.plan_id, sum(pa.amount_usd_cents) as total_paid_cents
        from public.installments i
        join public.payment_allocations pa on pa.clinic_id = i.clinic_id and pa.installment_id = i.id
        join public.payments p on p.clinic_id = pa.clinic_id and p.id = pa.payment_id and p.status = 'confirmed'
        left join public.payment_reversals r on r.clinic_id = p.clinic_id and r.payment_id = p.id
        where i.clinic_id = p_clinic_id and r.id is null
        group by i.clinic_id, i.plan_id
    ) paid on paid.clinic_id = tp.clinic_id and paid.plan_id = tp.id
    where tp.clinic_id = p_clinic_id and tp.patient_id = p_patient_id and tp.status = 'active';
  v_balance_after := greatest(v_balance_before - p_amount_usd_cents, 0);

  update public.clinic_receipt_counters c set last_number = c.last_number + 1 where c.clinic_id = p_clinic_id returning c.last_number into v_receipt_number;
  if not found then raise exception 'Falta el contador de recibos del consultorio.' using errcode = '55000'; end if;
  select c.name, p.full_name, p.phone, c.timezone, c.local_currency, c.local_precision into v_clinic_name, v_patient_name, v_patient_phone, v_timezone, v_local_currency, v_local_precision
    from public.clinics c join public.patients p on p.clinic_id = c.id where c.id = p_clinic_id and p.id = p_patient_id;
  if not found then raise exception 'Paciente inexistente.' using errcode = '22023'; end if;
  if p_received_currency = 'VES' then
    select r.id, r.rate, r.source, r.as_of, r.validated_at
      into v_rate_id, v_exchange_rate, v_rate_source, v_rate_as_of, v_rate_validated_at
      from public.exchange_rates r
      where r.clinic_id = p_clinic_id and r.id = p_exchange_rate_id and r.local_currency = v_local_currency
        and (r.as_of at time zone v_timezone)::date = (now() at time zone v_timezone)::date
        and not exists (
          select 1 from public.exchange_rates newer
          where newer.clinic_id = r.clinic_id and newer.local_currency = r.local_currency
            and (newer.as_of at time zone v_timezone)::date = (now() at time zone v_timezone)::date
            and (newer.as_of, newer.created_at) > (r.as_of, r.created_at)
        );
    if not found then raise exception 'La tasa seleccionada no está vigente para hoy.' using errcode = '22023'; end if;
    v_expected_amount_usd_cents := round((p_received_local_minor::numeric / power(10::numeric, v_local_precision)) / v_exchange_rate * 100)::bigint;
    if p_amount_usd_cents <> v_expected_amount_usd_cents then raise exception 'El equivalente en USD cambió. Revisa la tasa y el monto antes de guardar.' using errcode = '22023'; end if;
  else
    select r.id, r.rate, r.source, r.as_of, r.validated_at
      into v_rate_id, v_exchange_rate, v_rate_source, v_rate_as_of, v_rate_validated_at
      from public.exchange_rates r
      where r.clinic_id = p_clinic_id and r.local_currency = v_local_currency
        and (r.as_of at time zone v_timezone)::date = (now() at time zone v_timezone)::date
      order by r.as_of desc, r.created_at desc limit 1;
  end if;
  v_method_label := case p_method when 'cash' then 'Efectivo' when 'mobile_payment' then 'Pago móvil' when 'bank_transfer' then 'Transferencia' when 'card' then 'Tarjeta' else 'Otro' end;
  v_snapshot := jsonb_build_object('clinic_name', v_clinic_name, 'patient_name', v_patient_name, 'patient_phone', v_patient_phone,
    'amount_usd_cents', p_amount_usd_cents, 'currency', p_received_currency, 'received_local_minor', p_received_local_minor,
    'local_currency', v_local_currency, 'local_precision', v_local_precision,
    'method', v_method_label, 'reference', p_reference,
    'exchange_rate', v_exchange_rate, 'rate_source', v_rate_source, 'rate_as_of', v_rate_as_of, 'rate_validated_at', v_rate_validated_at,
    'exchange_rate_id', v_rate_id,
    'balance_after_usd_cents', v_balance_after,
    'allocation_lines', coalesce((
      select jsonb_agg(jsonb_build_object('plan_description', tp.description, 'sequence', i.sequence,
        'due_on', i.due_on, 'amount_usd_cents', a.amount_cents) order by i.sequence)
        from jsonb_to_recordset(p_allocations) as a(installment_id uuid, amount_cents bigint)
        join public.installments i on i.clinic_id = p_clinic_id and i.id = a.installment_id
        join public.treatment_plans tp on tp.clinic_id = i.clinic_id and tp.id = i.plan_id
    ), '[]'::jsonb),
    'receipt_number', v_receipt_number, 'received_at', now(), 'notes', p_notes);
  insert into public.payments(clinic_id, patient_id, amount_usd_cents, received_currency, received_local_minor, exchange_rate, rate_source, rate_as_of, rate_validated_at,
      method, reference, notes, idempotency_key, receipt_number, receipt_snapshot, created_by)
    values (p_clinic_id, p_patient_id, p_amount_usd_cents, p_received_currency, p_received_local_minor, v_exchange_rate, v_rate_source, v_rate_as_of, v_rate_validated_at,
      p_method, nullif(trim(p_reference), ''), nullif(trim(p_notes), ''), p_idempotency_key, v_receipt_number, v_snapshot, v_uid)
    returning id into v_payment_id;
  for v_item in select value from jsonb_array_elements(p_allocations) loop
    insert into public.payment_allocations(clinic_id, payment_id, installment_id, amount_usd_cents)
      values (p_clinic_id, v_payment_id, (v_item ->> 'installment_id')::uuid, (v_item ->> 'amount_cents')::bigint);
  end loop;
  insert into public.audit_events(clinic_id, actor_id, action, entity_type, entity_id, details)
    values (p_clinic_id, v_uid, 'payment.recorded', 'payment', v_payment_id,
      jsonb_build_object('receipt_number', v_receipt_number, 'amount_usd_cents', p_amount_usd_cents,
        'allocation_count', jsonb_array_length(p_allocations), 'rate_source', v_rate_source,
        'exchange_rate', v_exchange_rate, 'rate_as_of', v_rate_as_of, 'received_currency', p_received_currency,
        'received_local_minor', p_received_local_minor, 'balance_after_usd_cents', v_balance_after));
  return query select v_payment_id, v_receipt_number, false;
end;
$$;
revoke all on function public.record_payment(uuid, uuid, bigint, public.payment_method, jsonb, uuid, text, text, text, bigint, uuid) from public, anon;
grant execute on function public.record_payment(uuid, uuid, bigint, public.payment_method, jsonb, uuid, text, text, text, bigint, uuid) to authenticated;

create or replace function public.reverse_payment(p_clinic_id uuid, p_payment_id uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_reversal_id uuid; v_payment public.payments%rowtype;
begin
  if v_uid is null or not private.has_clinic_role(p_clinic_id, 'owner') then raise exception 'Solo la persona propietaria puede revertir pagos.' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_reason, ''))) < 5 or char_length(p_reason) > 500 then raise exception 'Indica el motivo de la reversión.' using errcode = '22023'; end if;
  select p.* into v_payment from public.payments p where p.clinic_id = p_clinic_id and p.id = p_payment_id for update;
  if not found then raise exception 'Pago no encontrado.' using errcode = 'P0002'; end if;
  perform i.id from public.installments i join public.payment_allocations a on a.clinic_id = i.clinic_id and a.installment_id = i.id
    where a.clinic_id = p_clinic_id and a.payment_id = p_payment_id order by i.id for update of i;
  if exists (select 1 from public.payment_reversals r where r.clinic_id = p_clinic_id and r.payment_id = p_payment_id) then raise exception 'Este pago ya fue revertido.' using errcode = '23505'; end if;
  insert into public.payment_reversals(clinic_id, payment_id, reason, reversed_by) values (p_clinic_id, p_payment_id, trim(p_reason), v_uid) returning id into v_reversal_id;
  insert into public.audit_events(clinic_id, actor_id, action, entity_type, entity_id, details)
    values (p_clinic_id, v_uid, 'payment.reversed', 'payment', p_payment_id, jsonb_build_object('reversal_id', v_reversal_id, 'reason', trim(p_reason), 'receipt_number', v_payment.receipt_number));
  return v_reversal_id;
end;
$$;
revoke all on function public.reverse_payment(uuid, uuid, text) from public, anon;
grant execute on function public.reverse_payment(uuid, uuid, text) to authenticated;

drop policy payments_insert_clinic on public.payments;
drop policy allocations_insert_clinic on public.payment_allocations;
drop policy reversals_owner_insert on public.payment_reversals;
drop policy audit_insert_member on public.audit_events;
revoke insert on public.payments, public.payment_allocations, public.payment_reversals, public.audit_events from authenticated;

create or replace view public.installment_balances with (security_invoker = true) as
select i.clinic_id, i.id as installment_id, i.plan_id, tp.patient_id, i.sequence, i.due_on,
  i.amount_usd_cents, coalesce(sum(pa.amount_usd_cents) filter (where p.id is not null and r.id is null), 0)::bigint as paid_usd_cents,
  greatest(i.amount_usd_cents - coalesce(sum(pa.amount_usd_cents) filter (where p.id is not null and r.id is null), 0), 0)::bigint as balance_usd_cents,
  case when i.amount_usd_cents <= coalesce(sum(pa.amount_usd_cents) filter (where p.id is not null and r.id is null), 0) then 'paid'
       when i.due_on < current_date then 'overdue' else 'pending' end as balance_status
from public.installments i join public.treatment_plans tp on tp.clinic_id = i.clinic_id and tp.id = i.plan_id
left join public.payment_allocations pa on pa.clinic_id = i.clinic_id and pa.installment_id = i.id
left join public.payments p on p.clinic_id = pa.clinic_id and p.id = pa.payment_id and p.status = 'confirmed'
left join public.payment_reversals r on r.clinic_id = p.clinic_id and r.payment_id = p.id
group by i.clinic_id, i.id, tp.patient_id;
grant select on public.installment_balances to authenticated;
