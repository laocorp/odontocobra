-- Preserve older imported rows while enforcing the agreed patient fields for
-- every new or edited record. The UI normalizes Venezuelan phones to E.164.
alter table public.patients
  add constraint patients_full_name_requires_surname
    check (full_name ~ '^[^[:space:]]+[[:space:]]+[^[:space:]].*$') not valid,
  add constraint patients_required_billing_contact
    check (
      nullif(btrim(national_id), '') is not null
      and phone is not null
      and phone ~ '^\+58[0-9]{10}$'
    ) not valid;
