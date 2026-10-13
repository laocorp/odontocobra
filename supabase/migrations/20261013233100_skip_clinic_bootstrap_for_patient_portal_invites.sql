-- Patient portal invitations create an Auth user before the portal access row.
-- Keep those users out of the clinic owner bootstrap path. The marker only
-- suppresses clinic creation; portal access is still granted exclusively by
-- create_patient_portal_invitation after its server-side checks.
create or replace function private.bootstrap_clinic_for_new_user()
returns trigger language plpgsql security definer
set search_path = ''
as $$
declare
  v_clinic_id uuid;
  v_name text;
begin
  if new.invited_at is not null
    or new.raw_user_meta_data ->> 'odonto_portal' = 'patient' then
    return new;
  end if;

  v_name := coalesce(nullif(left(trim(new.raw_user_meta_data ->> 'clinic_name'), 120), ''), 'Mi consultorio');
  insert into public.clinics(name) values (v_name) returning id into v_clinic_id;
  insert into public.clinic_members(clinic_id, user_id, role) values (v_clinic_id, new.id, 'owner');
  insert into public.clinic_receipt_counters(clinic_id) values (v_clinic_id);
  return new;
end;
$$;
revoke all on function private.bootstrap_clinic_for_new_user() from public, anon, authenticated;
