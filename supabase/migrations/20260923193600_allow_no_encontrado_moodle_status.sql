alter table public.integrantes
  drop constraint if exists integrantes_moodle_sync_status_valido;

alter table public.integrantes
  add constraint integrantes_moodle_sync_status_valido
  check (moodle_sync_status = any (array[
    'NO_SOLICITADO'::text,
    'NO_ENCONTRADO'::text,
    'PENDIENTE'::text,
    'PROCESANDO'::text,
    'CREADO'::text,
    'EXISTENTE'::text,
    'PENDIENTE_VERIFICACION'::text,
    'ERROR'::text
  ]));
