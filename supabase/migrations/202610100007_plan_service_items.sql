create table public.plan_items (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  plan_id uuid not null,
  service_id uuid not null,
  service_name text not null check (char_length(service_name) between 2 and 140),
  service_category text not null check (char_length(service_category) <= 80),
  amount_usd_cents bigint not null check (amount_usd_cents > 0),
  created_at timestamptz not null default now(),
  unique (clinic_id, id),
  unique (clinic_id, plan_id, service_id),
  foreign key (clinic_id, plan_id) references public.treatment_plans(clinic_id, id) on delete cascade,
  foreign key (clinic_id, service_id) references public.services(clinic_id, id) on delete restrict
);

create index plan_items_clinic_plan_idx on public.plan_items(clinic_id, plan_id);
alter table public.plan_items enable row level security;
create policy plan_items_read_clinic on public.plan_items
  for select to authenticated using (private.is_clinic_member(clinic_id));
grant select on public.plan_items to authenticated;

revoke all on function public.create_treatment_plan(uuid, uuid, text, bigint, smallint, date, uuid) from public, anon, authenticated;
drop function public.create_treatment_plan(uuid, uuid, text, bigint, smallint, date, uuid);

create or replace function public.create_treatment_plan(
  p_clinic_id uuid,
  p_patient_id uuid,
  p_installment_count smallint,
  p_first_due_on date,
  p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_plan_id uuid;
  v_sequence integer;
  v_count integer := 0;
  v_base bigint;
  v_remainder bigint;
  v_total bigint := 0;
  v_amount bigint;
  v_service_id uuid;
  v_first_service_id uuid;
  v_service_name text;
  v_service_category text;
  v_description text := '';
  v_item record;
begin
  if v_uid is null or not private.is_clinic_member(p_clinic_id) then
    raise exception 'Acceso al consultorio requerido.' using errcode = '42501';
  end if;
  if p_installment_count is null or p_installment_count not between 1 and 120 or p_first_due_on is null then
    raise exception 'Fecha o cantidad de cuotas inválidas.' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Agrega uno o más servicios al plan.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) not between 1 and 20 then
    raise exception 'Un plan debe contener entre uno y veinte servicios.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.patients p
    where p.clinic_id = p_clinic_id and p.id = p_patient_id and p.archived_at is null
  ) then
    raise exception 'Paciente inexistente en este consultorio.' using errcode = '22023';
  end if;

  for v_item in
    select item.service_id, item.amount_cents
    from jsonb_to_recordset(p_items) as item(service_id uuid, amount_cents bigint)
  loop
    if v_item.service_id is null or v_item.amount_cents is null or v_item.amount_cents <= 0 then
      raise exception 'Cada servicio debe tener un importe acordado válido.' using errcode = '22023';
    end if;
    if exists (
      select 1
      from jsonb_to_recordset(p_items) as duplicate_item(service_id uuid, amount_cents bigint)
      where duplicate_item.service_id = v_item.service_id
      group by duplicate_item.service_id having count(*) > 1
    ) then
      raise exception 'Un servicio no puede aparecer dos veces en el mismo plan.' using errcode = '22023';
    end if;

    select s.name, s.category into v_service_name, v_service_category
    from public.services s
    where s.clinic_id = p_clinic_id and s.id = v_item.service_id and s.active
    for share;
    if not found then
      raise exception 'Un servicio no existe o está inactivo en este consultorio.' using errcode = '22023';
    end if;

    v_count := v_count + 1;
    v_total := v_total + v_item.amount_cents;
    if v_count = 1 then v_first_service_id := v_item.service_id; end if;
    v_description := case when v_description = '' then v_service_name else v_description || ' · ' || v_service_name end;
    if char_length(v_description) > 500 then
      raise exception 'La descripción combinada supera el límite permitido.' using errcode = '22023';
    end if;
  end loop;

  if v_count <> jsonb_array_length(p_items) or v_total < p_installment_count then
    raise exception 'Cada cuota debe tener al menos un centavo.' using errcode = '22023';
  end if;

  insert into public.treatment_plans(clinic_id, patient_id, service_id, description, total_usd_cents, starts_on, created_by)
    values (p_clinic_id, p_patient_id, v_first_service_id, v_description, v_total, current_date, v_uid)
    returning id into v_plan_id;

  for v_item in
    select item.service_id, item.amount_cents
    from jsonb_to_recordset(p_items) as item(service_id uuid, amount_cents bigint)
  loop
    select s.name, s.category into v_service_name, v_service_category
    from public.services s
    where s.clinic_id = p_clinic_id and s.id = v_item.service_id and s.active;
    insert into public.plan_items(clinic_id, plan_id, service_id, service_name, service_category, amount_usd_cents)
      values (p_clinic_id, v_plan_id, v_item.service_id, v_service_name, v_service_category, v_item.amount_cents);
  end loop;

  v_base := v_total / p_installment_count;
  v_remainder := v_total - v_base * p_installment_count;
  for v_sequence in 1..p_installment_count loop
    v_amount := v_base + case when v_sequence = p_installment_count then v_remainder else 0 end;
    insert into public.installments(clinic_id, plan_id, sequence, due_on, amount_usd_cents)
      values (p_clinic_id, v_plan_id, v_sequence, p_first_due_on + ((v_sequence - 1) * interval '1 month'), v_amount);
  end loop;

  insert into public.audit_events(clinic_id, actor_id, action, entity_type, entity_id, details)
    values (p_clinic_id, v_uid, 'plan.created', 'treatment_plan', v_plan_id,
      jsonb_build_object('patient_id', p_patient_id, 'total_usd_cents', v_total, 'installment_count', p_installment_count, 'service_count', v_count));
  return v_plan_id;
end;
$$;

revoke all on function public.create_treatment_plan(uuid, uuid, smallint, date, jsonb) from public, anon;
grant execute on function public.create_treatment_plan(uuid, uuid, smallint, date, jsonb) to authenticated;
