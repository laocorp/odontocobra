-- Include installments due today. The initial function selected tomorrow's date,
-- which excluded installments shown as due today in the dashboard.
create or replace function public.claim_email_payment_reminders()
returns table (
  dispatch_id uuid,
  patient_name text,
  patient_email text,
  clinic_name text,
  amount_usd_cents bigint,
  due_on date,
  installment_sequence smallint
)
language sql
security definer
set search_path = ''
as $$
  with eligible as (
    select c.id as clinic_id, i.id as installment_id, i.due_on,
      p.full_name, p.email, c.name as clinic_name, b.balance_usd_cents,
      i.sequence
    from public.installments i
    join public.clinics c on c.id = i.clinic_id
    join public.treatment_plans tp on tp.clinic_id = i.clinic_id and tp.id = i.plan_id and tp.status = 'active'
    join public.patients p on p.clinic_id = tp.clinic_id and p.id = tp.patient_id
    join public.installment_balances b on b.clinic_id = i.clinic_id and b.installment_id = i.id
    where i.status <> 'cancelled'
      and i.due_on = (now() at time zone c.timezone)::date
      and b.balance_usd_cents > 0
      and p.archived_at is null
      and p.email_reminder_consent_at is not null
      and nullif(btrim(p.email), '') is not null
  ), claimed as (
    insert into public.email_reminder_dispatches (clinic_id, installment_id, due_on)
    select e.clinic_id, e.installment_id, e.due_on from eligible e
    on conflict (clinic_id, installment_id, due_on) do nothing
    returning id, clinic_id, installment_id, due_on
  )
  select claimed.id, eligible.full_name, eligible.email, eligible.clinic_name,
    eligible.balance_usd_cents, eligible.due_on, eligible.sequence
  from claimed
  join eligible on eligible.clinic_id = claimed.clinic_id
    and eligible.installment_id = claimed.installment_id
    and eligible.due_on = claimed.due_on
  order by eligible.due_on, eligible.full_name, eligible.sequence;
$$;

revoke all on function public.claim_email_payment_reminders() from public, anon, authenticated;
grant execute on function public.claim_email_payment_reminders() to service_role;
