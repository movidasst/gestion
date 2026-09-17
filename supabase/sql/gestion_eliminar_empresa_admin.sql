create or replace function public.academia_eliminar_empresa(
  p_empresa_id uuid, p_admin_user_id uuid, p_nombre_confirmado text
) returns jsonb
language plpgsql security invoker set search_path = public
as $$
declare
  v_empresa public.academia_empresas%rowtype;
  v_contratos uuid[];
  v_cursos uuid[];
  v_participantes integer;
begin
  if not exists (select 1 from public.estudio_admins where auth_user_id=p_admin_user_id and activo=true and rol='admin') then
    raise exception 'No autorizado.';
  end if;
  select * into v_empresa from public.academia_empresas where id=p_empresa_id for update;
  if not found then raise exception 'La empresa ya no existe. Actualiza la lista.'; end if;
  if p_nombre_confirmado is distinct from v_empresa.nombre then
    raise exception 'El nombre de confirmación no coincide con la empresa.';
  end if;
  select coalesce(array_agg(id),array[]::uuid[]) into v_contratos from public.academia_contratos where empresa_id=p_empresa_id;
  select coalesce(array_agg(id),array[]::uuid[]) into v_cursos from public.academia_cursos_empresa where contrato_id=any(v_contratos);
  select count(*) into v_participantes from public.academia_participantes_empresa where curso_empresa_id=any(v_cursos);
  delete from public.academia_participantes_empresa where curso_empresa_id=any(v_cursos);
  delete from public.academia_enlaces_inscripcion where curso_empresa_id=any(v_cursos);
  delete from public.academia_demo_solicitudes where empresa_id=p_empresa_id;
  delete from public.academia_cursos_empresa where id=any(v_cursos);
  delete from public.academia_contratos where id=any(v_contratos);
  delete from public.academia_empresas where id=p_empresa_id;
  insert into public.academia_empresa_portal_auditoria(auth_user_id,empresa_id,accion,detalle)
  values(p_admin_user_id,null,'ELIMINAR_EMPRESA',jsonb_build_object(
    'empresa_id',p_empresa_id,'empresa',v_empresa.nombre,
    'contratos',cardinality(v_contratos),'cursos',cardinality(v_cursos),
    'participantes',v_participantes,'moodle_conservado',true));
  return jsonb_build_object('empresa_id',p_empresa_id,'empresa',v_empresa.nombre,
    'contratos',cardinality(v_contratos),'cursos',cardinality(v_cursos),'participantes',v_participantes);
end;
$$;
revoke all on function public.academia_eliminar_empresa(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.academia_eliminar_empresa(uuid,uuid,text) to service_role;