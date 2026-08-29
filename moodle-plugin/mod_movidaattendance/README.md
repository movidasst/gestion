# Asistencia asincrónica Movida SST

Actividad para Moodle 5.2 que permite crear puntos de asistencia en cursos asincrónicos.

## Funciones

- Botón visible `Registrar mi asistencia`.
- Ventana puntual y período tardío configurables.
- Un solo registro por estudiante y punto de asistencia.
- Finalización de actividad al registrar.
- Reporte por curso y grupo, con descarga CSV.
- Servicio externo `mod_movidaattendance_get_course_report` para Gestión.
- Copia segura con las plantillas de curso: la actividad se copia, los registros solo se incluyen cuando el respaldo contiene datos de usuarios.

## Instalación

Instala el ZIP desde `Administración del sitio > Plugins > Instalar plugins` y completa la actualización de la base de datos.

Después agrega `mod_movidaattendance_get_course_report` al servicio externo utilizado por Gestión.

## Uso recomendado en cursos empresariales cortos

Incluye tres actividades en la plantilla: `Asistencia de inicio`, `Control de avance` y `Asistencia final`. Configura la ventana de cada una al preparar el curso de la empresa.

