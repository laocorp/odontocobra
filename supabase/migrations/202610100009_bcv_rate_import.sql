create or replace function public.record_bcv_exchange_rate(
  p_clinic_id uuid,
  p_rate numeric,
  p_as_of timestamptz,
  p_actor_id uuid
)
returns table(id uuid, rate numeric, source text, as_of timestamptz, validated_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rate_id uuid;
  v_rate numeric;
  v_as_of timestamptz;
  v_validated_at timestamptz;
  v_inserted boolean := false;
begin
  if p_rate is null or p_rate <= 0 or p_as_of is null or p_actor_id is null then
    raise exception 'Tasa BCV o datos de validación inválidos.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.clinic_members cm where cm.clinic_id = p_clinic_id and cm.user_id = p_actor_id) then
    raise exception 'La persona que solicitó la tasa no pertenece a este consultorio.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.clinics c where c.id = p_clinic_id and c.local_currency = 'VES') then
    raise exception 'La tasa BCV solo aplica a consultorios que cobran en VES.' using errcode = '22023';
  end if;

  insert into public.exchange_rates(clinic_id, source, rate, local_currency, as_of, validated_by)
    values (p_clinic_id, 'BCV', p_rate, 'VES', p_as_of, p_actor_id)
    on conflict (clinic_id, as_of, rate) where (source = 'BCV') do nothing
    returning exchange_rates.id, exchange_rates.rate, exchange_rates.as_of, exchange_rates.validated_at
      into v_rate_id, v_rate, v_as_of, v_validated_at;
  v_inserted := found;

  if not v_inserted then
    select er.id, er.rate, er.as_of, er.validated_at
      into v_rate_id, v_rate, v_as_of, v_validated_at
      from public.exchange_rates er
      where er.clinic_id = p_clinic_id and er.source = 'BCV' and er.as_of = p_as_of and er.rate = p_rate;
    if not found then raise exception 'No se pudo guardar la tasa BCV.' using errcode = '55000'; end if;
  else
    insert into public.audit_events(clinic_id, actor_id, action, entity_type, entity_id, details)
      values (p_clinic_id, p_actor_id, 'exchange_rate.bcv_imported', 'exchange_rate', v_rate_id,
        jsonb_build_object('rate', v_rate, 'currency', 'VES', 'as_of', v_as_of, 'source_url', 'https://www.bcv.org.ve/'));
  end if;

  return query select v_rate_id, v_rate, 'BCV'::text, v_as_of, v_validated_at;
end;
$$;
revoke all on function public.record_bcv_exchange_rate(uuid, numeric, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.record_bcv_exchange_rate(uuid, numeric, timestamptz, uuid) to service_role;
