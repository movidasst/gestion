# Integraciones Movida SST para Moodle 5.2

Este complemento local añade el servicio web `local_movidasst_bulk_unenrol_users`.
La función elimina las matrículas reales que Moodle permita administrar,
incluidas las creadas mediante matriculación manual y auto-matriculación.

Protecciones incluidas:

- excluye administradores y personal docente;
- limita cada llamada a 100 usuarios;
- consulta nuevamente cada matrícula después de eliminarla;
- informa resultados completos, parciales y errores por usuario;
- no almacena información personal en Moodle.

## Instalación

1. Instalar el ZIP desde `Administración del sitio > Plugins > Instalar plugins`.
2. Completar la actualización de la base de datos de Moodle.
3. Agregar `local_movidasst_bulk_unenrol_users` al servicio externo que usa Gestión.
4. Confirmar que el usuario técnico del servicio conserva el rol de administrador.
