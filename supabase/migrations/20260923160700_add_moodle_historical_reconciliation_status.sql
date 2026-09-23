create or replace function public.admin_gestion_incidencias_resumen()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_result jsonb;
begin
  if not private.es_admin_gestion() then
    raise exception 'No autorizado';
  end if;

  select jsonb_build_object(
    'moodle_no_solicitado', count(*) filter (where i.moodle_sync_status = 'NO_SOLICITADO' and i.moodle_user_id is null),
    'moodle_no_encontrado', count(*) filter (where i.moodle_sync_status = 'NO_ENCONTRADO' and i.moodle_user_id is null),
    'moodle_pendiente', count(*) filter (where i.moodle_sync_status in ('PENDIENTE','PROCESANDO') and i.moodle_user_id is null),
    'moodle_verificacion', count(*) filter (where i.moodle_sync_status = 'PENDIENTE_VERIFICACION' and i.moodle_user_id is null),
    'moodle_error', count(*) filter (where i.moodle_sync_status = 'ERROR'),
    'moodle_sin_id', count(*) filter (where i.moodle_sync_status in ('CREADO','EXISTENTE') and i.moodle_user_id is null),
    'correos_pendientes', (select count(*) from public.cola_correos_registro q where q.estado in ('pendiente','procesando')),
    'correos_fallidos', (select count(*) from public.cola_correos_registro q where q.estado = 'fallido'),
    'actualizado_at', now()
  ) into v_result
  from public.integrantes i;

  return v_result;
end;
$function$;

create or replace function public.admin_gestion_incidencias_detalle(p_estado text, p_limit integer default 100)
returns table(
  id bigint,
  nombres text,
  apellidos text,
  documento text,
  correo text,
  codigo_integrante text,
  moodle_sync_status text,
  moodle_user_id bigint,
  moodle_sync_error text,
  moodle_pending_user_id bigint,
  moodle_pending_email text,
  moodle_pending_reason text,
  moodle_last_attempt_at timestamptz
)
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if not private.es_admin_gestion() then
    raise exception 'No autorizado';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 500 then p_limit := 100; end if;

  return query
  select i.id, i.nombres, i.apellidos, i.documento, i.correo, i.codigo_integrante,
         i.moodle_sync_status, i.moodle_user_id, i.moodle_sync_error,
         i.moodle_pending_user_id, i.moodle_pending_email, i.moodle_pending_reason,
         i.moodle_last_attempt_at
  from public.integrantes i
  where case upper(coalesce(p_estado,''))
    when 'NO_SOLICITADO' then i.moodle_sync_status = 'NO_SOLICITADO' and i.moodle_user_id is null
    when 'NO_ENCONTRADO' then i.moodle_sync_status = 'NO_ENCONTRADO' and i.moodle_user_id is null
    when 'PENDIENTE' then i.moodle_sync_status in ('PENDIENTE','PROCESANDO') and i.moodle_user_id is null
    when 'PENDIENTE_VERIFICACION' then i.moodle_sync_status = 'PENDIENTE_VERIFICACION' and i.moodle_user_id is null
    when 'ERROR' then i.moodle_sync_status = 'ERROR'
    when 'SIN_ID' then i.moodle_sync_status in ('CREADO','EXISTENTE') and i.moodle_user_id is null
    else i.moodle_sync_status in ('NO_SOLICITADO','NO_ENCONTRADO','PENDIENTE','PROCESANDO','PENDIENTE_VERIFICACION','ERROR')
  end
  order by
    case
      when i.moodle_sync_status = 'ERROR' then 0
      when i.moodle_sync_status = 'PENDIENTE_VERIFICACION' then 1
      when i.moodle_sync_status in ('PENDIENTE','PROCESANDO') then 2
      when i.moodle_sync_status = 'NO_ENCONTRADO' then 3
      else 4
    end,
    i.moodle_last_attempt_at desc nulls last,
    i.id desc
  limit p_limit;
end;
$function$;
