alter table public.clinics
  add column owner_display_name text not null default '' check (char_length(owner_display_name) <= 160),
  add column contact_phone text check (contact_phone is null or char_length(contact_phone) <= 40),
  add column contact_email text check (contact_email is null or char_length(contact_email) <= 254),
  add column business_address text check (business_address is null or char_length(business_address) <= 300);
