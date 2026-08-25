alter table public.moodle_admin_auditoria
  drop constraint if exists moodle_admin_auditoria_accion_check;

alter table public.moodle_admin_auditoria
  add constraint moodle_admin_auditoria_accion_check
  check (
    accion in (
      'CREAR_VINCULAR_USUARIO',
      'MATRICULAR',
      'DESMATRICULAR',
      'CONSULTAR_HISTORIAL',
      'APROBAR_PAGO'
    )
  );
