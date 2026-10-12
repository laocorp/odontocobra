-- Resolve output-column/table-column name collisions in the BCV rate RPC.
-- Migrations 013 through 018 are already assigned in the repository.
-- In particular, the returned `as_of` column can collide with the
-- exchange_rates.as_of column inside PL/pgSQL statements.
do $migration$
declare
  function_definition text;
  patched_definition text;
begin
  select pg_get_functiondef(
    'public.record_bcv_exchange_rate(uuid,numeric,timestamptz,uuid)'::regprocedure
  )
  into function_definition;

  patched_definition := regexp_replace(
    function_definition,
    '(AS[[:space:]]+\$[A-Za-z0-9_]*\$)',
    E'\\1\n#variable_conflict use_column\n',
    'i'
  );

  if patched_definition = function_definition then
    raise exception 'Could not add PL/pgSQL column resolution directive to record_bcv_exchange_rate.';
  end if;

  execute patched_definition;
end;
$migration$;
