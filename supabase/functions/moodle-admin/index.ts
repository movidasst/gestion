import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.95.0";

type JsonObject = Record<string, unknown>;
type MoodleParameter = string | number | boolean;

const ALLOWED_ORIGINS = new Set([
  "https://gestion.movidasst.com",
  "https://movidasst.github.io",
]);

const STUDENT_ROLE_ID = 5;
const JSON_CONTENT_TYPE = "application/json; charset=utf-8";

function getAdminKey(): string {
  const direct = [
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim(),
    Deno.env.get("SUPABASE_SECRET_KEY")?.trim(),
  ].find(Boolean);

  if (direct) return direct;

  const encoded = Deno.env.get("SUPABASE_SECRET_KEYS")?.trim();
  if (encoded) {
    try {
      const parsed = JSON.parse(encoded) as unknown;
      if (typeof parsed === "string" && parsed.trim()) return parsed.trim();
      if (parsed && typeof parsed === "object") {
        const values = parsed as Record<string, unknown>;
        for (const key of [
          "default",
          "SUPABASE_SERVICE_ROLE_KEY",
          "SUPABASE_SECRET_KEY",
          "service_role",
          "serviceRole",
          "secret",
          "key",
        ]) {
          const candidate = values[key];
          if (typeof candidate === "string" && candidate.trim()) {
            return candidate.trim();
          }
        }
      }
    } catch {
      return encoded;
    }
  }

  throw new Error("No se encontró la clave administrativa de Supabase.");
}

function requiredSecret(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Falta configurar el secreto ${name}.`);
  return value;
}

function requestOrigin(req: Request): string {
  return req.headers.get("origin")?.trim() || "";
}

function corsHeaders(req: Request): Record<string, string> {
  const origin = requestOrigin(req);
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin)
      ? origin
      : "https://gestion.movidasst.com",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(req: Request, body: JsonObject, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(req),
      "Content-Type": JSON_CONTENT_TYPE,
      "Cache-Control": "no-store",
    },
  });
}

function cleanError(error: unknown): string {
  const value = error instanceof Error ? error.message : String(error ?? "Error desconocido");
  return value.replace(/wstoken=[^&\s]+/gi, "wstoken=[OCULTO]").slice(0, 1200);
}

function positiveInteger(value: unknown, label: string): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`${label} no es válido.`);
  }
  return number;
}

function normalizeSearch(value: unknown): string {
  return String(value ?? "")
    .replace(/[%_,()'"\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

async function callMoodle(
  functionName: string,
  parameters: Record<string, MoodleParameter> = {},
): Promise<unknown> {
  const baseUrl = requiredSecret("MOODLE_BASE_URL").replace(/\/+$/, "");
  const token = requiredSecret("MOODLE_TOKEN");
  const form = new URLSearchParams({
    wstoken: token,
    wsfunction: functionName,
    moodlewsrestformat: "json",
  });

  for (const [key, value] of Object.entries(parameters)) {
    form.set(key, String(value));
  }

  const response = await fetch(`${baseUrl}/webservice/rest/server.php`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: form,
    signal: AbortSignal.timeout(30000),
  });
  const raw = await response.text();
  let payload: unknown;

  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    throw new Error(`Moodle devolvió una respuesta no válida (${response.status}).`);
  }

  if (!response.ok) {
    throw new Error(`Moodle respondió con HTTP ${response.status}.`);
  }

  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const error = payload as Record<string, unknown>;
    if (error.exception || error.errorcode) {
      throw new Error(String(error.message || error.errorcode || "Moodle rechazó la operación."));
    }
  }

  return payload;
}

function normalizeCourse(course: unknown): JsonObject {
  const item = (course && typeof course === "object" ? course : {}) as Record<string, unknown>;
  return {
    id: Number(item.id || 0),
    shortname: String(item.shortname || ""),
    fullname: String(item.fullname || item.displayname || "Curso sin nombre"),
    categoryid: Number(item.categoryid || item.category || 0),
    visible: item.visible !== 0 && item.visible !== false,
    startdate: Number(item.startdate || 0),
    enddate: Number(item.enddate || 0),
    progress: item.progress == null ? null : Number(item.progress),
    completed: item.completed === true,
    enablecompletion: Number(item.enablecompletion || 0),
  };
}

async function getCourses(): Promise<JsonObject[]> {
  const response = await callMoodle("core_course_get_courses_by_field", {
    field: "",
    value: "",
  }) as Record<string, unknown>;
  const courses = Array.isArray(response?.courses) ? response.courses : [];
  return courses
    .map(normalizeCourse)
    .filter((course) => Number(course.id) > 1);
}

async function getMember(admin: ReturnType<typeof createClient>, integranteId: number) {
  const { data, error } = await admin
    .from("integrantes")
    .select("id,nombres,apellidos,documento,cedula,correo,pais_iso2,moodle_user_id,moodle_sync_status,moodle_sync_error")
    .eq("id", integranteId)
    .maybeSingle();

  if (error) throw new Error(`No se pudo consultar el integrante: ${error.message}`);
  if (!data) throw new Error("El integrante no existe.");
  return data;
}

async function getUserCourses(moodleUserId: number): Promise<JsonObject[]> {
  const response = await callMoodle("core_enrol_get_users_courses", {
    userid: moodleUserId,
    returnusercount: 0,
  });
  return (Array.isArray(response) ? response : []).map(normalizeCourse);
}

async function audit(
  admin: ReturnType<typeof createClient>,
  values: {
    admin_user_id: string;
    accion: "CREAR_VINCULAR_USUARIO" | "MATRICULAR" | "DESMATRICULAR";
    integrante_id?: number | null;
    moodle_user_id?: number | null;
    moodle_course_id?: number | null;
    detalle?: JsonObject;
    resultado: "OK" | "ERROR";
    error?: string | null;
  },
) {
  const { error } = await admin.from("moodle_admin_auditoria").insert({
    ...values,
    detalle: values.detalle || {},
  });
  if (error) console.error("No se pudo guardar la auditoría Moodle:", error.message);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    const origin = requestOrigin(req);
    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      return json(req, { ok: false, error: "Origen no autorizado." }, 403);
    }
    return new Response("ok", { headers: corsHeaders(req) });
  }

  if (req.method !== "POST") {
    return json(req, { ok: false, error: "Método no permitido." }, 405);
  }

  const origin = requestOrigin(req);
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return json(req, { ok: false, error: "Origen no autorizado." }, 403);
  }

  let adminUserId = "";
  const supabaseUrl = requiredSecret("SUPABASE_URL");
  const admin = createClient(supabaseUrl, getAdminKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const authorization = req.headers.get("authorization") || "";
    const token = authorization.replace(/^Bearer\s+/i, "").trim();
    if (!token) return json(req, { ok: false, error: "Sesión requerida." }, 401);

    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData.user) {
      return json(req, { ok: false, error: "La sesión no es válida." }, 401);
    }
    adminUserId = authData.user.id;

    const { data: permission, error: permissionError } = await admin
      .from("estudio_admins")
      .select("auth_user_id")
      .eq("auth_user_id", adminUserId)
      .eq("activo", true)
      .eq("rol", "admin")
      .maybeSingle();

    if (permissionError) throw new Error(`No se pudo validar el administrador: ${permissionError.message}`);
    if (!permission) return json(req, { ok: false, error: "No autorizado." }, 403);

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = String(body.action || "").trim();

    if (action === "site_info") {
      const data = await callMoodle("core_webservice_get_site_info");
      return json(req, { ok: true, data: data as unknown as JsonObject });
    }

    if (action === "courses") {
      const courses = await getCourses();
      return json(req, { ok: true, courses, total: courses.length });
    }

    if (action === "summary") {
      const [courses, linked, pending, grades, passed] = await Promise.all([
        getCourses(),
        admin.from("integrantes").select("id", { count: "exact", head: true }).not("moodle_user_id", "is", null),
        admin.from("integrantes").select("id", { count: "exact", head: true }).in("moodle_sync_status", ["PENDIENTE", "PROCESANDO", "PENDIENTE_VERIFICACION", "ERROR"]),
        admin.from("calificaciones_moodle").select("id", { count: "exact", head: true }).eq("tiene_nota", true),
        admin.from("calificaciones_moodle").select("id", { count: "exact", head: true }).eq("aprobado", true),
      ]);
      for (const result of [linked, pending, grades, passed]) {
        if (result.error) throw new Error(result.error.message);
      }
      return json(req, {
        ok: true,
        summary: {
          courses: courses.length,
          linked_users: linked.count || 0,
          pending_users: pending.count || 0,
          graded_records: grades.count || 0,
          passed_records: passed.count || 0,
        },
        courses,
      });
    }

    if (action === "search_members") {
      const search = normalizeSearch(body.search);
      let query = admin
        .from("integrantes")
        .select("id,nombres,apellidos,documento,correo,pais_iso2,moodle_user_id,moodle_sync_status,moodle_sync_error")
        .order("created_at", { ascending: false })
        .limit(15);
      if (search) {
        query = query.or([
          `nombres.ilike.%${search}%`,
          `apellidos.ilike.%${search}%`,
          `documento.ilike.%${search}%`,
          `cedula.ilike.%${search}%`,
          `correo.ilike.%${search}%`,
        ].join(","));
      }
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return json(req, { ok: true, members: data || [] });
    }

    if (action === "member_history") {
      const integranteId = positiveInteger(body.integrante_id, "El integrante");
      const member = await getMember(admin, integranteId);
      const moodleUserId = Number(member.moodle_user_id || 0);
      const courses = moodleUserId > 0 ? await getUserCourses(moodleUserId) : [];
      return json(req, { ok: true, member, courses });
    }

    if (action === "course_detail") {
      const integranteId = positiveInteger(body.integrante_id, "El integrante");
      const courseId = positiveInteger(body.course_id, "El curso");
      const member = await getMember(admin, integranteId);
      const moodleUserId = positiveInteger(member.moodle_user_id, "El usuario Moodle");
      const [completion, activities, grades] = await Promise.all([
        callMoodle("core_completion_get_course_completion_status", { courseid: courseId, userid: moodleUserId }),
        callMoodle("core_completion_get_activities_completion_status", { courseid: courseId, userid: moodleUserId }),
        callMoodle("gradereport_user_get_grade_items", { courseid: courseId, userid: moodleUserId }),
      ]);
      return json(req, {
        ok: true,
        detail: { completion, activities, grades },
      });
    }

    if (action === "course_users") {
      const courseId = positiveInteger(body.course_id, "El curso");
      const result = await callMoodle("core_enrol_get_enrolled_users", { courseid: courseId });
      const users = Array.isArray(result) ? result : [];
      return json(req, { ok: true, users, total: users.length });
    }

    if (action === "ensure_user") {
      const integranteId = positiveInteger(body.integrante_id, "El integrante");
      const member = await getMember(admin, integranteId);
      if (Number(member.moodle_user_id || 0) > 0) {
        return json(req, { ok: true, result: "ALREADY_SYNCED", member });
      }

      try {
        const response = await fetch(`${supabaseUrl}/functions/v1/smooth-endpoint`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-webhook-secret": requiredSecret("MOODLE_WEBHOOK_SECRET"),
          },
          body: JSON.stringify({ integrante_id: integranteId, action: "manual-admin" }),
          signal: AbortSignal.timeout(45000),
        });
        const result = await response.json().catch(() => ({})) as JsonObject;
        if (!response.ok || result.ok === false) {
          throw new Error(String(result.error || `No se pudo crear o vincular la cuenta (${response.status}).`));
        }
        await audit(admin, {
          admin_user_id: adminUserId,
          accion: "CREAR_VINCULAR_USUARIO",
          integrante_id: integranteId,
          moodle_user_id: Number(result.moodle_user_id || 0) || null,
          detalle: { result: result.result || null },
          resultado: "OK",
        });
        return json(req, { ok: true, result });
      } catch (error) {
        const message = cleanError(error);
        await audit(admin, {
          admin_user_id: adminUserId,
          accion: "CREAR_VINCULAR_USUARIO",
          integrante_id: integranteId,
          resultado: "ERROR",
          error: message,
        });
        throw new Error(message);
      }
    }

    if (action === "enroll" || action === "unenroll") {
      const integranteId = positiveInteger(body.integrante_id, "El integrante");
      const courseId = positiveInteger(body.course_id, "El curso");
      const member = await getMember(admin, integranteId);
      const moodleUserId = positiveInteger(member.moodle_user_id, "El usuario Moodle");
      const isEnroll = action === "enroll";

      try {
        const parameters: Record<string, MoodleParameter> = {
          "enrolments[0][userid]": moodleUserId,
          "enrolments[0][courseid]": courseId,
        };
        if (isEnroll) {
          parameters["enrolments[0][roleid]"] = STUDENT_ROLE_ID;
          parameters["enrolments[0][timestart]"] = 0;
          parameters["enrolments[0][timeend]"] = 0;
          parameters["enrolments[0][suspend]"] = 0;
        }

        await callMoodle(
          isEnroll ? "enrol_manual_enrol_users" : "enrol_manual_unenrol_users",
          parameters,
        );
        await audit(admin, {
          admin_user_id: adminUserId,
          accion: isEnroll ? "MATRICULAR" : "DESMATRICULAR",
          integrante_id: integranteId,
          moodle_user_id: moodleUserId,
          moodle_course_id: courseId,
          detalle: { roleid: STUDENT_ROLE_ID },
          resultado: "OK",
        });
        const courses = await getUserCourses(moodleUserId);
        return json(req, { ok: true, courses });
      } catch (error) {
        const message = cleanError(error);
        await audit(admin, {
          admin_user_id: adminUserId,
          accion: isEnroll ? "MATRICULAR" : "DESMATRICULAR",
          integrante_id: integranteId,
          moodle_user_id: moodleUserId,
          moodle_course_id: courseId,
          detalle: { roleid: STUDENT_ROLE_ID },
          resultado: "ERROR",
          error: message,
        });
        throw new Error(message);
      }
    }

    return json(req, { ok: false, error: "Acción no reconocida." }, 400);
  } catch (error) {
    const message = cleanError(error);
    console.error("moodle-admin:", message);
    return json(req, { ok: false, error: message }, 500);
  }
});
