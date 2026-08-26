import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.95.0";

type JsonObject = Record<string, unknown>;
type MoodleParameter = string | number | boolean;

const ALLOWED_ORIGINS = new Set([
  "https://gestion.movidasst.com",
  "https://movidasst.github.io",
]);
const ALLOWED_MOODLE_FUNCTIONS = new Set([
  "core_course_get_courses",
  "mod_feedback_get_feedbacks_by_courses",
  "mod_feedback_get_items",
  "mod_feedback_get_analysis",
  "mod_feedback_get_responses_analysis",
]);
const JSON_CONTENT_TYPE = "application/json; charset=utf-8";

function requiredSecret(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Falta configurar el secreto ${name}.`);
  return value;
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
        for (const key of ["default", "service_role", "serviceRole", "secret", "key"]) {
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
  const message = error instanceof Error ? error.message : String(error ?? "Error desconocido");
  return message
    .replace(/wstoken=[^&\s]+/gi, "wstoken=[OCULTO]")
    .replace(/[a-f0-9]{32,}/gi, "[SECRETO OCULTO]")
    .slice(0, 1200);
}

function positiveInteger(value: unknown, label: string): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${label} no es válido.`);
  return number;
}

function nonNegativeInteger(value: unknown, label: string): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw new Error(`${label} no es válido.`);
  return number;
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function asObjects(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.map(asObject) : [];
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

async function callMoodle(
  functionName: string,
  parameters: Record<string, MoodleParameter> = {},
): Promise<unknown> {
  if (!ALLOWED_MOODLE_FUNCTIONS.has(functionName)) {
    throw new Error(`La función Moodle ${functionName} no está autorizada para lectura académica.`);
  }

  const baseUrl = requiredSecret("MOODLE_BASE_URL").replace(/\/+$/, "");
  const token = requiredSecret("MOODLE_LECTURA_TOKEN");
  const form = new URLSearchParams({
    wstoken: token,
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
    throw new Error(`Moodle devolvió una respuesta no válida para ${functionName} (${response.status}).`);
  }
  if (!response.ok) throw new Error(`Moodle bloqueó ${functionName}: HTTP ${response.status}.`);
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const moodleError = payload as JsonObject;
    if (moodleError.exception || moodleError.errorcode) {
      const code = String(moodleError.errorcode || moodleError.exception || "error_moodle");
      const message = String(moodleError.message || "Moodle rechazó la consulta.");
      throw new Error(`Moodle bloqueó ${functionName} [${code}]: ${message}`);
    }
  }
  return payload;
}

function normalizeCourse(raw: unknown): JsonObject {
  const course = asObject(raw);
  return {
    id: Number(course.id || 0),
    fullname: String(course.fullname || course.displayname || "Curso sin nombre"),
    shortname: String(course.shortname || ""),
    categoryid: Number(course.categoryid || course.category || 0),
    visible: course.visible !== 0 && course.visible !== false,
    startdate: Number(course.startdate || 0),
    enddate: Number(course.enddate || 0),
  };
}

function normalizeFeedback(raw: unknown): JsonObject {
  const feedback = asObject(raw);
  return {
    id: Number(feedback.id || 0),
    course_id: Number(feedback.course || 0),
    cmid: Number(feedback.coursemodule || 0),
    name: String(feedback.name || "Encuesta sin nombre"),
    anonymous: Number(feedback.anonymous || 0) === 1,
    multiple_submit: Boolean(feedback.multiple_submit),
    publish_stats: Boolean(feedback.publish_stats),
    timeopen: Number(feedback.timeopen || 0),
    timeclose: Number(feedback.timeclose || 0),
    timemodified: Number(feedback.timemodified || 0),
  };
}

async function getCourses(): Promise<JsonObject[]> {
  const response = await callMoodle("core_course_get_courses");
  return asObjects(response)
    .map(normalizeCourse)
    .filter((course) => Number(course.id || 0) > 1);
}

async function getFeedbacks(courses: JsonObject[]): Promise<{
  feedbacks: JsonObject[];
  warnings: JsonObject[];
}> {
  const feedbacks: JsonObject[] = [];
  const warnings: JsonObject[] = [];
  for (const batch of chunks(courses, 40)) {
    const parameters: Record<string, MoodleParameter> = {};
    batch.forEach((course, index) => {
      parameters[`courseids[${index}]`] = Number(course.id || 0);
    });
    const response = asObject(await callMoodle("mod_feedback_get_feedbacks_by_courses", parameters));
    feedbacks.push(...asObjects(response.feedbacks).map(normalizeFeedback));
    warnings.push(...asObjects(response.warnings));
  }
  const unique = [...new Map(feedbacks.filter((item) => Number(item.id || 0) > 0)
    .map((item) => [Number(item.id), item])).values()];
  return { feedbacks: unique, warnings };
}

async function getAnalysis(feedbackId: number): Promise<JsonObject> {
  return asObject(await callMoodle("mod_feedback_get_analysis", {
    feedbackid: feedbackId,
    groupid: 0,
    courseid: 0,
  }));
}

async function getFeedbackDetail(
  feedbackId: number,
  page = 0,
  perpage = 100,
  includeResponses = false,
): Promise<JsonObject> {
  const requests: Promise<unknown>[] = [
    callMoodle("mod_feedback_get_items", { feedbackid: feedbackId, courseid: 0 }),
    callMoodle("mod_feedback_get_analysis", { feedbackid: feedbackId, groupid: 0, courseid: 0 }),
  ];
  if (includeResponses) {
    requests.push(callMoodle("mod_feedback_get_responses_analysis", {
      feedbackid: feedbackId,
      groupid: 0,
      page,
      perpage,
      courseid: 0,
    }));
  }
  const [items, analysis, responses] = await Promise.all(requests);
  return {
    items: asObject(items),
    analysis: asObject(analysis),
    responses: includeResponses ? asObject(responses) : null,
  };
}

async function getCatalog(): Promise<JsonObject> {
  const courses = await getCourses();
  const courseMap = new Map(courses.map((course) => [Number(course.id || 0), course]));
  const result = await getFeedbacks(courses);
  const feedbacks = result.feedbacks.map((feedback) => ({
    ...feedback,
    course: courseMap.get(Number(feedback.course_id || 0)) || null,
  })).sort((left, right) => {
    const leftCourse = String(asObject(left.course).fullname || "");
    const rightCourse = String(asObject(right.course).fullname || "");
    return leftCourse.localeCompare(rightCourse, "es") ||
      String(left.name || "").localeCompare(String(right.name || ""), "es");
  });
  return {
    courses,
    feedbacks,
    warnings: result.warnings,
    summary: {
      courses: courses.length,
      feedbacks: feedbacks.length,
      anonymous: feedbacks.filter((item) => item.anonymous === true).length,
    },
  };
}

async function getDashboard(): Promise<JsonObject> {
  const catalog = await getCatalog();
  const feedbacks = asObjects(catalog.feedbacks);
  const metrics: JsonObject[] = [];
  for (const batch of chunks(feedbacks, 6)) {
    const results = await Promise.all(batch.map(async (feedback) => {
      try {
        const analysis = await getAnalysis(Number(feedback.id || 0));
        return {
          ...feedback,
          completedcount: Number(analysis.completedcount || 0),
          itemscount: Number(analysis.itemscount || 0),
          itemsdata: asObjects(analysis.itemsdata),
          warnings: asObjects(analysis.warnings),
          error: null,
        };
      } catch (error) {
        return {
          ...feedback,
          completedcount: 0,
          itemscount: 0,
          itemsdata: [],
          warnings: [],
          error: cleanError(error),
        };
      }
    }));
    metrics.push(...results);
  }
  return {
    ...catalog,
    feedbacks: metrics,
    summary: {
      ...asObject(catalog.summary),
      total_responses: metrics.reduce((sum, item) => sum + Number(item.completedcount || 0), 0),
      readable: metrics.filter((item) => !item.error).length,
      errors: metrics.filter((item) => Boolean(item.error)).length,
    },
  };
}

async function requireAdmin(req: Request): Promise<void> {
  const authorization = req.headers.get("authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("Sesión requerida.");

  const admin = createClient(requiredSecret("SUPABASE_URL"), getAdminKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData.user) throw new Error("La sesión no es válida.");

  const { data: permission, error: permissionError } = await admin
    .from("estudio_admins")
    .select("auth_user_id")
    .eq("auth_user_id", authData.user.id)
    .eq("activo", true)
    .eq("rol", "admin")
    .maybeSingle();
  if (permissionError) throw new Error(`No se pudo validar el administrador: ${permissionError.message}`);
  if (!permission) throw new Error("No autorizado.");
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
    // __TEST_AUTH_BYPASS__
    await requireAdmin(req);
    const body = await req.json().catch(() => ({})) as JsonObject;
    const action = String(body.action || "catalog").trim();

    if (action === "catalog") return json(req, { ok: true, data: await getCatalog() });
    if (action === "dashboard") return json(req, { ok: true, data: await getDashboard() });
    if (action === "probe") {
      const cmid = positiveInteger(body.feedback_cmid || 958, "El módulo Feedback");
      const catalog = await getCatalog();
      const feedback = asObjects(catalog.feedbacks).find((item) => Number(item.cmid || 0) === cmid);
      if (!feedback) throw new Error(`No se encontró una encuesta accesible con el módulo ${cmid}.`);
      const detail = await getFeedbackDetail(Number(feedback.id || 0), 0, 100, false);
      return json(req, { ok: true, feedback, detail, catalog_summary: catalog.summary as JsonObject });
    }
    if (action === "detail") {
      const feedbackId = positiveInteger(body.feedback_id, "La encuesta");
      const page = nonNegativeInteger(body.page || 0, "La página");
      const perpage = Math.min(200, Math.max(1, positiveInteger(body.perpage || 100, "El tamaño de página")));
      const includeResponses = body.include_responses === true;
      const detail = await getFeedbackDetail(feedbackId, page, perpage, includeResponses);
      return json(req, { ok: true, feedback_id: feedbackId, detail });
    }
    return json(req, { ok: false, error: "Acción no reconocida." }, 400);
  } catch (error) {
    const message = cleanError(error);
    const status = message === "Sesión requerida." || message === "La sesión no es válida."
      ? 401
      : message === "No autorizado."
      ? 403
      : 500;
    console.error("moodle-feedback-analytics:", message);
    return json(req, { ok: false, error: message }, status);
  }
});
