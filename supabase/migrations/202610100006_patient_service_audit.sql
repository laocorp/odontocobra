create or replace function private.audit_patient_service_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic_id uuid;
  v_entity_id uuid;
  v_entity_type text;
  v_action text;
  v_fields jsonb;
  v_uid uuid := auth.uid();
begin
  -- Background maintenance without an authenticated actor is not a user audit event.
  if v_uid is null then
    return new;
  end if;

  v_clinic_id := case when tg_table_name = 'clinics' then new.id else new.clinic_id end;
  v_entity_id := new.id;
  v_entity_type := case when tg_table_name = 'patients' then 'patient' when tg_table_name = 'services' then 'service' else 'clinic' end;

  if tg_op = 'INSERT' then
    v_action := v_entity_type || '.created';
    select coalesce(jsonb_agg(k order by k), '[]'::jsonb)
      into v_fields
      from jsonb_object_keys(to_jsonb(new)) as field_keys(k)
      where k not in ('created_at', 'updated_at');
  else
    select coalesce(jsonb_agg(k order by k), '[]'::jsonb)
      into v_fields
      from jsonb_object_keys(to_jsonb(new)) as field_keys(k)
      where k <> 'updated_at'
        and (to_jsonb(new) -> k) is distinct from (to_jsonb(old) -> k);

    if jsonb_array_length(v_fields) = 0 then
      return new;
    end if;

    if tg_table_name = 'patients' and old.archived_at is null and new.archived_at is not null then
      v_action := 'patient.archived';
    elsif tg_table_name = 'services' and old.active and not new.active then
      v_action := 'service.archived';
    elsif tg_table_name = 'services' and not old.active and new.active then
      v_action := 'service.activated';
    else
      v_action := v_entity_type || '.updated';
    end if;
  end if;

  insert into public.audit_events (clinic_id, actor_id, action, entity_type, entity_id, details)
    values (v_clinic_id, v_uid, v_action, v_entity_type, v_entity_id, jsonb_build_object('changed_fields', v_fields));

  return new;
end;
$$;

revoke all on function private.audit_patient_service_changes() from public, anon, authenticated;

create trigger patients_audit_changes
  after insert or update on public.patients
  for each row execute function private.audit_patient_service_changes();

create trigger services_audit_changes
  after insert or update on public.services
  for each row execute function private.audit_patient_service_changes();

create trigger clinics_audit_changes
  after update on public.clinics
  for each row execute function private.audit_patient_service_changes();
