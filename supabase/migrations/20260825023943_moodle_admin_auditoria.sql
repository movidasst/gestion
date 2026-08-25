create table if not exists public.moodle_admin_auditoria (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null,
  accion text not null check (
    accion in (
      'CREAR_VINCULAR_USUARIO',
      'MATRICULAR',
      'DESMATRICULAR',
      'CONSULTAR_HISTORIAL'
    )
  ),
  integrante_id bigint references public.integrantes(id),
  moodle_user_id bigint,
  moodle_course_id bigint,
  detalle jsonb not null default '{}'::jsonb,
  resultado text not null check (resultado in ('OK', 'ERROR')),
  error text,
  created_at timestamptz not null default now()
);

comment on table public.moodle_admin_auditoria is
  'Bitácora privada de operaciones administrativas realizadas entre Gestión y Moodle.';

alter table public.moodle_admin_auditoria enable row level security;

revoke all on table public.moodle_admin_auditoria from public, anon, authenticated;
grant select, insert on table public.moodle_admin_auditoria to service_role;

create index if not exists moodle_admin_auditoria_integrante_idx
  on public.moodle_admin_auditoria (integrante_id, created_at desc);

create index if not exists moodle_admin_auditoria_admin_idx
  on public.moodle_admin_auditoria (admin_user_id, created_at desc);
