-- Existing auth accounts may predate the signup trigger that creates their
-- first clinic. Let an authenticated account provision its own clinic once.
create or replace function public.create_clinic_for_current_user(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_clinic_id uuid;
  v_name text := nullif(btrim(p_name), '');
begin
  if v_user_id is null then
    raise exception 'Inicia sesión para crear tu consultorio.' using errcode = '42501';
  end if;

  if v_name is null or char_length(v_name) not between 2 and 120 then
    raise exception 'El nombre debe tener entre 2 y 120 caracteres.' using errcode = '22023';
  end if;

  -- Serialize concurrent onboarding requests for this user and make retries
  -- idempotent if a previous response was lost after the transaction committed.
  perform 1 from auth.users u where u.id = v_user_id for update;
  select cm.clinic_id into v_clinic_id
  from public.clinic_members cm
  where cm.user_id = v_user_id
  order by cm.created_at
  limit 1;
  if v_clinic_id is not null then
    return v_clinic_id;
  end if;

  insert into public.clinics(name) values (v_name) returning id into v_clinic_id;
  insert into public.clinic_members(clinic_id, user_id, role)
    values (v_clinic_id, v_user_id, 'owner');
  insert into public.clinic_receipt_counters(clinic_id) values (v_clinic_id);
  insert into public.audit_events(clinic_id, actor_id, action, entity_type, entity_id, details)
    values (v_clinic_id, v_user_id, 'clinic.created', 'clinic', v_clinic_id,
      jsonb_build_object('source', 'self_service_onboarding'));

  return v_clinic_id;
end;
$$;

revoke all on function public.create_clinic_for_current_user(text) from public, anon;
grant execute on function public.create_clinic_for_current_user(text) to authenticated;
