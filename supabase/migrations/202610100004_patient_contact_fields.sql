alter table public.patients
  add column national_id text check (national_id is null or char_length(btrim(national_id)) between 3 and 30),
  add column address text check (address is null or char_length(address) <= 300);

create unique index patients_clinic_national_id_uidx
  on public.patients (clinic_id, lower(btrim(national_id)))
  where national_id is not null and archived_at is null;
