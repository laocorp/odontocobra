-- Invitations create auth.users rows before the recipient accepts the email.
-- They must not trigger the self-signup bootstrap that grants clinic ownership.
create or replace function private.bootstrap_clinic_for_new_user()
returns trigger language plpgsql security definer
set search_path = ''
as $$
declare
  v_clinic_id uuid;
  v_name text;
begin
  if new.invited_at is not null then
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

-- Migration 202610100005_patient_owner_management already restricted patient
-- updates to owners. Remove any existing plan-insert policy regardless of its
-- name so a permissive legacy policy cannot bypass the owner-only rule.
-- The catalog loop handles the known legacy policy too, without assuming it
-- still exists after a failed or partially retried migration.

do $$
declare
  v_policy record;
begin
  for v_policy in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'treatment_plans' and cmd in ('INSERT', 'ALL')
  loop
    execute format('drop policy %I on public.treatment_plans', v_policy.policyname);
  end loop;
end;
$$;

create policy plans_insert_owner on public.treatment_plans for insert to authenticated
  with check (private.has_clinic_role(clinic_id, 'owner') and created_by = (select auth.uid()));

-- Apply the same rule to installment creation, independent of the previous
-- policy name recorded in the database.
do $$
declare
  v_policy record;
begin
  for v_policy in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'installments' and cmd in ('INSERT', 'ALL')
  loop
    execute format('drop policy %I on public.installments', v_policy.policyname);
  end loop;
end;
$$;

create policy installments_insert_owner on public.installments for insert to authenticated
  with check (private.has_clinic_role(clinic_id, 'owner'));

-- The plan RPC runs as SECURITY DEFINER, so RLS insert policies alone cannot
-- enforce this role boundary. Check the caller's membership from triggers too.
create or replace function private.require_owner_for_plan_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.has_clinic_role(new.clinic_id, 'owner') then
    raise exception 'Solo la persona propietaria puede crear planes y cuotas.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.require_owner_for_plan_insert() from public, anon, authenticated;
drop trigger if exists treatment_plans_require_owner on public.treatment_plans;
create trigger treatment_plans_require_owner
  before insert on public.treatment_plans
  for each row execute function private.require_owner_for_plan_insert();
drop trigger if exists installments_require_owner on public.installments;
create trigger installments_require_owner
  before insert on public.installments
  for each row execute function private.require_owner_for_plan_insert();

create or replace function public.list_clinic_members(p_clinic_id uuid)
returns table(user_id uuid, email text, role public.clinic_role, created_at timestamptz, invitation_pending boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_clinic_role(p_clinic_id, 'owner') then
    raise exception 'Solo la persona propietaria puede consultar el equipo.' using errcode = '42501';
  end if;

  return query
    select cm.user_id, u.email::text, cm.role, cm.created_at,
      (u.invited_at is not null and u.email_confirmed_at is null)
    from public.clinic_members cm
    join auth.users u on u.id = cm.user_id
    where cm.clinic_id = p_clinic_id
    order by (cm.role = 'owner') desc, cm.created_at;
end;
$$;
revoke all on function public.list_clinic_members(uuid) from public, anon;
grant execute on function public.list_clinic_members(uuid) to authenticated;

create or replace function public.revoke_clinic_member(p_clinic_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.clinic_role;
begin
  if not private.has_clinic_role(p_clinic_id, 'owner') then
    raise exception 'Solo la persona propietaria puede cambiar el equipo.' using errcode = '42501';
  end if;

  select cm.role into v_role
  from public.clinic_members cm
  where cm.clinic_id = p_clinic_id and cm.user_id = p_user_id
  for update;
  if not found then
    raise exception 'La persona no pertenece a este consultorio.' using errcode = 'P0002';
  end if;
  if v_role <> 'assistant' then
    raise exception 'La cuenta propietaria no se puede revocar desde esta pantalla.' using errcode = '42501';
  end if;

  insert into public.audit_events(clinic_id, actor_id, action, entity_type, entity_id, details)
  values (p_clinic_id, (select auth.uid()), 'clinic_member.revoked', 'clinic_member', p_user_id,
    jsonb_build_object('role', v_role));
  delete from public.clinic_members cm where cm.clinic_id = p_clinic_id and cm.user_id = p_user_id;
end;
$$;
revoke all on function public.revoke_clinic_member(uuid, uuid) from public, anon;
grant execute on function public.revoke_clinic_member(uuid, uuid) to authenticated;

-- Service-role-only lookup lets the invitation function add existing accounts
-- without exposing auth.users to the browser or scanning the Auth user directory.
create or replace function public.find_auth_user_by_email(p_email text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Acceso reservado al servicio de invitaciones.' using errcode = '42501';
  end if;
  select u.id into v_user_id from auth.users u where lower(u.email) = lower(trim(p_email)) limit 1;
  return v_user_id;
end;
$$;
revoke all on function public.find_auth_user_by_email(text) from public, anon, authenticated;
grant execute on function public.find_auth_user_by_email(text) to service_role;
