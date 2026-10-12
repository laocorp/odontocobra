begin;

select plan(20);

-- Fixture users are deliberately unrelated to any real account. Creating them
-- also exercises the auth-user clinic bootstrap trigger.
insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, invited_at
) values
  ('10000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'rls-a@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now(), null),
  ('10000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'rls-b@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now(), null),
  ('10000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'rls-assistant@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now(), null),
  ('10000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'rls-invited@example.test', '', null, '{}'::jsonb, '{}'::jsonb, now(), now(), now());

insert into public.clinics (id, name) values
  ('20000000-0000-4000-8000-000000000001', 'Clínica RLS A'),
  ('20000000-0000-4000-8000-000000000002', 'Clínica RLS B');

insert into public.clinic_members (clinic_id, user_id, role) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'owner'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'owner'),
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', 'assistant');

insert into public.patients (id, clinic_id, full_name, national_id, phone) values
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Paciente de prueba A', 'V-00.000.001', '+584120000001'),
  ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'Paciente de prueba B', 'V-00.000.002', '+584120000002');

insert into public.services (clinic_id, name, base_price_usd_cents)
values ('20000000-0000-4000-8000-000000000001', 'Servicio RLS A', 10000);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select is(
  (select count(*) from public.clinics where id = '20000000-0000-4000-8000-000000000001'),
  1::bigint,
  'a member can read their own clinic'
);
select is(
  (select count(*) from public.list_clinic_members('20000000-0000-4000-8000-000000000001')),
  2::bigint,
  'the owner can read clinic members for the team screen'
);
select is(
  (select count(*) from public.clinics where id = '20000000-0000-4000-8000-000000000002'),
  0::bigint,
  'a member cannot read another clinic'
);
select is(
  (select count(*) from public.patients),
  1::bigint,
  'patient rows are isolated by clinic membership'
);
select throws_ok(
  $$insert into public.patients (clinic_id, full_name) values ('20000000-0000-4000-8000-000000000002', 'Paciente intruso')$$,
  '42501',
  null,
  'a member cannot insert a patient into another clinic'
);

select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
select is(
  (select count(*) from public.clinic_members where user_id = '10000000-0000-4000-8000-000000000004'),
  0::bigint,
  'an invited auth user is not bootstrapped as a clinic owner'
);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select throws_ok(
  $$update public.patients set clinic_id = '20000000-0000-4000-8000-000000000002' where id = '30000000-0000-4000-8000-000000000001'$$,
  '42501',
  null,
  'a member cannot move a patient into another clinic'
);

select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select throws_ok(
  $$select count(*) from public.list_clinic_members('20000000-0000-4000-8000-000000000001')$$,
  '42501',
  null,
  'an assistant cannot enumerate clinic member emails'
);
select throws_ok(
  $$select public.revoke_clinic_member('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003')$$,
  '42501',
  null,
  'an assistant cannot revoke team access'
);
select throws_ok(
  $$select public.find_auth_user_by_email('rls-b@example.test')$$,
  '42501',
  null,
  'auth user lookup is unavailable to authenticated clients'
);
select is(
  (select count(*) from public.patients),
  1::bigint,
  'an assistant can consult patient records in their clinic'
);
select is(
  (with changed as (update public.patients set phone = '+584121234567' where id = '30000000-0000-4000-8000-000000000001' returning 1) select count(*) from changed),
  0::bigint,
  'an assistant cannot edit patient contact details'
);
select throws_ok(
  $$insert into public.treatment_plans (clinic_id, patient_id, description, total_usd_cents) values ('20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'Plan no autorizado', 10000)$$,
  '42501',
  null,
  'an assistant cannot create treatment plans'
);
select throws_ok(
  $$delete from public.patients where id = '30000000-0000-4000-8000-000000000001'$$,
  '42501',
  null,
  'an assistant cannot delete patient records'
);
select is(
  (with changed as (update public.clinics set name = 'Nombre no autorizado' where id = '20000000-0000-4000-8000-000000000001' returning 1) select count(*) from changed),
  0::bigint,
  'an assistant cannot change clinic settings'
);
select throws_ok(
  $$insert into public.services (clinic_id, name, base_price_usd_cents) values ('20000000-0000-4000-8000-000000000001', 'Servicio no autorizado', 10000)$$,
  '42501',
  null,
  'an assistant cannot administer the service catalog'
);
select throws_ok(
  $$insert into public.clinic_members (clinic_id, user_id, role) values ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', 'assistant')$$,
  '42501',
  null,
  'an assistant cannot invite or assign clinic members'
);

select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$select public.revoke_clinic_member('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003')$$,
  'the owner can revoke an assistant'
);
select is(
  (select count(*) from public.clinic_members where clinic_id = '20000000-0000-4000-8000-000000000001' and user_id = '10000000-0000-4000-8000-000000000003'),
  0::bigint,
  'revocation removes only the assistant membership'
);
select is(
  (select count(*) from public.audit_events where clinic_id = '20000000-0000-4000-8000-000000000001' and actor_id = '10000000-0000-4000-8000-000000000001' and action = 'clinic_member.revoked' and entity_id = '10000000-0000-4000-8000-000000000003'),
  1::bigint,
  'assistant revocation is recorded in the audit log'
);

select * from finish();
rollback;
