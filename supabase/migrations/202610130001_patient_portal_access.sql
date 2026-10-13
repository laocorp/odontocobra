-- Patient portal is an isolated, read-only Auth surface. It must never create a
-- clinic_members row or let the browser choose a patient identifier.
create table public.patient_portal_access (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null,
  patient_id uuid not null,
  user_id uuid,
  invited_email text not null check (char_length(invited_email) between 3 and 254 and invited_email = lower(trim(invited_email))),
  status text not null check (status in ('invited', 'active', 'revoked')),
  invited_at timestamptz not null default now(),
  activated_at timestamptz,
  revoked_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (clinic_id, patient_id),
  foreign key (clinic_id, patient_id) references public.patients(clinic_id, id) on delete cascade,
  foreign key (user_id) references auth.users(id) on delete cascade,
  check ((status = 'invited' and user_id is not null and activated_at is null and revoked_at is null)
      or (status = 'active' and user_id is not null and activated_at is not null and revoked_at is null)
      or (status = 'revoked' and revoked_at is not null))
);
create unique index patient_portal_access_user_unique
  on public.patient_portal_access (user_id) where user_id is not null;
create index patient_portal_access_clinic_status_idx
  on public.patient_portal_access (clinic_id, status);

alter table public.patient_portal_access enable row level security;
revoke all on public.patient_portal_access from public, anon, authenticated;
-- The clinic dashboard needs safe invitation metadata, never the linked Auth UUID.
grant select (id, clinic_id, patient_id, invited_email, status, invited_at, activated_at, revoked_at, created_at, updated_at)
  on public.patient_portal_access to authenticated;
create policy patient_portal_access_read_owner
  on public.patient_portal_access for select to authenticated
  using (private.has_clinic_role(clinic_id, 'owner'));
-- Edge Functions need server-side lookup of the linked Auth UUID to enforce
-- one-person access and trigger revocation; no browser role receives it.
revoke all on public.patient_portal_access from service_role;
grant select on public.patient_portal_access to service_role;

create or replace function public.create_patient_portal_invitation(
  p_clinic_id uuid,
  p_patient_id uuid,
  p_user_id uuid,
  p_email text,
  p_actor_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_access public.patient_portal_access%rowtype;
  v_access_id uuid;
  v_email text := lower(trim(coalesce(p_email, '')));
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'Acceso reservado al servicio de invitaciones.' using errcode = '42501';
  end if;
  if p_clinic_id is null or p_patient_id is null or p_user_id is null or p_actor_id is null
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Datos de invitación inválidos.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.clinic_members cm
    where cm.clinic_id = p_clinic_id and cm.user_id = p_actor_id and cm.role = 'owner'
  ) then
    raise exception 'Solo la persona propietaria puede invitar al portal.' using errcode = '42501';
  end if;
  perform p.id from public.patients p
    where p.clinic_id = p_clinic_id and p.id = p_patient_id and p.archived_at is null
    for update;
  if not found then
    raise exception 'Paciente inexistente o archivado.' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from auth.users u
    where u.id = p_user_id and lower(u.email) = v_email
  ) then
    raise exception 'El correo no coincide con la cuenta invitada.' using errcode = '22023';
  end if;
  if exists (select 1 from public.clinic_members cm where cm.user_id = p_user_id) then
    raise exception 'La cuenta ya pertenece al personal de un consultorio; usa otro correo.' using errcode = '23505';
  end if;

  -- Serialize first-time invitations as well as updates for this patient.
  perform pg_advisory_xact_lock(hashtextextended(p_clinic_id::text || ':' || p_patient_id::text, 0));
  select a.* into v_access from public.patient_portal_access a
    where a.clinic_id = p_clinic_id and a.patient_id = p_patient_id for update;
  if found then
    if v_access.status in ('invited', 'active') then
      if v_access.user_id = p_user_id and v_access.invited_email = v_email then
        return v_access.id;
      end if;
      raise exception 'Este paciente ya tiene una invitación o acceso activo.' using errcode = '23505';
    end if;
    update public.patient_portal_access a
      set user_id = p_user_id, invited_email = v_email, status = 'invited',
          invited_at = now(), activated_at = null, revoked_at = null, updated_at = now()
      where a.id = v_access.id returning a.id into v_access_id;
  else
    insert into public.patient_portal_access (clinic_id, patient_id, user_id, invited_email, status, invited_at, created_by)
      values (p_clinic_id, p_patient_id, p_user_id, v_email, 'invited', now(), p_actor_id)
      returning id into v_access_id;
  end if;

  insert into public.audit_events (clinic_id, actor_id, action, entity_type, entity_id, details)
  values (p_clinic_id, p_actor_id, 'patient_portal.invited', 'patient_portal_access', v_access_id,
    jsonb_build_object('patient_id', p_patient_id, 'email', v_email));
  return v_access_id;
end;
$$;
revoke all on function public.create_patient_portal_invitation(uuid, uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.create_patient_portal_invitation(uuid, uuid, uuid, text, uuid) to service_role;

create or replace function public.revoke_patient_portal_access(
  p_clinic_id uuid,
  p_access_id uuid,
  p_actor_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_access public.patient_portal_access%rowtype;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'Acceso reservado al servicio de invitaciones.' using errcode = '42501';
  end if;
  if p_clinic_id is null or p_access_id is null or p_actor_id is null then
    raise exception 'Datos de revocación inválidos.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.clinic_members cm
    where cm.clinic_id = p_clinic_id and cm.user_id = p_actor_id and cm.role = 'owner'
  ) then
    raise exception 'Solo la persona propietaria puede revocar el portal.' using errcode = '42501';
  end if;
  select a.* into v_access from public.patient_portal_access a
    where a.clinic_id = p_clinic_id and a.id = p_access_id for update;
  if not found then raise exception 'Acceso al portal no encontrado.' using errcode = 'P0002'; end if;
  if v_access.status <> 'revoked' then
    update public.patient_portal_access a
      set status = 'revoked', revoked_at = now(), updated_at = now()
      where a.id = p_access_id;
    insert into public.audit_events (clinic_id, actor_id, action, entity_type, entity_id, details)
    values (p_clinic_id, p_actor_id, 'patient_portal.revoked', 'patient_portal_access', p_access_id,
      jsonb_build_object('patient_id', v_access.patient_id, 'email', v_access.invited_email));
  end if;
  return true;
end;
$$;
revoke all on function public.revoke_patient_portal_access(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.revoke_patient_portal_access(uuid, uuid, uuid) to service_role;

create or replace function public.activate_patient_portal_access()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
begin
  if v_uid is null then raise exception 'Autenticación requerida.' using errcode = '42501'; end if;
  select lower(u.email) into v_email from auth.users u
    where u.id = v_uid and u.email_confirmed_at is not null;
  if v_email is null then raise exception 'Confirma el correo de invitación para activar el portal.' using errcode = '42501'; end if;
  if exists (
    select 1 from public.patient_portal_access a
    join public.patients p on p.clinic_id = a.clinic_id and p.id = a.patient_id and p.archived_at is null
    where a.user_id = v_uid and a.invited_email = v_email and a.status = 'active'
  ) then return true; end if;
  update public.patient_portal_access a
    set status = 'active', activated_at = now(), updated_at = now()
    from public.patients p
    where a.clinic_id = p.clinic_id and a.patient_id = p.id and p.archived_at is null
      and a.user_id = v_uid and a.invited_email = v_email and a.status = 'invited'
      and not exists (select 1 from public.clinic_members cm where cm.user_id = v_uid);
  if found then return true; end if;
  raise exception 'No existe una invitación activa para esta cuenta.' using errcode = '42501';
end;
$$;
revoke all on function public.activate_patient_portal_access() from public, anon;
grant execute on function public.activate_patient_portal_access() to authenticated;

create or replace function public.patient_portal_session_is_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.patient_portal_access a
    join public.patients p on p.clinic_id = a.clinic_id and p.id = a.patient_id and p.archived_at is null
    where a.user_id = (select auth.uid()) and a.status = 'active'
      and not exists (select 1 from public.clinic_members cm where cm.user_id = a.user_id)
  );
$$;
revoke all on function public.patient_portal_session_is_active() from public, anon;
grant execute on function public.patient_portal_session_is_active() to authenticated;

create or replace function public.get_patient_portal_account()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_clinic_id uuid;
  v_patient_id uuid;
  v_account jsonb;
begin
  if v_uid is null then raise exception 'Autenticación requerida.' using errcode = '42501'; end if;
  select a.clinic_id, a.patient_id into v_clinic_id, v_patient_id
    from public.patient_portal_access a
    join public.patients p on p.clinic_id = a.clinic_id and p.id = a.patient_id and p.archived_at is null
    where a.user_id = v_uid and a.status = 'active'
      and not exists (select 1 from public.clinic_members cm where cm.user_id = v_uid);
  if not found then raise exception 'El acceso al portal está inactivo o fue revocado.' using errcode = '42501'; end if;

  select jsonb_build_object(
    'clinic', jsonb_build_object(
      'name', c.name,
      'timezone', c.timezone,
      'local_currency', c.local_currency,
      'local_precision', c.local_precision
    ),
    'patient', jsonb_build_object(
      'full_name', p.full_name,
      'email', p.email,
      'phone', p.phone
    ),
    'summary', jsonb_build_object(
      'active_plan_count', coalesce(summary.plan_count, 0),
      'total_agreed_usd_cents', coalesce(summary.total_agreed_usd_cents, 0),
      'paid_usd_cents', coalesce(summary.paid_usd_cents, 0),
      'balance_usd_cents', coalesce(summary.balance_usd_cents, 0)
    ),
    'plans', coalesce(plans.items, '[]'::jsonb),
    'payments', coalesce(payments.items, '[]'::jsonb)
  ) into v_account
  from public.clinics c
  join public.patients p on p.clinic_id = c.id
  left join lateral (
    select count(*)::integer as plan_count,
      coalesce(sum(tp.total_usd_cents), 0)::bigint as total_agreed_usd_cents,
      coalesce(sum(coalesce(balance.paid_usd_cents, 0)), 0)::bigint as paid_usd_cents,
      coalesce(sum(coalesce(balance.balance_usd_cents, 0)), 0)::bigint as balance_usd_cents
    from public.treatment_plans tp
    left join lateral (
      select sum(ib.paid_usd_cents)::bigint as paid_usd_cents,
        sum(ib.balance_usd_cents)::bigint as balance_usd_cents
      from public.installment_balances ib
      where ib.clinic_id = tp.clinic_id and ib.plan_id = tp.id
    ) balance on true
    where tp.clinic_id = v_clinic_id and tp.patient_id = v_patient_id and tp.status = 'active'
  ) summary on true
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'id', tp.id,
      'plan_code', tp.plan_code,
      'description', tp.description,
      'status', tp.status,
      'starts_on', tp.starts_on,
      'total_usd_cents', tp.total_usd_cents,
      'paid_usd_cents', coalesce(balance.paid_usd_cents, 0),
      'balance_usd_cents', coalesce(balance.balance_usd_cents, 0),
      'installments', coalesce(installments.items, '[]'::jsonb)
    ) order by tp.created_at desc, tp.id) as items
    from public.treatment_plans tp
    left join lateral (
      select sum(ib.paid_usd_cents)::bigint as paid_usd_cents,
        sum(ib.balance_usd_cents)::bigint as balance_usd_cents
      from public.installment_balances ib
      where ib.clinic_id = tp.clinic_id and ib.plan_id = tp.id
    ) balance on true
    left join lateral (
      select jsonb_agg(jsonb_build_object(
        'id', ib.installment_id,
        'sequence', ib.sequence,
        'due_on', ib.due_on,
        'amount_usd_cents', ib.amount_usd_cents,
        'paid_usd_cents', ib.paid_usd_cents,
        'balance_usd_cents', ib.balance_usd_cents,
        'status', ib.balance_status
      ) order by ib.sequence) as items
      from public.installment_balances ib
      where ib.clinic_id = tp.clinic_id and ib.plan_id = tp.id
    ) installments on true
    where tp.clinic_id = v_clinic_id and tp.patient_id = v_patient_id and tp.status = 'active'
  ) plans on true
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'id', pay.id,
      'receipt_number', pay.receipt_number,
      'received_at', pay.received_at,
      'amount_usd_cents', pay.amount_usd_cents,
      'received_currency', pay.received_currency,
      'received_local_minor', pay.received_local_minor,
      'exchange_rate', pay.exchange_rate,
      'method', pay.method,
      'status', case when reversal.id is null then pay.status::text else 'reversed' end,
      'receipt_snapshot', pay.receipt_snapshot
    ) order by pay.received_at desc, pay.receipt_number desc) as items
    from public.payments pay
    left join public.payment_reversals reversal
      on reversal.clinic_id = pay.clinic_id and reversal.payment_id = pay.id
    where pay.clinic_id = v_clinic_id and pay.patient_id = v_patient_id
  ) payments on true
  where c.id = v_clinic_id and p.id = v_patient_id;
  return v_account;
end;
$$;
revoke all on function public.get_patient_portal_account() from public, anon;
grant execute on function public.get_patient_portal_account() to authenticated;

comment on table public.patient_portal_access is
  'Invited one-to-one patient portal identity mapping. Isolated from clinic_members; authenticated clients cannot write or read linked Auth user IDs.';
comment on function public.get_patient_portal_account() is
  'Read-only JSON account payload for the patient bound to auth.uid(); fails immediately after access revocation.';

