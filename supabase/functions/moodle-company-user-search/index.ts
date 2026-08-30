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

function normalize(value: unknown): string {
  return cleanText(value, 500)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es")
    .replace(/[^a-z0-9@._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compact(value: unknown): string {
  return normalize(value).replace(/[^a-z0-9]/g, "");
}

function digits(value: unknown): string {
  return String(value ?? "").replace(/\D+/g, "");
}

function safeSearch(value: unknown): string {
  return cleanText(value, 100)
    .replace(/[%_,()'"\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeMoodleWildcard(value: string): string {
  return value.replace(/([%_\\])/g, "\\$1");
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

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asObjects(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map((item) => asObject(item)) : [];
}

async function callMoodle(functionName: string, parameters: Record<string, MoodleParameter> = {}): Promise<unknown> {
  const baseUrl = requiredSecret("MOODLE_BASE_URL").replace(/\/+$/, "");
  const form = new URLSearchParams({
    wstoken: requiredSecret("MOODLE_LECTURA_TOKEN"),
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
    if (error.exception || error.errorcode) {
      const code = String(error.errorcode || error.exception || "moodle_error");
      throw new Error(`${code}: ${String(error.message || "Moodle rechazó la consulta.")}`);
    }
  }
  return payload;
}

async function usersByField(field: "id" | "idnumber" | "email", values: Array<string | number>): Promise<Record<string, unknown>[]> {
  const unique = [...new Set(values.map((value) => String(value).trim()).filter(Boolean))];
  if (!unique.length) return [];
  const parameters: Record<string, MoodleParameter> = { field };
  unique.slice(0, 30).forEach((value, index) => parameters[`values[${index}]`] = value);
  return asObjects(await callMoodle("core_user_get_users_by_field", parameters));
}

async function flexibleUsers(field: string, value: string): Promise<Record<string, unknown>[]> {
  const parameters: Record<string, MoodleParameter> = {
    "criteria[0][key]": field,
    "criteria[0][value]": value,
  };
  const response = asObject(await callMoodle("core_user_get_users", parameters));
  return asObjects(response.users);
}

async function getAvailableFunctions(): Promise<Set<string>> {
  try {
    const info = asObject(await callMoodle("core_webservice_get_site_info"));
    const available = new Set(asObjects(info.functions).map((item) => String(item.name || "")));
    if (available.has("core_user_get_users")) return available;
  } catch {
    // Algunos servicios Moodle bloquean site_info aunque permitan las funciones asignadas.
  }

  try {
    await callMoodle("core_user_get_users", {
      "criteria[0][key]": "email",
      "criteria[0][value]": "__gestion_probe__@example.invalid",
    });
    return new Set(["core_user_get_users"]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "");
    if (!/acceso|access|accessexception/i.test(message)) {
      return new Set(["core_user_get_users"]);
    }
    return new Set();
  }
}

function userScore(user: Record<string, unknown>, query: string): number {
  const q = normalize(query);
  const qc = compact(query);
  const qd = digits(query);
  const id = String(user.id || "");
  const email = normalize(user.email);
  const idnumber = normalize(user.idnumber);
  const username = normalize(user.username);
  const firstname = normalize(user.firstname);
  const lastname = normalize(user.lastname);
  const fullname = normalize(user.fullname || `${firstname} ${lastname}`);
  const values = [email, idnumber, username, firstname, lastname, fullname];
  const compactValues = values.map(compact);
  let score = 0;

  if (/^\d+$/.test(q) && id === q) score = Math.max(score, 150);
  if (email && email === q) score = Math.max(score, 145);
  if (idnumber && idnumber === q) score = Math.max(score, 140);
  if (username && username === q) score = Math.max(score, 135);
  if (qc && compactValues.some((value) => value === qc)) score = Math.max(score, 130);
  if (qd.length >= 5 && [idnumber, username].some((value) => digits(value) === qd)) score = Math.max(score, 128);
  if (fullname && fullname === q) score = Math.max(score, 120);
  if (q && values.some((value) => value.includes(q))) score = Math.max(score, 100);
  if (qc.length >= 4 && compactValues.some((value) => value.includes(qc))) score = Math.max(score, 95);
  if (qd.length >= 5 && [idnumber, username].some((value) => digits(value).includes(qd))) score = Math.max(score, 92);

  const tokens = q.split(/\s+/).filter((token) => token.length >= 2);
  if (tokens.length && tokens.every((token) => fullname.includes(token))) {
    score = Math.max(score, 110 + Math.min(tokens.length, 5));
  } else if (tokens.some((token) => fullname.includes(token))) {
    score = Math.max(score, 75);
  }
  return score;
}

function addUnique(target: Map<number, Record<string, unknown>>, users: Record<string, unknown>[]) {
  for (const user of users) {
    const id = Number(user.id || 0);
    if (id > 0) target.set(id, user);
  }
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
    if (!query) throw new Error("Escribe un nombre, apellido, correo, documento o ID Moodle.");
    if (!companyCourseId) throw new Error("Selecciona el curso empresarial.");

    const { data: companyCourse, error: companyCourseError } = await admin
      .from("academia_cursos_empresa")
      .select("id,moodle_course_id,moodle_group_id,moodle_group_name")
      .eq("id", companyCourseId)
      .maybeSingle();
    if (companyCourseError) throw companyCourseError;
    if (!companyCourse) throw new Error("El curso empresarial no existe.");

    const unique = new Map<number, Record<string, unknown>>();
    const warnings: string[] = [];
    const raw = query.trim();
    const upper = raw.toUpperCase();
    const lower = raw.toLowerCase();
    const compactQuery = compact(raw);
    const digitQuery = digits(raw);

    // 1) Coincidencias exactas rápidas. Se prueban varias formas de documento.
    const documentVariants = new Set<string>([raw, upper, compactQuery]);
    if (digitQuery.length >= 5) {
      documentVariants.add(digitQuery);
      documentVariants.add(`V-${digitQuery}`);
      documentVariants.add(`V${digitQuery}`);
      documentVariants.add(`E-${digitQuery}`);
      documentVariants.add(`E${digitQuery}`);
    }
    try {
      if (raw.includes("@")) addUnique(unique, await usersByField("email", [lower, raw]));
      addUnique(unique, await usersByField("idnumber", [...documentVariants]));
      if (/^\d+$/.test(raw)) addUnique(unique, await usersByField("id", [raw]));
    } catch (error) {
      warnings.push(`Búsqueda exacta: ${error instanceof Error ? error.message : String(error)}`);
    }

    // 2) Cruce con la base de La Movida. Esto recupera Moodle IDs ya vinculados aunque
    // el dato haya sido escrito con un formato distinto en Moodle.
    const dbNeedle = safeSearch(raw);
    if (dbNeedle.length >= 2) {
      try {
        const filters = [
          `nombres.ilike.%${dbNeedle}%`,
          `apellidos.ilike.%${dbNeedle}%`,
          `correo.ilike.%${dbNeedle}%`,
          `documento.ilike.%${dbNeedle}%`,
          `cedula.ilike.%${dbNeedle}%`,
        ];
        const { data: members, error } = await admin
          .from("integrantes")
          .select("id,nombres,apellidos,documento,cedula,correo,moodle_user_id")
          .or(filters.join(","))
          .not("moodle_user_id", "is", null)
          .limit(40);
        if (error) throw error;
        const linkedIds = [...new Set((members || []).map((member) => Number(member.moodle_user_id || 0)).filter(Boolean))];
        if (linkedIds.length) addUnique(unique, await usersByField("id", linkedIds));
      } catch (error) {
        warnings.push(`Cruce con Directorio: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Si la consulta es básicamente una cédula, hacemos también un cruce por solo dígitos.
    if (digitQuery.length >= 5 && dbNeedle !== digitQuery) {
      try {
        const { data: members, error } = await admin
          .from("integrantes")
          .select("moodle_user_id,documento,cedula")
          .or(`documento.ilike.%${digitQuery}%,cedula.ilike.%${digitQuery}%`)
          .not("moodle_user_id", "is", null)
          .limit(40);
        if (error) throw error;
        const linkedIds = [...new Set((members || []).map((member) => Number(member.moodle_user_id || 0)).filter(Boolean))];
        if (linkedIds.length) addUnique(unique, await usersByField("id", linkedIds));
      } catch (error) {
        warnings.push(`Cruce por documento: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // 3) Búsqueda flexible nativa de Moodle. core_user_get_users es la función de búsqueda;
    // core_user_get_users_by_field solo sirve para campos únicos/exactos.
    const available = await getAvailableFunctions();
    const flexibleAvailable = available.size === 0 || available.has("core_user_get_users");
    if (flexibleAvailable) {
      const wildcardRaw = `%${escapeMoodleWildcard(raw)}%`;
      const wildcardCompact = compactQuery.length >= 3 ? `%${escapeMoodleWildcard(compactQuery)}%` : "";
      const wildcardDigits = digitQuery.length >= 5 ? `%${digitQuery}%` : "";
      const tasks: Array<[string, string]> = [];

      if (raw.includes("@")) tasks.push(["email", wildcardRaw]);
      else {
        tasks.push(["email", wildcardRaw], ["username", wildcardRaw], ["idnumber", wildcardRaw]);
      }
      if (wildcardCompact && wildcardCompact !== wildcardRaw) {
        tasks.push(["username", wildcardCompact], ["idnumber", wildcardCompact]);
      }
      if (wildcardDigits) tasks.push(["username", wildcardDigits], ["idnumber", wildcardDigits]);

      const tokens = normalize(raw).split(/\s+/).filter((token) => token.length >= 2).slice(0, 3);
      if (tokens.length) {
        for (const token of tokens) {
          const wildcard = `%${escapeMoodleWildcard(token)}%`;
          tasks.push(["firstname", wildcard], ["lastname", wildcard]);
        }
      }

      const seenTask = new Set<string>();
      for (const [field, value] of tasks.slice(0, 14)) {
        const key = `${field}:${value}`;
        if (seenTask.has(key)) continue;
        seenTask.add(key);
        try {
          addUnique(unique, await flexibleUsers(field, value));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (!warnings.some((item) => item.includes("core_user_get_users"))) {
            warnings.push(`Búsqueda flexible Moodle: ${message}`);
          }
          // Si la función no está incluida en el servicio externo no tiene sentido repetir 14 errores.
          if (/functionnotavailable|not available|no está disponible|not found|accessexception/i.test(message)) break;
        }
      }
    } else {
      warnings.push("core_user_get_users no está incluida en el servicio externo de Moodle; se usó búsqueda exacta y cruces vinculados.");
    }

    const users = [...unique.values()]
      .map((user) => ({ user, score: userScore(user, raw) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || String(a.user.lastname || "").localeCompare(String(b.user.lastname || ""), "es"))
      .slice(0, 30)
      .map((item) => item.user);

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
      search_mode: "flexible_v2",
      warnings,
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
