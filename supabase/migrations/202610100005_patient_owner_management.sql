drop policy patients_insert_clinic on public.patients;
create policy patients_insert_owner on public.patients
  for insert to authenticated
  with check (private.has_clinic_role(clinic_id, 'owner'));

drop policy patients_update_clinic on public.patients;
create policy patients_update_owner on public.patients
  for update to authenticated
  using (private.has_clinic_role(clinic_id, 'owner'))
  with check (private.has_clinic_role(clinic_id, 'owner'));
