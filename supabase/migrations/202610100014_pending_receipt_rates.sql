-- Keep payment facts immutable while allowing a receipt that lacked its
-- effective BCV rate at payment time to be completed later.
create table public.payment_receipt_rate_completions (
  clinic_id uuid not null,
  payment_id uuid not null,
  exchange_rate_id uuid not null,
  exchange_rate numeric(24, 10) not null check (exchange_rate > 0),
  rate_source text not null check (rate_source in ('BCV', 'manual_owner')),
  rate_as_of timestamptz not null,
  rate_validated_at timestamptz not null,
  equivalent_local_minor bigint not null check (equivalent_local_minor > 0),
  created_at timestamptz not null default now(),
  primary key (clinic_id, payment_id),
  foreign key (clinic_id, payment_id) references public.payments(clinic_id, id),
  foreign key (clinic_id, exchange_rate_id) references public.exchange_rates(clinic_id, id)
);

alter table public.payment_receipt_rate_completions enable row level security;
revoke all on public.payment_receipt_rate_completions from public, anon, authenticated;
grant select on public.payment_receipt_rate_completions to authenticated;
create policy receipt_rate_completion_read_member
  on public.payment_receipt_rate_completions for select to authenticated
  using (private.is_clinic_member(clinic_id));

create or replace function public.complete_pending_payment_receipt_rate(
  p_clinic_id uuid,
  p_payment_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.payments%rowtype;
  v_timezone text;
  v_local_currency text;
  v_local_precision smallint;
  v_payment_day date;
  v_rate public.exchange_rates%rowtype;
  v_completion public.payment_receipt_rate_completions%rowtype;
begin
  if not private.is_clinic_member(p_clinic_id) then
    raise exception 'No perteneces a este consultorio.' using errcode = '42501';
  end if;

  select * into v_payment
  from public.payments p
  where p.clinic_id = p_clinic_id and p.id = p_payment_id
  for update;
  if not found then
    raise exception 'No encontramos ese pago en el consultorio.' using errcode = 'P0002';
  end if;

  select * into v_completion
  from public.payment_receipt_rate_completions c
  where c.clinic_id = p_clinic_id and c.payment_id = p_payment_id;
  if found then
    return jsonb_build_object(
      'exchange_rate', v_completion.exchange_rate,
      'rate_source', v_completion.rate_source,
      'rate_as_of', v_completion.rate_as_of,
      'rate_validated_at', v_completion.rate_validated_at,
      'equivalent_local_minor', v_completion.equivalent_local_minor
    );
  end if;

  if v_payment.received_currency <> 'USD' or v_payment.exchange_rate is not null then
    return null;
  end if;

  select c.timezone, c.local_currency, c.local_precision
    into v_timezone, v_local_currency, v_local_precision
  from public.clinics c where c.id = p_clinic_id;
  v_payment_day := (v_payment.received_at at time zone v_timezone)::date;

  select r.* into v_rate
  from public.exchange_rates r
  where r.clinic_id = p_clinic_id
    and r.local_currency = v_local_currency
    and (r.as_of at time zone v_timezone)::date = v_payment_day
  order by r.validated_at desc, r.created_at desc
  limit 1;
  if not found then
    return null;
  end if;

  insert into public.payment_receipt_rate_completions(
    clinic_id, payment_id, exchange_rate_id, exchange_rate, rate_source,
    rate_as_of, rate_validated_at, equivalent_local_minor
  ) values (
    p_clinic_id, p_payment_id, v_rate.id, v_rate.rate, v_rate.source,
    v_rate.as_of, v_rate.validated_at,
    round((v_payment.amount_usd_cents::numeric / 100) * v_rate.rate * power(10::numeric, v_local_precision))::bigint
  ) returning * into v_completion;

  insert into public.audit_events(clinic_id, actor_id, action, entity_type, entity_id, details)
  values (p_clinic_id, (select auth.uid()), 'payment.receipt_rate_completed', 'payment', p_payment_id,
    jsonb_build_object('exchange_rate_id', v_rate.id, 'rate_source', v_rate.source, 'rate_as_of', v_rate.as_of));

  return jsonb_build_object(
    'exchange_rate', v_completion.exchange_rate,
    'rate_source', v_completion.rate_source,
    'rate_as_of', v_completion.rate_as_of,
    'rate_validated_at', v_completion.rate_validated_at,
    'equivalent_local_minor', v_completion.equivalent_local_minor
  );
end;
$$;

revoke all on function public.complete_pending_payment_receipt_rate(uuid, uuid) from public, anon;
grant execute on function public.complete_pending_payment_receipt_rate(uuid, uuid) to authenticated;
