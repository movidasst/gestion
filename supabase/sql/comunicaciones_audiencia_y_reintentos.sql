CREATE OR REPLACE FUNCTION private.comunicacion_filtro_cumple(i integrantes, f jsonb)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select
    (nullif(trim(coalesce(f->>'pais_iso2','')),'') is null or upper(trim(coalesce(i.pais_iso2,''))) = upper(trim(f->>'pais_iso2')))
    and (case when jsonb_typeof(f->'estados')='array' and jsonb_array_length(f->'estados')>0 then
      upper(trim(coalesce(i.pais_iso2,'')))='VE' and exists(select 1 from jsonb_array_elements_text(f->'estados') s where extensions.unaccent(lower(trim(s)))=extensions.unaccent(lower(trim(coalesce(i.estado,'')))))
      else (nullif(trim(coalesce(f->>'estado','')),'') is null or lower(trim(coalesce(i.estado,'')))=lower(trim(f->>'estado'))) end)
    and (nullif(f->>'integrante_id','') is null or i.id::text=f->>'integrante_id')
    and (nullif(trim(coalesce(f->>'genero','')),'') is null or lower(trim(coalesce(i.genero,''))) = lower(trim(f->>'genero')))
    and (nullif(trim(coalesce(f->>'laboral','')),'') is null or lower(trim(coalesce(i.laboral,''))) = lower(trim(f->>'laboral')))
    and (
      nullif(trim(coalesce(f->>'busqueda','')),'') is null
      or not exists (
        select 1
        from regexp_split_to_table(
          extensions.unaccent(lower(trim(f->>'busqueda'))),
          E'\\s+'
        ) as term
        where term <> ''
          and position(term in extensions.unaccent(lower(concat_ws(' ', i.nombres,i.apellidos,i.documento,i.correo,i.carrera,i.telefono_e164,i.whatsapp_username,i.estado,i.municipio,i.pais_nombre))))=0
      )
    );
$function$;

CREATE OR REPLACE FUNCTION public.admin_comunicacion_previsualizar(p_filtros jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v jsonb;
begin
  if not private.es_admin_gestion() then raise exception 'No autorizado'; end if;
  with filtrados as (
    select i.*, x.correo as correo_excluido
    from public.integrantes i
    left join public.comunicacion_exclusiones x on x.correo=lower(trim(i.correo))
    where private.comunicacion_filtro_cumple(i,coalesce(p_filtros,'{}'::jsonb))
  )
  select jsonb_build_object(
    'total_coincidencias', count(*),
    'correos_validos', count(distinct lower(trim(f.correo))) filter(where lower(trim(f.correo)) ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' and f.correo_excluido is null),
    'sin_correo', count(*) filter(where nullif(trim(f.correo),'') is null),
    'correo_invalido', count(*) filter(where nullif(trim(f.correo),'') is not null and lower(trim(f.correo)) !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'),
    'excluidos', count(*) filter(where f.correo_excluido is not null),
    'muestra', coalesce((
      select jsonb_agg(m.item order by m.orden desc)
      from (
        select ff.id as orden,jsonb_build_object(
          'id',ff.id,'nombre',trim(concat_ws(' ',ff.nombres,ff.apellidos)),
          'correo',ff.correo,'pais_iso2',ff.pais_iso2,'estado',ff.estado
        ) item
        from filtrados ff
        where lower(trim(ff.correo)) ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
          and ff.correo_excluido is null
        order by ff.id desc limit 10
      ) m
    ),'[]'::jsonb)
  ) into v from filtrados f;
  return v;
end $function$;

CREATE OR REPLACE FUNCTION public.admin_comunicacion_campana_crear(p_nombre text, p_asunto text, p_preencabezado text, p_encabezado text, p_cuerpo_html text, p_boton_texto text, p_boton_url text, p_filtros jsonb, p_programada_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_id uuid; v_total integer;
begin
  if not private.es_admin_gestion() then raise exception 'No autorizado'; end if;
  if nullif(trim(p_nombre),'') is null or nullif(trim(p_asunto),'') is null
     or nullif(trim(p_encabezado),'') is null or nullif(trim(p_cuerpo_html),'') is null
  then raise exception 'Nombre, asunto, encabezado y contenido son obligatorios'; end if;
  if nullif(trim(coalesce(p_boton_url,'')),'') is not null and trim(p_boton_url) !~* '^https://'
  then raise exception 'El enlace del botón debe comenzar con https://'; end if;

  insert into public.comunicacion_campanas(
    nombre,asunto,preencabezado,encabezado,cuerpo_html,boton_texto,boton_url,filtros,
    programada_at,creado_por
  ) values (
    trim(p_nombre),trim(p_asunto),nullif(trim(p_preencabezado),''),trim(p_encabezado),p_cuerpo_html,
    nullif(trim(p_boton_texto),''),nullif(trim(p_boton_url),''),coalesce(p_filtros,'{}'::jsonb),
    p_programada_at,(select auth.uid())
  ) returning id into v_id;

  insert into public.comunicacion_destinatarios(
    campana_id,integrante_id,correo,nombres,apellidos,pais_iso2,pais_nombre,
    estado_nombre,municipio,profesion
  )
  select v_id,i.id,lower(trim(i.correo)),i.nombres,i.apellidos,i.pais_iso2,i.pais_nombre,
         i.estado,i.municipio,i.carrera
  from public.integrantes i
  left join public.comunicacion_exclusiones x on x.correo=lower(trim(i.correo))
  where private.comunicacion_filtro_cumple(i,coalesce(p_filtros,'{}'::jsonb))
    and lower(trim(i.correo)) ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    and x.correo is null
  on conflict(campana_id,correo) do nothing;
  get diagnostics v_total=row_count;

  if v_total=0 then
    delete from public.comunicacion_campanas where id=v_id;
    raise exception 'El filtro no produjo destinatarios con correo válido';
  end if;
  return jsonb_build_object('id',v_id,'destinatarios',v_total,'estado','borrador');
end $function$;

CREATE OR REPLACE FUNCTION public.admin_comunicacion_campana_accion(p_id uuid, p_accion text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_estado text; v_total bigint;
begin
  if not private.es_admin_gestion() then raise exception 'No autorizado'; end if;
  select estado into v_estado from public.comunicacion_campanas where id=p_id for update;
  if not found then raise exception 'Campaña no encontrada'; end if;
  select count(*) into v_total from public.comunicacion_destinatarios where campana_id=p_id and estado_envio in('pendiente','procesando','fallido');

  if p_accion='iniciar' then
    if v_estado<>'borrador' then raise exception 'Solo se puede iniciar una campaña en borrador'; end if;
    if v_total=0 then raise exception 'La campaña no tiene destinatarios pendientes'; end if;
    update public.comunicacion_destinatarios set estado_envio='pendiente',proximo_intento_at=now(),bloqueado_at=null
      where campana_id=p_id and estado_envio='fallido';
    update public.comunicacion_campanas set estado='enviando',iniciada_at=coalesce(iniciada_at,now()),updated_at=now() where id=p_id;
  elsif p_accion='pausar' then
    update public.comunicacion_campanas set estado='pausada',updated_at=now() where id=p_id and estado in('enviando','programada');
  elsif p_accion='reanudar' then
    if v_estado<>'pausada' then raise exception 'Solo se puede reanudar una campaña pausada'; end if;
    update public.comunicacion_destinatarios set estado_envio='pendiente',intentos=0,proximo_intento_at=now(),bloqueado_at=null where campana_id=p_id and estado_envio='fallido';
    update public.comunicacion_campanas set estado='enviando',updated_at=now() where id=p_id and estado='pausada';
  elsif p_accion='cancelar' then
    update public.comunicacion_campanas set estado='cancelada',updated_at=now() where id=p_id and estado not in('completada','cancelada');
    update public.comunicacion_destinatarios set estado_envio='cancelado',updated_at=now()
      where campana_id=p_id and estado_envio in('pendiente','procesando','fallido');
  else raise exception 'Acción no válida';
  end if;
  select estado into v_estado from public.comunicacion_campanas where id=p_id;
  return jsonb_build_object('id',p_id,'estado',v_estado);
end $function$;

CREATE OR REPLACE FUNCTION public.reprogramar_comunicacion(p_id bigint, p_error text, p_demora_minutos integer DEFAULT 15)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
declare v_campana uuid;
begin
update public.comunicacion_destinatarios d set
estado_envio=case when d.intentos>=10 then 'fallido' else 'pendiente' end,
proximo_intento_at=now()+make_interval(mins=>least(greatest(coalesce(p_demora_minutos,15),5),1440)),
bloqueado_at=null,ultimo_error=left(coalesce(p_error,'Error no especificado'),1000),updated_at=now()
where d.id=p_id and d.estado_envio='procesando' returning campana_id into v_campana;
if v_campana is null then return false; end if;
if not exists(select 1 from public.comunicacion_destinatarios where campana_id=v_campana and estado_envio in ('pendiente','procesando')) then
update public.comunicacion_campanas set estado='pausada',updated_at=now() where id=v_campana and estado in ('enviando','programada');
end if;
return true;
end $function$;

CREATE OR REPLACE FUNCTION public.reclamar_comunicaciones(p_limite integer DEFAULT 10)
 RETURNS TABLE(id bigint, campana_id uuid, correo text, nombres text, apellidos text, pais_nombre text, estado_nombre text, municipio text, profesion text, asunto text, preencabezado text, encabezado text, cuerpo_html text, boton_texto text, boton_url text, intentos integer)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with excluded as (
    update public.comunicacion_destinatarios d set estado_envio='cancelado',bloqueado_at=null,ultimo_error='Correo excluido antes del envío',updated_at=now()
    where d.estado_envio='pendiente' and exists(select 1 from public.comunicacion_exclusiones x where x.correo=lower(trim(d.correo)))
    and exists(select 1 from public.comunicacion_campanas c where c.id=d.campana_id and c.estado in ('enviando','programada'))
    returning d.id
  ), finished as (
    update public.comunicacion_campanas c set
    estado=case when exists(select 1 from public.comunicacion_destinatarios d where d.campana_id=c.id and d.estado_envio='fallido') then 'pausada' else 'completada' end,
    completada_at=case when exists(select 1 from public.comunicacion_destinatarios d where d.campana_id=c.id and d.estado_envio='fallido') then null else now() end,updated_at=now()
    where c.estado in ('enviando','programada') and not exists(select 1 from public.comunicacion_destinatarios d where d.campana_id=c.id and d.estado_envio in ('pendiente','procesando'))
    returning c.id
  ), candidatos as (
    select d.id from public.comunicacion_destinatarios d
    join public.comunicacion_campanas c on c.id=d.campana_id
    where c.estado in('enviando','programada')
      and (c.programada_at is null or c.programada_at<=now())
      and (d.intentos<10 or d.estado_envio='procesando')
      and not exists(select 1 from public.comunicacion_exclusiones x where x.correo=lower(trim(d.correo)))
      and ((d.estado_envio='pendiente' and d.proximo_intento_at<=now())
        or (d.estado_envio='procesando' and d.bloqueado_at<now()-interval '20 minutes'))
    order by d.created_at for update of d skip locked
    limit least(greatest(coalesce(p_limite,10),1),20)
  ), claimed as (
    update public.comunicacion_destinatarios d set estado_envio='procesando',intentos=d.intentos+1,
      bloqueado_at=now(),updated_at=now()
    from candidatos x where d.id=x.id returning d.*
  )
  select d.id,d.campana_id,d.correo,d.nombres,d.apellidos,d.pais_nombre,d.estado_nombre,d.municipio,d.profesion,
         c.asunto,c.preencabezado,c.encabezado,c.cuerpo_html,c.boton_texto,c.boton_url,d.intentos
  from claimed d join public.comunicacion_campanas c on c.id=d.campana_id;
$function$;

CREATE OR REPLACE FUNCTION public.completar_comunicacion(p_id bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_campana uuid;
begin
  update public.comunicacion_destinatarios set estado_envio='enviado',enviado_at=now(),bloqueado_at=null,
    ultimo_error=null,updated_at=now() where id=p_id returning campana_id into v_campana;
  if v_campana is null then return false; end if;
  if not exists(select 1 from public.comunicacion_destinatarios where campana_id=v_campana and estado_envio in('pendiente','procesando')) then
    update public.comunicacion_campanas set estado=case when exists(select 1 from public.comunicacion_destinatarios where campana_id=v_campana and estado_envio='fallido') then 'pausada' else 'completada' end,completada_at=case when exists(select 1 from public.comunicacion_destinatarios where campana_id=v_campana and estado_envio='fallido') then null else now() end,updated_at=now()
    where id=v_campana and estado in('enviando','programada');
  end if;
  return true;
end $function$;
