import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Aísla la gestión corporativa en el token del servicio Moodle
// "Gestión académica Movida SST" (secreto histórico: MOODLE_LECTURA_TOKEN).
// El resto de moodle-admin continúa usando MOODLE_TOKEN y no se altera.
const academicToken = Deno.env.get("MOODLE_LECTURA_TOKEN")?.trim();
if (!academicToken) {
  throw new Error("Falta configurar MOODLE_LECTURA_TOKEN para Gestión académica Movida SST.");
}

Deno.env.set("MOODLE_TOKEN", academicToken);

// Importamos una versión fijada del motor administrativo. Al ejecutarse en esta
// función separada, todas sus llamadas Moodle usan exclusivamente el token
// académico anterior, sin afectar pagos, calificaciones ni otros módulos.
await import("https://raw.githubusercontent.com/movidasst/gestion/61f64ad3a24b713220d621d6e7fe26a8aa9b8992/supabase/functions/moodle-admin/index.ts");
