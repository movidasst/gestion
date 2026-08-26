import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.95.0";

type JsonObject = Record<string, unknown>;
type MoodleParameter = string | number | boolean;
type SupabaseAdminClient = ReturnType<typeof createClient>;

type PaymentFile = {
  filename: string;
  mimetype: string;
  filesize: number;
  fileurl: string;
};

type PaymentAssignment = {
  course_id: number;
  course_name: string;
  course_shortname: string;
  assignment_id: number;
  assignment_cmid: number;
  assignment_name: string;
  grade: number;
  markingworkflow: number;
  teamsubmission: number;
};

type PaymentRow = {
  submission_id: number;
  moodle_user_id: number;
  attemptnumber: number;
  timecreated: number;
  timemodified: number;
  submission_status: string;
  gradingstatus: string;
  processed: boolean;
  course: JsonObject;
  assignment: JsonObject;
  student: JsonObject;
  member: JsonObject | null;
  files: PaymentFile[];
};

type PaymentSnapshot = {
  assignments: PaymentAssignment[];
  courses_without_payment: JsonObject[];
  warnings: JsonObject[];
  rows: PaymentRow[];
};

type EvaluationRow = PaymentRow & {
  online_text: string;
};

type EvaluationSnapshot = {
  assignments: PaymentAssignment[];
  warnings: JsonObject[];
  rows: EvaluationRow[];
};

const ALLOWED_ORIGINS = new Set([
  "https://gestion.movidasst.com",
  "https://movidasst.github.io",
]);

const STUDENT_ROLE_ID = 5;
const JSON_CONTENT_TYPE = "application/json; charset=utf-8";
const PAYMENT_ASSIGNMENT_NAME = "Sube tu pago";
const PAYMENT_APPROVAL_GRADE = 100;
const MAX_PAYMENT_FILE_BYTES = 15 * 1024 * 1024;
const MAX_FEEDBACK_LENGTH = 5000;

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

function nonNegativeInteger(value: unknown, label: string): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    throw new Error(`${label} no es válido.`);
  }
  return number;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asObjects(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(asObject) : [];
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
    signal: AbortSignal.timeout(functionName === "core_course_duplicate_course" ? 120000 : 30000),
  });
  const raw = await response.text();
  let payload: unknown;

  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    throw new Error(`Moodle bloqueó ${functionName}: respuesta no válida (${response.status}).`);
  }

  if (!response.ok) {
    throw new Error(`Moodle bloqueó ${functionName}: HTTP ${response.status}.`);
  }

  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const error = payload as Record<string, unknown>;
    if (error.exception || error.errorcode) {
      const code = String(error.errorcode || error.exception || "error_moodle");
      const message = String(error.message || "Moodle rechazó la operación.");
      throw new Error(`Moodle bloqueó ${functionName} [${code}]: ${message}`);
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

function enrolledUserIsStudent(user: JsonObject): boolean {
  const roles = asObjects(user.roles);
  if (!roles.length) return true;
  return roles.some((role) => {
    const shortname = String(role.shortname || "").trim().toLowerCase();
    return Number(role.roleid || role.id || 0) === STUDENT_ROLE_ID || shortname === "student";
  });
}

function normalizeEnrolledUser(raw: unknown): JsonObject {
  const user = asObject(raw);
  const fullname = String(user.fullname || "").trim() ||
    `${String(user.firstname || "").trim()} ${String(user.lastname || "").trim()}`.trim() ||
    `Usuario Moodle #${Number(user.id || 0)}`;
  return {
    id: Number(user.id || 0),
    fullname,
    email: String(user.email || "").trim(),
    idnumber: String(user.idnumber || "").trim(),
    lastaccess: Number(user.lastaccess || 0),
    lastcourseaccess: Number(user.lastcourseaccess || 0),
    firstaccess: Number(user.firstaccess || 0),
    suspended: user.suspended === true || Number(user.suspended || 0) === 1,
    profileimageurlsmall: String(user.profileimageurlsmall || ""),
    roles: asObjects(user.roles),
  };
}

async function getCourseStudents(courseId: number): Promise<JsonObject[]> {
  const response = await callMoodle("core_enrol_get_enrolled_users", { courseid: courseId });
  return asObjects(response)
    .filter(enrolledUserIsStudent)
    .map(normalizeEnrolledUser)
    .filter((user) => Number(user.id || 0) > 0 && user.suspended !== true);
}

function accessStatus(lastAccess: number, inactiveDays: number): "active" | "inactive" | "never" {
  if (!lastAccess) return "never";
  const cutoff = Math.floor(Date.now() / 1000) - inactiveDays * 86400;
  return lastAccess >= cutoff ? "active" : "inactive";
}

async function getAcademicOverview(inactiveDays: number): Promise<JsonObject> {
  const courses = (await getCourses()).filter((course) => course.visible !== false);
  const rows: JsonObject[] = [];
  const uniqueStudents = new Map<number, JsonObject>();

  for (const courseBatch of chunks(courses, 6)) {
    const batch = await Promise.all(courseBatch.map(async (course) => {
      try {
        const students = await getCourseStudents(Number(course.id || 0));
        let active = 0;
        let inactive = 0;
        let never = 0;
        for (const student of students) {
          const lastCourseAccess = Number(student.lastcourseaccess || 0);
          const status = accessStatus(lastCourseAccess, inactiveDays);
          if (status === "active") active++;
          else if (status === "inactive") inactive++;
          else never++;

          const userId = Number(student.id || 0);
          const previous = uniqueStudents.get(userId);
          const previousAccess = Number(previous?.lastcourseaccess || 0);
          if (!previous || lastCourseAccess > previousAccess) {
            uniqueStudents.set(userId, { ...student, lastcourseaccess: lastCourseAccess });
          }
        }
        return {
          ...course,
          enrolled: students.length,
          active,
          inactive,
          never,
          alerts: inactive + never,
          error: null,
        };
      } catch (error) {
        return {
          ...course,
          enrolled: 0,
          active: 0,
          inactive: 0,
          never: 0,
          alerts: 0,
          error: cleanError(error),
        };
      }
    }));
    rows.push(...batch);
  }

  const unique = [...uniqueStudents.values()];
  const activeStudents = unique.filter((student) =>
    accessStatus(Number(student.lastcourseaccess || 0), inactiveDays) === "active"
  ).length;
  const neverStudents = unique.filter((student) => !Number(student.lastcourseaccess || 0)).length;
  const inactiveStudents = unique.length - activeStudents - neverStudents;

  rows.sort((left, right) => {
    const alertsOrder = Number(right.alerts || 0) - Number(left.alerts || 0);
    return alertsOrder || String(left.fullname || "").localeCompare(String(right.fullname || ""), "es");
  });

  return {
    inactive_days: inactiveDays,
    courses: rows,
    summary: {
      courses: courses.length,
      readable_courses: rows.filter((course) => !course.error).length,
      students: unique.length,
      active_students: activeStudents,
      inactive_students: inactiveStudents,
      never_accessed: neverStudents,
      alerts: inactiveStudents + neverStudents,
      enrolments: rows.reduce((sum, course) => sum + Number(course.enrolled || 0), 0),
    },
  };
}

function gradeSummary(raw: unknown): JsonObject {
  const response = asObject(raw);
  const userGrade = asObjects(response.usergrades)[0] || {};
  const items = asObjects(userGrade.gradeitems);
  const courseItem = items.find((item) => String(item.itemtype || "") === "course") || items[0] || {};
  const rawGrade = courseItem.graderaw == null || courseItem.graderaw === ""
    ? null
    : Number(courseItem.graderaw);
  const maximum = Number(courseItem.grademax || 0);
  const percentage = rawGrade != null && Number.isFinite(rawGrade) && maximum > 0
    ? Math.round((rawGrade * 10000) / maximum) / 100
    : null;
  return {
    raw: rawGrade != null && Number.isFinite(rawGrade) ? rawGrade : null,
    maximum,
    percentage,
    formatted: String(courseItem.gradeformatted || "").trim(),
    percentage_formatted: String(courseItem.percentageformatted || "").trim(),
    graded_items: items.filter((item) => item.graderaw != null && item.graderaw !== "").length,
  };
}

async function getAcademicStudentDetail(
  course: JsonObject,
  student: JsonObject,
  inactiveDays: number,
): Promise<JsonObject> {
  const courseId = Number(course.id || 0);
  const userId = Number(student.id || 0);
  const results = await Promise.allSettled([
    callMoodle("core_completion_get_course_completion_status", { courseid: courseId, userid: userId }),
    callMoodle("core_completion_get_activities_completion_status", { courseid: courseId, userid: userId }),
    callMoodle("gradereport_user_get_grade_items", { courseid: courseId, userid: userId }),
  ]);

  const completion = results[0].status === "fulfilled" ? asObject(results[0].value) : {};
  const activities = results[1].status === "fulfilled" ? asObject(results[1].value) : {};
  const grades = results[2].status === "fulfilled" ? gradeSummary(results[2].value) : gradeSummary({});
  const completionStatus = asObject(completion.completionstatus);
  const statuses = asObjects(activities.statuses);
  const completedActivities = statuses.filter((status) => Number(status.state || 0) > 0);
  const pendingActivities = statuses.filter((status) => Number(status.state || 0) === 0);
  const completed = completionStatus.completed === true || Number(completionStatus.completed || 0) === 1;
  const progress = statuses.length
    ? Math.round((completedActivities.length * 1000) / statuses.length) / 10
    : completed
    ? 100
    : null;
  const lastAccess = Number(student.lastcourseaccess || 0);
  const access = accessStatus(lastAccess, inactiveDays);
  const courseEnded = Number(course.enddate || 0) > 0 && Number(course.enddate || 0) < Math.floor(Date.now() / 1000);
  const alerts: JsonObject[] = [];

  if (access === "never") alerts.push({ code: "never", severity: "danger", message: "Nunca ha ingresado al curso" });
  if (access === "inactive") alerts.push({ code: "inactive", severity: "warn", message: `Sin ingresar durante más de ${inactiveDays} días` });
  if (courseEnded && !completed) alerts.push({ code: "overdue", severity: "danger", message: "El curso terminó y sigue pendiente" });
  if (progress === 0 && access !== "never") alerts.push({ code: "no_progress", severity: "warn", message: "Ingresó, pero no registra avance" });
  if (Number(grades.percentage) < 50 && grades.percentage != null) {
    alerts.push({ code: "low_grade", severity: "danger", message: "Calificación acumulada inferior a 50%" });
  }

  const errors = results.flatMap((result) => result.status === "rejected" ? [cleanError(result.reason)] : []);
  return {
    ...student,
    access_status: access,
    completed,
    progress,
    activities_total: statuses.length,
    activities_completed: completedActivities.length,
    activities_pending: pendingActivities.length,
    pending_names: pendingActivities.slice(0, 6).map((item) => String(item.name || item.modname || "Actividad pendiente")),
    grade: grades,
    alerts,
    status: completed ? "completed" : alerts.length ? "attention" : "progress",
    errors,
  };
}

async function getAcademicCourseStudents(
  admin: SupabaseAdminClient,
  courseId: number,
  inactiveDays: number,
  page: number,
  perPage: number,
  search: string,
  requestedStatus: string,
): Promise<JsonObject> {
  const course = (await getCourses()).find((item) => Number(item.id || 0) === courseId);
  if (!course) throw new Error("El curso no existe o no está disponible.");

  let students = await getCourseStudents(courseId);
  if (search) {
    const needle = search.toLocaleLowerCase("es");
    students = students.filter((student) =>
      [student.fullname, student.email, student.idnumber]
        .some((value) => String(value || "").toLocaleLowerCase("es").includes(needle))
    );
  }
  if (["active", "inactive", "never"].includes(requestedStatus)) {
    students = students.filter((student) =>
      accessStatus(Number(student.lastcourseaccess || 0), inactiveDays) === requestedStatus
    );
  }
  students.sort((left, right) => {
    const leftStatus = accessStatus(Number(left.lastcourseaccess || 0), inactiveDays);
    const rightStatus = accessStatus(Number(right.lastcourseaccess || 0), inactiveDays);
    const rank = { never: 0, inactive: 1, active: 2 };
    return rank[leftStatus] - rank[rightStatus] ||
      String(left.fullname || "").localeCompare(String(right.fullname || ""), "es");
  });

  const total = students.length;
  const from = page * perPage;
  const pageStudents = students.slice(from, from + perPage);
  const ids = pageStudents.map((student) => Number(student.id || 0)).filter(Boolean);
  let members: JsonObject[] = [];
  if (ids.length) {
    const { data, error } = await admin
      .from("integrantes")
      .select("id,nombres,apellidos,documento,cedula,correo,moodle_user_id")
      .in("moodle_user_id", ids);
    if (error) throw new Error(`No se pudieron relacionar los integrantes: ${error.message}`);
    members = data || [];
  }
  const memberMap = new Map(members.map((member) => [Number(member.moodle_user_id || 0), member]));
  const rows: JsonObject[] = [];
  for (const batch of chunks(pageStudents, 5)) {
    const detailed = await Promise.all(batch.map((student) =>
      getAcademicStudentDetail(course, student, inactiveDays)
    ));
    rows.push(...detailed.map((student) => {
      const member = memberMap.get(Number(student.id || 0));
      return {
        ...student,
        member_id: Number(member?.id || 0) || null,
        idnumber: String(member?.documento || member?.cedula || student.idnumber || ""),
        email: String(member?.correo || student.email || ""),
      };
    }));
  }

  return {
    course,
    students: rows,
    page,
    perpage: perPage,
    total,
    pages: Math.max(1, Math.ceil(total / perPage)),
    inactive_days: inactiveDays,
    summary: {
      shown: rows.length,
      completed: rows.filter((student) => student.completed === true).length,
      attention: rows.filter((student) => student.status === "attention").length,
      pending_activities: rows.reduce((sum, student) => sum + Number(student.activities_pending || 0), 0),
    },
  };
}

function getSubmissionFiles(submission: Record<string, unknown>): PaymentFile[] {
  const files: PaymentFile[] = [];
  for (const plugin of asObjects(submission.plugins)) {
    for (const area of asObjects(plugin.fileareas)) {
      for (const file of asObjects(area.files)) {
        const fileurl = String(file.fileurl || "").trim();
        const filename = String(file.filename || "").trim();
        if (!fileurl || !filename || file.isdir === true || Number(file.isdir || 0) === 1) continue;
        files.push({
          filename,
          mimetype: String(file.mimetype || "application/octet-stream"),
          filesize: Math.max(0, Number(file.filesize || 0)),
          fileurl,
        });
      }
    }
  }
  return files;
}

function getSubmissionOnlineText(submission: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const plugin of asObjects(submission.plugins)) {
    for (const field of asObjects(plugin.editorfields)) {
      const text = String(field.text || "").trim();
      if (text) parts.push(text);
    }
  }
  return parts.join("\n\n").slice(0, 50000);
}

function isPaymentAssignmentName(value: unknown): boolean {
  const normalized = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return normalized === PAYMENT_ASSIGNMENT_NAME.toLowerCase();
}

function isEvaluationAssignmentName(value: unknown): boolean {
  const normalized = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
  return normalized.includes("tarea");
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

async function getMoodleUsersByIds(userIds: number[]): Promise<JsonObject[]> {
  if (!userIds.length) return [];

  const responses = await Promise.all(chunks(userIds, 100).map((userIdBatch) => {
    const parameters: Record<string, MoodleParameter> = { field: "id" };
    userIdBatch.forEach((userId, index) => {
      parameters[`values[${index}]`] = userId;
    });
    return callMoodle("core_user_get_users_by_field", parameters);
  }));

  return responses.flatMap(asObjects);
}

async function getPaymentAssignments(): Promise<{
  assignments: PaymentAssignment[];
  courses_without_payment: JsonObject[];
  warnings: JsonObject[];
}> {
  const courses = await getCourses();
  if (!courses.length) return { assignments: [], courses_without_payment: [], warnings: [] };

  const responses = await Promise.all(chunks(courses, 50).map((courseBatch) => {
    const parameters: Record<string, MoodleParameter> = { includenotenrolledcourses: 1 };
    courseBatch.forEach((course, index) => {
      parameters[`courseids[${index}]`] = Number(course.id || 0);
    });
    return callMoodle("mod_assign_get_assignments", parameters);
  }));

  const assignments: PaymentAssignment[] = [];
  const warnings: JsonObject[] = [];
  for (const rawResponse of responses) {
    const response = asObject(rawResponse);
    warnings.push(...asObjects(response.warnings));
    for (const course of asObjects(response.courses)) {
      for (const assignment of asObjects(course.assignments)) {
        if (!isPaymentAssignmentName(assignment.name)) continue;
        assignments.push({
          course_id: Number(course.id || assignment.course || 0),
          course_name: String(course.fullname || "Curso sin nombre"),
          course_shortname: String(course.shortname || ""),
          assignment_id: Number(assignment.id || 0),
          assignment_cmid: Number(assignment.cmid || 0),
          assignment_name: String(assignment.name || PAYMENT_ASSIGNMENT_NAME),
          grade: Number(assignment.grade || 0),
          markingworkflow: Number(assignment.markingworkflow || 0),
          teamsubmission: Number(assignment.teamsubmission || 0),
        });
      }
    }
  }

  const paymentCourseIds = new Set(assignments.map((item) => item.course_id));
  const coursesWithoutPayment = courses.filter((course) => !paymentCourseIds.has(Number(course.id || 0)));
  assignments.sort((left, right) => left.course_name.localeCompare(right.course_name, "es"));
  return { assignments, courses_without_payment: coursesWithoutPayment, warnings };
}

async function getEvaluationAssignments(): Promise<{
  assignments: PaymentAssignment[];
  warnings: JsonObject[];
}> {
  const courses = await getCourses();
  if (!courses.length) return { assignments: [], warnings: [] };

  const responses = await Promise.all(chunks(courses, 50).map((courseBatch) => {
    const parameters: Record<string, MoodleParameter> = { includenotenrolledcourses: 1 };
    courseBatch.forEach((course, index) => {
      parameters[`courseids[${index}]`] = Number(course.id || 0);
    });
    return callMoodle("mod_assign_get_assignments", parameters);
  }));

  const assignments: PaymentAssignment[] = [];
  const warnings: JsonObject[] = [];
  for (const rawResponse of responses) {
    const response = asObject(rawResponse);
    warnings.push(...asObjects(response.warnings));
    for (const course of asObjects(response.courses)) {
      for (const assignment of asObjects(course.assignments)) {
        if (!isEvaluationAssignmentName(assignment.name)) continue;
        const assignmentId = Number(assignment.id || 0);
        if (!assignmentId) continue;
        assignments.push({
          course_id: Number(course.id || assignment.course || 0),
          course_name: String(course.fullname || "Curso sin nombre"),
          course_shortname: String(course.shortname || ""),
          assignment_id: assignmentId,
          assignment_cmid: Number(assignment.cmid || 0),
          assignment_name: String(assignment.name || "Tarea sin nombre"),
          grade: Number(assignment.grade || 0),
          markingworkflow: Number(assignment.markingworkflow || 0),
          teamsubmission: Number(assignment.teamsubmission || 0),
        });
      }
    }
  }

  assignments.sort((left, right) => {
    const courseOrder = left.course_name.localeCompare(right.course_name, "es");
    return courseOrder || left.assignment_name.localeCompare(right.assignment_name, "es");
  });
  return { assignments, warnings };
}

async function getEvaluationSnapshot(admin: SupabaseAdminClient): Promise<EvaluationSnapshot> {
  const context = await getEvaluationAssignments();
  if (!context.assignments.length) return { ...context, rows: [] };

  const responses = await Promise.all(chunks(context.assignments, 50).map((assignmentBatch) => {
    const parameters: Record<string, MoodleParameter> = {
      status: "submitted",
      since: 0,
      before: 0,
    };
    assignmentBatch.forEach((assignment, index) => {
      parameters[`assignmentids[${index}]`] = assignment.assignment_id;
    });
    return callMoodle("mod_assign_get_submissions", parameters);
  }));

  const submissionsByAssignment = new Map<number, JsonObject[]>();
  const warnings = [...context.warnings];
  for (const rawResponse of responses) {
    const response = asObject(rawResponse);
    warnings.push(...asObjects(response.warnings));
    for (const assignment of asObjects(response.assignments)) {
      submissionsByAssignment.set(
        Number(assignment.assignmentid || 0),
        asObjects(assignment.submissions),
      );
    }
  }

  const rawRows = context.assignments.flatMap((assignment) =>
    (submissionsByAssignment.get(assignment.assignment_id) || [])
      .map((submission) => ({ assignment, submission }))
  );
  const moodleUserIds = [...new Set(rawRows.map((item) => Number(item.submission.userid || 0)).filter(Boolean))];
  let linkedMembers: JsonObject[] = [];

  if (moodleUserIds.length) {
    const { data, error } = await admin
      .from("integrantes")
      .select("id,nombres,apellidos,documento,cedula,correo,moodle_user_id")
      .in("moodle_user_id", moodleUserIds);
    if (error) throw new Error(`No se pudieron relacionar los integrantes: ${error.message}`);
    linkedMembers = data || [];
  }

  const memberMap = new Map(linkedMembers.map((member) => [Number(member.moodle_user_id || 0), member]));
  const moodleLookupIds = moodleUserIds.filter((moodleUserId) => {
    const member = memberMap.get(moodleUserId);
    if (!member) return true;
    const memberName = `${String(member.nombres || "")} ${String(member.apellidos || "")}`.trim();
    return !memberName || !String(member.correo || "").trim();
  });
  let moodleUsers: JsonObject[] = [];
  try {
    moodleUsers = await getMoodleUsersByIds(moodleLookupIds);
  } catch (error) {
    const message = cleanError(error);
    console.warn("No se pudieron completar los datos de usuarios desde Moodle:", message);
    warnings.push({ warningcode: "moodle_user_lookup_failed", message });
  }
  const moodleUserMap = new Map(moodleUsers.map((user) => [Number(user.id || 0), user]));

  const rows = rawRows
    .map(({ assignment, submission }): EvaluationRow | null => {
      const files = getSubmissionFiles(submission);
      const onlineText = getSubmissionOnlineText(submission);
      if (!files.length && !onlineText) return null;
      const moodleUserId = Number(submission.userid || 0);
      if (!moodleUserId) return null;
      const member = memberMap.get(moodleUserId) || null;
      const moodleUser = moodleUserMap.get(moodleUserId) || null;
      const gradingstatus = String(submission.gradingstatus || "notgraded").toLowerCase();
      const memberName = `${String(member?.nombres || "")} ${String(member?.apellidos || "")}`.trim();
      const moodleName = String(moodleUser?.fullname || "").trim() ||
        `${String(moodleUser?.firstname || "")} ${String(moodleUser?.lastname || "")}`.trim();
      return {
        submission_id: Number(submission.id || 0),
        moodle_user_id: moodleUserId,
        attemptnumber: Number(submission.attemptnumber || 0),
        timecreated: Number(submission.timecreated || 0),
        timemodified: Number(submission.timemodified || 0),
        submission_status: String(submission.status || ""),
        gradingstatus,
        processed: gradingstatus === "graded",
        course: {
          id: assignment.course_id,
          fullname: assignment.course_name,
          shortname: assignment.course_shortname,
        },
        assignment: {
          id: assignment.assignment_id,
          cmid: assignment.assignment_cmid,
          name: assignment.assignment_name,
          grade: assignment.grade,
          markingworkflow: assignment.markingworkflow,
          teamsubmission: assignment.teamsubmission,
        },
        student: {
          fullname: memberName || moodleName || `Usuario Moodle #${moodleUserId}`,
          email: String(member?.correo || moodleUser?.email || "").trim(),
          idnumber: String(member?.documento || member?.cedula || moodleUser?.idnumber || "").trim(),
        },
        member: member
          ? {
            id: Number(member.id || 0),
            documento: String(member.documento || member.cedula || ""),
          }
          : null,
        files,
        online_text: onlineText,
      };
    })
    .filter((row): row is EvaluationRow => row !== null)
    .sort((left, right) => right.timemodified - left.timemodified);

  return { ...context, warnings, rows };
}

async function getEvaluationTarget(assignmentId: number, submissionId: number): Promise<{
  assignment: PaymentAssignment;
  submission: JsonObject;
  files: PaymentFile[];
}> {
  const context = await getEvaluationAssignments();
  const assignment = context.assignments.find((item) => item.assignment_id === assignmentId);
  if (!assignment) throw new Error("La tarea ya no está disponible para evaluación.");

  const response = asObject(await callMoodle("mod_assign_get_submissions", {
    "assignmentids[0]": assignmentId,
    status: "",
    since: 0,
    before: 0,
  }));
  const remoteAssignment = asObjects(response.assignments)
    .find((item) => Number(item.assignmentid || 0) === assignmentId);
  const submission = asObjects(remoteAssignment?.submissions)
    .find((item) => Number(item.id || 0) === submissionId);
  if (!submission) throw new Error("La entrega ya no está disponible en Moodle.");
  return { assignment, submission, files: getSubmissionFiles(submission) };
}

async function getPaymentSnapshot(admin: SupabaseAdminClient): Promise<PaymentSnapshot> {
  const context = await getPaymentAssignments();
  if (!context.assignments.length) return { ...context, rows: [] };

  const responses = await Promise.all(chunks(context.assignments, 50).map((assignmentBatch) => {
    const parameters: Record<string, MoodleParameter> = {
      status: "",
      since: 0,
      before: 0,
    };
    assignmentBatch.forEach((assignment, index) => {
      parameters[`assignmentids[${index}]`] = assignment.assignment_id;
    });
    return callMoodle("mod_assign_get_submissions", parameters);
  }));

  const submissionsByAssignment = new Map<number, Record<string, unknown>[]>();
  const warnings = [...context.warnings];
  for (const rawResponse of responses) {
    const response = asObject(rawResponse);
    warnings.push(...asObjects(response.warnings));
    for (const assignment of asObjects(response.assignments)) {
      submissionsByAssignment.set(
        Number(assignment.assignmentid || 0),
        asObjects(assignment.submissions),
      );
    }
  }

  const rawRows = context.assignments.flatMap((assignment) =>
    (submissionsByAssignment.get(assignment.assignment_id) || [])
      .map((submission) => ({ assignment, submission }))
  );
  const moodleUserIds = [...new Set(rawRows.map((item) => Number(item.submission.userid || 0)).filter(Boolean))];
  let linkedMembers: Record<string, unknown>[] = [];

  if (moodleUserIds.length) {
    const { data, error } = await admin
      .from("integrantes")
      .select("id,nombres,apellidos,documento,cedula,correo,moodle_user_id")
      .in("moodle_user_id", moodleUserIds);
    if (error) throw new Error(`No se pudieron relacionar los integrantes: ${error.message}`);
    linkedMembers = data || [];
  }

  const memberMap = new Map(linkedMembers.map((member) => [Number(member.moodle_user_id || 0), member]));
  const moodleLookupIds = moodleUserIds.filter((moodleUserId) => {
    const member = memberMap.get(moodleUserId);
    if (!member) return true;
    const memberName = `${String(member.nombres || "")} ${String(member.apellidos || "")}`.trim();
    return !memberName || !String(member.correo || "").trim();
  });
  let moodleUsers: JsonObject[] = [];
  try {
    moodleUsers = await getMoodleUsersByIds(moodleLookupIds);
  } catch (error) {
    const message = cleanError(error);
    console.warn("No se pudieron completar los datos de usuarios desde Moodle:", message);
    warnings.push({
      warningcode: "moodle_user_lookup_failed",
      message,
    });
  }
  const moodleUserMap = new Map(moodleUsers.map((user) => [Number(user.id || 0), user]));
  const rows = rawRows
    .map(({ assignment, submission }): PaymentRow | null => {
      const files = getSubmissionFiles(submission);
      if (!files.length) return null;
      const moodleUserId = Number(submission.userid || 0);
      const member = memberMap.get(moodleUserId) || null;
      const moodleUser = moodleUserMap.get(moodleUserId) || null;
      const gradingstatus = String(submission.gradingstatus || "notgraded").toLowerCase();
      const memberName = `${String(member?.nombres || "")} ${String(member?.apellidos || "")}`.trim();
      const moodleName = String(moodleUser?.fullname || "").trim() ||
        `${String(moodleUser?.firstname || "")} ${String(moodleUser?.lastname || "")}`.trim();
      const fullname = memberName || moodleName || `Usuario Moodle #${moodleUserId}`;
      return {
        submission_id: Number(submission.id || 0),
        moodle_user_id: moodleUserId,
        attemptnumber: Number(submission.attemptnumber || 0),
        timecreated: Number(submission.timecreated || 0),
        timemodified: Number(submission.timemodified || 0),
        submission_status: String(submission.status || ""),
        gradingstatus,
        processed: gradingstatus === "graded",
        course: {
          id: assignment.course_id,
          fullname: assignment.course_name,
          shortname: assignment.course_shortname,
        },
        assignment: {
          id: assignment.assignment_id,
          cmid: assignment.assignment_cmid,
          name: assignment.assignment_name,
          grade: assignment.grade,
          markingworkflow: assignment.markingworkflow,
          teamsubmission: assignment.teamsubmission,
        },
        student: {
          fullname,
          email: String(member?.correo || moodleUser?.email || "").trim(),
          idnumber: String(member?.documento || member?.cedula || moodleUser?.idnumber || "").trim(),
        },
        member: member
          ? {
            id: Number(member.id || 0),
            documento: String(member.documento || member.cedula || ""),
          }
          : null,
        files,
      };
    })
    .filter((row): row is PaymentRow => row !== null)
    .sort((left, right) => right.timemodified - left.timemodified);

  return { ...context, warnings, rows };
}

function publicPaymentRow(row: PaymentRow): JsonObject {
  return {
    ...row,
    files: row.files.map((file, index) => ({
      index,
      filename: file.filename,
      mimetype: file.mimetype,
      filesize: file.filesize,
    })),
  };
}

function publicEvaluationRow(row: EvaluationRow): JsonObject {
  return {
    ...row,
    files: row.files.map((file, index) => ({
      index,
      filename: file.filename,
      mimetype: file.mimetype,
      filesize: file.filesize,
    })),
  };
}

async function downloadMoodleFile(file: PaymentFile): Promise<{ data: ArrayBuffer; mimetype: string }> {
  if (file.filesize > MAX_PAYMENT_FILE_BYTES) {
    throw new Error("El archivo supera el máximo de 15 MB permitido para la vista previa.");
  }

  const baseUrl = new URL(requiredSecret("MOODLE_BASE_URL").replace(/\/+$/, ""));
  const fileUrl = new URL(file.fileurl);
  if (fileUrl.origin !== baseUrl.origin || !fileUrl.pathname.includes("/webservice/pluginfile.php/")) {
    throw new Error("La dirección del archivo no pertenece al Moodle autorizado.");
  }
  fileUrl.searchParams.set("token", requiredSecret("MOODLE_TOKEN"));

  const response = await fetch(fileUrl, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`No se pudo descargar el comprobante (${response.status}).`);
  const data = await response.arrayBuffer();
  if (data.byteLength > MAX_PAYMENT_FILE_BYTES) {
    throw new Error("El archivo descargado supera el máximo de 15 MB.");
  }

  const responseType = response.headers.get("content-type")?.split(";")[0]?.trim() || "";
  const declaredType = file.mimetype.split(";")[0]?.trim() || "";
  const candidate = responseType || declaredType;
  const mimetype = candidate.startsWith("image/") || candidate === "application/pdf"
    ? candidate
    : "application/octet-stream";
  return { data, mimetype };
}

async function audit(
  admin: SupabaseAdminClient,
  values: {
    admin_user_id: string;
    accion: "CREAR_VINCULAR_USUARIO" | "MATRICULAR" | "DESMATRICULAR" | "APROBAR_PAGO" | "CALIFICAR_TAREA" | "CREAR_CURSO_DESDE_PLANTILLA";
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
      const [courses, siteInfo, linked, pending, grades, passed] = await Promise.all([
        getCourses(),
        callMoodle("core_webservice_get_site_info"),
        admin.from("integrantes").select("id", { count: "exact", head: true }).not("moodle_user_id", "is", null),
        admin.from("integrantes").select("id", { count: "exact", head: true }).in("moodle_sync_status", ["PENDIENTE", "PROCESANDO", "PENDIENTE_VERIFICACION", "ERROR"]),
        admin.from("calificaciones_moodle").select("id", { count: "exact", head: true }).eq("tiene_nota", true),
        admin.from("calificaciones_moodle").select("id", { count: "exact", head: true }).eq("aprobado", true),
      ]);
      for (const result of [linked, pending, grades, passed]) {
        if (result.error) throw new Error(result.error.message);
      }
      const availableFunctions = new Set(
        asObjects(asObject(siteInfo).functions).map((item) => String(item.name || "")),
      );
      const academicReadFunctions = [
        "core_enrol_get_enrolled_users",
        "core_completion_get_course_completion_status",
        "core_completion_get_activities_completion_status",
        "gradereport_user_get_grade_items",
      ];
      return json(req, {
        ok: true,
        summary: {
          courses: courses.length,
          linked_users: linked.count || 0,
          pending_users: pending.count || 0,
          graded_records: grades.count || 0,
          passed_records: passed.count || 0,
          capabilities: {
            academic_read: academicReadFunctions.every((name) => availableFunctions.has(name)),
            academic_missing: academicReadFunctions.filter((name) => !availableFunctions.has(name)),
            duplicate_course: availableFunctions.has("core_course_duplicate_course"),
          },
        },
        courses,
      });
    }

    if (action === "academic_overview") {
      const inactiveDays = Math.min(180, Math.max(1, Number(body.inactive_days || 15)));
      const overview = await getAcademicOverview(inactiveDays);
      return json(req, { ok: true, ...overview });
    }

    if (action === "academic_course_students") {
      const courseId = positiveInteger(body.course_id, "El curso");
      const inactiveDays = Math.min(180, Math.max(1, Number(body.inactive_days || 15)));
      const page = nonNegativeInteger(body.page || 0, "La página");
      const perPage = Math.min(25, Math.max(5, Number(body.perpage || 15)));
      const search = normalizeSearch(body.search);
      const status = String(body.status || "all").trim().toLowerCase();
      const result = await getAcademicCourseStudents(
        admin,
        courseId,
        inactiveDays,
        page,
        perPage,
        search,
        status,
      );
      return json(req, { ok: true, ...result });
    }

    if (action === "duplicate_course") {
      const sourceCourseId = positiveInteger(body.source_course_id, "El curso plantilla");
      const fullname = String(body.fullname || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
      const shortname = String(body.shortname || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
      if (fullname.length < 3 || fullname.length > 254) throw new Error("El nombre del curso debe tener entre 3 y 254 caracteres.");
      if (shortname.length < 2 || shortname.length > 100) throw new Error("El nombre corto debe tener entre 2 y 100 caracteres.");

      const courses = await getCourses();
      const source = courses.find((course) => Number(course.id || 0) === sourceCourseId);
      if (!source) throw new Error("El curso seleccionado como plantilla no existe.");
      if (courses.some((course) => String(course.shortname || "").toLocaleLowerCase("es") === shortname.toLocaleLowerCase("es"))) {
        throw new Error("Ya existe un curso con ese nombre corto.");
      }
      const categoryId = positiveInteger(body.categoryid || source.categoryid, "La categoría");
      const visible = body.visible === true ? 1 : 0;

      try {
        const result = asObject(await callMoodle("core_course_duplicate_course", {
          courseid: sourceCourseId,
          fullname,
          shortname,
          categoryid: categoryId,
          visible,
        }));
        const createdCourseId = Number(result.id || result.courseid || 0) || null;
        await audit(admin, {
          admin_user_id: adminUserId,
          accion: "CREAR_CURSO_DESDE_PLANTILLA",
          moodle_course_id: createdCourseId,
          detalle: {
            source_course_id: sourceCourseId,
            source_course_name: source.fullname,
            fullname,
            shortname,
            categoryid: categoryId,
            visible: Boolean(visible),
          },
          resultado: "OK",
        });
        return json(req, { ok: true, course: result, source });
      } catch (error) {
        const message = cleanError(error);
        await audit(admin, {
          admin_user_id: adminUserId,
          accion: "CREAR_CURSO_DESDE_PLANTILLA",
          moodle_course_id: sourceCourseId,
          detalle: { source_course_id: sourceCourseId, fullname, shortname, categoryid: categoryId },
          resultado: "ERROR",
          error: message,
        });
        throw new Error(message);
      }
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

    if (action === "evaluation_submissions") {
      const snapshot = await getEvaluationSnapshot(admin);
      const pending = snapshot.rows.filter((row) => !row.processed).length;
      const evaluationCourses = [...new Map(snapshot.assignments.map((assignment) => [
        assignment.course_id,
        {
          id: assignment.course_id,
          fullname: assignment.course_name,
          shortname: assignment.course_shortname,
        },
      ])).values()];
      return json(req, {
        ok: true,
        courses: evaluationCourses,
        assignments: snapshot.assignments.map((assignment) => ({
          course_id: assignment.course_id,
          assignment_id: assignment.assignment_id,
          assignment_cmid: assignment.assignment_cmid,
          assignment_name: assignment.assignment_name,
          grade: assignment.grade,
          teamsubmission: assignment.teamsubmission,
        })),
        warnings: snapshot.warnings,
        summary: {
          total: snapshot.rows.length,
          pending,
          processed: snapshot.rows.length - pending,
          courses: evaluationCourses.length,
          assignments: snapshot.assignments.length,
        },
        submissions: snapshot.rows.map(publicEvaluationRow),
      });
    }

    if (action === "evaluation_file") {
      const assignmentId = positiveInteger(body.assignment_id, "La tarea");
      const submissionId = positiveInteger(body.submission_id, "La entrega");
      const fileIndex = nonNegativeInteger(body.file_index, "El archivo");
      const target = await getEvaluationTarget(assignmentId, submissionId);
      const file = target.files[fileIndex];
      if (!file) throw new Error("El archivo solicitado no existe.");
      const downloaded = await downloadMoodleFile(file);
      return new Response(downloaded.data, {
        status: 200,
        headers: {
          ...corsHeaders(req),
          "Content-Type": downloaded.mimetype,
          "Content-Length": String(downloaded.data.byteLength),
          "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    if (action === "grade_submission") {
      const assignmentId = positiveInteger(body.assignment_id, "La tarea");
      const submissionId = positiveInteger(body.submission_id, "La entrega");
      const grade = Number(body.grade);
      const feedback = String(body.feedback || "").trim();
      if (!Number.isFinite(grade)) throw new Error("La calificación no es válida.");
      if (feedback.length > MAX_FEEDBACK_LENGTH) {
        throw new Error(`El comentario no puede superar ${MAX_FEEDBACK_LENGTH} caracteres.`);
      }

      const target = await getEvaluationTarget(assignmentId, submissionId);
      const maximumGrade = Number(target.assignment.grade || 0);
      if (maximumGrade <= 0) {
        throw new Error("Esta tarea usa una escala o un método de calificación que debe evaluarse directamente en Moodle.");
      }
      if (maximumGrade !== 100) {
        throw new Error("La tarea debe estar configurada sobre 100 puntos para usar este centro de evaluación.");
      }
      if (![0, 50, 80, 100].includes(grade)) {
        throw new Error("La calificación debe ser 100, 80, 50 o 0.");
      }

      const moodleUserId = positiveInteger(target.submission.userid, "El usuario Moodle");
      const integranteId = await admin
        .from("integrantes")
        .select("id")
        .eq("moodle_user_id", moodleUserId)
        .maybeSingle()
        .then(({ data }) => Number(data?.id || 0) || null);
      const gradeParameters: Record<string, MoodleParameter> = {
        assignmentid: assignmentId,
        userid: moodleUserId,
        grade,
        attemptnumber: Number(target.submission.attemptnumber || 0),
        addattempt: 0,
        workflowstate: target.assignment.markingworkflow === 1 ? "released" : "",
        applytoall: 0,
      };
      if (feedback) {
        gradeParameters["plugindata[assignfeedbackcomments_editor][text]"] = feedback;
        gradeParameters["plugindata[assignfeedbackcomments_editor][format]"] = 2;
      }

      try {
        await callMoodle("mod_assign_save_grade", gradeParameters);
        await audit(admin, {
          admin_user_id: adminUserId,
          accion: "CALIFICAR_TAREA",
          integrante_id: integranteId,
          moodle_user_id: moodleUserId,
          moodle_course_id: target.assignment.course_id,
          detalle: {
            assignment_id: assignmentId,
            assignment_cmid: target.assignment.assignment_cmid,
            assignment_name: target.assignment.assignment_name,
            course_name: target.assignment.course_name,
            submission_id: submissionId,
            attemptnumber: Number(target.submission.attemptnumber || 0),
            grade,
            maximum_grade: maximumGrade,
            feedback_included: Boolean(feedback),
            files: target.files.map((file) => file.filename),
          },
          resultado: "OK",
        });
        return json(req, {
          ok: true,
          graded: true,
          moodle_user_id: moodleUserId,
          grade,
          maximum_grade: maximumGrade,
        });
      } catch (error) {
        const message = cleanError(error);
        await audit(admin, {
          admin_user_id: adminUserId,
          accion: "CALIFICAR_TAREA",
          integrante_id: integranteId,
          moodle_user_id: moodleUserId,
          moodle_course_id: target.assignment.course_id,
          detalle: {
            assignment_id: assignmentId,
            submission_id: submissionId,
            grade,
            maximum_grade: maximumGrade,
          },
          resultado: "ERROR",
          error: message,
        });
        throw new Error(message);
      }
    }

    if (action === "payment_submissions") {
      const snapshot = await getPaymentSnapshot(admin);
      const pending = snapshot.rows.filter((row) => !row.processed).length;
      const paymentCourses = [...new Map(snapshot.assignments.map((assignment) => [
        assignment.course_id,
        {
          id: assignment.course_id,
          fullname: assignment.course_name,
          shortname: assignment.course_shortname,
        },
      ])).values()];
      return json(req, {
        ok: true,
        courses: paymentCourses,
        assignments: snapshot.assignments.map((assignment) => ({
          course_id: assignment.course_id,
          assignment_id: assignment.assignment_id,
          assignment_cmid: assignment.assignment_cmid,
          assignment_name: assignment.assignment_name,
          grade: assignment.grade,
        })),
        courses_without_payment: snapshot.courses_without_payment,
        warnings: snapshot.warnings,
        summary: {
          total: snapshot.rows.length,
          pending,
          processed: snapshot.rows.length - pending,
          payment_courses: paymentCourses.length,
          payment_assignments: snapshot.assignments.length,
          courses_without_payment: snapshot.courses_without_payment.length,
        },
        payments: snapshot.rows.map(publicPaymentRow),
      });
    }

    if (action === "payment_file") {
      const submissionId = positiveInteger(body.submission_id, "La entrega");
      const fileIndex = nonNegativeInteger(body.file_index, "El archivo");
      const snapshot = await getPaymentSnapshot(admin);
      const payment = snapshot.rows.find((row) => row.submission_id === submissionId);
      if (!payment) throw new Error("La entrega ya no está disponible en la tarea de pago.");
      const file = payment.files[fileIndex];
      if (!file) throw new Error("El comprobante solicitado no existe.");
      const downloaded = await downloadMoodleFile(file);
      return new Response(downloaded.data, {
        status: 200,
        headers: {
          ...corsHeaders(req),
          "Content-Type": downloaded.mimetype,
          "Content-Length": String(downloaded.data.byteLength),
          "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    if (action === "approve_payment") {
      const submissionId = positiveInteger(body.submission_id, "La entrega");
      const snapshot = await getPaymentSnapshot(admin);
      const payment = snapshot.rows.find((row) => row.submission_id === submissionId);
      if (!payment) throw new Error("La entrega ya no está disponible en la tarea de pago.");
      if (payment.processed) {
        return json(req, { ok: true, already_processed: true, payment: publicPaymentRow(payment) });
      }

      const assignmentId = positiveInteger(payment.assignment.id, "La tarea de pago");
      const courseId = positiveInteger(payment.course.id, "El curso");
      const configuredGrade = Number(payment.assignment.grade || 0);
      if (configuredGrade !== PAYMENT_APPROVAL_GRADE) {
        throw new Error(
          `La tarea “${String(payment.assignment.name || PAYMENT_ASSIGNMENT_NAME)}” del curso “${String(payment.course.fullname || courseId)}” debe estar configurada sobre ${PAYMENT_APPROVAL_GRADE} puntos.`,
        );
      }

      const integranteId = Number(payment.member?.id || 0) || null;
      try {
        await callMoodle("mod_assign_save_grade", {
          assignmentid: assignmentId,
          userid: payment.moodle_user_id,
          grade: PAYMENT_APPROVAL_GRADE,
          attemptnumber: payment.attemptnumber,
          addattempt: 0,
          workflowstate: Number(payment.assignment.markingworkflow || 0) === 1 ? "released" : "",
          applytoall: 0,
        });
        await audit(admin, {
          admin_user_id: adminUserId,
          accion: "APROBAR_PAGO",
          integrante_id: integranteId,
          moodle_user_id: payment.moodle_user_id,
          moodle_course_id: courseId,
          detalle: {
            assignment_id: assignmentId,
            assignment_cmid: Number(payment.assignment.cmid || 0),
            assignment_name: String(payment.assignment.name || PAYMENT_ASSIGNMENT_NAME),
            course_name: String(payment.course.fullname || ""),
            submission_id: payment.submission_id,
            attemptnumber: payment.attemptnumber,
            grade: PAYMENT_APPROVAL_GRADE,
            files: payment.files.map((file) => file.filename),
          },
          resultado: "OK",
        });
        return json(req, {
          ok: true,
          approved: true,
          moodle_user_id: payment.moodle_user_id,
          grade: PAYMENT_APPROVAL_GRADE,
        });
      } catch (error) {
        const message = cleanError(error);
        await audit(admin, {
          admin_user_id: adminUserId,
          accion: "APROBAR_PAGO",
          integrante_id: integranteId,
          moodle_user_id: payment.moodle_user_id,
          moodle_course_id: courseId,
          detalle: {
            assignment_id: assignmentId,
            submission_id: payment.submission_id,
            attemptnumber: payment.attemptnumber,
          },
          resultado: "ERROR",
          error: message,
        });
        throw new Error(message);
      }
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
