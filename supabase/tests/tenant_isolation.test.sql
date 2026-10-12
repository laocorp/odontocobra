begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(7);

insert into auth.users(id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, email_confirmed_at)
values
  ('11111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated', 'owner-a@example.test', 'test-only', '{"provider":"email","providers":["email"]}', '{"clinic_name":"Consultorio A"}', now()),
  ('22222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated', 'owner-b@example.test', 'test-only', '{"provider":"email","providers":["email"]}', '{"clinic_name":"Consultorio B"}', now()),
  ('33333333-3333-4333-8333-333333333333', 'authenticated', 'authenticated', 'assistant-a@example.test', 'test-only', '{"provider":"email","providers":["email"]}', '{"clinic_name":"No se usa para roles"}', now());

insert into public.clinic_members(clinic_id, user_id, role)
select clinic_id, '33333333-3333-4333-8333-333333333333', 'assistant'
from public.clinic_members where user_id = '11111111-1111-4111-8111-111111111111';

insert into public.patients(clinic_id, full_name)
select clinic_id, 'Paciente ficticio A' from public.clinic_members where user_id = '11111111-1111-4111-8111-111111111111' and role = 'owner';
insert into public.patients(clinic_id, full_name)
select clinic_id, 'Paciente ficticio B' from public.clinic_members where user_id = '22222222-2222-4222-8222-222222222222' and role = 'owner';

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select is((select count(*)::integer from public.patients), 1, 'owner sees patients from own clinic');
select is((select count(*)::integer from public.patients where full_name = 'Paciente ficticio B'), 0, 'owner cannot see another clinic patients');
select ok(private.is_clinic_member((select clinic_id from public.clinic_members where user_id = auth.uid())), 'own clinic membership passes');
select ok(not private.is_clinic_member((select id from public.clinics where name = 'Consultorio B')), 'other clinic membership is denied');
select lives_ok($$select public.create_treatment_plan(
  (select clinic_id from public.clinic_members where user_id = auth.uid()),
  (select id from public.patients where full_name = 'Paciente ficticio A'),
  'Plan de prueba', 10001, 3, current_date, null
)$$, 'owner can create a plan for own patient');
select is((select sum(i.amount_usd_cents)::bigint from public.installments i join public.treatment_plans p on p.clinic_id = i.clinic_id and p.id = i.plan_id where p.description = 'Plan de prueba'), 10001::bigint, 'installments preserve exact plan total');
select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);
select throws_ok($$select public.reverse_payment(
  (select clinic_id from public.clinic_members where user_id = '33333333-3333-4333-8333-333333333333'),
  '99999999-9999-4999-8999-999999999999', 'Prueba sin permiso'
)$$, '42501', 'Solo la persona propietaria puede revertir pagos.', 'assistant cannot reverse a payment');

select * from finish();
rollback;
