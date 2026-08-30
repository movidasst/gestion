import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.95.0";

type JsonObject = Record<string, unknown>;
type MoodleParameter = string | number | boolean;

const ALLOWED_ORIGINS = new Set([
  "https://gestion.movidasst.com",
  "https://movidasst.github.io",
]);

function requestOrigin(req: Request): string {
  return req.headers.get("origin")?.trim() || "";
}

function corsHeaders(req: Request): Record<string, string> {
  const origin = requestOrigin(req);
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : "https://gestion.movidasst.com",
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
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function cleanText(value: unknown, maxLength = 254): string {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

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
        for (const key of ["default", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY", "service_role", "serviceRole", "secret", "key"]) {
          const candidate = values[key];
          if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
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
  if (!value) throw new Error(`Falta configurar ${name}.`);
  return value;
}

function asObjects(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map((item) => item && typeof item === "object" ? item as Record<string, unknown> : {}) : [];
}

async function callMoodle(functionName: string, parameters: Record<string, MoodleParameter> = {}): Promise<unknown> {
  const baseUrl = requiredSecret("MOODLE_BASE_URL").replace(/\/+$/, "");
  const form = new URLSearchParams({
    wstoken: requiredSecret("MOODLE_TOKEN"),
    wsfunction: functionName,
    moodlewsrestformat: "json",
  });
  for (const [key, value] of Object.entries(parameters)) form.set(key, String(value));

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
  if (!response.ok) throw new Error(`Moodle respondió HTTP ${response.status}.`);
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const error = payload as Record<string, unknown>;
    if (error.exception || error.errorcode) throw new Error(String(error.message || error.errorcode || "Moodle rechazó la consulta."));
  }
  return payload;
}

async function usersByField(field: "id" | "idnumber" | "email", values: Array<string | number>): Promise<Record<string, unknown>[]> {
  const unique = [...new Set(values.map((value) => String(value).trim()).filter(Boolean))];
  if (!unique.length) return [];
  const parameters: Record<string, MoodleParameter> = { field };
  unique.slice(0, 20).forEach((value, index) => parameters[`values[${index}]`] = value);
  return asObjects(await callMoodle("core_user_get_users_by_field", parameters));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    const origin = requestOrigin(req);
    if (origin && !ALLOWED_ORIGINS.has(origin)) return json(req, { ok: false, error: "Origen no autorizado." }, 403);
    return new Response("ok", { headers: corsHeaders(req) });
  }
  if (req.method !== "POST") return json(req, { ok: false, error: "Método no permitido." }, 405);

  const origin = requestOrigin(req);
  if (origin && !ALLOWED_ORIGINS.has(origin)) return json(req, { ok: false, error: "Origen no autorizado." }, 403);

  try {
    const supabaseUrl = requiredSecret("SUPABASE_URL");
    const admin = createClient(supabaseUrl, getAdminKey(), { auth: { persistSession: false, autoRefreshToken: false } });
    const authorization = req.headers.get("authorization") || "";
    const token = authorization.replace(/^Bearer\s+/i, "").trim();
    if (!token) return json(req, { ok: false, error: "Sesión requerida." }, 401);

    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData.user) return json(req, { ok: false, error: "La sesión no es válida." }, 401);

    const { data: permission, error: permissionError } = await admin
      .from("estudio_admins")
      .select("auth_user_id")
      .eq("auth_user_id", authData.user.id)
      .eq("activo", true)
      .eq("rol", "admin")
      .maybeSingle();
    if (permissionError) throw permissionError;
    if (!permission) return json(req, { ok: false, error: "No autorizado." }, 403);

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const query = cleanText(body.query, 254);
    const companyCourseId = cleanText(body.company_course_id, 36);
    if (!query) throw new Error("Escribe un correo, documento o ID Moodle.");
    if (!companyCourseId) throw new Error("Selecciona el curso empresarial.");

    const { data: companyCourse, error: companyCourseError } = await admin
      .from("academia_cursos_empresa")
      .select("id,moodle_course_id,moodle_group_id,moodle_group_name")
      .eq("id", companyCourseId)
      .maybeSingle();
    if (companyCourseError) throw companyCourseError;
    if (!companyCourse) throw new Error("El curso empresarial no existe.");

    const found: Record<string, unknown>[] = [];
    if (query.includes("@")) found.push(...await usersByField("email", [query.toLowerCase()]));
    found.push(...await usersByField("idnumber", [query, query.toUpperCase()]));
    if (/^\d+$/.test(query)) found.push(...await usersByField("id", [query]));

    const unique = new Map<number, Record<string, unknown>>();
    for (const user of found) {
      const id = Number(user.id || 0);
      if (id > 0) unique.set(id, user);
    }

    const users = [...unique.values()].slice(0, 20);
    const ids = users.map((user) => Number(user.id || 0)).filter(Boolean);
    const courseId = Number(companyCourse.moodle_course_id || 0);
    const groupId = Number(companyCourse.moodle_group_id || 0);

    const enrolledIds = new Set<number>();
    if (courseId) {
      const enrolled = asObjects(await callMoodle("core_enrol_get_enrolled_users", { courseid: courseId }));
      enrolled.forEach((user) => enrolledIds.add(Number(user.id || 0)));
    }

    const groupIds = new Set<number>();
    if (groupId) {
      const groupResponse = asObjects(await callMoodle("core_group_get_group_members", { "groupids[0]": groupId }));
      const userids = Array.isArray(groupResponse[0]?.userids) ? groupResponse[0].userids as unknown[] : [];
      userids.forEach((id) => groupIds.add(Number(id)));
    }

    let existingParticipants: Record<string, unknown>[] = [];
    if (ids.length) {
      const { data, error } = await admin
        .from("academia_participantes_empresa")
        .select("id,moodle_user_id,estado")
        .eq("curso_empresa_id", companyCourseId)
        .in("moodle_user_id", ids)
        .not("estado", "in", "(retirado,reemplazado)");
      if (error) throw error;
      existingParticipants = data || [];
    }
    const existingMap = new Map(existingParticipants.map((row) => [Number(row.moodle_user_id || 0), row]));

    return json(req, {
      ok: true,
      query,
      company_course: {
        id: companyCourse.id,
        moodle_course_id: courseId,
        moodle_group_id: groupId || null,
        moodle_group_name: companyCourse.moodle_group_name || null,
      },
      users: users.map((user) => {
        const id = Number(user.id || 0);
        const existing = existingMap.get(id);
        return {
          id,
          username: String(user.username || ""),
          firstname: String(user.firstname || ""),
          lastname: String(user.lastname || ""),
          fullname: String(user.fullname || `${String(user.firstname || "")} ${String(user.lastname || "")}`).trim(),
          email: String(user.email || ""),
          idnumber: String(user.idnumber || ""),
          suspended: user.suspended === true || Number(user.suspended || 0) === 1,
          enrolled_in_course: enrolledIds.has(id),
          in_company_group: groupId ? groupIds.has(id) : false,
          company_participant: existing ? { id: existing.id, estado: existing.estado } : null,
        };
      }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "Error desconocido");
    return json(req, { ok: false, error: message.slice(0, 1000) }, 500);
  }
});
