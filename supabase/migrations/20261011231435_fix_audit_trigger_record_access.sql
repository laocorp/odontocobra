CREATE OR REPLACE FUNCTION private.audit_patient_service_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_clinic_id uuid;
  v_entity_id uuid;
  v_entity_type text;
  v_action text;
  v_fields jsonb;
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN NEW;
  END IF;

  v_clinic_id := CASE
    WHEN tg_table_name = 'clinics' THEN (to_jsonb(NEW) ->> 'id')::uuid
    ELSE (to_jsonb(NEW) ->> 'clinic_id')::uuid
  END;
  v_entity_id := (to_jsonb(NEW) ->> 'id')::uuid;

  v_entity_type := CASE
    WHEN tg_table_name = 'patients' THEN 'patient'
    WHEN tg_table_name = 'services' THEN 'service'
    ELSE 'clinic'
  END;

  IF tg_op = 'INSERT' THEN
    v_action := v_entity_type || '.created';

    SELECT coalesce(jsonb_agg(k ORDER BY k), '[]'::jsonb)
      INTO v_fields
      FROM jsonb_object_keys(to_jsonb(NEW)) AS field_keys(k)
      WHERE k NOT IN ('created_at', 'updated_at');
  ELSE
    SELECT coalesce(jsonb_agg(k ORDER BY k), '[]'::jsonb)
      INTO v_fields
      FROM jsonb_object_keys(to_jsonb(NEW)) AS field_keys(k)
      WHERE k <> 'updated_at'
        AND (to_jsonb(NEW) -> k) IS DISTINCT FROM (to_jsonb(OLD) -> k);

    IF jsonb_array_length(v_fields) = 0 THEN
      RETURN NEW;
    END IF;

    IF tg_table_name = 'patients'
       AND (to_jsonb(OLD) ->> 'archived_at') IS NULL
       AND (to_jsonb(NEW) ->> 'archived_at') IS NOT NULL THEN
      v_action := 'patient.archived';
    ELSIF tg_table_name = 'services'
       AND (to_jsonb(OLD) ->> 'active') = 'true'
       AND (to_jsonb(NEW) ->> 'active') = 'false' THEN
      v_action := 'service.archived';
    ELSIF tg_table_name = 'services'
       AND (to_jsonb(OLD) ->> 'active') = 'false'
       AND (to_jsonb(NEW) ->> 'active') = 'true' THEN
      v_action := 'service.activated';
    ELSE
      v_action := v_entity_type || '.updated';
    END IF;
  END IF;

  INSERT INTO public.audit_events
    (clinic_id, actor_id, action, entity_type, entity_id, details)
  VALUES
    (v_clinic_id, v_uid, v_action, v_entity_type, v_entity_id,
     jsonb_build_object('changed_fields', v_fields));

  RETURN NEW;
END;
$function$;