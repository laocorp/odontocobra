-- Keep the dashboard aggregate aligned with its contract: only confirmed,
-- non-reversed payments count toward the clinic-local month.
create or replace function public.clinic_payment_metrics(p_clinic_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_timezone text;
  v_month_start date;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_collected_usd_cents bigint;
  v_confirmed_count bigint;
  v_last_received_at timestamptz;
begin
  if not private.is_clinic_member(p_clinic_id) then
    raise exception 'No perteneces a este consultorio.' using errcode = '42501';
  end if;

  select c.timezone into v_timezone
  from public.clinics c where c.id = p_clinic_id;
  if not found then
    raise exception 'No encontramos el consultorio.' using errcode = 'P0002';
  end if;

  v_month_start := date_trunc('month', now() at time zone v_timezone)::date;
  v_period_start := v_month_start::timestamp at time zone v_timezone;
  v_period_end := (v_month_start + interval '1 month')::timestamp at time zone v_timezone;

  select coalesce(sum(p.amount_usd_cents), 0)::bigint, count(*)::bigint, max(p.received_at)
    into v_collected_usd_cents, v_confirmed_count, v_last_received_at
  from public.payments p
  where p.clinic_id = p_clinic_id
    and p.status = 'confirmed'
    and p.received_at >= v_period_start
    and p.received_at < v_period_end
    and not exists (
      select 1 from public.payment_reversals r
      where r.clinic_id = p.clinic_id and r.payment_id = p.id
    );

  return jsonb_build_object(
    'monthly_collected_usd_cents', v_collected_usd_cents,
    'confirmed_payment_count', v_confirmed_count,
    'last_received_at', v_last_received_at
  );
end;
$$;

revoke all on function public.clinic_payment_metrics(uuid) from public, anon;
grant execute on function public.clinic_payment_metrics(uuid) to authenticated;
