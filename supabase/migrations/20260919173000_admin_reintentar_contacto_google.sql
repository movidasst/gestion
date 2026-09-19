create or replace function public.admin_gestion_reintentar_contacto_google(
  p_integrante_id bigint
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_integrante public.integrantes%rowtype;
  v_cola public.cola_contactos_google%rowtype;
begin
  if not private.es_admin_gestion() then
    raise exception 'No autorizado';
  end if;

  select * into v_integrante
  from public.integrantes
  where id = p_integrante_id;

  if not found then
    raise exception 'Integrante no encontrado';
  end if;

  select * into v_cola
  from public.cola_contactos_google
  where integrante_id = p_integrante_id
  for update;

  -- Un contacto confirmado no se vuelve a enviar: así evitamos trabajo y
  -- cualquier posibilidad de duplicado en Google Contacts.
  if found and v_cola.estado in ('creado', 'actualizado') then
    return jsonb_build_object(
      'id', v_cola.id,
      'estado', v_cola.estado,
      'programado', false,
      'ya_existe', true
    );
  end if;

  insert into public.cola_contactos_google (
    integrante_id,
    estado,
    intentos,
    proximo_intento_at,
    bloqueado_at,
    completado_at,
    accion,
    resource_name,
    ultimo_error,
    duracion_ms,
    updated_at
  ) values (
    v_integrante.id,
    'pendiente',
    0,
    now(),
    null,
    null,
    null,
    null,
    null,
    null,
    now()
  )
  on conflict (integrante_id) do update set
    estado = case
      when public.cola_contactos_google.estado = 'procesando'
        then public.cola_contactos_google.estado
      else 'pendiente'
    end,
    intentos = case
      when public.cola_contactos_google.estado = 'procesando'
        then public.cola_contactos_google.intentos
      else 0
    end,
    proximo_intento_at = case
      when public.cola_contactos_google.estado = 'procesando'
        then public.cola_contactos_google.proximo_intento_at
      else now()
    end,
    bloqueado_at = case
      when public.cola_contactos_google.estado = 'procesando'
        then public.cola_contactos_google.bloqueado_at
      else null
    end,
    ultimo_error = case
      when public.cola_contactos_google.estado = 'procesando'
        then public.cola_contactos_google.ultimo_error
      else null
    end,
    updated_at = now()
  returning * into v_cola;

  insert into private.gestion_integrantes_auditoria (
    integrante_id,
    admin_user_id,
    accion,
    datos_nuevos,
    motivo
  ) values (
    v_integrante.id,
    (select auth.uid()),
    'reintento_contacto_google',
    jsonb_build_object('cola_id', v_cola.id, 'estado', v_cola.estado),
    'Creación de contacto solicitada manualmente desde el centro de gestión'
  );

  return jsonb_build_object(
    'id', v_cola.id,
    'estado', v_cola.estado,
    'programado', v_cola.estado = 'pendiente',
    'ya_existe', false
  );
end;
$$;

revoke all on function public.admin_gestion_reintentar_contacto_google(bigint) from public, anon;
grant execute on function public.admin_gestion_reintentar_contacto_google(bigint) to authenticated;
grant execute on function public.admin_gestion_reintentar_contacto_google(bigint) to service_role;

create or replace function public.admin_gestion_integrante_detalle(p_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_result jsonb;
begin
  if not private.es_admin_gestion() then
    raise exception 'No autorizado';
  end if;

  select to_jsonb(i) || jsonb_build_object(
    'correo_cola', case when correo.id is null then null else jsonb_build_object(
      'id', correo.id,
      'estado', correo.estado,
      'intentos', correo.intentos,
      'proximo_intento_at', correo.proximo_intento_at,
      'enviado_at', correo.enviado_at,
      'ultimo_error', correo.ultimo_error
    ) end,
    'contacto_google_cola', case when contacto.id is null then null else jsonb_build_object(
      'id', contacto.id,
      'estado', contacto.estado,
      'intentos', contacto.intentos,
      'proximo_intento_at', contacto.proximo_intento_at,
      'completado_at', contacto.completado_at,
      'accion', contacto.accion,
      'ultimo_error', contacto.ultimo_error
    ) end
  )
  into v_result
  from public.integrantes i
  left join public.cola_correos_registro correo on correo.integrante_id = i.id
  left join public.cola_contactos_google contacto on contacto.integrante_id = i.id
  where i.id = p_id;

  if v_result is null then
    raise exception 'Integrante no encontrado';
  end if;

  return v_result;
end;
$$;

