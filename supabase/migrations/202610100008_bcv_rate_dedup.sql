-- Repeated refreshes and concurrent sessions must not duplicate an unchanged BCV snapshot.
create unique index exchange_rates_bcv_snapshot_unique
  on public.exchange_rates (clinic_id, as_of, rate)
  where source = 'BCV';
