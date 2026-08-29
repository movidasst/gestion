begin;

create table if not exists public.academia_empresas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (char_length(btrim(nombre)) between 2 and 180),
  identificador_fiscal text,
  pais_iso2 text check (pais_iso2 is null or pais_iso2 ~ '^[A-Z]{2}$'),
  contacto_nombre text,
  contacto_cargo text,
  contacto_email text,
  contacto_telefono text,
  estado text not null default 'activo' check (estado in ('activo', 'inactivo')),
  notas text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists academia_empresas_nombre_uidx
  on public.academia_empresas (lower(btrim(nombre)));

create unique index if not exists academia_empresas_fiscal_uidx
  on public.academia_empresas (lower(btrim(identificador_fiscal)))
  where identificador_fiscal is not null and btrim(identificador_fiscal) <> '';

create table if not exists public.academia_contratos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.academia_empresas(id) on delete restrict,
  codigo text not null check (char_length(btrim(codigo)) between 4 and 40),
  nombre text not null check (char_length(btrim(nombre)) between 3 and 180),
  estado text not null default 'borrador'
    check (estado in ('borrador', 'activo', 'completado', 'cancelado')),
  fecha_inicio date,
  fecha_fin date,
  moneda text not null default 'USD' check (char_length(moneda) = 3),
  monto_total numeric(12,2) check (monto_total is null or monto_total >= 0),
  estado_pago text not null default 'pendiente'
    check (estado_pago in ('pendiente', 'parcial', 'pagado', 'no_aplica')),
  contacto_nombre text,
  contacto_email text,
  contacto_telefono text,
  notas text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint academia_contratos_fechas_chk
    check (fecha_fin is null or fecha_inicio is null or fecha_fin >= fecha_inicio)
);

create unique index if not exists academia_contratos_codigo_uidx
  on public.academia_contratos (lower(btrim(codigo)));
create index if not exists academia_contratos_empresa_idx
  on public.academia_contratos (empresa_id, created_at desc);

create table if not exists public.academia_cursos_empresa (
  id uuid primary key default gen_random_uuid(),
  contrato_id uuid not null references public.academia_contratos(id) on delete restrict,
  moodle_course_id bigint not null check (moodle_course_id > 1),
  moodle_course_name text not null,
  moodle_course_shortname text,
  modalidad text not null default 'compartido'
    check (modalidad in ('compartido', 'exclusivo')),
  cupos_contratados integer not null check (cupos_contratados between 1 and 5000),
  fecha_inicio date,
  fecha_fin date,
  moodle_group_id bigint,
  moodle_group_name text,
  moodle_group_idnumber text,
  estado text not null default 'borrador'
    check (estado in ('borrador', 'listo', 'matriculando', 'activo', 'completado', 'cancelado')),
  precio numeric(12,2) check (precio is null or precio >= 0),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint academia_cursos_empresa_fechas_chk
    check (fecha_fin is null or fecha_inicio is null or fecha_fin >= fecha_inicio)
);

create index if not exists academia_cursos_empresa_contrato_idx
  on public.academia_cursos_empresa (contrato_id, created_at desc);
create index if not exists academia_cursos_empresa_moodle_idx
  on public.academia_cursos_empresa (moodle_course_id);
create unique index if not exists academia_cursos_empresa_group_uidx
  on public.academia_cursos_empresa (moodle_course_id, lower(btrim(moodle_group_idnumber)))
  where moodle_group_idnumber is not null and btrim(moodle_group_idnumber) <> '';

create table if not exists public.academia_participantes_empresa (
  id uuid primary key default gen_random_uuid(),
  curso_empresa_id uuid not null references public.academia_cursos_empresa(id) on delete restrict,
  integrante_id bigint references public.integrantes(id) on delete set null,
  moodle_user_id bigint,
  nombres text not null check (char_length(btrim(nombres)) between 1 and 120),
  apellidos text not null check (char_length(btrim(apellidos)) between 1 and 120),
  tipo_documento text,
  documento text,
  correo text not null check (position('@' in correo) > 1),
  telefono text,
  pais_iso2 text check (pais_iso2 is null or pais_iso2 ~ '^[A-Z]{2}$'),
  origen text not null default 'admin' check (origen in ('admin', 'csv', 'excel', 'enlace')),
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'validado', 'matriculado', 'error', 'retirado', 'reemplazado')),
  error_validacion text,
  matriculado_at timestamptz,
  retirado_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists academia_participantes_curso_idx
  on public.academia_participantes_empresa (curso_empresa_id, estado, created_at);
create index if not exists academia_participantes_moodle_idx
  on public.academia_participantes_empresa (moodle_user_id)
  where moodle_user_id is not null;
create index if not exists academia_participantes_integrante_idx
  on public.academia_participantes_empresa (integrante_id)
  where integrante_id is not null;
create unique index if not exists academia_participantes_correo_activo_uidx
  on public.academia_participantes_empresa (curso_empresa_id, lower(btrim(correo)))
  where estado not in ('retirado', 'reemplazado');
create unique index if not exists academia_participantes_documento_activo_uidx
  on public.academia_participantes_empresa (curso_empresa_id, lower(btrim(documento)))
  where documento is not null and btrim(documento) <> '' and estado not in ('retirado', 'reemplazado');

create table if not exists public.academia_enlaces_inscripcion (
  id uuid primary key default gen_random_uuid(),
  curso_empresa_id uuid not null references public.academia_cursos_empresa(id) on delete restrict,
  token_hash text not null unique,
  estado text not null default 'activo' check (estado in ('activo', 'cerrado', 'vencido')),
  expires_at timestamptz not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists academia_enlaces_curso_idx
  on public.academia_enlaces_inscripcion (curso_empresa_id, estado, expires_at desc);

comment on table public.academia_empresas is
  'Empresas clientes de la oferta de formación corporativa de Academia Movida SST.';
comment on table public.academia_contratos is
  'Contratos u órdenes empresariales que pueden incluir uno o varios cursos.';
comment on table public.academia_cursos_empresa is
  'Cursos y cupos contratados por empresa, vinculados con curso y grupo de Moodle.';
comment on table public.academia_participantes_empresa is
  'Participantes empresariales por curso contratado y estado de matrícula.';
comment on table public.academia_enlaces_inscripcion is
  'Enlaces privados y vencibles para que cada empresa cargue sus participantes.';

alter table public.academia_empresas enable row level security;
alter table public.academia_contratos enable row level security;
alter table public.academia_cursos_empresa enable row level security;
alter table public.academia_participantes_empresa enable row level security;
alter table public.academia_enlaces_inscripcion enable row level security;

revoke all on table public.academia_empresas from anon, authenticated;
revoke all on table public.academia_contratos from anon, authenticated;
revoke all on table public.academia_cursos_empresa from anon, authenticated;
revoke all on table public.academia_participantes_empresa from anon, authenticated;
revoke all on table public.academia_enlaces_inscripcion from anon, authenticated;

grant select, insert, update, delete on table public.academia_empresas to service_role;
grant select, insert, update, delete on table public.academia_contratos to service_role;
grant select, insert, update, delete on table public.academia_cursos_empresa to service_role;
grant select, insert, update, delete on table public.academia_participantes_empresa to service_role;
grant select, insert, update, delete on table public.academia_enlaces_inscripcion to service_role;

commit;
