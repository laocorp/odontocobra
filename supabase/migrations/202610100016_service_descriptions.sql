-- Keep a service description in the live catalog and snapshot the agreed text
-- into each plan item when the plan is created.
alter table public.services
  add column description text not null default ''
    check (char_length(description) <= 500);

alter table public.plan_items
  add column service_description text not null default ''
    check (char_length(service_description) <= 500);

create or replace function private.snapshot_plan_item_service_details()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select s.name, s.category, s.description
    into new.service_name, new.service_category, new.service_description
  from public.services s
  where s.clinic_id = new.clinic_id
    and s.id = new.service_id
    and s.active;

  if not found then
    raise exception 'El servicio ya no está disponible en este consultorio.' using errcode = '22023';
  end if;

  return new;
end;
$$;

revoke all on function private.snapshot_plan_item_service_details() from public, anon, authenticated;
drop trigger if exists plan_items_snapshot_service_details on public.plan_items;
create trigger plan_items_snapshot_service_details
  before insert on public.plan_items
  for each row execute function private.snapshot_plan_item_service_details();
