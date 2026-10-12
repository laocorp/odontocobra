create extension if not exists pgcrypto with schema extensions;

create type public.clinic_role as enum ('owner', 'assistant');
create type public.plan_status as enum ('active', 'completed', 'cancelled');
create type public.installment_status as enum ('pending', 'paid', 'overdue', 'cancelled');
create type public.payment_status as enum ('confirmed', 'reversed');
create type public.payment_method as enum ('cash', 'mobile_payment', 'bank_transfer', 'card', 'other');

create table public.clinics (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  timezone text not null default 'America/Caracas',
  local_currency text not null default 'VES' check (local_currency ~ '^[A-Z]{3}$'),
  local_precision smallint not null default 2 check (local_precision between 0 and 4),
  created_at timestamptz not null default now(),
  unique (id)
);

create table public.clinic_members (
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.clinic_role not null,
  created_at timestamptz not null default now(),
  primary key (clinic_id, user_id),
  unique (clinic_id, user_id, role)
);
create index clinic_members_user_id_idx on public.clinic_members(user_id);

-- These helpers expose only membership booleans and deliberately keep their lookup
-- in a non-exposed schema so RLS policies cannot recurse through clinic_members.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create or replace function private.is_clinic_member(p_clinic_id uuid)
returns boolean language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.clinic_members cm
    where cm.clinic_id = p_clinic_id and cm.user_id = (select auth.uid())
  );
$$;

create or replace function private.has_clinic_role(p_clinic_id uuid, p_role public.clinic_role)
returns boolean language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.clinic_members cm
    where cm.clinic_id = p_clinic_id and cm.user_id = (select auth.uid()) and cm.role = p_role
  );
$$;
revoke all on function private.is_clinic_member(uuid) from public, anon;
revoke all on function private.has_clinic_role(uuid, public.clinic_role) from public, anon;
grant execute on function private.is_clinic_member(uuid) to authenticated;
grant execute on function private.has_clinic_role(uuid, public.clinic_role) to authenticated;

create table public.patients (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  full_name text not null check (char_length(full_name) between 2 and 160),
  phone text check (phone is null or char_length(phone) <= 40),
  email text check (email is null or char_length(email) <= 254),
  contact_notes text check (contact_notes is null or char_length(contact_notes) <= 1000),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (clinic_id, id)
);
create index patients_clinic_name_idx on public.patients(clinic_id, lower(full_name)) where archived_at is null;

create table public.services (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 140),
  category text not null default 'General' check (char_length(category) <= 80),
  base_price_usd_cents bigint not null check (base_price_usd_cents > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (clinic_id, id)
);

create table public.treatment_plans (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid not null,
  service_id uuid,
  description text not null check (char_length(description) between 2 and 500),
  total_usd_cents bigint not null check (total_usd_cents > 0),
  status public.plan_status not null default 'active',
  starts_on date not null default current_date,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  unique (clinic_id, id),
  foreign key (clinic_id, patient_id) references public.patients(clinic_id, id),
  foreign key (clinic_id, service_id) references public.services(clinic_id, id)
);
create index treatment_plans_clinic_patient_idx on public.treatment_plans(clinic_id, patient_id, created_at desc);

create table public.installments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null,
  plan_id uuid not null,
  sequence smallint not null check (sequence between 1 and 120),
  due_on date not null,
  amount_usd_cents bigint not null check (amount_usd_cents > 0),
  status public.installment_status not null default 'pending',
  created_at timestamptz not null default now(),
  unique (clinic_id, id),
  unique (clinic_id, plan_id, sequence),
  foreign key (clinic_id, plan_id) references public.treatment_plans(clinic_id, id)
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null,
  patient_id uuid not null,
  amount_usd_cents bigint not null check (amount_usd_cents > 0),
  received_currency text not null default 'USD' check (received_currency in ('USD', 'VES')),
  received_local_minor bigint check (received_local_minor is null or received_local_minor > 0),
  exchange_rate numeric(24, 10) check (exchange_rate is null or exchange_rate > 0),
  rate_source text check (rate_source is null or rate_source in ('BCV', 'manual_owner')),
  rate_as_of timestamptz,
  rate_validated_at timestamptz,
  method public.payment_method not null,
  reference text check (reference is null or char_length(reference) <= 120),
  notes text check (notes is null or char_length(notes) <= 500),
  status public.payment_status not null default 'confirmed',
  idempotency_key uuid not null,
  receipt_number bigint,
  received_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references auth.users(id),
  unique (clinic_id, id),
  unique (clinic_id, idempotency_key),
  unique (clinic_id, receipt_number),
  foreign key (clinic_id, patient_id) references public.patients(clinic_id, id),
  check ((received_currency = 'USD' and received_local_minor is null and ((exchange_rate is null and rate_source is null and rate_as_of is null)
          or (exchange_rate is not null and rate_source is not null and rate_as_of is not null))
      or (received_currency = 'VES' and received_local_minor is not null and exchange_rate is not null and rate_source is not null and rate_as_of is not null))),
  check (rate_source <> 'manual_owner' or rate_validated_at is not null)
);
create index payments_clinic_received_idx on public.payments(clinic_id, received_at desc);

create table public.payment_allocations (
  clinic_id uuid not null,
  payment_id uuid not null,
  installment_id uuid not null,
  amount_usd_cents bigint not null check (amount_usd_cents > 0),
  created_at timestamptz not null default now(),
  primary key (clinic_id, payment_id, installment_id),
  foreign key (clinic_id, payment_id) references public.payments(clinic_id, id),
  foreign key (clinic_id, installment_id) references public.installments(clinic_id, id)
);

create table public.payment_reversals (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null,
  payment_id uuid not null,
  reason text not null check (char_length(reason) between 5 and 500),
  reversed_by uuid not null default auth.uid() references auth.users(id),
  reversed_at timestamptz not null default now(),
  unique (clinic_id, payment_id),
  foreign key (clinic_id, payment_id) references public.payments(clinic_id, id)
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  clinic_id uuid not null references public.clinics(id),
  actor_id uuid not null default auth.uid() references auth.users(id),
  action text not null check (char_length(action) between 2 and 100),
  entity_type text not null check (char_length(entity_type) between 2 and 80),
  entity_id uuid,
  details jsonb not null default '{}'::jsonb check (pg_column_size(details) <= 8192),
  created_at timestamptz not null default now()
);
create index audit_events_clinic_created_idx on public.audit_events(clinic_id, created_at desc);

create table public.clinic_receipt_counters (
  clinic_id uuid primary key references public.clinics(id) on delete cascade,
  last_number bigint not null default 0 check (last_number >= 0)
);

-- Signup creates one isolated clinic and assigns its creator as owner. User-provided
-- metadata is used only as a display label, never to grant a role or set membership.
create or replace function private.bootstrap_clinic_for_new_user()
returns trigger language plpgsql security definer
set search_path = ''
as $$
declare
  v_clinic_id uuid;
  v_name text;
begin
  v_name := coalesce(nullif(left(trim(new.raw_user_meta_data ->> 'clinic_name'), 120), ''), 'Mi consultorio');
  insert into public.clinics(name) values (v_name) returning id into v_clinic_id;
  insert into public.clinic_members(clinic_id, user_id, role) values (v_clinic_id, new.id, 'owner');
  insert into public.clinic_receipt_counters(clinic_id) values (v_clinic_id);
  return new;
end;
$$;
revoke all on function private.bootstrap_clinic_for_new_user() from public, anon, authenticated;
create trigger on_auth_user_created_bootstrap_clinic
  after insert on auth.users
  for each row execute function private.bootstrap_clinic_for_new_user();

create or replace function private.set_updated_at()
returns trigger language plpgsql set search_path = ''
as $$ begin new.updated_at = now(); return new; end; $$;
create trigger patients_set_updated_at before update on public.patients
for each row execute function private.set_updated_at();
revoke all on function private.set_updated_at() from public, anon, authenticated;

-- Keep confirmed payment facts and their original receipt snapshots immutable.
create or replace function private.prevent_confirmed_payment_mutation()
returns trigger language plpgsql set search_path = ''
as $$
begin
  raise exception 'Los pagos son inmutables; registra una reversión auditada.' using errcode = '55000';
end;
$$;
create trigger payments_are_immutable before update or delete on public.payments
for each row execute function private.prevent_confirmed_payment_mutation();
revoke all on function private.prevent_confirmed_payment_mutation() from public, anon, authenticated;

alter table public.clinics enable row level security;
alter table public.clinic_members enable row level security;
alter table public.patients enable row level security;
alter table public.services enable row level security;
alter table public.treatment_plans enable row level security;
alter table public.installments enable row level security;
alter table public.payments enable row level security;
alter table public.payment_allocations enable row level security;
alter table public.payment_reversals enable row level security;
alter table public.audit_events enable row level security;
alter table public.clinic_receipt_counters enable row level security;

create policy clinics_read_member on public.clinics for select to authenticated using (private.is_clinic_member(id));
create policy clinics_update_owner on public.clinics for update to authenticated using (private.has_clinic_role(id, 'owner')) with check (private.has_clinic_role(id, 'owner'));
create policy members_read_clinic on public.clinic_members for select to authenticated using (private.is_clinic_member(clinic_id));
create policy patients_read_clinic on public.patients for select to authenticated using (private.is_clinic_member(clinic_id));
create policy patients_insert_clinic on public.patients for insert to authenticated with check (private.is_clinic_member(clinic_id));
create policy patients_update_clinic on public.patients for update to authenticated using (private.is_clinic_member(clinic_id)) with check (private.is_clinic_member(clinic_id));
create policy services_read_clinic on public.services for select to authenticated using (private.is_clinic_member(clinic_id));
create policy services_write_owner on public.services for all to authenticated using (private.has_clinic_role(clinic_id, 'owner')) with check (private.has_clinic_role(clinic_id, 'owner'));
create policy plans_read_clinic on public.treatment_plans for select to authenticated using (private.is_clinic_member(clinic_id));
create policy plans_insert_clinic on public.treatment_plans for insert to authenticated with check (private.is_clinic_member(clinic_id) and created_by = (select auth.uid()));
create policy plans_update_owner on public.treatment_plans for update to authenticated using (private.has_clinic_role(clinic_id, 'owner')) with check (private.has_clinic_role(clinic_id, 'owner'));
create policy installments_read_clinic on public.installments for select to authenticated using (private.is_clinic_member(clinic_id));
create policy installments_insert_clinic on public.installments for insert to authenticated with check (private.is_clinic_member(clinic_id));
create policy installments_update_owner on public.installments for update to authenticated using (private.has_clinic_role(clinic_id, 'owner')) with check (private.has_clinic_role(clinic_id, 'owner'));
create policy payments_read_clinic on public.payments for select to authenticated using (private.is_clinic_member(clinic_id));
create policy payments_insert_clinic on public.payments for insert to authenticated with check (private.is_clinic_member(clinic_id) and created_by = (select auth.uid()));
create policy allocations_read_clinic on public.payment_allocations for select to authenticated using (private.is_clinic_member(clinic_id));
create policy allocations_insert_clinic on public.payment_allocations for insert to authenticated with check (private.is_clinic_member(clinic_id));
create policy reversals_read_clinic on public.payment_reversals for select to authenticated using (private.is_clinic_member(clinic_id));
create policy reversals_owner_insert on public.payment_reversals for insert to authenticated with check (private.has_clinic_role(clinic_id, 'owner') and reversed_by = (select auth.uid()));
create policy audit_read_owner on public.audit_events for select to authenticated using (private.has_clinic_role(clinic_id, 'owner'));
create policy audit_insert_member on public.audit_events for insert to authenticated with check (private.is_clinic_member(clinic_id) and actor_id = (select auth.uid()));
create policy receipt_counter_read_owner on public.clinic_receipt_counters for select to authenticated using (private.has_clinic_role(clinic_id, 'owner'));

grant select, update on public.clinics to authenticated;
grant select on public.clinic_members to authenticated;
grant select, insert, update on public.patients to authenticated;
grant select, insert, update, delete on public.services to authenticated;
grant select, insert, update on public.treatment_plans to authenticated;
grant select, insert, update on public.installments to authenticated;
grant select, insert on public.payments to authenticated;
grant select, insert on public.payment_allocations to authenticated;
grant select, insert on public.payment_reversals to authenticated;
grant select, insert on public.audit_events to authenticated;
grant select on public.clinic_receipt_counters to authenticated;

comment on table public.patients is 'Datos de contacto y cobranza únicamente; no guardar historias clínicas.';
comment on table public.payments is 'Hechos de pago inmutables. Las correcciones se registran en payment_reversals.';
