-- A clinic's due-date status must use its own calendar day, not the database
-- session timezone. This keeps the dashboard and installment list consistent
-- with the timezone configured for the clinic.
create or replace view public.installment_balances with (security_invoker = true) as
select i.clinic_id, i.id as installment_id, i.plan_id, tp.patient_id, i.sequence, i.due_on,
  i.amount_usd_cents, coalesce(sum(pa.amount_usd_cents) filter (where p.id is not null and r.id is null), 0)::bigint as paid_usd_cents,
  greatest(i.amount_usd_cents - coalesce(sum(pa.amount_usd_cents) filter (where p.id is not null and r.id is null), 0), 0)::bigint as balance_usd_cents,
  case when i.amount_usd_cents <= coalesce(sum(pa.amount_usd_cents) filter (where p.id is not null and r.id is null), 0) then 'paid'
       when i.due_on < (now() at time zone c.timezone)::date then 'overdue' else 'pending' end as balance_status
from public.installments i
join public.treatment_plans tp on tp.clinic_id = i.clinic_id and tp.id = i.plan_id
join public.clinics c on c.id = i.clinic_id
left join public.payment_allocations pa on pa.clinic_id = i.clinic_id and pa.installment_id = i.id
left join public.payments p on p.clinic_id = pa.clinic_id and p.id = pa.payment_id and p.status = 'confirmed'
left join public.payment_reversals r on r.clinic_id = p.clinic_id and r.payment_id = p.id
group by i.clinic_id, i.id, tp.patient_id, c.timezone;

grant select on public.installment_balances to authenticated;
