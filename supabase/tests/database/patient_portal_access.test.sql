begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(30);

-- Fictional owner and portal identities only; never use real clinic records in SQL tests.
insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, invited_at
) values
  ('51000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'portal-owner-a@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now(), null),
  ('51000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'portal-patient-a@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now(), now()),
  ('51000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'portal-patient-b@example.test', '', null, '{}'::jsonb, '{}'::jsonb, now(), now(), now()),
  ('51000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'portal-owner-b@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now(), null),
  ('51000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'portal-patient-c@example.test', '', null, '{}'::jsonb, '{}'::jsonb, now(), now(), now());

insert into public.clinics (id, name, timezone, local_currency, local_precision) values
  ('52000000-0000-4000-8000-000000000001', 'Clínica Portal A', 'America/Caracas', 'VES', 2),
  ('52000000-0000-4000-8000-000000000002', 'Clínica Portal B', 'America/Guayaquil', 'USD', 2);
insert into public.clinic_members (clinic_id, user_id, role) values
  ('52000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000001', 'owner'),
  ('52000000-0000-4000-8000-000000000002', '51000000-0000-4000-8000-000000000004', 'owner');
insert into public.patients (id, clinic_id, full_name, national_id, email, phone) values
  ('53000000-0000-4000-8000-000000000001', '52000000-0000-4000-8000-000000000001', 'Paciente Portal A', 'V-10000001', 'contacto-paciente-a@example.test', '+584120000001'),
  ('53000000-0000-4000-8000-000000000002', '52000000-0000-4000-8000-000000000002', 'Paciente Portal B', 'V-10000002', 'portal-patient-b@example.test', '+584120000002'),
  ('53000000-0000-4000-8000-000000000003', '52000000-0000-4000-8000-000000000002', 'Paciente Portal C', 'V-10000003', 'portal-patient-c@example.test', '+584120000003');
insert into public.treatment_plans (id, clinic_id, patient_id, plan_code, description, total_usd_cents, status, starts_on, created_by) values
  ('54000000-0000-4000-8000-000000000001', '52000000-0000-4000-8000-000000000001', '53000000-0000-4000-8000-000000000001', 'PL-000001', 'Limpieza dental', 10000, 'active', current_date, '51000000-0000-4000-8000-000000000001');
insert into public.installments (id, clinic_id, plan_id, sequence, due_on, amount_usd_cents) values
  ('55000000-0000-4000-8000-000000000001', '52000000-0000-4000-8000-000000000001', '54000000-0000-4000-8000-000000000001', 1, current_date, 10000);
insert into public.payments (id, clinic_id, patient_id, amount_usd_cents, received_currency, method, idempotency_key, receipt_number, received_at, created_by, receipt_snapshot) values
  ('56000000-0000-4000-8000-000000000001', '52000000-0000-4000-8000-000000000001', '53000000-0000-4000-8000-000000000001', 2500, 'USD', 'cash', '57000000-0000-4000-8000-000000000001', 1, now(), '51000000-0000-4000-8000-000000000001', '{"clinic_name":"Clínica Portal A","patient_name":"Paciente Portal A","receipt_number":1}'::jsonb);
insert into public.payment_allocations (clinic_id, payment_id, installment_id, amount_usd_cents) values
  ('52000000-0000-4000-8000-000000000001', '56000000-0000-4000-8000-000000000001', '55000000-0000-4000-8000-000000000001', 2500);

insert into public.patient_portal_access (id, clinic_id, patient_id, user_id, invited_email, status, invited_at, activated_at, created_by) values
  ('62000000-0000-4000-8000-000000000001', '52000000-0000-4000-8000-000000000001', '53000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000002', 'portal-patient-a@example.test', 'active', now(), now(), '51000000-0000-4000-8000-000000000001'),
  ('62000000-0000-4000-8000-000000000002', '52000000-0000-4000-8000-000000000002', '53000000-0000-4000-8000-000000000002', '51000000-0000-4000-8000-000000000003', 'portal-patient-b@example.test', 'invited', now(), null, '51000000-0000-4000-8000-000000000004');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"51000000-0000-4000-8000-000000000001","role":"authenticated","email":"portal-owner-a@example.test"}', true);
select is((select status from public.patient_portal_access where patient_id = '53000000-0000-4000-8000-000000000001'), 'active', 'clinic owner can read safe portal access status');
select is((select invited_email from public.patient_portal_access where patient_id = '53000000-0000-4000-8000-000000000001'), 'portal-patient-a@example.test', 'portal invitation email is separate from patient contact email');
select set_config('request.jwt.claims', '{"sub":"51000000-0000-4000-8000-000000000002","role":"authenticated","email":"portal-patient-a@example.test"}', true);
select ok(public.patient_portal_session_is_active(), 'active portal user passes the session heartbeat');
select is(public.get_patient_portal_account() -> 'patient' ->> 'full_name', 'Paciente Portal A', 'portal response resolves patient from auth.uid');
select is(public.get_patient_portal_account() -> 'patient' ->> 'email', 'contacto-paciente-a@example.test', 'portal read model preserves original patient contact email');
select is((public.get_patient_portal_account() -> 'summary' ->> 'total_agreed_usd_cents')::bigint, 10000::bigint, 'account summary includes agreed plan amount');
select is((public.get_patient_portal_account() -> 'summary' ->> 'paid_usd_cents')::bigint, 2500::bigint, 'account summary uses confirmed payment allocation');
select is((public.get_patient_portal_account() -> 'summary' ->> 'balance_usd_cents')::bigint, 7500::bigint, 'account summary exposes remaining balance');
select is(public.get_patient_portal_account() -> 'plans' -> 0 ->> 'plan_code', 'PL-000001', 'portal includes only its patient plan');
select is(public.get_patient_portal_account() -> 'plans' -> 0 -> 'installments' -> 0 ->> 'balance_usd_cents', '7500', 'portal includes its installment balance');
select is(public.get_patient_portal_account() -> 'payments' -> 0 ->> 'receipt_number', '1', 'portal includes its receipt record');
select is((select count(*) from public.patients), 0::bigint, 'portal users cannot query patient rows directly');
select ok(not has_column_privilege('authenticated', 'public.patient_portal_access', 'user_id', 'SELECT'), 'portal status query cannot read auth user ids');
select is((select count(id) from public.patient_portal_access), 0::bigint, 'portal user cannot enumerate access rows');

select set_config('request.jwt.claims', '{"sub":"51000000-0000-4000-8000-000000000003","role":"authenticated","email":"portal-patient-b@example.test"}', true);
select ok(not public.patient_portal_session_is_active(), 'invited but inactive account fails the heartbeat');
select throws_ok($$select public.get_patient_portal_account()$$, '42501', null, 'invited account cannot read patient data before activation');
select throws_ok($$select public.activate_patient_portal_access()$$, '42501', null, 'unverified invited email cannot activate');

reset role;
update auth.users set email_confirmed_at = now() where id = '51000000-0000-4000-8000-000000000003';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"51000000-0000-4000-8000-000000000003","role":"authenticated","email":"portal-patient-b@example.test"}', true);
select is(public.activate_patient_portal_access(), true, 'verified invitee can activate only their own link');
select ok(public.patient_portal_session_is_active(), 'activated portal user passes the heartbeat');
select is(public.get_patient_portal_account() -> 'patient' ->> 'full_name', 'Paciente Portal B', 'second account is bound to its own patient only');
select is(public.get_patient_portal_account() -> 'clinic' ->> 'name', 'Clínica Portal B', 'second account cannot resolve another clinic');

select throws_ok($$select public.revoke_patient_portal_access('52000000-0000-4000-8000-000000000001', '62000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000001')$$, '42501', null, 'authenticated users cannot call service-only revoke');
reset role;
set local role service_role;
select set_config('request.jwt.claims', '{"sub":"51000000-0000-4000-8000-000000000001","role":"service_role"}', true);
select is(public.create_patient_portal_invitation('52000000-0000-4000-8000-000000000001', '53000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000002', 'portal-patient-a@example.test', '51000000-0000-4000-8000-000000000001'), '62000000-0000-4000-8000-000000000001'::uuid, 'same user and email invitation is idempotent');
select throws_ok($$select public.create_patient_portal_invitation('52000000-0000-4000-8000-000000000001', '53000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000005', 'portal-patient-c@example.test', '51000000-0000-4000-8000-000000000001')$$, '23505', 'Este paciente ya tiene una invitación o acceso activo.', 'active access cannot be overwritten by a concurrent invitation');
select is(public.revoke_patient_portal_access('52000000-0000-4000-8000-000000000001', '62000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000001'), true, 'owner can revoke the linked patient account');
reset role;
select is((select count(*) from public.audit_events where clinic_id = '52000000-0000-4000-8000-000000000001' and action = 'patient_portal.revoked' and entity_id = '62000000-0000-4000-8000-000000000001'), 1::bigint, 'revocation and its audit record are atomic');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"51000000-0000-4000-8000-000000000002","role":"authenticated","email":"portal-patient-a@example.test"}', true);
select ok(not public.patient_portal_session_is_active(), 'revoked access fails heartbeat immediately');
select throws_ok($$select public.get_patient_portal_account()$$, '42501', null, 'revoked access cannot read account data immediately');

reset role;
select throws_ok($$insert into public.patient_portal_access (clinic_id, patient_id, user_id, invited_email, status, created_by) values ('52000000-0000-4000-8000-000000000001', '53000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000005', 'portal-patient-c@example.test', 'invited', '51000000-0000-4000-8000-000000000001')$$, '23505', null, 'a patient cannot have a second portal link');
select throws_ok($$insert into public.patient_portal_access (clinic_id, patient_id, user_id, invited_email, status, created_by) values ('52000000-0000-4000-8000-000000000002', '53000000-0000-4000-8000-000000000003', '51000000-0000-4000-8000-000000000002', 'portal-patient-a@example.test', 'invited', '51000000-0000-4000-8000-000000000004')$$, '23505', null, 'one auth account cannot be linked to two patients');

select * from finish();
rollback;


